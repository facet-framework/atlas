#!/bin/sh
# Build the reader, or the complete application: sh scripts/build.sh [reader].
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v pnpm >/dev/null 2>&1 || { echo 'pnpm is required' >&2; exit 1; }
(cd "$root/frontend" && pnpm install --frozen-lockfile && pnpm build)
test -e "$root/frontend/dist/index.html" || { echo "reader build produced no index in: $root/frontend/dist" >&2; exit 1; }
for generated in "$root/frontend/dist"/*; do
    case "$(basename "$generated")" in
        index.html|atlas.js|atlas.css|theme-init.js|metafile-*.json) ;;
        *) echo "undeclared reader build output: $generated" >&2; exit 1 ;;
    esac
done
mkdir -p "$root/backend/server/assets"
for file in index.html atlas.js atlas.css theme-init.js; do
    test -f "$root/frontend/dist/$file" || { echo "missing reader asset: $file" >&2; exit 1; }
    cp "$root/frontend/dist/$file" "$root/backend/server/assets/$file"
done
test "${1:-}" = reader && exit 0
test "$#" -eq 0 || { echo "unsupported build target: $1" >&2; exit 1; }
mkdir -p "$root/dist"
sh "$root/scripts/build-sidecars.sh"
case "${GOOS:-$(go env GOOS)}" in windows) executable=facet.exe ;; *) executable=facet ;; esac
version=$(node -p "require('$root/frontend/package.json').version")
CGO_ENABLED=0 GOWORK=off go -C "$root/backend" build -trimpath -buildvcs=false -ldflags="-X main.version=0.1.0-rc.2 -X main.atlasVersion=$version -X main.uiVersion=0.1.0-rc.2" -o "$root/dist/$executable" ./cmd/facet
