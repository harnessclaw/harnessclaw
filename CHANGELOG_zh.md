# 更新日志

本文件用于记录项目的重要更新内容。

格式参考 Keep a Changelog。英文原始版本请见 `CHANGELOG.md`。

## [0.0.22] - 2026-06-12

### 新增

- Models 设置页拆分为「对话 / 图片 / 视频」三个分段，默认内置 OpenAI、火山引擎 两个图片提供方与火山引擎 视频提供方，并预填 Ark 默认参数。
- Agent 现在支持独立的 `image_generation` / `video_generation` 端点绑定，下拉列表会列出 ImageGen / VideoGen 配置中的可选端点。
- 首页案例数据抽离到 `data/homeCases`，秘书插画改用 SVG，并新增会话侧边面板与配套侧边栏图标（more / recent-arrow / settings / sidebar-collapse / sidebar-open / secretary-corner）。
- 新增 `imagegen`、`videogen` IPC 桥，向渲染进程暴露 `listImageProviders` / `patchImageConfig`（以及视频侧的等价接口）。

### 变更

- 图片提供方配置将 API 地址与路径合并为单一完整 URL 字段，品牌图标统一为 28px 无背景容器样式（新增火山引擎 SVG，DeepSeek 由 PNG 切换为 SVG）。
- 流式呼吸闪烁小点现在与「鎏金」shimmer 状态文案同行渲染，替代原先停留在助手消息右下角的位置。
- 侧边栏：收起态的收起/展开按钮移至「设置」正上方（6px 间距）且图标颜色与其对齐；最近会话的"更多"按钮默认隐藏，仅在 hover、键盘聚焦或其菜单展开时出现；macOS 红绿灯按钮在 78px 收起边栏内居中对齐。
- 首页细节：「24h Online」徽标改用成功色 `#02B578`，输入框占位符由 22px 放大至 26px，textarea 高度随内容自适应，案例分类标签样式同步调整。
- 移除发送前的图片视觉门控，图片现在直接传递给引擎，配合升级后的多模态链路。

### 修复

- 未完成的导航项（Scheduler / Projects / Team / x-Lab）从侧边栏暂时隐藏，避免误入尚未接通的页面。

## [0.0.21-beta.3] - 2026-06-10

### 新增

- 打包版 beta 现在会内置匹配的 `v0.0.21-beta.3` engine 运行时，支持对聊天附件图片和显式图片路径进行真正的图生图。

### 修复

- 图片生成重试不再展示空的蒙版/源图参数，也不会继续展示实际不会发送给 provider 的 PNG 压缩参数。

## [0.0.21-beta.2] - 2026-06-10

### 修复

- 恢复被 feature 分支 UI 回退覆盖的图片生成设置与对话界面，包括图片模型选择器、生成图片预览卡片，以及 GPT Image / 豆包 Seedream 预设。
- 设置页复用新的公共 Provider Logo 组件，确保恢复后的图片生成 Provider 入口与最新 UI 结构一起正常构建。

## [0.0.21-beta.1] - 2026-06-09

### 修复

- 打包版 beta 现在会内置匹配的 `v0.0.21-beta.1` engine 运行时，让图像生成可以等待较慢的上游服务，不再因为通用工具超时而失败。

## [0.0.21-beta.0] - 2026-06-09

### 新增

- Agent 图像生成现在提供独立的模型选择器，并从 provider 状态读取可用模型。
- 图像生成工具结果现在会在聊天中显示为图片预览卡片。
- 支持图像能力的 provider 条目现在会在图像能力标记上显示后端解析出的目标地址。

### 修复

- 打包版 Browser Agent 现在会在新配置和升级后的桌面配置中默认启用。
- 本地开发启动现在会在需要时重建 Electron 原生依赖，并在启动内置 engine 前清理残留的 engine 端口监听。

## [0.0.20] - 2026-06-04

### 修复

- 打包版 Browser Agent 现在始终启动桌面应用内置的 `agent-browser` 二进制。旧的本地 engine 配置即使指向裸 `agent-browser` 命令，也不会再覆盖打包运行时。
- 内置运行时查找现在要求精确的平台文件名，避免旧 fallback 路径掩盖 release asset 缺失问题。
- 现有桌面端配置现在会一次性迁移并启用 Browser Agent，升级安装后无需手动配置工具即可使用内置 sidecar。

