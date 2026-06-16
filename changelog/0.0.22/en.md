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
