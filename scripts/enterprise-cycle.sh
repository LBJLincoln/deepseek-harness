#!/usr/bin/env bash
# One enterprise cycle on the development branch, the unit the scheduled
# Routine runs every two hours without an operator:
#   1. intake    the Program Departments coordinators refill the ticket queue
#                when fewer than ENTERPRISE_MIN_OPEN tickets are open; admitted
#                tickets are committed and pushed first, so the shift's clone
#                of the branch tip sees them;
#   2. shift     `enterprise shift --next ENTERPRISE_TICKETS --push` works the
#                open tickets through one program and ships the approved ones
#                from its own clone;
#   3. functions the ticketless divisions run on the new tip, each heavy gate
#                taking ENTERPRISE_HEAVY_LOCK only while it runs;
#   4. roster, deck  regenerated from the ledger;
#   5. push      the functions' ledger lines and evidence, the roster and the
#                deck data are committed and pushed.
# Every step after the intake runs whatever an earlier step's outcome was,
# except that an intake stopped by the subscription's usage limit (exit 3)
# skips the shift, which would stop at the same limit. The cycle exits 0 when
# every step did, 4 when another cycle holds the lock, 5 when the checkout has
# uncommitted changes to tracked files, and otherwise the first failing step's
# code. Commits carry ENTERPRISE_COMMIT_TRAILERS (attribution lines) when set.
set -u

# The whole body is one function, parsed before it runs: the cycle pulls the
# branch, which may rewrite this very file under the running shell.
main() {

  repo=$(git rev-parse --show-toplevel)
  cd "$repo" || exit 1
  branch=${ENTERPRISE_BRANCH:-claude/coding-agent-harness-u9l4gt}
  heavy_lock=${ENTERPRISE_HEAVY_LOCK:-/tmp/dsh-heavy.lock}
  min_open=${ENTERPRISE_MIN_OPEN:-8}
  tickets=${ENTERPRISE_TICKETS:-2}
  cycle="cycle-$(date -u +%Y%m%dT%H%M%SZ)"
  first_failure=0

  exec 9>"${TMPDIR:-/tmp}/enterprise-cycle.lock"
  if ! flock -n 9; then
    echo "enterprise-cycle: another cycle holds the lock"
    exit 4
  fi

  step() {
    local name=$1 code=$2
    echo "enterprise-cycle: ${cycle} ${name} exit=${code} at $(date -u +%H:%M:%SZ)"
    if [ "$code" -ne 0 ] && [ "$first_failure" -eq 0 ]; then first_failure=$code; fi
  }

  # Commits whatever the given paths changed, with the cycle's message, then
  # rebases onto the remote tip and pushes, retrying a network error after 2, 4,
  # 8 and 16 seconds. Returns 0 when there was nothing to commit.
  ship() {
    local subject=$1; shift
    git add -- "$@" || return 1
    if git diff --cached --quiet; then return 0; fi
    local message="${subject}"
    if [ -n "${ENTERPRISE_COMMIT_TRAILERS:-}" ]; then message="${message}"$'\n\n'"${ENTERPRISE_COMMIT_TRAILERS}"; fi
    git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "$message" || return 1
    local delay
    for delay in 0 2 4 8 16; do
      sleep "$delay"
      if git pull -q --rebase origin "$branch" && git push -q origin "HEAD:${branch}"; then return 0; fi
    done
    return 1
  }

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "enterprise-cycle: the checkout has uncommitted changes to tracked files; refusing to run"
    git status --short --untracked-files=no
    exit 5
  fi
  git pull -q --ff-only origin "$branch"; step pull $?

  pnpm run -s enterprise:intake -- --min-open "$min_open"; intake=$?; step intake "$intake"
  ship "chore(enterprise): ${cycle} intake" data/enterprise; step intake-push $?

  if [ "$intake" -eq 3 ]; then
    echo "enterprise-cycle: the intake stopped at the usage limit; the shift is skipped"
  else
    pnpm run -s enterprise -- shift --next "$tickets" --push; step shift $?
  fi

  git pull -q --ff-only origin "$branch"; step pull-after-shift $?
  pnpm run -s enterprise:functions -- --shift "$cycle" --lock "$heavy_lock"; step functions $?
  pnpm run -s roster; step roster $?
  pnpm run -s enterprise:publish; step publish $?
  ship "chore(enterprise): ${cycle} functions, roster and deck" data/enterprise apps/command-deck/public/fixtures; step push $?

  echo "enterprise-cycle: ${cycle} done, first failure exit=${first_failure}"
  exit "$first_failure"
}

main "$@"
exit $?