### 变更

- 本版本替代已撤回的 `0.0.19` 桌面端 release。

## [0.0.19] - 2026-06-04

### 变更

- Release 打包现在消费 engine 发布的运行时包，不再分别下载 engine 与 Browser Agent 二进制。本地打包必须通过 `HARNESSCLAW_ENGINE_SOURCE_DIR` 或 `--engine-source-dir` 显式指定 engine checkout，不再猜测开发者目录结构。
- Browser Agent 的 skill 文件不再由桌面端随包携带；engine 现在负责内嵌 Browser Agent skill、references 与 templates。

### 修复

- Electron Builder 运行前会先准备目标平台的 engine runtime bundle，并带上锁定版本的 `agent-browser` sidecar，使本地打包与 GitHub Actions 使用同一套运行时交接逻辑。

## [0.0.18] - 2026-06-03

### 新增

- 模型条目新增可选 group 字段（自由文本展示标签）。欢迎引导的「连接」步骤新增「分组名」输入框；group 通过 endpoint API 持久化到引擎，重启不丢失，多客户端连同一引擎时可见。Settings 模型列表加载后会与引擎对账：引擎有值则覆盖本地，引擎空但本地有则静默 backfill 推回引擎。
- 「设置 > 模型配置」新增 GPT Image 与豆包 Seedream 两个文生图 provider，支持用「生图」标签标识图片生成模型，并避免这些 endpoint 被加入 Agent LLM 路由与兜底链路。

### 修复

- Browser Agent 创建弹窗时会保留各自独立的活动 CDP 目标，避免多个浏览器任务同时运行时漂移到错误窗口。
- Release 打包现在会下载已锁定版本、目标平台对应的 `agent-browser` 二进制，不再复用开发机本地平台的二进制。

## [0.0.17] - 2026-05-26

### 新增

- 聊天顶栏新增「工作区」抽屉：以可折叠文件树展示 `~/.harnessclaw/workspace/session/<sid>` 目录下的全部内容，右侧自带内联预览面板，支持文本、代码、图片、音视频，以及 docx / xlsx / pptx / pdf 的富预览。
- 工作区抽屉头部新增「在文件管理器中打开」按钮，可在 Finder / Explorer 中直接打开当前会话的工作目录（目录不存在时会自动创建）。
- Plan 工具现在会以普通工具活动卡片的形式出现在对应协调子智能体下，通过合成的 `tool_start` / `tool_end` 事件汇报开始、步骤数与完成状态。
- 工具调用卡片在阶段更新阶段就会实时展示工具输入内容，与已完成调用的展示方式保持一致。

### 修复

- 移除首页输入框占位符开头多余的 `+`，恢复正常句式。
- 修复打开 SOP 向导或角色编辑弹窗时 TeamPage 整页白屏的问题：原本依赖闭包访问的标签映射与步骤数组已改为通过 props 显式传给 `AgentDialog` / `SopWizardView`。
- 修复 `src/main/index.ts` 文件末尾残留的 UTF-16 / NUL 字节注释导致的构建失败。

### 变更

- 持久化会话 ID 改为裸 UUID，不再带 `harnessclaw:session:<uuid>` 前缀。工作目录与 IPC 处理仍兼容旧前缀格式，老会话能正常解析。

## [0.0.16] - 2026-05-20

### 新增

