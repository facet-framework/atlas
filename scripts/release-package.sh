#!/bin/sh
# Run Atlas release package: sh scripts/release-package.sh VERSION PLATFORM OUTPUT.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
exec go run -mod=readonly ./backend/cmd/release package "$@"
