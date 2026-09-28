#!/usr/bin/env bash
# Captures every live transcript source into data/transcripts/live/ on a fixed
# interval and pushes each capture, so a container reset loses at most one
# interval of transcripts:
#   TRANSCRIPTS_CAPTURE_MINUTES  minutes between captures (default 5);
#   TRANSCRIPTS_CAPTURE_BRANCH   the branch the captures are pushed to (default
#                                claude/coding-agent-harness-u9l4gt);
#   ENTERPRISE_COMMIT_TRAILERS   attribution lines appended to every commit
#                                message when set.
# Each round removes whatever a failed round left uncommitted under
# data/transcripts/live/,
# pulls the branch with --rebase, runs data/transcripts/tools/capture-live.mjs,
# commits data/transcripts/live/ alone as `chore(transcripts): live capture
# <UTC stamp>`, and pushes: fetch, `git pull --rebase`, push, retrying a failure
# after 2, 4, 8 and 16 seconds. A commit that did not reach the remote is pushed
# by the next round. The commit and the push pass --no-verify: the repository's
# hooks build and typecheck the whole workspace for about three minutes, which a
# five-minute data loop cannot afford, and a capture commit holds only generated
# gzip chunks and manifests; the enterprise shift engine commits its own
# machine-written data the same way (see data/transcripts/README.md).
# Start it from a dedicated linked worktree of the branch, never the main
# checkout. A second loop exits 4 while one holds the lock; the main checkout,
# or a checkout with uncommitted changes to tracked files, exits 5; a bad
# interval exits 2.
set -u

# The whole body is one function, parsed before it runs: every round pulls the
# branch, which may rewrite this very file under the running shell.
main() {
  repo=$(git rev-parse --show-toplevel) || exit 1
  cd "$repo" || exit 1
  minutes=${TRANSCRIPTS_CAPTURE_MINUTES:-5}
  branch=${TRANSCRIPTS_CAPTURE_BRANCH:-claude/coding-agent-harness-u9l4gt}
  live=data/transcripts/live
  case "$minutes" in ''|*[!0-9]*) echo "transcripts-capture: TRANSCRIPTS_CAPTURE_MINUTES must be a whole number of minutes"; exit 2;; esac
  if [ "$minutes" -lt 1 ] || [ "$minutes" -gt 1440 ]; then
    echo "transcripts-capture: the interval needs 1 <= minutes <= 1440"
    exit 2
  fi
  if [ "$(git rev-parse --absolute-git-dir)" = "$(cd "$(git rev-parse --git-common-dir)" && pwd)" ]; then
    echo "transcripts-capture: ${repo} is the main checkout; start the loop from a dedicated worktree (git worktree add)"
    exit 5
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "transcripts-capture: the checkout has uncommitted changes to tracked files; refusing to run"
    git status --short --untracked-files=no
    exit 5
  fi

  exec 7>"${TMPDIR:-/tmp}/transcripts-capture.lock"
  if ! flock -n 7; then
    echo "transcripts-capture: another capture loop holds the lock"
    exit 4
  fi

  # Rebases onto the remote tip and pushes, retrying a failure after 2, 4, 8
  # and 16 seconds.
  push() {
    local delay
    for delay in 0 2 4 8 16; do
      sleep "$delay"
      if git fetch -q origin "$branch" && git pull -q --rebase origin "$branch" && git push -q --no-verify origin "HEAD:${branch}"; then
        return 0
      fi
      git rebase --abort >/dev/null 2>&1
    done
    return 1
  }

  while true; do
    local started stamp code message
    started=$(date -u +%s)
    stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    git reset -q -- "$live"
    git clean -fdq -- "$live"
    git checkout -q -- "$live" 2>/dev/null
    if ! git pull -q --rebase origin "$branch"; then
      git rebase --abort >/dev/null 2>&1
      echo "transcripts-capture: ${stamp} pull failed; capturing on the local tip"
    fi
    node data/transcripts/tools/capture-live.mjs; code=$?
    if [ "$code" -ne 0 ]; then
      echo "transcripts-capture: ${stamp} capture exit=${code}; nothing committed"
      git clean -fdq -- "$live"
    else
      git add -- "$live"
      if ! git diff --cached --quiet; then
        message="chore(transcripts): live capture ${stamp}"
        if [ -n "${ENTERPRISE_COMMIT_TRAILERS:-}" ]; then message="${message}"$'\n\n'"${ENTERPRISE_COMMIT_TRAILERS}"; fi
        git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q --no-verify -m "$message"
      fi
    fi
    if [ -n "$(git rev-list "origin/${branch}..HEAD" 2>/dev/null)" ]; then
      if push; then
        echo "transcripts-capture: ${stamp} pushed $(git rev-parse --short HEAD) at $(date -u +%H:%M:%SZ)"
      else
        echo "transcripts-capture: ${stamp} push failed after 5 tries; the next round pushes it"
      fi
    fi
    local wait=$(( minutes * 60 - ($(date -u +%s) - started) ))
    if [ "$wait" -gt 0 ]; then sleep "$wait"; fi
  done
}

main "$@"
exit $?
