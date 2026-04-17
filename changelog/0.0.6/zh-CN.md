### 变更

- 调整 macOS 发布 workflow，tag 发版时必须具备 notarization 凭据，不再静默发布未完成 notarization 的产物。
- 调整 notarization 初始化方式，改为使用经过校验的 `notarytool` keychain profile，让 Apple 凭据错误在 CI 中直接暴露为可读失败。

### 修复

- 修复 macOS 发布链路，在上传前增加打包应用的 notarization 校验，降低用户直接安装 DMG 后被 Gatekeeper 拦截的概率。
- 修复 CI 中 Apple API Key 处理逻辑，拦截格式错误的 `.p8` secret，以及错误转义换行导致的 `notarytool` 异常。
- 修复 mac 打包配置对 notarization 凭据的识别逻辑，同时兼容直接 API key 模式和已存储的 keychain profile 模式。
