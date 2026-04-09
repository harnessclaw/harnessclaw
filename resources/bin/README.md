Place bundled native binaries in this directory.

Recommended naming:

- `myservice-darwin-arm64`
- `myservice-darwin-x64`
- `myservice-linux-x64`
- `myservice-windows-x64.exe`

Runtime lookup rules:

1. Main process first looks for `<baseName>-<platform>-<arch>[.exe]`
2. If not found, it falls back to `<baseName>[.exe]`

Examples:

- `resolveBundledBinaryPath('myservice')`
- `resolveBundledBinaryPath('nanobot')`

Notes:

- Keep these binaries outside `asar`; they should live under `resources/bin/`
- Ensure macOS/Linux binaries have executable permission before packaging
