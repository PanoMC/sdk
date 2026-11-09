#!/usr/bin/env bash
# Publishes every package with the given dist-tag, skipping a version npm already has.
# @panomc/sdk is frozen on its own line (2.0.0), so a second stable release must not try to republish it.
set -euo pipefail
tag="$1"
cd "$(dirname "$0")/../packages"
for p in theme-core sdk plugin-kit client client-gen widget-host; do
  name=$(node -p "require('./$p/package.json').name")
  version=$(node -p "require('./$p/package.json').version")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip $name@$version (already on npm)"
    if [ "$tag" != "latest" ] || [ "$p" != "sdk" ]; then npm dist-tag add "$name@$version" "$tag" >/dev/null 2>&1 || true; fi
    continue
  fi
  (cd "$p" && bun publish --access public --tag "$tag" --no-git-checks)
done
