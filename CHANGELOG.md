# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.

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
