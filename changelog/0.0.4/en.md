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
