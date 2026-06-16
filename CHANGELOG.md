# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.

## [0.0.23] - 2026-06-16

### Fixed

- Browser Agent sessions now run in a dedicated helper process with isolated CDP targets, preventing commands from taking over the main HarnessClaw window or another browser session.

## [0.0.22] - 2026-06-12

### Added

- The Models settings page is split into three sections — 对话 / 图片 / 视频 — with built-in image providers (OpenAI, 火山引擎) and a built-in video provider (火山引擎) always available; Ark default values are prefilled out of the box.
- Agents now support dedicated `image_generation` and `video_generation` endpoint bindings; the selectors list candidates from the new ImageGen / VideoGen configs.
- Homepage case data was lifted into `data/homeCases`, the secretary illustration switched to SVG, and a new conversation side panel plus matching sidebar icons (more / recent-arrow / settings / sidebar-collapse / sidebar-open / secretary-corner) were added.
- Bundled `imagegen` and `videogen` IPC bridges expose `listImageProviders` / `patchImageConfig` (and the video equivalents) to the renderer.

### Changed

- Image provider config merges the API base URL and path into a single full-URL field, and adopts the same 28px brand-icon style as the chat-model picker (new 火山引擎 SVG, DeepSeek switched from PNG to SVG, image/video icons no longer use a background container).
- The streaming breathing-dot indicator now renders inline with the 鎏金 shimmer status text instead of in the bottom-right of the last assistant message.
- Sidebar: in collapsed state the collapse/expand toggle now sits directly above Settings (6px gap) with a matching icon color; the recent-conversation "more" button is hidden by default and only appears on row hover, keyboard focus, or while its menu is open; macOS traffic-light buttons are centered within the 78px collapsed sidebar rail.
- Homepage polish: the "24h Online" badge now uses success color `#02B578`, the input placeholder grows from 22px to 26px, the textarea height adapts to its content, and the case category labels were restyled.
- The pre-send vision gate was removed — images now pass through directly to the engine for the upgraded multimodal pipeline.

### Fixed

- Unfinished navigation items (Scheduler / Projects / Team / x-Lab) are hidden from the sidebar until they ship, so users can no longer wander into pages that are not yet wired up.

## [0.0.21-beta.3] - 2026-06-10

### Added

- Packaged beta builds now bundle the matching `v0.0.21-beta.3` engine runtime with true image-to-image support for attached chat images and explicit source image paths.

### Fixed

- Image generation retries no longer surface empty mask/source-image parameters or PNG compression settings that are not sent to the provider.

## [0.0.21-beta.2] - 2026-06-10

### Fixed

- Restored the image generation Settings and Chat UI after the feature branch UI rollback, including the image model selector, generated-image preview cards, and GPT Image / Doubao Seedream presets.
- Reused the shared provider logo component in Settings so the restored image generation provider entries compile with the latest UI structure.

## [0.0.21-beta.1] - 2026-06-09

### Fixed

- Packaged beta builds now bundle the matching `v0.0.21-beta.1` engine runtime so image generation can wait for slower upstream providers instead of failing on the generic tool timeout.

## [0.0.21-beta.0] - 2026-06-09

### Added

- Agent image generation now has a dedicated model selector backed by provider state.
- Generated image tool results now render as preview cards in chat.
- Image-capable provider entries now show backend-resolved target URLs on the image capability badge.

### Fixed

- Packaged Browser Agent is enabled by default for new and upgraded desktop configs.
- Local dev startup now rebuilds Electron native dependencies when needed and clears stale engine port listeners before spawning the bundled engine.

## [0.0.20] - 2026-06-04

### Fixed

- Packaged Browser Agent now always launches the `agent-browser` binary bundled with the desktop app. Stale local engine configs that point to a bare `agent-browser` command no longer override the packaged runtime.
- Bundled runtime lookup now requires exact platform filenames, preventing legacy fallback paths from hiding missing release assets.
- Existing desktop configs now migrate Browser Agent to enabled once, so upgraded installs can use the packaged sidecar without manual tool configuration.

### Changed

- This release replaces the withdrawn `0.0.19` desktop release.

