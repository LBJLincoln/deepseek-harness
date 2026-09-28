#!/usr/bin/env bash
# Runs scripts/enterprise-cycle.sh on a fixed UTC schedule from the checkout it
# is started in, so the enterprise's cycles keep their times when no operator
# session is free to launch them:
#   ENTERPRISE_SCHEDULE_HOURS   the cycle runs in every UTC hour divisible by
#                               it (default 2);
#   ENTERPRISE_SCHEDULE_MINUTE  at this minute past such an hour (default 13);
#   ENTERPRISE_CYCLE_LOGS       each cycle's output goes to
#                               <dir>/cycle-<UTC stamp>.log (default
#                               /home/user/enterprise-cycles).
# The environment is passed on to every cycle, ENTERPRISE_COMMIT_TRAILERS
# included. A second scheduler exits 4 while one holds the lock. At each slot
# the scheduler first waits for any cycle still holding the cycle's lock (one
# started by hand), then starts its own, so a long cycle delays the next one
# instead of skipping it.
set -u

# The whole body is one function, parsed before it runs: the cycles pull the
# branch, which may rewrite this very file under the running shell.
main() {
  repo=$(git rev-parse --show-toplevel) || exit 1
  cd "$repo" || exit 1
  every=${ENTERPRISE_SCHEDULE_HOURS:-2}
  minute=${ENTERPRISE_SCHEDULE_MINUTE:-13}
  logs=${ENTERPRISE_CYCLE_LOGS:-/home/user/enterprise-cycles}
  case "$every" in ''|*[!0-9]*) echo "enterprise-scheduler: ENTERPRISE_SCHEDULE_HOURS must be a whole number of hours"; exit 2;; esac
  case "$minute" in ''|*[!0-9]*) echo "enterprise-scheduler: ENTERPRISE_SCHEDULE_MINUTE must be a whole number of minutes"; exit 2;; esac
  if [ "$every" -lt 1 ] || [ "$every" -gt 24 ] || [ "$minute" -gt 59 ]; then
    echo "enterprise-scheduler: the schedule needs 1 <= hours <= 24 and minute <= 59"
    exit 2
  fi

  exec 8>"${TMPDIR:-/tmp}/enterprise-scheduler.lock"
  if ! flock -n 8; then
    echo "enterprise-scheduler: another scheduler holds the lock"
    exit 4
  fi
  mkdir -p "$logs" || exit 1

  while true; do
    local now slot hour
    now=$(date -u +%s)
    slot=$(( now / 3600 * 3600 + minute * 60 ))
    while true; do
      hour=$(( slot / 3600 % 24 ))
      if [ "$slot" -gt "$now" ] && [ $(( hour % every )) -eq 0 ]; then break; fi
      slot=$(( slot + 3600 ))
    done
    echo "enterprise-scheduler: next cycle at $(date -u -d "@${slot}" +%Y-%m-%dT%H:%M:%SZ)"
    sleep $(( slot - now ))
    flock "${TMPDIR:-/tmp}/enterprise-cycle.lock" true
    local stamp
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    bash scripts/enterprise-cycle.sh > "${logs}/cycle-${stamp}.log" 2>&1 < /dev/null
    echo "enterprise-scheduler: cycle-${stamp} exit=$? at $(date -u +%H:%M:%SZ)"
  done
}

main "$@"
exit $?