- 全应用英文本地化：所有界面字符串均同时配套 `en` 与 `zh-CN` 文案,支持运行时切换语言并持久化到 `appConfig.ui.language`（首次启动时的切换按钮已从侧边栏迁移到欢迎弹窗顶栏)。
- 首次安装的内置示例项目使用英文文案,用户在首次启动选择中文时再切回中文版本。
- WelcomeModal 首次启动向导和 `设置 > 模型配置` 完全对齐:推理引擎选择支持全部托管 provider(xunfei、anthropic、openai、google、deepseek、zhipu、moonshot、minimax、custom),不再只提供 OpenAI / Anthropic 两项。选择 `custom` 时,连接配置阶段会额外出现协议选择器(OpenAI / Anthropic)。
- 推理引擎选择改为横向滑动卡片,带前后 chevron 按钮与底部指示点,9 个 provider 在向导列宽内可以舒适浏览。
- 欢迎向导完成时,所选 provider 会以和 Settings 完全一致的 schema 写入 `appConfig.modelProviders.<key>`(apiKey / apiBase / model / protocol / extraHeaders / enabled),完成首启后进入 `设置 > 模型配置` 立即就能看到。
- 欢迎向导保存的同时,通过 Providers Management API 即时在引擎侧注册:先 PATCH/POST `/providers/{key}`,再 POST 一条 endpoint,然后把 `{key}:{endpointName}` 追加到 fallback chain,使 dispatcher 立即路由、无需重启。整个流程是 best-effort,API 未挂载时静默跳过。
- 新增 Launcher 页面(Alfred 风格悬浮输入):通过全局快捷键唤出,把输入的 prompt 直接发送到主窗口的新会话。

### 修复

- 修复因之前 rebase 误删导致的 `react-i18next` / `i18next` / `i18next-browser-languagedetector` 运行依赖缺失:i18n 初始化时不再崩溃。
- 补齐 en.json 与 zh-CN.json 两边共 110+ 缺失的本地化 key:`models.apiKeyLabel`、`models.apiBaseLabel`、`models.hotReloadLabels.*`,以及完整的 `plan.*` / `stats.*` / `updates.*` / `storage.export.*` 等命名空间。中文模式下 `设置 > 模型配置` 页面之前出现的 `models.apiKeyLabel` 这类原始 key 现已全部解析为正常文案。
- 欢迎向导写入的 endpoint 名称改为 YAML 安全的标识符:当用户输入的 model id 是纯数字 / 布尔 / null 关键字时(如 `"1"`),endpoint 名称会自动前缀 provider key(如 `minimax-1`),生成的 YAML 不再加引号;`model` 字段仍按用户原始输入保存。

### 变更

- 抽取了所有 provider 相关常量与持久化辅助函数(`MANAGED_PROVIDER_KEYS`、`PROVIDER_DEFAULT_BASES`、`getEffectiveEngineType`、`buildAppModelConfig`、`createEmptyProviderConfig`、`resolveProviderProtocol`…)到独立模块 `src/renderer/src/lib/providers.ts`。Settings 与 WelcomeModal 从同一处导入,避免再次出现重复定义。
- 首次启动向导不再通过 `engineConfig.save` 写入 `engine.llm.providers`。引擎 YAML 由 Providers Management API 独占,渲染端只写应用级配置。
- 侧边栏的语言切换按钮已移除,首启用户改由欢迎弹窗顶栏的切换按钮控制语言。
- 欢迎向导「选择推理引擎」阶段不再渲染阶段标题与副标题,滑动选择器直接顶到顶部;卡片整体放宽,勾选指示器移到右上角避免与标题挤在一起。

## [0.0.15] - 2026-05-15

### 新增

- Agent 默认设置全面对接引擎 `/api/v1/agent`（2026-05-14+）：主 Provider 通过单独的下拉直接读写 `agent.primary`，Provider 负载兜底改为开关，开启后可在 fallback 列表里拖拽排序 / 增删；Agent 调用参数 (Max Tokens / Context Window / Temperature) 走 PATCH 即时热更，无需重启。
- 全新「回答风格」温度滑动条：四档预设（精准 / 平衡 / 灵活 / 创意）配独立卡片说明，拖动滑块即可在精准与创意之间无级调节；卡片在调整时温柔淡入、停下 3 秒后淡出，避免界面长期占用空间。
- 对话页右上角新增「统计」面板：上下文窗口使用率（按 input / cache / output / thinking 分段）、token 与延迟汇总、子 agent 贡献占比一目了然，支持轮询刷新。
- 全局快捷键：⌘N / Ctrl+N 跳到首页新会话输入框，⌘, / Ctrl+, 打开设置；编辑器内输入逗号不会被吞掉。
- 侧边栏右边缘新增拖拽手柄，可在 220–440px 之间调节宽度并记忆到本地；调宽时不掉帧，调窄时回到折叠态。
- 引擎 wire 协议升级到 v2：支持顶层 bare `ping`/`pong` 心跳帧、结构化 ErrorInfo（含 error.type 分类、user_message、retryable、retry_after_ms 与未来扩展用的 recovery 字段），工具失败 UI 可据此区分超时 / 限流 / 拒绝执行 / 模型错误等不同形态。
- 文件预览 / 网页预览抽屉新增「从右滑入」动画，主 Provider 字段在被外部状态触发时会有一次柔和的琥珀色脉冲提示。