## [0.0.19] - 2026-06-04

### Changed

- Release packaging now consumes the engine-owned runtime bundle instead of downloading the engine and Browser Agent binaries separately. Local packaging must point at an explicit engine checkout via `HARNESSCLAW_ENGINE_SOURCE_DIR` or `--engine-source-dir`, so developer directory layouts are no longer guessed.
- Browser Agent skill files are no longer bundled from the desktop app; the engine now owns the embedded Browser Agent skill, references, and templates.

### Fixed

- Packaged apps now include the engine runtime bundle with the pinned `agent-browser` sidecar for the target platform before Electron Builder runs, keeping local packaging and GitHub Actions on the same runtime handoff.

## [0.0.18] - 2026-06-03

### Added

- Model entries now carry an optional group tag (free-form display label). The welcome wizard exposes a Group input on the connection stage; the value is persisted to the engine via the endpoint API so it survives restarts and is visible across clients pointing at the same engine. The Settings model list reconciles the local group with the engine on load — engine wins when set, otherwise the local value is silently backfilled to the engine.
- Settings > Models now lists image-generation-only providers for GPT Image and Doubao Seedream, tags image-capable models with an Image Gen chip, and keeps those endpoints out of Agent LLM routing/fallback selection.

### Fixed

- Browser Agent windows now keep their own active CDP targets when popup windows are created, preventing simultaneous browser tasks from drifting onto the wrong window.
- Release packaging now downloads the pinned target platform `agent-browser` binary instead of reusing the developer machine's local binary.

## [0.0.17] - 2026-05-26

### Added

- Session workspace drawer in the chat top bar: lists everything under `~/.harnessclaw/workspace/session/<sid>` as a collapsible file tree, with an inline preview pane on the right that handles text, code, images, audio, video, and the existing rich previews for docx / xlsx / pptx / pdf.
- "Open in file manager" button in the workspace drawer header reveals the session's working directory in Finder / Explorer (creates it on demand if the agent hasn't written anything yet).
- Plan tool now appears as a regular tool activity card under its coordinating sub-agent, with a synthetic `tool_start` / `tool_end` pair so the panel reports start, step count, and completion status.
- Tool call cards now surface the tool input content as soon as a phase update arrives, matching how it already showed up for completed calls.

### Fixed

- Removed the leading `+` from the home composer placeholder so it reads as a sentence again.
- TeamPage no longer white-screens when opening the SOP wizard or the agent dialog: the label maps and SOP step arrays declared inside `TeamPage` are now passed to the sibling `AgentDialog` / `SopWizardView` components instead of being referenced through a closure that didn't exist.
- Fixed a build failure caused by a stray UTF-16 / null-byte-corrupted trailing comment in `src/main/index.ts`.

### Changed

- Persistent session IDs are stored as bare UUIDs instead of the `harnessclaw:session:<uuid>` form. The workspace directory and IPC handlers stay tolerant of the legacy prefix so older sessions still resolve correctly.

## [0.0.16] - 2026-05-20

### Added

- Full English localization across the app — every visible string now has both `en` and `zh-CN` translations, with a runtime language toggle (sidebar previously, now relocated to the WelcomeModal header during onboarding) that persists to `appConfig.ui.language`.
- Default seeded projects ship in English on a fresh install and switch to Chinese only when the user picks `zh` during onboarding.
- WelcomeModal first-run wizard now mirrors `Settings > Models` exactly: the engine picker offers the full managed provider list (xunfei, anthropic, openai, google, deepseek, zhipu, moonshot, minimax, custom) instead of just OpenAI/Anthropic. When the user picks `custom`, a protocol selector (OpenAI / Anthropic) appears alongside the API base / key / model inputs.
- The engine picker is now a horizontal snap-scroll carousel with prev/next chevrons and a dot indicator, so all nine providers fit comfortably inside the wizard column.
- The welcome flow now writes the chosen provider to `appConfig.modelProviders.<key>` in the same shape Settings reads — so the provider, API key, base URL and model surface immediately in Settings > Models after onboarding.
- After the welcome wizard saves, the engine is also registered on the fly via the Providers Management API: PATCH/POST `/providers/{key}`, then POST a single endpoint and append `{key}:{endpointName}` to the fallback chain so the dispatcher routes immediately without a restart. The whole sequence is best-effort and silently skips when the API isn't mounted yet.
- Launcher page (Alfred-style floating prompt) added: opens via the global hotkey, forwards the typed prompt straight into a new session on the main window.

