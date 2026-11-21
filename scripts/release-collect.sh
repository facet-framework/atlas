#!/bin/sh
# Run Atlas release collect: sh scripts/release-collect.sh INPUT OUTPUT.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
exec go run -mod=readonly ./backend/cmd/release collect "$@"