### 修复

- 连接状态徽标不再因单次心跳超时就掉到「未连接」：现在要求连续两次 probe 失败才下沉，主进程权威事件优先级高于探针猜测，彻底治好首页徽标闪烁。
- 设置页改动引擎 / 应用配置后，常驻挂载的 ChatPage 立即同步新值，不需要切回首页再切回去重新加载。
- 引擎在握手未完成时被掐断不再触发主进程 uncaughtException 崩溃：WebSocket terminate 现在带有错误吞咽和日志，主进程优雅清理。
- 工具调用的 `cancelled` / `skipped` 状态从红色错误样式改为中性灰色，与真正失败的 `failed` 区分。

### 变更

- 「统计」面板隐藏所有金额信息（触发徽标的总花费、4-up 卡片中的「总花费」、子 agent 行的美元数）以降低成本焦虑；总花费卡换成「总 token」，子 agent 列改名「贡献占比」。内部仍按价格加权计算占比，但不再向用户展示具体金额。
- 主 Provider 下拉自动过滤掉被 disable 的整厂商下的 endpoint，避免选到一个永远不会路由的项；选项标签简化为 `provider:endpoint`，括号里的 model id 不再重复出现。
- 主 Provider 行左侧新增「跳转设置」按钮（外链图标），一键跳到「模型配置」分区编辑 endpoint / max_tokens 等底层字段。
- CSP `img-src` 放开 Google / gstatic / DuckDuckGo 的图标域名，让网页预览抽屉的 favicon 能正常显示。
- 文件路径自动链接收紧匹配规则：只对常见文件系统根（`/Users`、`/home`、`/var`、`/tmp`、`/opt` 等）和 Windows 盘符路径生效，`/CRM/Jira`、`/Marketing/Q3` 这类业务面包屑不再被误判成可点击的路径。

## [0.0.14] - 2026-05-11

### 新增

- 左侧导航新增 X·LAB 实验室入口（位于「首页」与「技能」之间，烧瓶图标），用作阶段性实验功能的承载页，不与已有页面相互干扰。
- 执行卡新增「继续 / 重试 / 取消」决策门：当某个步骤的重试预算或整个计划的 re-plan 预算耗尽，引擎不再静默放弃，而是上浮一张决策卡（v0.5.0 §7.1/§7.3），用户可在 UI 上明确告诉系统下一步怎么走，并可附加备注；决策回执通过 `prompt.user_response` 回写引擎。
- Scheduler 在自动重试时下发的状态提示（例如"重试中 (3/3, 1.5s 后再试) — network_error"）会以 `engine_note` 形式透传到对话框上方临时横幅，调度过程不再黑盒。
- 设置页拆出独立的「软件设置」分区。日志等级（控制实际写入日志文件的最低等级）从「日志」模块迁到此处；「日志」页面仅保留筛选当前展示的等级，不再产生"调一下就改写盘上日志"的歧义。

### 修复

- Specialists / Task 等容器型工具卡不再被服务端 watchdog 的合成 `orphan_timeout` close 误报失败。客户端在 forest 中发现仍有未关闭子卡时直接丢弃该 close，UI 不再出现"工具失败但步骤仍在执行"的矛盾画面（与服务端 P0/P1 修复协同生效，并保留为防御纵深，覆盖将来同类回归）。
- 延迟到达的 `card.close` 帧若携带 `inner.step_id=""` 等空字符串字段，不再覆盖卡片原有的非空值。修复前会导致后续 `engine_note` / `step.*` 事件因找不到所属 step 而被静默丢弃。
- 计划草稿（PlanDraftCard）的步骤拖拽改用「间隙位置」判定——鼠标处于条目上半部表示插到该项之前、下半部表示插到之后；任何项现在都可以真正成为最后一项，拖入子节点时插入指示线也不再闪烁。

