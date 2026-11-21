#!/bin/sh
# Validate release tooling and workflows: sh scripts/check-release.sh.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
version=$(node -p "require('./frontend/package.json').version")
readme_versions=$(sed -nE 's/.*facet-atlas_([^_]+)_(linux|windows)_.*/\1/p' README.md)
test -n "$readme_versions"
test "$(printf '%s\n' "$readme_versions" | sort -u)" = "$version"
! grep -R -nE '0\.1\.0-rc\.1|build-reader\.sh|build:standalone' scripts .github --exclude=check-release.sh
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.10 -shellcheck= -pyflakes=
go test -mod=readonly ./backend/cmd/release
