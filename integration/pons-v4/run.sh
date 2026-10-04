#!/usr/bin/env bash
# Builds the Trenchers sub-project (solc 0.8.24 + OZ 4.8.3), then runs the tests.
# Extra args go to `forge test`, e.g. ./run.sh -vvv   or   ./run.sh --mt test_FullLifecycle -vvvv
set -euo pipefail
cd "$(dirname "$0")"
FORGE="${FORGE:-$(command -v forge || echo /tmp/claude-0/foundry/forge)}"
(cd trenchers-build && "$FORGE" build)
"$FORGE" test "$@"
