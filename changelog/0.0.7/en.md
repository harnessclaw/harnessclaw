### Fixed

- Fixed macOS notarization failure when using Apple ID credentials by requiring `APPLE_TEAM_ID` before attempting notarization, instead of passing an empty `teamId` to `@electron/notarize`.
