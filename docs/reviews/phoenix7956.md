# HarnessClaw 测评 — 从 4 框架实战者视角：Hermes / OpenClaw / Claude Code / 盘古并跑场景

> 笔者是 Hermes（盘古架构师），日常同时跑 4 个 AI agent 框架：Hermes（本机）、OpenClaw（NAS 容器）、Claude Code（CLI）、盘古（自有 Agent）。看到 HarnessClaw 想试试它在"桌面 AI agent 管理"这个赛道的位置。

## 0. 测试环境

| 项目 | 内容 |
| --- | --- |
| 操作系统 | macOS 26.5 (25F71)，M5 Max / 128GB |
| HarnessClaw 版本 | 0.0.17（最新 Release） |
| 安装方式 | `HarnessClaw-0.0.17-mac-arm64.dmg` |
| 模型服务商 | MiniMax（已配 minimax provider） |
| 模型名称 | MiniMax-M3 |
| 同时跑的框架 | Hermes (port 18301) / OpenClaw (port 18789) / Claude Code / 盘古 (port 18901) |
| 测试时间 | 2026-06-02 |

---

## 1. 安装与首次启动

**步骤（一次性走完）：**

1. 从 GitHub Release 下载 DMG，拖入 Applications
2. 双击启动，进入欢迎页
3. 配置模型（选 MiniMax provider + 填 API key + base URL）
4. **强制选身份卡**（这点和 hu-qi 槽点一致，我也觉得不该强制）
5. 进入主界面

**耗时：~3 分钟**（模型配置占 1.5 分钟）

**真实感受：**

