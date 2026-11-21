#!/bin/sh
# Run Atlas release smoke: sh scripts/release-smoke.sh ARCHIVES PLATFORM.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
exec go run -mod=readonly ./backend/cmd/release smoke "$@"