### 变更

- 引擎模板 `harnessclaw-engine.yaml` 默认值整理：`channels.websocket.client_tools` 默认改为 `false`（服务端跑工具的标准模式，匹配 Web UI 用法）、`tavily_search` 默认关闭、`llm.api_timeout` 放宽到 `900s` 并新增 `first_byte_timeout: 120s` 看门狗、新增 Console Management API 节、移除已废弃的 `session.storage` 字段；同时补充各字段的中文/英文用途说明。
- `ws send` / `ws recv` 中的 `ping` / `pong` 心跳帧不再写入 frame 追踪日志，避免 service.log 在长时间空闲时被心跳噪声淹没；功能性帧（`card.add`/`card.close`/`card.tick`、`user.message` 等）仍正常记录。

## [0.0.13] - 2026-05-08

### 新增

- 文件预览抽屉新增可收起的产出文件列表。当本会话产出文件多于 1 个时，抽屉左缘出现把手按钮，点击后文件目录从抽屉边缘向左滑出，方便用户在多个产物之间快速切换；目录不会挤占原有预览区，收起态会被抽屉遮住。

### 变更

- 日志时间戳改为按系统本地时区写入（例如 `2026-05-08T11:23:45.678+08:00`），不再写 UTC。与按本地日期命名的日志文件保持一致，避免出现"日志时间和我看到的时间差 8 小时"的歧义。

### 修复

- 关 App / WS 抖动后，用户在已弹出的 AskUserQuestion / plan_review 卡片上点回复，不再因为"pending askRequest not found"被丢弃。主进程现在把回包入队，等服务端按相同 `request_id` 重放 prompt 后立即发出（对齐协议 §2.4.2 的 v0.3 recovery 行为）；30 秒兜底超时后再回失败，避免 UI 永久挂起。
- 当聊天对话框存在未答的 `prompt.user`（追问 / 权限请求 / 计划审阅）时，右下角不再显示红色"停止"圆点，避免给用户"Agent 正在跑"的歧义；检测仅作用于当前正在 streaming 的助手消息，不会被旧轮的孤儿 prompt 永久压制。
- 右上角计划看板按钮不再在 plan 执行中途消失。`response_end` 在 plan 处于 `created` / `running` 状态时会保留 confirmed 草稿，让按钮一直跟到 `plan_completed/failed`；若草稿因重启等原因丢失，下一条 `step.*` 事件会按 `plan_id` 合成最小可用草稿，按钮可自动复活，后续步骤继续累积。

## [0.0.12] - 2026-05-07

### 新增

- Plan 模式：首页输入框新增「Plan 模式」开关，开启后本次提问会显式走 Plan 协调器并要求用户确认步骤；提案的步骤 DAG 以审阅卡片形式渲染，支持编辑、重排、删除与一键通过后再执行。
- 计划通过后，内联的审阅卡片会收起为对话区右上角的小型状态按钮，点击可弹出执行情况：包含每一步的实时状态（待执行 / 已派发 / 执行中 / 已完成 / 失败 / 跳过）与简短结果摘要，状态由引擎的 plan.* / step.* 事件驱动。
- 对话里的文本类产物新增「下载」按钮，可通过系统原生保存对话框将内容存到本地。
- 设置 → 日志新增原始时间线视图：不再受 500 行上限限制，按时间正序加载并自动滚动到最新一行，便于回看完整链路。

### 变更

- 对话客户端切换到引擎的 v2 通讯协议（新端点 /v1/ws），围绕每会话的「卡片森林」（文本 / 工具输入 / 思考链路）组织事件流；通过兼容事件保持既有对话行为不变。
- 当引擎声明 recovery 能力时，正在等待用户输入的提问 / 权限 / 计划审阅请求可在 websocket 重连后由服务端按 request_id 重放，前端不再因短暂断线而把对应卡片标记为已取消。

