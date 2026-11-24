#!/bin/sh
# Release policy: docs/facets/policies/workspace/public-release.yaml
# Check the publication protections before GitHub can create or enter the environment.
set -eu

[ "$#" -eq 0 ] || { echo 'Usage: release-environment-check.sh' >&2; exit 2; }
if [ -z "${GH_TOKEN:-}" ]; then
  echo 'release-environment-check: RELEASE_SETTINGS_TOKEN is required' >&2
  exit 2
fi

scope=workflow
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
release_gh() { gh "$@"; }
. "$root/scripts/release-settings-check.sh"