### Fixed

- Restored the `react-i18next` / `i18next` / `i18next-browser-languagedetector` runtime dependencies that were dropped during an earlier rebase — the app no longer crashes at boot when i18n initialises.
- Backfilled 110+ missing locale keys (`models.apiKeyLabel`, `models.apiBaseLabel`, `models.hotReloadLabels.*`, the entire `plan.*`, `stats.*`, `updates.*`, `storage.export.*` namespaces, etc.) in both `en.json` and `zh-CN.json`. Previously the Settings > Models page rendered raw keys like `models.apiKeyLabel` in Chinese mode.
- Engine endpoints created via the welcome flow now use a YAML-safe identifier: when a user-typed model id would parse as a number / boolean / null (e.g. `"1"`), the endpoint name is prefixed with the provider key (`minimax-1`) so the generated YAML doesn't wrap the key in quotes. The `model` field still stores the raw user input verbatim.

### Changed

- The provider-related constants and persistence helpers (`MANAGED_PROVIDER_KEYS`, `PROVIDER_DEFAULT_BASES`, `getEffectiveEngineType`, `buildAppModelConfig`, `createEmptyProviderConfig`, `resolveProviderProtocol`, …) moved out of `SettingsPage.tsx` into a shared `src/renderer/src/lib/providers.ts` module. Both Settings and the WelcomeModal import from the same source of truth.
- The first-run modal no longer writes to `engine.llm.providers` via `engineConfig.save`. Engine YAML is now exclusively owned by the Providers Management API; the renderer only writes app-level config.
- Sidebar's language switcher was removed — the welcome modal toggle replaces it for first-run users.
- Welcome stage 1 "Select Inference Engine" no longer renders the stage title / subtitle so the slider sits flush to the top, and the cards have wider padding with the check indicator floated into the top-right corner.

## [0.0.15] - 2026-05-15

### Added

- Agent default settings now talk directly to the engine `/api/v1/agent` endpoint (2026-05-14+): a dedicated dropdown reads / writes `agent.primary`, fallback routing is gated by a toggle that reveals a drag-to-reorder list, and the agent-level tuning fields (Max Tokens / Context Window / Temperature) are hot-applied through PATCH with no restart required.
- New "Answer Style" temperature control with four presets (Precise / Balanced / Flexible / Creative). The slider stays freely adjustable across the canonical [0, 1] range; the preset description card gently fades in while you adjust and fades back out 3 seconds after it stabilizes.
- Chat top-right "Stats" panel showing context-window utilization (segmented by input / cache / output / thinking tokens), token + latency cards and a per-subagent contribution breakdown, with manual refresh.
- Global keyboard shortcuts: ⌘N / Ctrl+N opens a fresh session in the home composer; ⌘, / Ctrl+, opens Settings. The bindings respect text inputs so typing a comma inside the composer is never hijacked.
- Sidebar gains a draggable resize handle on its right edge — width is clamped to 220–440px and persisted to localStorage. Collapsing returns to the icon-only rail.
- Engine wire protocol bumped to v2: top-level bare `ping`/`pong` keep-alive frames and structured ErrorInfo (categorized `error.type`, `user_message`, `retryable`, `retry_after_ms`, and a reserved `recovery` field) so failed tool calls can be classified as timeout / rate-limit / permission-denied / model-error etc. in the renderer.
- File / web preview drawers slide in from the right with a smooth animation; the primary Provider field pulses with a soft amber ring when an external event focuses it.

### Fixed

