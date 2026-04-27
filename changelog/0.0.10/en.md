### Added

- Added a Project Workspace page that lists sessions per project and supports batch management and cross-session actions.
- Added a first-run setup wizard with a golden-ratio modal split into four stages — "Meet Emma", "Choose engine", "Connect", and "Pick profile" — featuring typed-quotes prompts and a username-aware greeting.
- Added an Agent Team page that lets you create, edit, and delete agents, compose sub-agent teams, and persist them through the new console-api bindings.
- Added file-path linkification in chat: absolute paths inside messages now render as clickable file chips and open in the existing preview drawer.
- Added pasted-block handling in the composer: long pasted snippets fold into expandable code blocks while still being sent as the original text.
- Added a DangerConfirmMenu with two-step confirmation for destructive actions such as deleting projects or sessions.

### Changed

- Replaced the placeholder sub-agent avatars with the new Emma team illustrations (analyst / developer / writer / researcher / lifestyle) and resolve them by agent name.
- Refreshed the Sidebar, Sessions, Settings, and Home surfaces and replaced the full set of application icon assets.
- Streamlined the first-launch experience by removing the previous CRT-style boot animation and splash, taking users straight into the simplified wizard.

### Fixed

- Fixed assorted styling and click issues in session action menus and project cards near viewport edges.
