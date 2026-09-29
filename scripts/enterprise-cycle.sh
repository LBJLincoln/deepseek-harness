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

  # Commits whatever the given paths changed, with the cycle's message, then
  # rebases onto the remote tip and pushes, retrying a failure — a network
  # error, or a tip that a writer ignoring the push lock moved between the
  # rebase and the push — after 2, 4, 8 and 16 seconds. Each attempt holds the
  # push lock (scripts/enterprise-push-lock.ts) around its pull and push, so no
  # writer that takes it moves the tip in between; a lock not taken within
  # ENTERPRISE_PUSH_LOCK_WAIT seconds fails the ship. Returns 0 when there was
  # nothing to commit.
  ship() {
    local subject=$1; shift
    git add -- "$@" || return 1
    if git diff --cached --quiet; then return 0; fi
    local message="${subject}"
    if [ -n "${ENTERPRISE_COMMIT_TRAILERS:-}" ]; then message="${message}"$'\n\n'"${ENTERPRISE_COMMIT_TRAILERS}"; fi
    git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q --no-verify -m "$message" || return 1
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
      git rebase --abort >/dev/null 2>&1
    done
    return 1
  }

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "enterprise-cycle: the checkout has uncommitted changes to tracked files; refusing to run"
    git status --short --untracked-files=no
    exit 5
  fi
  : > "$steps"
  start=$(git rev-parse HEAD)
  git pull -q --ff-only origin "$branch"; step pull $?
  pulled=$(git rev-parse HEAD)
  remote=$(git rev-parse -q --verify "refs/remotes/origin/${branch}" || echo none)

  pnpm run -s enterprise:intake -- --min-open "$min_open"; intake=$?; step intake "$intake"
  ship "chore(enterprise): ${cycle} intake" data/enterprise; step intake-push $?

  if [ "$intake" -eq 3 ]; then
    echo "enterprise-cycle: the intake stopped at the usage limit; the shift is skipped"
  else
    ENTERPRISE_HEAVY_LOCK="$heavy_lock" ENTERPRISE_PUSH_LOCK="$push_lock" ENTERPRISE_PUSH_LOCK_WAIT="$push_lock_wait" \
      pnpm run -s enterprise -- shift --next "$tickets" --push; step shift $?
  fi

  git pull -q --ff-only origin "$branch"; step pull-after-shift $?
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
