# 设置页「快捷设置」栏 — 设计文档

日期：2026-07-08
状态：已确认，待编写实现计划

## 目标

在设置页新增一栏「快捷设置」，用于查看与自定义应用的快捷键。左侧是功能名，右侧是快捷键胶囊，支持删除、点击录制、冲突检测（红字提示、不写入）、按功能块分区、恢复默认设置。

参考截图为示意：截图中的「截图 / 锁定 / 显示隐藏窗口」只是样式与交互示例，本次**不实现截图、锁定等新功能**，只搭建 UI 框架并接入**已真实存在**的快捷键。

## 范围（已与用户确认）

- **接入真实项**：全局快捷键（显示/隐藏窗口）+ 应用内快捷键（搜索、新任务、打开设置）。后三者当前写死在渲染层，本次改为可配置。
- **与现有「快捷助手」栏协调**：两栏共存，读写同一份 `launcher.hotkey`，通过 `useAppConfig` 广播即时同步。
- **应用内快捷键**：保持"仅应用聚焦时生效"（现状即如此），主进程无需为它们改动。
- **冲突检测**：只在本注册表内 4 项之间查重；不校验系统/其它 App 占用。
  - 备注（不在本次范围）：全局快捷键可用 `globalShortcut.register` 返回值探测 OS 层占用，作为后续可选增强；应用内快捷键无法可靠探测。

## 非目标（YAGNI）

- 不实现截图、锁定窗口等新功能。
- 不做系统/其它 App 占用探测。
- 不把应用内快捷键升级为全局快捷键。

## 数据模型（`harnessclaw.json`）

```jsonc
{
  "launcher": { "enabled": true, "hotkey": "Alt+Space" }, // 现有；显示/隐藏窗口复用 hotkey
  "shortcuts": {                                            // 新增
    "search":   "CommandOrControl+K",
    "newTask":  "CommandOrControl+N",
    "settings": "CommandOrControl+,"
  }
}
```

- 空字符串 `""` = 已删除/未绑定。
- `updateConfig` 为顶层浅合并：更新单项用 `updateConfig({ shortcuts: { ...shortcuts, search: next } })`，launcher 项用 `updateConfig({ launcher: { ...launcher, hotkey: next } })`。

## 注册表与分区（满足"按功能块分区"）

单一数据源 `SHORTCUT_REGISTRY`，UI / 冲突检测 / 恢复默认都基于它：

| 分组 | id | 标签 (i18n) | 类型 | 存储位置 | 默认值 |
|---|---|---|---|---|---|
| 全局快捷键 | `toggleWindow` | 显示/隐藏窗口 | global | `launcher.hotkey` | `Alt+Space` |
| 应用内快捷键 | `search` | 搜索 | app | `shortcuts.search` | `CommandOrControl+K` |
| 应用内快捷键 | `newTask` | 新任务 | app | `shortcuts.newTask` | `CommandOrControl+N` |
| 应用内快捷键 | `settings` | 打开设置 | app | `shortcuts.settings` | `CommandOrControl+,` |

每条注册项结构（概念）：
```ts
interface ShortcutDef {
  id: string
  group: 'global' | 'app'
  labelKey: string          // i18n key
  read: (config) => string  // 从 config 取当前值
  write: (updateConfig, config, next: string) => void // 写回（含空值删除）
  default: string
}
```

## 组件结构

### `ShortcutsSection`（新）
- `useAppConfig()` 读配置。
- 按 `group` 渲染两个 `GroupCard`（复用现有卡片组件），组内每项一行：左标签 + 右 `ShortcutRecorder`。
- 底部「恢复默认设置」按钮：将 4 项写回各自 `default`。
- 冲突提示状态：记录"哪一项正处于冲突"，在该行下方渲染红字。

