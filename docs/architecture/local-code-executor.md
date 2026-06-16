<h1 align="center">本地代码执行器（Python / Node）设计方案</h1>

> 视角：让 HarnessClaw 的 Agent 在对话中能执行 Python / Node 代码，且**用户无需自行安装任何运行时环境**——装上 HarnessClaw 即可用；缺少第三方库时支持**受控的 pip 自动安装**。
>
> 涉及的源码层：`harnessclaw-engine`（Go，新增 `python` / `node` 工具）→ `resources/bin/runtime`（打包便携运行时）→ `electron-builder`（按平台分发）→ `src/main/index.ts`（spawn 引擎时注入运行时路径）→ renderer（pip 安装审批 UI）。
>
> 状态：设计稿，待评审后实施。

---

## 1. 需求与硬约束

| 项 | 内容 |
|---|---|
| 需求 | Agent 在对话中需要运行代码时，能在本地执行 Python / Node 片段并拿回结果 |
| **硬约束** | **用户机器上无需预装 Python / Node**，开箱即用（领导明确要求"零环境依赖"） |
| 依赖包 | 预装常用包覆盖主场景；缺包时支持 **pip 自动安装**（白名单内静默装，白名单外需用户审批） |
| 适用场景 | 数据分析、脚本验证、格式转换、计算、爬取解析、图像处理等 |

这条硬约束直接决定技术路线：**排除"检测系统环境"方案**（依赖用户已装），锁定**内置/打包运行时**路线。

---

## 2. 方案选型（为什么是打包运行时）

| 流派 | 代表产品 | 用户没装时 | 是否满足本需求 |
|---|---|---|---|
| **打包运行时** | Claude Desktop（官方原文 "We ship Node.js with Claude Desktop"） | 自带可用 | ✅ 满足 |
| 检测系统环境 | Cursor / Windsurf / Open Interpreter | 失败 / 提示安装 | ❌ 违反硬约束 |
| 云端沙箱 | ChatGPT / Claude 网页版 | 无所谓 | ❌ 与本地应用定位冲突（数据上云、需联网） |

**关键参考**：Claude Desktop 与 HarnessClaw 同为 Electron 应用，"打包运行时"思路可直接借鉴。

---

## 3. 总体架构

```
┌─ 安装包结构 ─────────────────────────────────────┐
│ HarnessClaw.exe / .app                           │
│ resources/                                       │
│   ├── bin/                                       │
│   │   ├── harnessclaw-engine(.exe)   (现有引擎)  │
│   │   └── runtime/                   (★ 新增)    │
│   │       ├── python/                            │
│   │       │   ├── python(.exe)                   │
│   │       │   └── lib/  (标准库 + 预装包)        │
│   │       └── node/                              │
│   │           └── node(.exe)                     │
│   └── templates/                                 │
└──────────────────────────────────────────────────┘

执行流程：
  用户："帮我分析这个 CSV" / "爬这个网页的标题"
    │
    ▼  Agent 生成 Python/Node 代码
  引擎 python/node 工具
    │  用 resources/bin/runtime 下的内置运行时执行
    ├─ 成功 → 输出回灌给 Agent 继续推理
    └─ ModuleNotFoundError → 进入 pip 自动安装流程（见 §6）
```

**数据流的两条注入链**：
- 运行时路径：客户端 spawn 引擎时，用环境变量把内置 python/node 的绝对路径传给引擎。
- pip 审批：引擎检测到缺包，通过现有 `askUserQuestion` 通道向 renderer 请求用户确认。

---

## 4. 引擎侧：新增 python / node 工具

### 4.1 现状基础

引擎（Go）已有成熟工具体系：`internal/tool/bash/bash.go` 通过 `exec.CommandContext` spawn 子进程，捕获 stdout/stderr 回灌 LLM，自带超时（`maxTimeout` 10min / `defaultTimeout` 2min）、输出截断（`maxOutputLen` 30K）、进程清理、`ToolResult` 元数据（exit_code / duration_ms）。新工具完全复用这套模式。

### 4.2 两个新工具

新增 `internal/tool/python/` 和 `internal/tool/node/`，结构对照 `bash`：

| 工具 | 输入 | 执行方式 |
|---|---|---|
| `Python` | `{ code: string, timeout?: number }` | 把 code 写临时 `.py` 文件 → `exec(pythonBin, tmpfile)` → 捕获输出 |
| `Node` | `{ code: string, timeout?: number }` | 把 code 写临时 `.js` 文件 → `exec(nodeBin, tmpfile)` → 捕获输出 |

