### Changed

- Changed the macOS release workflow to require notarization credentials for tagged releases instead of silently publishing unsigned-notarization artifacts.
- Changed notarization setup to use a validated `notarytool` keychain profile so Apple credential failures surface as actionable CI errors.

### Fixed

- Fixed the macOS release pipeline so packaged apps are validated for notarization before upload, reducing Gatekeeper warnings after direct DMG installs.
- Fixed Apple API key handling in CI by rejecting malformed `.p8` secrets, including escaped newline formatting that previously caused opaque `notarytool` failures.
- Fixed mac build configuration to recognize both direct API-key credentials and stored keychain profiles when enabling notarization.
