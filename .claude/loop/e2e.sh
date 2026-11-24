#!/usr/bin/env bash
# Browser tests for this checkout in one command: start a fresh preview, run the Playwright e2e tests (system Chrome,
# phone emulation) against it, stop the preview. Extra arguments go to `playwright test` (e.g. a spec file or -g).
# Screenshots taken with `shot()` land in frontend/e2e-results/.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tree=$(git -C "$here" rev-parse --show-toplevel)
trap '"$here/preview.sh" stop' EXIT INT TERM
rm -f "$tree"/frontend/e2e-results/*.png # no stale screenshots from an earlier run
url=$("$here/preview.sh" start | tail -1) || exit 1
cd "$tree/frontend" && E2E_URL=$url nix develop "$tree" -c pnpm exec playwright test "$@"
