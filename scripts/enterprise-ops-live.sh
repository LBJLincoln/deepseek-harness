#!/usr/bin/env bash
# Keeps the mirror relay's operations snapshot live: from the checkout it is
# started in, it runs `scripts/enterprise-ops.ts --push` every
# OPS_INTERVAL_SECONDS, which collects one snapshot and sends it to the relay
# as `/ops`, with its activity frames as the `ops` event stream.
#   OPS_INTERVAL_SECONDS  seconds between snapshots (default 15);
#   OPS_PULL_SECONDS      the checkout is fast-forwarded from the branch this
#                         often (default 300), so the ledger, the roster and
#                         the collector itself stay current; a changed
#                         lockfile reinstalls the dependencies offline;
#   INGEST_URL            the relay's ingest function (default the Daliesk
#                         relay the deck reads);
#   INGEST_TOKEN_FILE     the relay's write token, outside the repository
#                         (default $HOME/.dsh-mirror-token);
#   ENTERPRISE_BRANCH     the branch pulled (default the development branch).
# Other variables reach the collector unchanged (ENTERPRISE_CYCLE_LOGS,
# DSH_ENTERPRISE_SCRATCH, OPS_OPERATOR_TREE). A second loop exits 4 while one
# holds the lock, and a missing token or a bad interval exits 2. A failed
# collection or push is logged and retried at the next tick; a heartbeat line
# every OPS_HEARTBEAT_SECONDS (default 600) says how many pushes landed.
set -u

# The whole body is one function, parsed before it runs: the loop pulls the
# branch, which may rewrite this very file under the running shell.
main() {
  repo=$(git rev-parse --show-toplevel) || exit 1
  cd "$repo" || exit 1
  interval=${OPS_INTERVAL_SECONDS:-15}
  pull_every=${OPS_PULL_SECONDS:-300}
  heartbeat=${OPS_HEARTBEAT_SECONDS:-600}
  branch=${ENTERPRISE_BRANCH:-claude/coding-agent-harness-u9l4gt}
  export INGEST_URL=${INGEST_URL:-https://cnaxcqiuwibsswfjjpko.supabase.co/functions/v1/ingest}
  export INGEST_TOKEN_FILE=${INGEST_TOKEN_FILE:-$HOME/.dsh-mirror-token}
  export NODE_USE_ENV_PROXY=1
  for value in "$interval" "$pull_every" "$heartbeat"; do
    case "$value" in ''|*[!0-9]*|0) echo "enterprise-ops-live: OPS_INTERVAL_SECONDS, OPS_PULL_SECONDS and OPS_HEARTBEAT_SECONDS must be whole numbers of seconds above 0"; exit 2;; esac
  done
  if [ ! -r "$INGEST_TOKEN_FILE" ]; then
    echo "enterprise-ops-live: no readable token at ${INGEST_TOKEN_FILE}; rotate one first (apps/command-deck/mirror/README.md)"
    exit 2
  fi

  exec 7>"${TMPDIR:-/tmp}/enterprise-ops-live.lock"
  if ! flock -n 7; then
    echo "enterprise-ops-live: another loop holds the lock"
    exit 4
  fi

  local last_pull=0 last_beat pushes=0 failures=0 now started elapsed lock_before
  last_beat=$(date +%s)
  echo "enterprise-ops-live: every ${interval}s from ${repo} to ${INGEST_URL} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  while true; do
    now=$(date +%s)
    if [ $(( now - last_pull )) -ge "$pull_every" ]; then
      lock_before=$(git rev-parse -q HEAD:pnpm-lock.yaml 2>/dev/null)
      if git pull -q --ff-only origin "$branch" 2>&1; then
        if [ "$(git rev-parse -q HEAD:pnpm-lock.yaml 2>/dev/null)" != "$lock_before" ]; then
          pnpm install --offline --frozen-lockfile > /dev/null 2>&1 || echo "enterprise-ops-live: install after pull failed at $(date -u +%H:%M:%SZ)"
        fi
      else
        echo "enterprise-ops-live: pull failed at $(date -u +%H:%M:%SZ); collecting from $(git rev-parse --short HEAD)"
      fi
      last_pull=$now
    fi
    started=$(date +%s)
    if timeout $(( interval * 4 + 30 )) node_modules/.bin/tsx scripts/enterprise-ops.ts --push --interval "$interval" --state "${TMPDIR:-/tmp}/enterprise-ops-live-state.json" > /dev/null 2> "${TMPDIR:-/tmp}/enterprise-ops-live.err"; then
      pushes=$(( pushes + 1 ))
    else
      failures=$(( failures + 1 ))
      echo "enterprise-ops-live: tick failed at $(date -u +%H:%M:%SZ): $(grep -v -e UNDICI -e trace-warnings "${TMPDIR:-/tmp}/enterprise-ops-live.err" | tail -2 | tr '\n' ' ')"
    fi
    now=$(date +%s)
    if [ $(( now - last_beat )) -ge "$heartbeat" ]; then
      echo "enterprise-ops-live: ${pushes} pushes, ${failures} failed ticks by $(date -u +%H:%M:%SZ)"
      last_beat=$now
    fi
    elapsed=$(( now - started ))
    if [ "$elapsed" -lt "$interval" ]; then sleep $(( interval - elapsed )); fi
  done
}

main "$@"
exit $?