- Connection badge no longer flickers between "connected" and "disconnected" after a single missed pong. The probe loop now requires two consecutive failures before downgrading the badge, and authoritative status events from the main process win over speculative probe results.
- Engine / app config edits made in Settings now propagate immediately to the permanently-mounted ChatPage hook without bouncing through the home page.
- WebSocket teardown no longer crashes the main process when the engine drops mid-handshake — `terminate()` is now guarded by a no-op error listener and a try/catch that logs to `service.log`.
- Tool-call statuses `cancelled` / `skipped` render in neutral gray instead of the red error treatment, leaving the red color reserved for true `failed` outcomes.

### Changed

- The Stats panel intentionally hides every monetary number (trigger badge total, "Total cost" card, per-row USD) to reduce cost anxiety. "Total cost" is replaced with "Total tokens", and the per-agent column is now labeled "Contribution share". Pricing still drives the share-bar weighting internally, but no dollar amount is surfaced to the user.
- Primary Provider dropdown filters out endpoints whose owning provider is disabled (those can never route), and option labels are shortened to the canonical `provider:endpoint` ref — the parenthesized model id is gone.
- The Primary Provider row sprouts a small "Jump to settings" icon button (external-link glyph) that hops straight to the Models section so you can edit endpoint / max_tokens fields without manual navigation.
- CSP `img-src` is relaxed to allow favicons from Google / gstatic / DuckDuckGo so the web preview drawer can render site icons.
- File-path autolinking now requires a well-known filesystem root (`/Users`, `/home`, `/var`, `/tmp`, `/opt`, …) or a Windows drive prefix. Generic slash-separated labels like `/CRM/Jira` or `/Marketing/Q3` are no longer rendered as clickable paths.

## [0.0.14] - 2026-05-11

### Added

- New X·LAB entry in the left sidebar (flask icon, placed between Home and Skills) that hosts staging experiments without interfering with existing pages.
- "Continue / Retry / Cancel" decision gate now appears whenever a step's retry budget or the plan's re-plan budget is exhausted (v0.5.0 §7.1/§7.3). The engine no longer silently gives up — users explicitly tell the system how to proceed and can attach a free-text note; the reply is written back through `prompt.user_response`.
- Scheduler retry notes (e.g. "Retrying (3/3, 1.5s) — network_error") are surfaced to the renderer as `engine_note` events and rendered as a transient banner above the composer, making automatic recovery visible instead of opaque.
- Settings page now carries a dedicated "Software" section. The log level (which controls the minimum severity written to disk) moved out of the Logs viewer and lives here; the Logs page only filters what's currently displayed, removing the false impression that tweaking the dropdown rewrites on-disk logs.

### Fixed

- Container-style tool cards (Specialists / Task) are no longer reported as failed when the server watchdog emits a synthetic `orphan_timeout` close while their sub-tree (sub-agent, plan, steps) is still actively running. The client now drops the close whenever the forest still has open descendants — paired with the server-side P0/P1 root-cause fix, and retained as defense-in-depth against future regressions.
- Late `card.close` frames carrying empty-string fields like `inner.step_id=""` no longer overwrite the card's existing non-empty values. The previous behaviour silently dropped subsequent `engine_note` / `step.*` events because they could no longer resolve their owning step.
- Plan draft step reordering now uses gap-based drop targets: hovering the upper half of an item inserts before it, the lower half inserts after it, so any row can finally be dragged to become the last row. Dragging across child nodes no longer makes the drop indicator flicker.

### Changed

- Refreshed defaults in `harnessclaw-engine.yaml`: `channels.websocket.client_tools` now defaults to `false` (server-runs-tools mode, the right setting for the Web UI), `tavily_search` defaults to disabled, `llm.api_timeout` relaxed to `900s` with a new `first_byte_timeout: 120s` watchdog, a Console Management API section was added, and the deprecated `session.storage` field removed. Inline comments now document the meaning of each tunable.
- `ping` / `pong` heartbeat frames are no longer written to the engine frame trace log on either direction. service.log stays quiet during idle periods; functional frames (`card.add` / `card.close` / `card.tick`, `user.message`, etc.) are still logged in full.

## [0.0.13] - 2026-05-08

### Added

- File preview drawer now ships with a collapsible artifact list. When the active session has more than one output artifact, a handle on the drawer's left edge expands a panel that slides in from the drawer toward the left, letting users hop between files without closing the preview. The list never compresses the preview area; collapsing hides it behind the drawer.

