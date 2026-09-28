#!/bin/sh
# Stands in for a heavy coverage run: its `--coverage` argument is what marks
# it heavy, and it passes only while ENTERPRISE_HEAVY_LOCK is held, which the
# engine takes through `flock` around every heavy acceptance command.
[ -n "${ENTERPRISE_HEAVY_LOCK:-}" ] && ! flock -n "$ENTERPRISE_HEAVY_LOCK" true
