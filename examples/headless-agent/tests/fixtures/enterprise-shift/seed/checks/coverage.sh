#!/bin/sh
# Stands in for a heavy coverage run: its `--coverage` argument is what marks
# it heavy, and it passes only while ENTERPRISE_HEAVY_LOCK is held, which the
# engine takes through `flock` around every heavy acceptance command, and only
# while ENTERPRISE_E2E_API_TOKEN, the credential-named variable the e2e gives
# the engine, has not reached it.
[ -z "${ENTERPRISE_E2E_API_TOKEN:-}" ] && [ -n "${ENTERPRISE_HEAVY_LOCK:-}" ] && ! flock -n "$ENTERPRISE_HEAVY_LOCK" true
