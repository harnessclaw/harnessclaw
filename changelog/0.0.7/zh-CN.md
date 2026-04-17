### 修复

- 修复使用 Apple ID 凭据时 macOS notarization 失败的问题：在尝试 notarization 前要求 `APPLE_TEAM_ID` 必须存在，避免向 `@electron/notarize` 传入空 `teamId`。