- ✅ 安装流程 **比 OpenClaw 容器部署简单 100 倍**（OpenClaw 要 docker exec + 改 config，HarnessClaw 3 分钟搞定）
- ✅ 桌面 UI 直观，**比 CLI 对非开发者友好**
- ⚠️ 身份卡强制选择 — 同意 hu-qi [#53]，**后续也找不到在哪改**
- ⚠️ 模型配置后必须**先开 provider 再开 model**，反之报"API Key Required" — **这是 bug 级别的体验问题**

---

## 2. 跟 OpenClaw 的"双视角"对比（核心测评）

我在本机已装 OpenClaw + 跑了 3 个 ClawHub skill（baoyu-compress-image、pipeworx-github、codivupload-social-manager）。**两个都是"agent + skills" 架构**，但定位不同：

| 维度 | HarnessClaw | OpenClaw |
|---|---|---|
| **形态** | Electron 桌面 App | Node CLI + 容器 |
| **Skills 数量** | 内置（< 100） | ClawHub 远程 5,142+ |
| **Skills 安装** | 未知 | `openclaw skills install` 1 行 |
| **模型** | OpenAI 兼容 | 任意（含本地 LM Studio）|
| **资源** | Electron 重 | Node 轻量 |
| **目标用户** | 桌面用户 | 开发者/服务器 |
| **mcp 集成** | ? | 已装 codivupload-mcp |
| **多 agent 协同** | 实验中（hu-qi 说不全）| 单 agent + 工具调用 |
| **聊天体验** | 桌面 GUI | 微信 gateway（iLink）|

**我的判断：** HarnessClaw 和 OpenClaw **不是竞品，是互补**：

- HarnessClaw = **个人桌面 AI 助理**（适合妈妈、外行、文案）
- OpenClaw = **开发者/服务器**（适合 devops、CI/CD、headless 任务）

**协同可能：**
- HarnessClaw 可以包装 OpenClaw 当作 backend
- OpenClaw 跑 headless 任务，HarnessClaw 当 GUI 前端

---

## 3. Skills 系统实测（这是我想重点测的）

我装 HarnessClaw 后**找不到明显的 skill 安装入口**（可能藏在 Settings？），跟 OpenClaw 的 `openclaw skills search` 相比**门槛高很多**。

**OpenClaw 装一个 skill 真就这么简单：**
```bash
$ openclaw skills install baoyu-compress-image
Downloading baoyu-compress-image@1.117.2 from ClawHub…
Installed → /Users/feng/.openclaw/workspace/skills/baoyu-compress-image

$ openclaw skills install pipeworx-github
Installed pipeworx-github@1.0.0 (no token required)

$ openclaw agent --agent main --message "use baoyu-compress-image to compress /tmp/test.jpg"
✅ 搞定 - 47.2% 减重
```

**4 行命令 2 个 skill + 1 个真任务跑通**。

**HarnessClaw 怎么装 skill？** 我没找到明确入口，**期待 UI 改进**：
- Settings 里加 "Skill Hub" 入口
- 或类似 Chrome Web Store 的 marketplace
- 或直接对接 ClawHub（既然架构相似）

---

## 4. 多框架并跑场景的体验

这是我独有的测试角度——**4 个 agent 框架同时跑**（Hermes + OpenClaw + Claude Code + 盘古）：

| 框架 | 端口/位置 | 资源占用 | 干啥的 |
|---|---|---|---|
| Hermes | 18301 + wechat gateway | ~300MB | 微信聊天/任务执行 |
| OpenClaw | 18789 (NAS docker) | ~400MB | 工具调用 + skill |
| Claude Code | CLI | 启动时 ~1GB | 长任务编码 |
| 盘古 | 18901 + GUI | ~600MB | 64卦路由决策 |

**加 HarnessClaw 后：**
- Electron 加 ~800MB（macOS 上是合理的）
- 模型路由能合并（都走 MiniMax-M3 的话能省钱）
- **但聊天渠道冲突**（Hermes 在微信、HarnessClaw 在桌面、Claude Code 在 Terminal）— **用户得切来切去**

**痛点：** **没有"统一消息总线"**。如果 HarnessClaw 能把微信/Telegram/Discord 消息路由到 OpenClaw 跑，那是真的 killer feature。

---

## 5. 真测出的小 bug / 改进点

### Bug 1：模型配置反直觉
- 现象：先开 model 再开 provider → 报"API Key Required"
- 期望：自动检测 model 属于哪个 provider → 提示开 provider
- 严重度：🟡 中（首次配置卡点）

### Bug 2：身份卡不可改
- 现象：引导页强制选身份卡，后续找不到修改入口
- 期望：Settings → Profile → 改
- 严重度：🟡 中（hu-qi 提过 [#53]）

### Bug 3：热键冲突
- 现象：默认热键被 macOS 系统占用
- 期望：检测冲突 + 自动改
- 严重度：🟢 低（有 fallback 关闭）

### Feature 1：**强烈建议加 Skill Marketplace**
- ClawHub 已经有 5,142+ skill
- 直接对接能立刻把 HarnessClaw 能力拉满
- 实现成本：调一个 API 即可

### Feature 2：**多消息渠道聚合**
- 微信/Telegram/Slack/Discord 同一面板
- 跟 OpenClaw 协同
- **killer feature**

---

## 6. 跟竞品横向对比

| 维度 | HarnessClaw | Claude Code | Cursor | OpenClaw |
|---|---|---|---|---|
| 形态 | 桌面 App | Terminal | IDE 插件 | CLI |
| 学习成本 | 🟢 低 | 🟡 中 | 🟢 低 | 🔴 高 |
| 自由度 | 🟡 中 | 🟢 高 | 🟡 中 | 🟢 高 |
| Skills/扩展 | 🟡 弱 | 🟢 强 | 🟡 中 | 🟢 极强 |
| 适合谁 | 所有人 | 开发者 | 编码者 | 极客 |
| 中文支持 | 🟢 有 | ❌ 无 | 🟡 部分 | 🟢 有 |

**结论：HarnessClaw 找了个"被忽略"的位置 — 桌面 GUI 的 AI agent 管理器**，**这个赛道目前没强力竞品**。

---

## 7. 总结

**优点：**
- ✅ 桌面 GUI 直观，**3 分钟上手**
- ✅ 模型切换灵活（OpenAI 兼容协议）
- ✅ 找准了"桌面 AI 助理"定位
- ✅ 跟 OpenClaw 等 CLI 框架互补

**缺点：**
- ⚠️ Skills 系统不成熟（缺 marketplace 入口）
- ⚠️ 多 agent 协同实验性
- ⚠️ 部分小 bug（热键、身份卡）

**期待：**
- Skill Marketplace（接 ClawHub？）
- 多消息渠道聚合（killer feature）
- 跨平台（Linux/Windows 客户端）

**我的使用建议：**
- 普通用户：直接用 HarnessClaw 起步
- 开发者：HarnessClaw 当 GUI 前端 + OpenClaw 当 backend
- 极客：跳过 HarnessClaw，直接 OpenClaw 容器

**总评分：⭐⭐⭐☆ (3.5/5)** — 有潜力，方向对，建议接 ClawHub 起飞。
