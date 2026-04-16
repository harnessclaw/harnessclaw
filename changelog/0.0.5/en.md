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
