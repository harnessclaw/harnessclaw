# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.

## [0.0.7] - 2026-04-17

### Fixed

- Fixed macOS notarization failure when using Apple ID credentials by requiring `APPLE_TEAM_ID` before attempting notarization, instead of passing an empty `teamId` to `@electron/notarize`.

## [0.0.6] - 2026-04-17

### Changed

- Changed the macOS release workflow to require notarization credentials for tagged releases instead of silently publishing unsigned-notarization artifacts.
- Changed notarization setup to use a validated `notarytool` keychain profile so Apple credential failures surface as actionable CI errors.

### Fixed

- Fixed the macOS release pipeline so packaged apps are validated for notarization before upload, reducing Gatekeeper warnings after direct DMG installs.
- Fixed Apple API key handling in CI by rejecting malformed `.p8` secrets, including escaped newline formatting that previously caused opaque `notarytool` failures.
- Fixed mac build configuration to recognize both direct API-key credentials and stored keychain profiles when enabling notarization.

## [0.0.5] - 2026-04-16

### Added

- Added integrated model provider settings for OpenAI, Anthropic, and protocol-compatible custom endpoints, with synchronized app and engine configuration updates.
- Added dedicated Projects and Team entry pages, plus a conversation list page with session rename and delete actions.
- Added structured in-chat error cards so model and runtime failures are easier to read and persist across reloads.

### Changed

- Redesigned sidebar navigation to group Home and Skills separately from Conversations, Projects, and Team, and added a live-updating Recent section.
- Changed recent conversations and session lists to support inline management, background refresh, collapsible recent history, and non-blocking floating action menus.
- Simplified the chat workspace so conversation routing comes from the global sidebar and the composer stays compact without extra separators.
- Updated chat metadata timing so timestamps appear only after a response finishes, with error states aligned to the normal assistant message flow.
- Refined settings forms for provider credentials, gateway protocol mapping, toast feedback, and engine restart behavior after model configuration changes.

### Fixed

- Fixed canonical engine YAML writes so provider settings no longer append invalid or duplicate fields.
- Fixed runtime restart handling after model config changes to ensure HarnessClaw reconnects with the updated engine settings.
- Fixed conversation switching and session hydration issues that could leave chat history blank after navigation.
- Fixed recent-session and session-list menus so actions stay clickable without being clipped by their containers.
- Fixed persistence for structured runtime errors so reloading a session still shows the latest failure details.

## [0.0.4] - 2026-04-15

### Added

- Added advanced proxy settings for skill repositories, allowing repository discovery and downloads to use a dedicated proxy endpoint.
- Added release note extraction tooling so GitHub Release bodies can be generated from localized changelog sources.

### Changed

- Changed the skill market to always show enabled repositories immediately after configuration, even before any skill has been discovered.
- Changed skill discovery refresh to run in the background so the market page remains interactive during repository sync.
- Changed discovery feedback to use in-app toast notifications for completion and failure states.
- Simplified skill repository proxy configuration to protocol, host, and port only.

### Fixed

- Fixed native dependency rebuild guidance for `better-sqlite3` in Electron environments.
- Fixed desktop packaging metadata to consistently use `HarnessClaw` as the product name.

## [0.0.3] - 2026-04-14

### Added

- Initial desktop release with chat, sessions, skills, settings, and packaged updater support.