复用 bash 的：超时、输出截断、进程组清理、元数据。`SafetyLevel = SafetyDangerous`（与 bash 同级，走审批门）。

### 4.3 运行时路径解析（关键）

工具如何找到打包的 python/node？**由客户端在 spawn 引擎时通过环境变量注入**，引擎按以下优先级解析：

```
func resolvePythonBin() string {
    if p := os.Getenv("HARNESSCLAW_PYTHON_BIN"); p != "" && fileExists(p) {
        return p                    // 1. 优先用客户端注入的内置运行时
    }
    if p, err := exec.LookPath("python3"); err == nil {
        return p                    // 2. 回退系统环境（开发态 / 未打包）
    }
    return "python"                 // 3. 兜底
}
```

保证「打包后由客户端启动」与「开发时裸跑引擎」两种场景都能工作。

---

## 5. 客户端侧：打包与路径注入

### 5.1 便携运行时来源

| 运行时 | 来源 | 体积（单平台） | 说明 |
|---|---|---|---|
| Python | [python-build-standalone](https://github.com/astral-sh/python-build-standalone) | ~30-50MB | uv 同源，免费可商用，relocatable，解压即用；可裁剪标准库 |
| Node | Node 官方便携版 | ~30MB | 独立打包（不复用 Electron 内嵌），隔离性好、版本可控 |

便携运行时按 `win-x64` / `mac-arm64` / `mac-x64` / `linux-x64` 分平台打包，沿用现有引擎二进制的命名约定（`config.ts` 的 `resolveBundledBinaryPath`，已支持 `{base}-{platform}-{arch}` 后缀）。

### 5.2 预装包（首版）

便携 Python 打包时预装一批常用包，覆盖主场景（约 80%）：

- 数据分析：pandas、numpy、scipy、matplotlib、openpyxl
- 网络/解析：requests、beautifulsoup4、lxml、pyyaml
- 文件/图像：pillow、python-docx、pypdf

### 5.3 路径注入（唯一的客户端代码改动）

`src/main/index.ts` 引擎 spawn 处（现 line 927）：

```
const PYTHON_BIN = resolveBundledBinaryPath('python')   // resources/bin/runtime/python/...
const NODE_BIN   = resolveBundledBinaryPath('node')
harnessclawEngineProcess = spawn(HARNESSCLAW_ENGINE_BIN, ['-config', ENGINE_CONFIG_PATH], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  env: {
    ...process.env,
    ...(PYTHON_BIN ? { HARNESSCLAW_PYTHON_BIN: PYTHON_BIN } : {}),
    ...(NODE_BIN   ? { HARNESSCLAW_NODE_BIN: NODE_BIN } : {}),
  },
})
```

`resolveBundledBinaryPath` 已处理 `app.isPackaged` 下 `process.resourcesPath` 与开发态差异、平台/架构后缀，直接复用。

### 5.4 打包配置

`electron-builder.config.cjs` 的 `extraResources` 确保 `resources/bin/runtime` 被打入（现有规则 `from: 'resources/bin'` 已递归包含，确认 filter 不排除即可）。新增 `bundle:runtime` 构建脚本（参考现有 `bundle:tools`）：下载对应平台便携运行时 → 解压到 `resources/bin/runtime/` → 预装包。

---

## 6. pip 自动安装机制

### 6.1 触发与流程

```
执行 Python 代码
  │
  ▼ 捕获到 ModuleNotFoundError: No module named 'xxx'
解析缺失包名（含别名映射，如 bs4 → beautifulsoup4）
  │
  ▼ 查白名单
  ├─ 在白名单 → 静默 pip install → 重新执行代码
  └─ 不在白名单 → 通过 askUserQuestion 请求审批
        ├─ 用户「允许一次」 → pip install → 重新执行
        ├─ 用户「总是允许」 → pip install + 写入个人白名单
        └─ 用户「拒绝」 → 把 ModuleNotFoundError 回灌 Agent，让它换方案
```

### 6.2 三层安全防护

| 层 | 措施 |
|---|---|
| **白名单** | 内置 Top-N 常用包白名单（`internal/tool/python/whitelist.go`），白名单内自动装，白名单外需审批 |
| **版本锁定** | 不允许 Agent 指定版本（防旧版漏洞包），统一装最新稳定版 |
| **隔离 + 超时** | `pip install --target <内置 Python site-packages>`，不污染系统；安装超时 60s，失败/超时回灌错误而非中断会话 |

### 6.3 审批 UI（renderer）

复用现有 `askUserQuestion` 机制，渲染一个三按钮弹窗：

```
┌─ Agent 请求安装 Python 包 ──────────────┐
│  需要安装：beautifulsoup4               │
│  来源：PyPI    用途：HTML/XML 解析       │
│  ⚠️ 安装到 HarnessClaw 内置环境，不影响系统 │
│  [ 拒绝 ]  [ 允许一次 ]  [ 总是允许 ]    │
└──────────────────────────────────────────┘
```

「总是允许」把包名写入 `~/.harnessclaw/pip-whitelist.json`（个人白名单），后续静默安装。

---

## 7. 安全模型

本地执行是**用户权限的真实进程**，隔离弱（与 bash 同级）。沿用引擎现有机制，不新造轮子：

| 措施 | 做法 |
|---|---|
| 执行前审批 | `python`/`node` 标 `SafetyDangerous`，走现有 permission 审批门 |
| pip 安装审批 | 白名单 + 用户审批双重防护（§6.2） |
| 超时 / 输出限制 | 复用 bash 的 `maxTimeout` / `maxOutputLen` |
| 工作目录 | 限定 workspace 目录，不放任任意路径 |
| 包隔离 | pip 装到内置 Python，不碰系统环境 |

> 内置运行时不提供强沙箱（容器级隔离是云端方案的能力）。本地方案的安全底线是「审批门 + 用户知情 + 包白名单」，与 Open Interpreter / Cursor 等本地工具取舍一致。

---

## 8. 安装实现流程（一步一步）

> 按依赖顺序推进，每步都能独立验证，不必等全部完成。

### 步骤 1：引擎工具骨架（先用系统环境跑通）

1. 新建 `internal/tool/python/python.go`、`internal/tool/node/node.go`，仿 `bash/bash.go` 实现 `Name / Description / InputSchema / Execute`。
2. 实现 `resolvePythonBin()` / `resolveNodeBin()`（§4.3），此阶段先走系统 PATH。
3. 在引擎工具装配处注册两个工具，`SafetyLevel = SafetyDangerous`。
4. **验证**：开发态（裸跑引擎，机器已装 python/node）让 Agent 执行一段 `print(1+1)`，确认输出回灌正常、超时/截断生效。

### 步骤 2：获取并放置便携运行时

1. 下载 python-build-standalone 对应平台版本，解压到 `resources/bin/runtime/python/`。
2. 下载 Node 便携版到 `resources/bin/runtime/node/`。
3. 命名遵循 `{base}-{platform}-{arch}` 约定，使 `resolveBundledBinaryPath` 能解析。
4. **验证**：手动用内置 python 绝对路径执行脚本，确认 relocatable（移动目录后仍能跑）。

### 步骤 3：预装常用包

1. 用内置 python 的 pip：`python -m pip install --target <内置 site-packages> pandas numpy ...`（§5.2 清单）。
2. 把预装结果一并纳入打包产物。
3. **验证**：内置 python 执行 `import pandas`，确认预装包可用。

### 步骤 4：打包配置 + 构建脚本

1. 写 `scripts/build-bundled-runtime.cjs`（参考 `build-bundled-tools.cjs`），自动完成步骤 2-3 的下载、解压、预装。
2. `package.json` 加 `bundle:runtime` 脚本；接入 CI（按平台矩阵执行）。
3. 确认 `electron-builder.config.cjs` 的 `extraResources` 打入 `runtime`。
4. **验证**：本地打一个安装包，检查 `resources/bin/runtime` 完整。

### 步骤 5：客户端注入运行时路径

1. 改 `src/main/index.ts` 引擎 spawn 处（§5.3），注入 `HARNESSCLAW_PYTHON_BIN` / `HARNESSCLAW_NODE_BIN`。
2. 引擎 `resolvePythonBin()` 此时会优先命中内置运行时。
3. **验证**：在**全新机器（确认未装 python/node）**安装打包版，Agent 执行 Python/Node 代码成功。

### 步骤 6：pip 自动安装

1. 引擎侧：实现 `ModuleNotFoundError` 解析、包名别名映射、`whitelist.go` 白名单、`pipInstall()`（`--target` + 60s 超时）、装完重试逻辑（§6.1/6.2）。
2. 白名单内：静默安装。
3. 白名单外：通过 `askUserQuestion` 发审批请求。
4. renderer：实现三按钮审批弹窗（§6.3），「总是允许」写 `pip-whitelist.json`。
5. **验证**：见 §10 验收清单的 pip 相关项。

### 步骤 7：全场景回归

按 §10 逐项验收，覆盖全新机器、离线、审批拒绝、超时等边界。

---

## 9. 影响范围

| 模块 | 改动 |
|---|---|
| `harnessclaw-engine/internal/tool/python/` | 新增 Python 工具 + 缺包检测 + pip 安装 + 白名单 |
| `harnessclaw-engine/internal/tool/node/` | 新增 Node 工具 |
| 引擎工具注册处 | 注册两个新工具 + 运行时路径解析 helper |
| `resources/bin/runtime/` | 新增便携 Python（含预装包）/ Node，按平台 |
| `scripts/build-bundled-runtime.cjs` | 新增运行时下载/解压/预装脚本 |
| `package.json` | 新增 `bundle:runtime` 脚本 |
| `electron-builder.config.cjs` | 确认 `extraResources` 打入 runtime |
| `src/main/index.ts` | 引擎 spawn 处注入运行时环境变量（1 处） |
| renderer（审批 UI） | pip 安装审批弹窗（复用 askUserQuestion 通道） |
| CI 配置 | 多平台构建时执行 `bundle:runtime` |

---

## 10. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 安装包体积膨胀 | Python+预装包+Node，单平台 +90-130MB | 裁剪标准库；per-platform 只打目标运行时；预装包控制在 Top 15 |
| 多平台打包复杂度 | 每个 平台×架构 都要对应运行时 | 沿用引擎二进制的多平台 CI；运行时下载脚本化 |
| 便携 Python 重定位失败 | 装到非预期路径找不到自身库 | python-build-standalone 本就 relocatable；用绝对路径调用 |
| pip install 失败（网络/冲突） | 代码执行中断 | 60s 超时 + 失败回灌 Agent 让它换方案，不崩会话 |
| 恶意包（typosquatting，如 reqeusts） | 安全风险 | 白名单 + 审批双重防护；白名单内的包经人工审核 |
| 包版本冲突 | 内置环境损坏 | 统一装最新稳定版；极端情况删 `~/.harnessclaw/` 下安装目录重置 |
| 用户离线 | pip 无法下载 | 预装 Top 15 覆盖主场景；离线时白名单外的包失败但不崩 |
| 审批弹窗打断体验 | 用户烦 | 白名单内静默装；「总是允许」减少重复弹窗 |
| 任意代码执行 | 用户权限跑 LLM 生成代码 | 走审批门（SafetyDangerous）+ workspace 限定 + 用户知情 |
| 运行时安全补丁 | 内置运行时需随版本升级 | 纳入发版流程定期升级（打包方案的固有代价） |
| Windows 杀软误报 | 打包的 python.exe/node.exe 触发杀软 | 代码签名；必要时提供白名单说明 |

---

## 11. 验收清单

- [ ] 全新机器（确认未装 Python/Node）安装后，Agent 能执行 Python 代码
- [ ] 同上，能执行 Node 代码
- [ ] 预装包（pandas/numpy）可直接 import
- [ ] 白名单内的包（如 requests）缺失时自动安装、无弹窗
- [ ] 白名单外的包缺失时弹审批；「允许」后能装上并执行
- [ ] 「拒绝」后 Agent 收到错误能换方案
- [ ] 「总是允许」后，下次该包静默安装
- [ ] 离线状态：预装包可用，pip 安装失败但不崩溃
- [ ] pip 安装超时（模拟慢网）能正确中断并回灌错误
- [ ] 执行前触发审批门（与 bash 一致）
- [ ] 超时、输出截断、退出码正常
- [ ] Mac（arm64/x64）、Linux、Windows 均验证通过
- [ ] 开发态（未打包）裸跑引擎，回退系统 PATH 仍可工作

---

## 12. 明确不做的（划清边界）

- ❌ 不做云端沙箱（与本地定位冲突）
- ❌ 不做检测系统环境路线（违反"零环境依赖"约束）
- ❌ 不允许 Agent 指定 pip 包版本（统一最新稳定版）
- ❌ 首版不做容器级强沙箱（本地方案以审批门为安全底线）
- ❌ 不提供运行时内的 GPU / 系统级依赖（如 CUDA），仅纯 Python/Node 场景