### 修复

- 对话中没有 target=_blank 的普通外链（如产物预览链接）不再把整个 React 应用替换成外部网页，改为通过 shell.openExternal 调起系统浏览器打开。
- 对话中的文件路径胶囊在深色 / 标准错误风格的代码块里不再退化为白底白字，保持可读对比度。

## [0.0.11] - 2026-05-05

### 新增

- 工具卡片新增 agent.intent 进度行：运行中以鎏光效果显示当前意图（例如「正在搜索 vLLM 论文」），运行结束后退化为静态文案。
- 支持 AskUserQuestion 互动工具：Agent 可在对话中以选项卡片向用户发问，支持单选、多选、自定义回答与取消。
- 工具结果支持 ArtifactRef 物件引用元数据，便于后续在产物列表中追踪和打开。
- 头像点击可放大预览：侧边栏 Logo 与对话头像接入统一的 AvatarLightbox 组件。

### 变更

- 工具卡片头部高度统一：搜索结果、时长、完成等徽章与下拉按钮采用同一基线，避免视觉错位。
- ChatPage 在路由切换时保持挂载，离开后再返回不再丢失 WebSocket 监听与流式状态。
- 侧边栏明暗切换与 Settings 主题选项共享同一份 appConfig.ui.theme，两处相互联动、不再互相覆盖。

### 修复

- 后端不可达时 websocket 等待方加 8 秒超时，避免发送/停止挂死、渲染层一直停留在「思考中」。
- 工具卡片图标与徽章行不再因 items-start 顶端对齐而错位。

## [0.0.10] - 2026-04-27

### 新增

- 新增项目工作区页（Project Workspace），支持在项目维度查看会话、批量管理与跨会话操作。
- 新增首次启动配置向导：黄金比例弹窗，分为「认识 Emma」「选择推理引擎」「配置连接信息」「选择任务画像」四步，加入打字机示例问法与按用户名问候。
- 新增 Agent Team 可视化与编辑页，支持创建 / 编辑 / 删除 Agent，可编排子 Agent 团队，并通过 console-api 持久化。
- 新增对话中文件路径自动识别能力：消息里的绝对路径会变成可点击的文件徽章，点击后在右侧抽屉打开内容。
- 新增聊天输入框的「粘贴块（Pasted Blocks）」处理：长粘贴自动折叠为可展开的代码块，发送时仍按原文提交。
- 新增危险操作二次确认菜单（DangerConfirmMenu），覆盖删除项目 / 会话等场景。

### 变更

- 替换 Agent Team 子 Agent 的占位图标为新的 Emma 团队插画（分析 / 开发 / 写作 / 调研 / 生活），并按 agent 名称智能匹配。
- 重构 Sidebar、Sessions、Settings、Home 的视觉与交互细节，并替换全部应用图标资源。
- 优化首次启动体验，移除原 CRT 电视开机动画与启动画面，改为更轻量的直接进入向导。

### 修复

- 修复部分会话操作菜单与项目卡片在边缘场景下的样式与点击问题。

## [0.0.9] - 2026-04-22

### 新增

- 新增对话页的多选能力，支持批量复制、批量删除，并可通过 `Esc` 退出选择模式。
- 新增 iFly Search 与 Tavily Search 的设置项，包括 engine 模板默认值和设置页内的直接配置入口。

### 变更

- 调整首页输入框快捷键为 `Enter` 发送、`Shift + Enter` 换行。
- 调整聊天工作区中的 Agent 活动展示，支持更丰富的工具输出渲染、子 Agent 状态持久化，以及更完善的文件预览交互。

### 修复

- 修复对话列表底部留白与溢出问题，避免最后几项内容紧贴窗口边缘。
- 修复对话相关界面中的更多操作菜单在靠近视口边缘时被裁切、无法稳定点击的问题。

## [0.0.8] - 2026-04-18

### 新增

- 新增输入框中的 slash 技能选择能力，支持插入 skill 模块、悬浮说明，以及通过键盘快捷键选择技能。
- 新增位于首页与技能之间的全局搜索浮层，支持快捷操作、最近会话检索和键盘导航。