### `ShortcutRecorder`（新，紧凑胶囊，对齐截图）
- **有值**：显示 accelerator 字形（如 `⌃⌘A`）+ 右侧 `×` 按钮；点 `×` 清空该项（写空串）。
- **空值/未绑定**：显示「点击设置」按钮。
- **录制中**：点击进入捕获态，监听 `keydown`；`Esc` 取消；捕获到合法组合后交给上层做冲突检测。
- 复用 `SettingsPage.tsx` 已有的 `eventToAccelerator` / `parseAccelerator` / `MODIFIER_SYMBOLS` / `KEY_SYMBOLS`（如需，将这些提取为可共享位置）。
- 与现有 `HotkeyInput` 区别：`HotkeyInput` 恒显 4 个修饰键槽（Alfred 风格），本组件按截图只显示实际组合 + 删除按钮，且承载空值/删除语义。

### 冲突检测流程
1. 用户在某项录到组合 `accel`。
2. 归一化后与注册表内**其它项**的当前值比对（归一化需将 `Command`/`CommandOrControl` 视作等价，避免同物异写绕过）。
3. 冲突 → 设置该行冲突态（红字），**不调用 write**。
4. 无冲突 → 调用该项 `write` 落盘，清除冲突态。

## 应用内快捷键改造（写死 → 读配置）

新增共享工具 `matchesAccelerator(event: KeyboardEvent, accel: string): boolean`：
- 解析 accel → 修饰键集合 + 主键。
- `Command`/`Cmd`/`Meta` → 需 `metaKey`；`Control`/`Ctrl` → 需 `ctrlKey`；`CommandOrControl` → `metaKey || ctrlKey`；`Alt`/`Shift` 同理。
- **精确匹配**修饰键（未要求的修饰键必须未按下），避免 `⌘⇧K` 误触发 `⌘K`。
- 主键归一化与 `eventToAccelerator` 一致。
- accel 为空串 → 恒返回 false（该快捷键停用）。

改造点：
- `App.tsx` `GlobalShortcuts`：`⌘,` 改为读 `shortcuts.settings` + `matchesAccelerator`。
- `Sidebar.tsx` 键盘处理：`⌘K`（搜索）读 `shortcuts.search`；`⌘N`（新任务）读 `shortcuts.newTask`。
- 均保留原有"输入框内不劫持"等既有守卫逻辑。

## 主进程改动

仅 launcher：`readLauncherSettings` / `applyLauncherConfig` 需正确处理 `hotkey` 为空串的情况——空值时**不注册**（当前逻辑会在空/缺失时回退默认 `Alt+Space`，需改为：缺失才回退默认，空串表示用户主动删除→不注册）。

`shortcuts.*` 三项为渲染层快捷键，主进程**无需改动**。

## 导航接入

- `SectionKey` 增加 `'shortcuts'`。
- 在「应用配置」导航组内、`launcher` 附近新增导航项（图标 `Keyboard` 或 `Command`，标签 `settings.nav.shortcuts`）。
- 右侧 `active === 'shortcuts'` 时渲染 `<ShortcutsSection />`（普通 `max-w-2xl` 容器，非全宽）。

## i18n

在 `zh.json` / `en.json` 新增：
- `settings.nav.shortcuts`
- `settings.shortcuts.header.title` / `.subtitle`
- `settings.shortcuts.group.global` / `.group.app`
- 各项标签：`settings.shortcuts.item.toggleWindow` / `.search` / `.newTask` / `.settings`
- `settings.shortcuts.setBtn`（点击设置）、`settings.shortcuts.conflict`（冲突红字）、`settings.shortcuts.restoreDefaults`（恢复默认设置）、录制中/清除的 aria 文案。

## 验收标准

1. 设置页出现「快捷设置」栏，含两个分区（全局 / 应用内），共 4 项。
2. 每项右侧胶囊显示当前快捷键与 `×`；点 `×` 清空，变为「点击设置」。
3. 点「点击设置」进入录制，按下组合即写入；`Esc` 取消。
4. 录入的组合与其它项冲突时，该行红字提示且不写入。
5. 底部「恢复默认设置」把 4 项还原为默认值。
6. 修改"显示/隐藏窗口"与「快捷助手」栏双向同步（同一 `launcher.hotkey`）。
7. 修改搜索/新任务/打开设置后，应用内对应快捷键按新值生效；清空后失效。
8. 删除"显示/隐藏窗口"快捷键后，主进程不再注册该全局快捷键（不回退默认）。
