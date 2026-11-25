<p align="center"><img src="docs/assets/atlas.svg" width="96" alt="FACET Atlas"></p>

# FACET Atlas

Atlas makes visible what coding agents build and visualizes what FACET makes measurable.

- **See the whole product.** Domains, capabilities and features as a city you can walk through, with what each part depends on.
- **Know whether the code keeps its promises.** Drift, test evidence and source anchors for every record. What is not measured is shown as unmeasured.
- **Find the next piece of work.** Views for developers, reviewers, authors, leadership and newcomers.
- **Ask and get sources.** The Companion answers questions about the repository and names the files each answer comes from.
- **Make it yours.** Plugins, themes and language packs, without changing Atlas. Bundled plugins read ADR, BPMN, DMN and wiki content.

Download your archive and `checksums.txt` from the
[latest release](https://github.com/facet-framework/atlas/releases/latest).
Choose `linux`, `darwin` (macOS) or `windows`, and `amd64` (x64) or `arm64`.
Windows archives use `.zip`; the others use `.tar.gz`. Keep the executables
from the archive together.

For example, on Linux x64:

```sh
archive=facet-atlas_0.1.0-rc.3_linux_amd64.tar.gz
grep "  $archive\$" checksums.txt | sha256sum --check
gh attestation verify "$archive" --repo facet-framework/atlas
tar -xzf "$archive"
./facet --root /path/to/project ui
```

On macOS use `shasum -a 256 --check` for the checksum. In the extraction
directory, remove the browser quarantine attribute from all four executables
with `xattr -dr com.apple.quarantine .` once.

On Windows, compare `(Get-FileHash .\facet-atlas_0.1.0-rc.3_windows_amd64.zip -Algorithm SHA256).Hash`
with its entry in `checksums.txt`, run `gh attestation verify` on that archive,
extract it with `Expand-Archive`, then run `.\facet.exe --root C:\path\to\project ui`.

Open the address printed by the command. Stop it with Ctrl-C.

[Documentation](https://facet-framework.com) · [Support](SUPPORT.md) ·
[Security](SECURITY.md) · [AGPL-3.0-only](LICENSE)
