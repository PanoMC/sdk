#!/usr/bin/env bash
# Builds the PRODUCTION (adapter-node) host for TC-9 item 2 from a private copy of themes/vanilla-theme (the checkout itself is never built or touched).
#   ./build-theme-prod.sh [targetDir]     default <umbrella>/.worktrees/e2e19-ui/vanilla-theme ; result: <targetDir>/build/index.js (E2E19_THEME_BUILD=<targetDir>/build)
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
UMBRELLA=$(cd "$HERE/../../.." && pwd -P)
TARGET=${1:-$UMBRELLA/.worktrees/e2e19-ui/vanilla-theme}
mkdir -p "$TARGET"
rsync -a --delete --exclude /.git --exclude /build --exclude /plugins --exclude /.svelte-kit "$UMBRELLA/themes/vanilla-theme/" "$TARGET/"
cd "$TARGET"
systemd-run --user --scope -p MemoryMax=6G bun run build:ui
systemd-run --user --scope -p MemoryMax=6G bun run build
ls -l build/index.js
