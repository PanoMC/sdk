#!/usr/bin/env bash
# Builds the E2E-19 host fixture plugin jar: UI bundle (rollup, like pano-boilerplate-plugin) -> resources/plugin-ui.zip -> Gradle jar.
#   ./build.sh [panoJar]    default panoJar = <umbrella>/pano-web-platform/build/libs/Pano-local-build.jar
# Output: build/libs/tc9-fixture-local-build.jar. Needs the market checkout's node_modules (rollup, svelte, @panomc/sdk) and a built Pano jar.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
UMBRELLA=$(cd "$HERE/../../.." && pwd -P)
PANO_JAR=${1:-$UMBRELLA/pano-web-platform/build/libs/Pano-local-build.jar}
NM=${E2E19_NODE_MODULES:-$UMBRELLA/pano-web-platform/plugins/pano-plugin-market/node_modules}
WORK=$HERE/build/ui-work
[ -f "$PANO_JAR" ] || { echo "Pano jar missing: $PANO_JAR" >&2; exit 1; }
[ -d "$NM/.bin" ] || { echo "node_modules missing: $NM" >&2; exit 1; }

rm -rf "$WORK"; mkdir -p "$WORK/src/panel"
cp "$HERE/../tc9-fixture-plugin/src/main.js" "$WORK/src/theme.js"
cp "$HERE/../tc9-fixture-plugin/src/Page.svelte" "$HERE/../tc9-fixture-plugin/src/SidebarItem.svelte" "$WORK/src/"
cp "$HERE/ui/main.js" "$HERE/ui/HookProbe.svelte" "$WORK/src/"
cp "$HERE"/ui/panel/* "$WORK/src/panel/"
cp "$HERE/ui/rollup.config.js" "$WORK/rollup.config.js"
cp "$HERE/../tc9-fixture-plugin/package.json" "$WORK/package.json"
ln -s "$NM" "$WORK/node_modules"
(cd "$WORK" && node_modules/.bin/rollup -c)
rm -f "$HERE/resources/plugin-ui.zip"
(cd "$WORK/plugin-ui" && zip -qr "$HERE/resources/plugin-ui.zip" .)

export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}
cd "$HERE"
systemd-run --user --scope -p MemoryMax=6G "$UMBRELLA/pano-web-platform/gradlew" -p . "-PpanoJar=$PANO_JAR" --offline jar
ls -l build/libs/tc9-fixture-local-build.jar
