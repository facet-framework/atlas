# Contributing to FACET Atlas

Open an issue for a reproducible defect or a small, concrete proposal. Include
the release version, expected behavior and a minimal synthetic example. Do not
include credentials, private repository contents or another project's records.
For vulnerabilities, follow [SECURITY.md](SECURITY.md).

Keep pull requests focused. Explain the behavior or responsibility being changed
and run the checks CI runs (`.github/workflows/ci.yml`) that your change
touches, including:

Use the Node version in `.nvmrc`, pnpm 10.33.0 and the Go 1.26.8 toolchain
declared in `go.mod`.

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage --runInBand
cd ..
sh scripts/build.sh reader
sh scripts/check-go.sh
```

One Go module contains the server, composed command and sidecars. The module uses published FACET Core without a workspace or local replacements.

`frontend` contains editable browser sources, styles, translations and tests.
`backend` contains the Go HTTP server, composed command and release tooling.
`plugins` contains the bundled plugins and their sidecars.
The browser consumes `@facet-tools/ui@0.1.0-rc.2` under Apache-2.0.
The registry engine is the Apache-2.0 Core module.

`sh scripts/build.sh reader` rebuilds the browser, checks its declared outputs
and copies its four assets into `backend/server/assets/` for Go embedding. With
no argument, the same script also builds the bundled sidecars and composed command.

Run `sh scripts/check-release.sh` to validate workflows and release tooling. After
embedding the browser, set `version=$(node -p "require('./frontend/package.json').version")`
and run `sh scripts/release-package.sh "$version" linux_amd64 dist/release` from a clean commit, then
`sh scripts/release-smoke.sh dist/release linux_amd64`. Packaging requires
Go 1.26.8. The manual release workflow checks successful CI on
main, builds the browser once and runs packaging and smoke checks on six native
platforms. Publishing waits for the `release` environment; maintainers must
configure its required reviewers and main-only deployment policy before use.

Jest enforces coverage floors for global code, derivation and screens.
Preserve license notices and use synthetic fixtures in regression tests.

This repository publishes curated releases. An accepted change may be integrated
with related work before the next tagged release; acceptance does not imply an
immediate package release. Maintainers review the final source and built artifacts
together.

## Rights and contributor agreement

The current project license is **AGPL-3.0-only**; see [LICENSE](LICENSE).
Contribute only work you have the right to submit. Preserve third-party notices
and identify third-party material and its license separately.

Before merge, each contributor must explicitly sign the exact version and
SHA-256 hash of the [FACET Contributor License Agreement](CLA.md), and Pascal
Malbranche or an authorized representative must accept it. Request private
signing instructions at <hello@facet-framework.com>. Do not publish signatures,
legal identities, contact details or employer authorization evidence in this
repository. A PR
checkbox, commit signature or Signed-off-by line does not replace this agreement.
If you submitted your first pull request before signing, include its repository,
pull request number and exact head commit in the signed record of Earlier
Contributions. Both parties must explicitly accept that coverage before merge.

You retain your copyright. The CLA grants Pascal Malbranche broad transferable
and sublicensable rights, including permission to relicense your contribution
under any terms, including proprietary or commercial terms. Future releases may
use different terms, including proprietary terms, for contributions covered by
the CLA. This does not change the license of an existing release.
Open-source rights already granted for earlier releases remain in force under
their existing terms. Third-party material keeps its own terms; the CLA grants
no rights you do not own or have authority to license. Obtain any necessary
employer or other rights holder authorization before submission.

## Agent-assisted contributions

A human contributor or authorized organization must hold the necessary rights
and sign the CLA. An automated agent cannot sign on your behalf or supply
employer authorization. Review generated changes, identify their sources and
licenses, and take responsibility for the submitted patch.

## FACET records

Keep Atlas capability records in `docs/facets`. Add `@facet:` and
`@facet-role:` comments at the implementing symbols for active records.
When behavior changes, update its record and any affected anchors in the same
change. Run `npx --yes facet-framework@0.1.0-rc.2 lint` from the repository
root and fix any errors before submitting.
