#!/usr/bin/env bash
# One enterprise cycle on the development branch, the unit the scheduled
# Routine runs every two hours without an operator:
#   1. intake    the Program Departments coordinators refill the ticket queue
#                when fewer than ENTERPRISE_MIN_OPEN tickets are open; admitted
#                tickets are committed and pushed first, so the shift's clone
#                of the branch tip sees them;
#   2. shift     `enterprise shift --next ENTERPRISE_TICKETS --push` works the
#                open tickets through one program and ships the approved ones
#                from its own clone, its heavy acceptance runs taking
#                ENTERPRISE_HEAVY_LOCK, which the cycle exports to it;
#   3. functions the ticketless divisions run on the new tip, each heavy gate
#                taking ENTERPRISE_HEAVY_LOCK only while it runs;
#   4. roster, deck  regenerated from the ledger;
#   5. record    data/enterprise/cycles/<cycle>.json, built by
#                `pnpm run enterprise:cycle-record` from the step lines this
#                script appends to a temporary file and the commits it captured;
#   6. push      the functions' ledger lines and evidence, the roster, the deck
#                data and the record are committed and pushed.
# Every pull-and-push of the cycle holds the push lock ENTERPRISE_PUSH_LOCK
# (default /tmp/dsh-push.lock), waiting up to ENTERPRISE_PUSH_LOCK_WAIT seconds
# (default 1800); the cycle exports both to the shift, whose engine holds the
# same lock from its fetch through its recertification to its push.
# A checkout holding unpushed commits (a push that failed in an earlier cycle)
# pushes them before the cycle pulls, instead of failing a fast-forward. A push
# whose rebase conflicts, as generated files other writers also regenerate do
# (the roster, the scoreboard, the telemetry, the deck data), is rebuilt on the
# remote tip: the unpushed commits' new files under data/enterprise and their
# new ledger lines are saved, the checkout is reset to the tip, both are
# restored, the roster and the deck data are regenerated, and the push is tried
# again. Only a dedicated linked worktree is ever reset; in any other checkout
# the rebuild fails and the commits stay.
# Every step after the intake runs whatever an earlier step's outcome was,
# except that an intake stopped by the subscription's usage limit (exit 3)
# skips the shift, which would stop at the same limit; a record that cannot be
# written is a failed step, and the push still runs. The cycle exits 0 when
# every step did, 2 for a lock wait that is not a whole number of seconds, 4
# when another cycle holds the lock, 5 when the checkout has
# uncommitted changes to tracked files, and otherwise the first failing step's
# code. Commits carry ENTERPRISE_COMMIT_TRAILERS (attribution lines) when set.
# The cycle's own commits and pushes carry machine-written data only and pass
# --no-verify, as the shift engine and the transcript capture loop do: the
# repository's pre-push hook typechecks the workspace for about three minutes,
# in which the capture loop's five-minute pushes move the tip and the push is
# refused.
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
  push_lock=${ENTERPRISE_PUSH_LOCK:-/tmp/dsh-push.lock}
  push_lock_wait=${ENTERPRISE_PUSH_LOCK_WAIT:-1800}
  case "$push_lock_wait" in ''|*[!0-9]*) echo "enterprise-cycle: ENTERPRISE_PUSH_LOCK_WAIT must be a whole number of seconds"; exit 2;; esac
  cycle="cycle-$(date -u +%Y%m%dT%H%M%SZ)"
  first_failure=0

  exec 9>"${TMPDIR:-/tmp}/enterprise-cycle.lock"
  if ! flock -n 9; then
    echo "enterprise-cycle: another cycle holds the lock"
    exit 4
  fi

  # The cycle record's input: one "<name> <exit> <UTC time>" line per step, and
  # who started the cycle, the scheduler when it is this shell's parent process.
  steps="${TMPDIR:-/tmp}/enterprise-${cycle}.steps"
  case "$(ps -o args= -p "$PPID" 2>/dev/null)" in *enterprise-scheduler.sh*) started_by=scheduler ;; *) started_by=operator ;; esac
  step() {
    local name=$1 code=$2 at
    at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "enterprise-cycle: ${cycle} ${name} exit=${code} at ${at}"
    echo "${name} ${code} ${at}" >> "$steps"
    if [ "$code" -ne 0 ] && [ "$first_failure" -eq 0 ]; then first_failure=$code; fi
  }

  # Commits the staged changes with the given subject and the trailers.
  commit() {
    local message=$1
    if [ -n "${ENTERPRISE_COMMIT_TRAILERS:-}" ]; then message="${message}"$'\n\n'"${ENTERPRISE_COMMIT_TRAILERS}"; fi
    git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q --no-verify -m "$message"
  }

  # Whether this checkout is a linked worktree, the only kind of checkout a
  # rebuild may reset: the cycle runs from a dedicated one.
  dedicated() {
    [ "$(cd "$(git rev-parse --absolute-git-dir)" && pwd -P)" != "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]
  }

  # Whether a rebase stopped on a conflict and is still in progress.
  rebasing() {
    [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]
  }

  # Rebuilds the checkout's unpushed data as one commit on the remote tip,
  # because the generated files other writers also regenerate make a rebase of
  # it conflict: every file the unpushed commits added under data/enterprise
  # (function logs, intake and cycle records, admitted tickets) and every
  # ledger line they appended are saved under TMPDIR, the dedicated checkout is
  # reset to the tip, the files the tip lacks and the lines it does not already
  # carry are restored, `pnpm run roster` and `pnpm run enterprise:publish`
  # regenerate the rest (a failure leaves the tip's generated files for the
  # next cycle), and one commit is made; the caller pushes it. Outside a linked
  # worktree nothing is reset and the rebuild fails.
  rebuild() {
    local reason=$1 tip base save path
    git rebase --abort >/dev/null 2>&1
    if ! dedicated; then
      echo "enterprise-cycle: ${reason}; this checkout is not a dedicated worktree, so it is not reset"
      return 1
    fi
    git fetch -q origin "$branch" || return 1
    tip=$(git rev-parse FETCH_HEAD) || return 1
    base=$(git merge-base HEAD "$tip") || return 1
    save=$(mktemp -d "${TMPDIR:-/tmp}/enterprise-${cycle}-rebuild.XXXXXX") || return 1
    git diff --name-only --no-renames --diff-filter=A -z "$base" HEAD -- data/enterprise > "$save/added" || return 1
    while IFS= read -r -d '' path; do
      mkdir -p "$save/files/$(dirname "$path")" && git show "HEAD:${path}" > "$save/files/${path}" || return 1
    done < "$save/added"
    git diff --no-color --no-ext-diff --unified=0 "$base" HEAD -- data/enterprise/ledger.jsonl | sed -n 's/^+{/{/p' > "$save/ledger"
    echo "enterprise-cycle: ${reason}; rebuilding $(git rev-list --count "${base}..HEAD") unpushed commit(s) on ${tip}: $(tr -cd '\0' < "$save/added" | wc -c) new file(s) and $(wc -l < "$save/ledger") ledger line(s), saved under ${save}"
    git reset -q --hard "$tip" || return 1
    while IFS= read -r -d '' path; do
      if [ -e "$path" ]; then continue; fi
      mkdir -p "$(dirname "$path")" && cp "$save/files/${path}" "$path" || return 1
    done < "$save/added"
    grep -Fxv -f data/enterprise/ledger.jsonl "$save/ledger" >> data/enterprise/ledger.jsonl
    if ! pnpm run -s roster || ! pnpm run -s enterprise:publish; then
      echo "enterprise-cycle: the rebuild's regeneration failed; its generated files stay as the tip has them"
      git diff -z --name-only "$tip" -- data/enterprise apps/command-deck/public/fixtures ':(exclude)data/enterprise/ledger.jsonl' |
        xargs -0 -r git checkout -q "$tip" --
    fi
    git add -- data/enterprise apps/command-deck/public/fixtures || return 1
    if git diff --cached --quiet; then return 0; fi
    commit "chore(enterprise): ${cycle} rebuilds unpushed data on ${tip:0:10}"
  }

  # Pushes HEAD: rebases onto the remote tip and pushes, retrying a failure — a
  # network error, or a tip that a writer ignoring the push lock moved between
  # the rebase and the push — after 2, 4, 8 and 16 seconds. Each attempt holds
  # the push lock (scripts/enterprise-push-lock.ts) around its pull and push, so
  # no writer that takes it moves the tip in between; a lock not taken within
  # ENTERPRISE_PUSH_LOCK_WAIT seconds fails the push. A rebase that conflicts is
  # aborted and the unpushed data rebuilt on the tip before the next attempt.
  push_head() {
    local delay code
    for delay in 0 2 4 8 16; do
      sleep "$delay"
      ( flock -w "$push_lock_wait" 6 || exit 75
        git pull -q --rebase origin "$branch" && git push -q --no-verify origin "HEAD:${branch}" ) 6>>"$push_lock"
      code=$?
      if [ "$code" -eq 0 ]; then return 0; fi
      if [ "$code" -eq 75 ]; then
        echo "enterprise-cycle: the push lock ${push_lock} was not taken within ${push_lock_wait} s"
        return 1
      fi
      if rebasing; then
        rebuild "the rebase onto the remote tip conflicted" || return 1
      else
        git rebase --abort >/dev/null 2>&1
      fi
    done
    return 1
  }

  # Commits whatever the given paths changed with the cycle's message and
  # pushes it. Returns 0 when there was nothing to commit.
  ship() {
    local subject=$1; shift
    git add -- "$@" || return 1
    if git diff --cached --quiet; then return 0; fi
    commit "$subject" || return 1
    push_head
  }

  # Brings the checkout to the remote tip: a fast-forward when it holds no
  # unpushed commit, else a push of those commits as ship() pushes, rebuilt on
  # the tip when their rebase conflicts. Sets fetched_tip to the tip fetched.
  sync() {
    git fetch -q origin "$branch" || return 1
    fetched_tip=$(git rev-parse FETCH_HEAD) || return 1
    if [ -z "$(git rev-list "${fetched_tip}..HEAD")" ]; then
      git merge -q --ff-only "$fetched_tip"
      return $?
    fi
    echo "enterprise-cycle: the checkout holds $(git rev-list --count "${fetched_tip}..HEAD") unpushed commit(s); pushing them first"
    push_head
  }

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "enterprise-cycle: the checkout has uncommitted changes to tracked files; refusing to run"
    git status --short --untracked-files=no
    exit 5
  fi
  : > "$steps"
  start=$(git rev-parse HEAD)
  fetched_tip=
  sync; step pull $?
  pulled=$(git rev-parse HEAD)
  # The remote tip as fetched before any unpushed commit was pushed, so the
  # record states whether the previous cycle's own push had delivered it.
  remote=${fetched_tip:-$(git rev-parse -q --verify "refs/remotes/origin/${branch}" || echo none)}

  pnpm run -s enterprise:intake -- --min-open "$min_open"; intake=$?; step intake "$intake"
  ship "chore(enterprise): ${cycle} intake" data/enterprise; step intake-push $?

  if [ "$intake" -eq 3 ]; then
    echo "enterprise-cycle: the intake stopped at the usage limit; the shift is skipped"
  else
    ENTERPRISE_HEAVY_LOCK="$heavy_lock" ENTERPRISE_PUSH_LOCK="$push_lock" ENTERPRISE_PUSH_LOCK_WAIT="$push_lock_wait" \
      pnpm run -s enterprise -- shift --next "$tickets" --push; step shift $?
  fi

  sync; step pull-after-shift $?
  pnpm run -s enterprise:functions -- --shift "$cycle" --lock "$heavy_lock"; step functions $?
  pnpm run -s roster; step roster $?
  pnpm run -s enterprise:publish; step publish $?
  pnpm run -s enterprise:cycle-record -- --cycle "$cycle" --steps "$steps" --start "$start" --pulled "$pulled" --remote "$remote" --started-by "$started_by"; step record $?
  ship "chore(enterprise): ${cycle} functions, roster and deck" data/enterprise apps/command-deck/public/fixtures; step push $?
  rm -f "$steps"

  echo "enterprise-cycle: ${cycle} done, first failure exit=${first_failure}"
  exit "$first_failure"
}

main "$@"
exit $?
