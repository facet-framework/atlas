# Shared release settings validation. Entry points supply root, scope and release_gh:
# scripts/release-environment-check.sh (scope=workflow, the release workflow) and
# scripts/release-settings-check-all.sh (scope=all, the full check that also compares repository merge settings).
repo=facet-framework/atlas

api() {
  release_gh api --hostname github.com --method GET "$@" || {
    printf 'Cannot read Atlas release settings (%s). Use a repository-scoped token with Administration: Read and Metadata: Read.\n' "$*" >&2
    return 2
  }
}

scratch=$(mktemp -d)
trap 'rm -r "$scratch"' EXIT
trap 'exit 2' HUP INT TERM
drift=0
compare() {
  canonical='walk(if type == "array" then sort else . end)'
  jq -eS "$canonical" "$root/settings/$1.json" > "$scratch/expected" || exit 2
  printf '%s\n' "$2" | jq -eS "$canonical" > "$scratch/live" || exit 2
  if diff -u -L "expected/$1.json" -L "live/$1.json" "$scratch/expected" "$scratch/live"; then
    printf 'Atlas settings match %s\n' "$1"
  else
    [ "$?" -eq 1 ] || exit 2
    drift=1
  fi
}

ruleset() {
  response=$(api "repos/$repo/rulesets/$2") || exit 2
  actual=$(printf '%s' "$response" | jq -ce '
    select((.bypass_actors | type) == "array")
    | {name, target, enforcement, bypass_actors, conditions, rules}') || {
    echo "Cannot read bypass actors for Atlas ruleset $2. GitHub must return bypass_actors for the repository-scoped token with Administration: Read and Metadata: Read." >&2
    exit 2
  }
  if ! printf '%s' "$actual" | jq -e '.bypass_actors == []' >/dev/null; then
    echo "Atlas $1 must have no bypass actors" >&2
    drift=1
  fi
  if [ "$1" = ruleset-tag ] && ! printf '%s' "$actual" | jq -e '
    (.rules | type) == "array" and all(.rules[]; .type != "creation")' >/dev/null; then
    echo 'Atlas ruleset-tag must allow creation of version tags' >&2
    drift=1
  fi
  compare "$1" "$actual"
}

ruleset ruleset-main 27813710
ruleset ruleset-tag 27813711
response=$(api --paginate --slurp "repos/$repo/rulesets?targets=tag&includes_parents=true&per_page=100") || exit 2
active_tag_rulesets=$(printf '%s' "$response" | jq -ce '
  select(type == "array" and length > 0 and all(.[]; type == "array"))
  | [.[][] | select(.enforcement == "active") | .id]') || exit 2
compare active-tag-rulesets "$active_tag_rulesets"

# GitHub returns merge settings only to tokens that can write to the repository.
# The workflow token is read-only, so only the full pre-release check compares them;
# the workflow still verifies that the release commit is a squash of the approved tree.
if [ "$scope" = all ]; then
  response=$(api "repos/$repo") || exit 2
  actual=$(printf '%s' "$response" | jq -ce '
    select(.full_name == "facet-framework/atlas")
    | {default_branch, allow_merge_commit, allow_rebase_merge, allow_squash_merge,
       squash_merge_commit_title, squash_merge_commit_message}') || exit 2
  compare repository-merge "$actual"
fi

response=$(api "repos/$repo/environments/release") || exit 2
if ! printf '%s' "$response" | jq -e '.can_admins_bypass == false' >/dev/null; then
  echo 'Atlas release environment must disallow administrator bypass' >&2
  drift=1
fi
policies=$(api --paginate --slurp "repos/$repo/environments/release/deployment-branch-policies?per_page=100") || exit 2
branch_policies=$(printf '%s' "$policies" | jq -ce '
  select(type == "array" and length > 0 and all(.[]; (.branch_policies | type) == "array"))
  | [.[].branch_policies[] | {name, type}]') || exit 2
actual=$(printf '%s' "$response" | jq -ce --argjson branch_policies "$branch_policies" '
  {can_admins_bypass, deployment_branch_policy,
   protection_rules: [.protection_rules[] | del(.id, .node_id)
     | if .type == "required_reviewers" then .reviewers |= map({type, id: .reviewer.id}) else . end],
   branch_policies: $branch_policies}') || exit 2
compare env-release "$actual"

response=$(api "repos/$repo/immutable-releases") || exit 2
actual=$(printf '%s' "$response" | jq -ce '{enabled}') || exit 2
compare immutable-releases "$actual"
exit "$drift"
