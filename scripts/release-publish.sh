#!/bin/sh
# Release policy: docs/facets/policies/workspace/public-release.yaml
# @facet: workspace/contracts/signed-release-manifest
# @facet-role: related
# Publish the verified release assets through a draft that can be resumed.
set -eu

fail() { printf 'release-publish: %s\n' "$*" >&2; exit 2; }
[ "$#" -eq 3 ] || fail 'usage: release-publish.sh VERSION REPOSITORY DIST'
version=$1 repo=$2 dist=$3
tag="v$version"
prerelease=false
case "$version" in *-rc.*) prerelease=true ;; esac
[ -n "${GH_TOKEN:-}" ] || fail 'a workflow token is required'
[ -f "$dist/checksums.txt" ] && [ -f "$dist/release-manifest.json" ] ||
  fail 'the release requires checksums.txt and release-manifest.json'
[ -f "$dist/release-manifest.json.sig" ] || fail 'the release requires release-manifest.json.sig'

set -- "$dist/"*
[ "$#" -gt 3 ] || fail 'the release has no archives'
for asset do
  [ -f "$asset" ] || fail "invalid release asset $asset"
done
expected_assets=$(printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0) | split("/")[-1]) | sort')

if result=$(gh release view "$tag" --repo "$repo" --json isDraft,tagName 2>&1); then
  state=$(printf '%s' "$result" | jq -er --arg tag "$tag" '
    select(.tagName == $tag and (.isDraft | type) == "boolean")
    | if .isDraft then "draft" else "published" end') || fail "cannot verify release $tag"
  [ "$state" = draft ] || fail "$tag already has a published release"
else
  case "$result" in
    'release not found') gh release create "$tag" --repo "$repo" --verify-tag --draft \
      --prerelease="$prerelease" --title "FACET Atlas $version" --notes-file CHANGELOG.md ;;
    *) fail "cannot read release $tag: $result" ;;
  esac
fi
gh release upload "$tag" "$@" --repo "$repo" --clobber
result=$(gh release view "$tag" --repo "$repo" --json isDraft,tagName,assets) ||
  fail "cannot verify uploaded assets for $tag"
printf '%s\n' "$result" | jq -e --arg tag "$tag" --argjson expected "$expected_assets" '
  .isDraft == true and .tagName == $tag and ([.assets[].name] | sort) == $expected' >/dev/null ||
  fail "draft $tag does not contain exactly the expected assets"
gh release edit "$tag" --repo "$repo" --prerelease="$prerelease" --title "FACET Atlas $version" \
  --notes-file CHANGELOG.md --draft=false
