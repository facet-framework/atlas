#!/bin/sh
# Full release settings check, including repository merge settings: sh scripts/release-settings-check-all.sh.
# Needs a gh login that can read repository settings (merge settings are null for Administration: Read alone).
# Exit 0 confirms the settings, 1 reports drift, 2 reports a read or check failure.
set -eu
[ "$#" -eq 0 ] || { echo 'Usage: release-settings-check-all.sh' >&2; exit 2; }
scope=all
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# RELEASE_SETTINGS_GH can name another way to run gh, for example a wrapper command.
release_gh() { ${RELEASE_SETTINGS_GH:-gh} "$@"; }
. "$root/scripts/release-settings-check.sh"
