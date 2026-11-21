#!/bin/sh
# Build and measure bundled sidecars: sh scripts/build-sidecars.sh.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
platform_os=${GOOS:-$(go env GOOS)}
platform_arch=${GOARCH:-$(go env GOARCH)}
case "$platform_os" in windows) extension=.exe ;; *) extension= ;; esac
mkdir -p "$root/dist" "$root/backend/internal/bundledsums"
checksum() {
    if command -v sha256sum >/dev/null 2>&1; then
        measured=$(sha256sum "$1") || return 1
    else
        measured=$(shasum -a 256 "$1") || return 1
    fi
    printf '%s\n' "${measured%% *}"
}
while read -r name source extra; do
    case "$name" in ''|'#'*) continue ;; *[!a-zA-Z0-9_-]*) echo "invalid sidecar name: $name" >&2; exit 1 ;; esac
    test -n "$source" && test -z "$extra" || { echo "invalid sidecar declaration: $name $source $extra" >&2; exit 1; }
    case "$source" in plugins/*/sidecar/*) ;; *) echo "unexpected sidecar source root: $source" >&2; exit 1 ;; esac
    case "/$source/" in */../*|*/./*|*//*) echo "unsafe sidecar source path: $source" >&2; exit 1 ;; esac
    destination="$root/dist/$name$extension"
    CGO_ENABLED=0 GOOS="$platform_os" GOARCH="$platform_arch" go -C "$root" build -trimpath -buildvcs=false -o "$destination" "./$source"
    checksum "$destination" > "$root/backend/internal/bundledsums/$name-$platform_os-$platform_arch.sha256"
done < "$root/backend/sidecars.list"
