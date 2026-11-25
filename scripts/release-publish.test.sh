#!/bin/sh
# Test draft creation, retry and publication without contacting GitHub.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/atlas-publish.XXXXXX")
trap 'rm -r "$work"' EXIT
trap 'exit 1' HUP INT TERM
export TMPDIR="$work" FIXTURE="$work" PATH="$work/bin:$PATH"
export GH_TOKEN=fixture-token VERSION=0.2.0-rc.4 REPO=example/atlas
export PRERELEASE=true
mkdir "$work/bin" "$work/dist"
cd "$work"
printf '# Release notes\n' > CHANGELOG.md
for asset in checksums.txt facet-atlas_linux_amd64.tar.gz release-manifest.json release-manifest.json.sig; do
  printf 'Fixture asset\n' > "dist/$asset"
done

cat > "$work/bin/gh" <<'MOCK'
#!/bin/sh
set -eu
[ "$GH_TOKEN" = fixture-token ]
[ "$1" = release ] && [ "$3" = "v$VERSION" ] || exit 70
operation=$2
shift 3
state=$(cat "$FIXTURE/state")
case "$operation" in
  view)
    [ "$#" -eq 4 ] && [ "$1 $2 $3" = "--repo $REPO --json" ] || exit 70
    case "$state" in
      absent) echo 'release not found' >&2; exit 1 ;;
      unavailable) echo 'HTTP 403: Resource not accessible' >&2; exit 1 ;;
      draft|published) ;;
      *) exit 70 ;;
    esac
    case "$4" in
      isDraft,tagName)
        jq -n --arg tag "v$VERSION" --arg state "$state"           '{tagName: $tag, isDraft: ($state == "draft")}'
        ;;
      isDraft,tagName,assets)
        [ ! -f "$FIXTURE/read-failure" ] || exit 71
        jq -n --arg tag "v$VERSION" --arg state "$state" --rawfile names "$FIXTURE/assets" '
          {tagName: $tag, isDraft: ($state == "draft"),
           assets: ($names | split("\n") | map(select(length > 0) | {name:.}))}'
        ;;
      *) exit 70 ;;
    esac
    ;;
  create)
    [ "$state" = absent ] && [ "$#" -eq 9 ] || exit 70
    [ "$1 $2 $3 $4 $5" = "--repo $REPO --verify-tag --draft --prerelease=$PRERELEASE" ]
    [ "$6" = --title ] && [ "$7" = "FACET Atlas $VERSION" ] || exit 70
    [ "$8 $9" = '--notes-file CHANGELOG.md' ]
    echo create >> "$FIXTURE/writes"
    echo draft > "$FIXTURE/state"
    ;;
  upload)
    [ "$state" = draft ] && [ "$#" -eq 7 ] || exit 70
    [ "$1 $2 $3" = 'dist/checksums.txt dist/facet-atlas_linux_amd64.tar.gz dist/release-manifest.json' ]
    [ "$4" = dist/release-manifest.json.sig ]
    [ "$5 $6 $7" = "--repo $REPO --clobber" ]
    echo upload >> "$FIXTURE/writes"
    if [ -f "$FIXTURE/upload-failure" ]; then
      echo 'Simulated upload failure' >&2
      exit 72
    fi
    printf '%s\n' "${3##*/}" "${1##*/}" "${2##*/}" > "$FIXTURE/assets"
    if [ ! -f "$FIXTURE/missing-signature" ]; then
      printf '%s\n' "${4##*/}" >> "$FIXTURE/assets"
    fi
    ;;
  edit)
    [ "$state" = draft ] && [ "$#" -eq 8 ] || exit 70
    [ "$1 $2 $3 $4" = "--repo $REPO --prerelease=$PRERELEASE --title" ]
    [ "$5" = "FACET Atlas $VERSION" ] && [ "$6 $7 $8" = '--notes-file CHANGELOG.md --draft=false' ] || exit 70
    echo publish >> "$FIXTURE/writes"
    echo published > "$FIXTURE/state"
    ;;
  *) exit 70 ;;
esac
MOCK
chmod +x "$work/bin/gh"

publish() { sh "$root/scripts/release-publish.sh" "$VERSION" "$REPO" dist; }
expect() {
  code=$1 message=$2
  result=0
  publish > "$work/out" 2>&1 || result=$?
  if [ "$result" -ne "$code" ] || ! grep -Fq "$message" "$work/out"; then
    cat "$work/out" >&2
    echo "Expected exit $code and message: $message" >&2
    exit 1
  fi
}

echo unavailable > "$work/state"
expect 2 'cannot read release'
[ ! -e "$work/writes" ]
mv dist/release-manifest.json "$work/"
expect 2 'requires checksums.txt and release-manifest.json'
mv release-manifest.json dist/
mv dist/release-manifest.json.sig "$work/"
expect 2 'requires release-manifest.json.sig'
mv release-manifest.json.sig dist/
[ ! -e "$work/writes" ]

echo absent > "$work/state"
touch "$work/upload-failure"
expect 72 'Simulated upload failure'
[ "$(cat "$work/state")" = draft ]
[ "$(cat "$work/writes")" = "$(printf 'create\nupload')" ]
unlink "$work/upload-failure"
touch "$work/missing-signature"
expect 2 'does not contain exactly the expected assets'
[ "$(cat "$work/state")" = draft ]
unlink "$work/missing-signature"
touch "$work/read-failure"
expect 2 'cannot verify uploaded assets'
[ "$(cat "$work/state")" = draft ]
unlink "$work/read-failure"
publish
[ "$(cat "$work/state")" = published ]
expect 2 'already has a published release'
[ "$(cat "$work/writes")" = "$(printf 'create\nupload\nupload\nupload\nupload\npublish')" ]
VERSION=0.2.0 PRERELEASE=false
echo absent > "$work/state"
: > "$work/writes"
publish
[ "$(cat "$work/state")" = published ]
[ "$(cat "$work/writes")" = "$(printf 'create\nupload\npublish')" ]
echo 'OK: a verified tag and complete uploaded draft are required for publication'