### Changed

- Log timestamps are now written in the system's local timezone (e.g. `2026-05-08T11:23:45.678+08:00`) instead of UTC, matching the daily log file naming and what users actually see on the wall clock.

### Fixed

- AskUserQuestion / plan_review replies no longer drop with "pending askRequest not found" when the user clicks an answer right after restarting the app or while the websocket is mid-reconnect. Replies are now queued on the main side and flushed as soon as the server replays the prompt with the same `request_id`, per protocol §2.4.2 (v0.3 recovery). A 30s safety timer surfaces a hard error if the replay never arrives.
- The bottom-right "stop" pill in the chat composer no longer shows while a `prompt.user` (AskUserQuestion / permission / plan_review) is open and unanswered, removing the false "Agent 正在跑" signal in a state where the engine is actually parked waiting for input. Detection is scoped to the currently streaming assistant message so stale orphan prompts from earlier turns don't permanently suppress the indicator.
- The top-right plan status button no longer disappears mid-execution. `response_end` now keeps a confirmed plan draft alive when its `planStatus` is still `created` / `running`, so the button tracks live `step.*` events through plan completion. If the renderer somehow loses the draft (app restart, premature `response_end`, missed `plan_proposed/created`), the next `step.*` event synthesizes a minimal confirmed draft from the event's `plan_id` so the button can resurrect itself instead of dropping events silently.

## [0.0.12] - 2026-05-07

### Added

- Plan mode: a new "Plan 模式" toggle on the home composer pins the upcoming turn to the Plan coordinator and asks for explicit user confirmation. The proposed step DAG renders as an inline review card that supports edit, reorder, delete, and approve before execution starts.
- After approval, the inline plan card collapses into a compact status button at the top-right of the chat area. Clicking it opens a popover with live per-step status (pending / dispatched / running / completed / failed / skipped) and short summaries, driven by the engine's plan.* and step.* events.
- Generated text artifacts in chat now show a Download button that saves the content to a user-chosen location via a native save dialog.
- Settings → Logs adds a raw timeline view that loads the entire log buffer (no 500-line cap), sorts ascending by time, and auto-scrolls to the latest entry.

### Changed

- The chat client now speaks the engine's v2 wire protocol over the new /v1/ws endpoint, organized around a per-session card forest (text / tool_input / thinking channels). Existing chat behavior is preserved through compatibility events.
- When the engine advertises the recovery capability, in-flight ask / permission / plan prompts now survive a websocket reconnect: the server replays them by request_id and the renderer keeps the corresponding cards alive instead of cancelling them.

### Fixed

- Plain external links in chat (anchors without target=_blank, e.g. artifact preview links) no longer replace the React shell with the external page; they are now opened in the system browser via shell.openExternal.
- The file path chip in chat keeps a readable contrast in dark / stderr-style code blocks instead of collapsing to white-on-white.

## [0.0.11] - 2026-05-05

### Added

- Added an agent.intent progress line on tool cards: a flowing-light shimmer renders the current intent (e.g. "Searching vLLM papers") while the tool runs, fading to plain muted text once it finishes.
- Added the AskUserQuestion interactive tool: agents can now ask the user a question in-conversation with single-select, multi-select, custom-answer, and cancel options.
- Tool results now carry ArtifactRef metadata so produced artifacts can be tracked and opened in later views.
- Avatars are now clickable for a lightbox preview: the sidebar logo and chat avatars share a single AvatarLightbox component.

### Changed

- Aligned tool-card header heights: search-result / duration / completed badges and the expand button now share a single baseline.
- ChatPage stays mounted across route changes; leaving and returning no longer drops WebSocket listeners or streaming state.
- The sidebar light/dark toggle and the Settings theme picker now share the same `appConfig.ui.theme`, keeping both surfaces in sync.

### Fixed

- The websocket transport waiter now times out after 8 seconds when the backend is unreachable, so send/stop calls no longer hang the renderer in a "thinking" state.
- Tool-card icons and badge rows no longer drift apart from `items-start` top-alignment.

## [0.0.10] - 2026-04-27

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