### 变更

- 调整搜索中的最近会话列表为固定 8 个快捷槽位，当前可见项可通过稳定的 `Win/Cmd + 数字` 快捷键打开。
- 调整已选 skill 模块的键盘交互，支持键盘选中、延迟展示描述，以及不离开输入框直接删除。

### 修复

- 修复从全局搜索进入首页新建会话时输入框未自动聚焦的问题。

## [0.0.7] - 2026-04-17

### 修复

- 修复使用 Apple ID 凭据时 macOS notarization 失败的问题：在尝试 notarization 前要求 `APPLE_TEAM_ID` 必须存在，避免向 `@electron/notarize` 传入空 `teamId`。

## [0.0.6] - 2026-04-17

### 变更

- 调整 macOS 发布 workflow，tag 发版时必须具备 notarization 凭据，不再静默发布未完成 notarization 的产物。
- 调整 notarization 初始化方式，改为使用经过校验的 `notarytool` keychain profile，让 Apple 凭据错误在 CI 中直接暴露为可读失败。

### 修复

- 修复 macOS 发布链路，在上传前增加打包应用的 notarization 校验，降低用户直接安装 DMG 后被 Gatekeeper 拦截的概率。
- 修复 CI 中 Apple API Key 处理逻辑，拦截格式错误的 `.p8` secret，以及错误转义换行导致的 `notarytool` 异常。
- 修复 mac 打包配置对 notarization 凭据的识别逻辑，同时兼容直接 API key 模式和已存储的 keychain profile 模式。

## [0.0.5] - 2026-04-16

### 新增

- 新增 OpenAI、Anthropic 与协议兼容 Custom 的模型配置能力，并同步更新应用配置与引擎配置。
- 新增项目页、Team 页，以及支持会话重命名和删除的对话列表页。
- 新增结构化错误卡片，模型和运行时失败信息在会话中更易读，且重载后仍可保留展示。

### 变更

- 重构侧边栏导航分组，将首页与技能、对话与项目与 Team 分区展示，并增加实时刷新的最近会话区域。
- 调整最近会话与对话列表交互，支持内联管理、后台刷新、最近栏目折叠和不阻塞布局的悬浮操作菜单。
- 简化聊天工作区结构，会话切换统一由全局侧边栏承接，输入区保持更紧凑且移除多余分隔线。
- 调整聊天元信息展示时机，时间仅在回复结束后显示，错误态与普通助手消息保持一致的对齐和节奏。
- 优化设置页的模型凭据表单、协议映射、toast 反馈，以及模型配置保存后的引擎重启行为。

### 修复

- 修复引擎 YAML 配置写入逻辑，避免追加错误字段或重复字段。
- 修复模型配置变更后的运行时重启流程，确保 HarnessClaw 使用最新引擎配置重新连接。
- 修复会话切换与历史数据回填问题，避免切换后聊天记录空白。
- 修复最近会话和对话列表中的更多菜单被容器裁切、无法点击的问题。
- 修复结构化错误信息未持久化的问题，重新载入会话后仍能看到最近一次失败详情。

## [0.0.4] - 2026-04-15

### 新增

- 为 Skill 仓库增加高级代理设置，支持通过独立代理端点进行仓库发现和下载。
- 增加更新日志提取工具，用于从多语言更新源生成 GitHub Release 正文。

### 变更

- 调整 Skill 市场展示逻辑：仓库配置并启用后，即使暂时还没有发现到 Skill，也会立即显示在市场中。
- 调整 Skill 发现刷新逻辑为后台执行，仓库同步过程中市场页面仍可继续操作。
- 调整发现反馈方式，刷新成功和失败统一通过应用内 toast 提示。
- 简化 Skill 仓库代理配置，只保留协议、主机和端口。

### 修复

- 修复 Electron 环境下 `better-sqlite3` 原生依赖的重建指引问题。
- 修复桌面打包元数据，统一产品名称为 `HarnessClaw`。

## [0.0.3] - 2026-04-14

### 新增

- 首个桌面版本发布，包含聊天、会话、技能、设置和应用更新支持。
