# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.

## [0.0.9] - 2026-04-22

### Added

- Added bulk selection for the Conversations page, including batch copy, batch delete, and `Esc` to leave selection mode.
- Added iFly Search and Tavily Search settings, including engine template defaults and direct configuration fields in Settings.

### Changed

- Changed the Home composer shortcut so `Enter` sends and `Shift + Enter` inserts a newline.
- Changed the chat workspace to show richer agent activity, including better tool output rendering, subagent status persistence, and improved file preview interactions.

### Fixed

- Fixed conversation list bottom spacing and overflow so the last rows no longer get cramped against the window edge.
- Fixed session action menus in conversation surfaces so they stay visible and clickable near the viewport edge.

## [0.0.8] - 2026-04-18

### Added

- Added slash-triggered skill picking in the composer, including inline skill chips, description tooltips, and keyboard shortcuts for skill selection.
- Added a global search overlay between Home and Skills with quick actions, recent chat lookup, and keyboard-driven navigation.

### Changed

- Changed recent chat search results to use a fixed eight-slot shortcut window so visible items can be browsed and opened with stable `Win/Cmd + number` shortcuts.
- Changed selected skill chips to support keyboard focus movement, delayed descriptions, and direct deletion without leaving the composer.

### Fixed

- Fixed Home navigation from global search so creating a new session always restores focus to the main composer input.

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
