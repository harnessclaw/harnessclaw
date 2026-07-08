# 快捷设置栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页新增「快捷设置」栏，可查看/录制/删除/恢复默认快捷键，按功能块分区，冲突时红字提示不写入。

**Architecture:** 新建 `lib/shortcuts.ts` 存放共享纯函数（accelerator 解析、事件匹配、归一化、默认值、config 读取）。设置页新增紧凑录制组件 `ShortcutRecorder` 与 `ShortcutsSection`（注册表驱动，含两个分区 + 恢复默认）。应用内快捷键（⌘K/⌘N/⌘,）从写死改为读配置匹配；显示/隐藏窗口沿用现有 launcher 全局快捷键并支持空值不注册。

**Tech Stack:** Electron + React + TypeScript，i18n（react-i18next），配置存 `harnessclaw.json`（`window.appConfig` / `useAppConfig`）。

## Global Constraints

- 无测试框架：每个任务的门禁是 `yarn lint` 通过 + 指定的手动运行验证。禁止引入 vitest/jest。
- 复用现有组件：`GroupCard` / `SettingRow` / `SectionHeader`（`SettingsPage.tsx`），不新造卡片样式。
- 不得破坏现有 `HotkeyInput` 及其本地 `parseAccelerator`（数组形态，供 `MODIFIER_SLOTS` 使用）。新共享函数放 `lib/shortcuts.ts`，与之并存。
- 空字符串 `""` = 用户已删除/未绑定；缺失（`undefined`）才回退默认值。
- 应用内快捷键仅在应用聚焦时生效（渲染层 keydown），主进程不为其注册全局快捷键。
- 冲突检测仅在本注册表 4 项之间，用 `normalizeAccelerator` 归一化比较（`Command`/`CommandOrControl` 在同平台视为等价）。
- 提交信息以 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 结尾。
- 当前分支 `feat/switch-agent-framework`，直接在此分支提交（非默认分支）。

---

### Task 1: 共享快捷键工具 `lib/shortcuts.ts`

**Files:**
- Create: `src/renderer/src/lib/shortcuts.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_SHORTCUTS: { search: string; newTask: string; settings: string }`
  - `DEFAULT_TOGGLE_WINDOW_HOTKEY: string` （`'Alt+Space'`）
  - `type AppShortcutId = 'search' | 'newTask' | 'settings'`
  - `readAppShortcuts(config: unknown): Record<AppShortcutId, string>`
  - `matchesAccelerator(event: KeyboardEvent, accel: string): boolean`
  - `normalizeAccelerator(accel: string): string`

- [ ] **Step 1: 创建 `src/renderer/src/lib/shortcuts.ts`**

```ts
// 共享快捷键工具：accelerator 解析 / 事件匹配 / 归一化 / 默认值 / config 读取。
// 供 App.tsx、Sidebar.tsx、SettingsPage.tsx 复用。
// 注意：SettingsPage.tsx 另有一份本地 parseAccelerator（数组形态，供
// HotkeyInput 的修饰键槽渲染用），与本文件的 Set 形态解析并存，勿混用。

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export const DEFAULT_TOGGLE_WINDOW_HOTKEY = 'Alt+Space'

export const DEFAULT_SHORTCUTS = {
  search: 'CommandOrControl+K',
  newTask: 'CommandOrControl+N',
  settings: 'CommandOrControl+,',
} as const

export type AppShortcutId = keyof typeof DEFAULT_SHORTCUTS

// 解析 accelerator 字符串 → 归一化修饰键集合 + 主键。
// 修饰键归一为：'meta' | 'ctrl' | 'cmdorctrl' | 'alt' | 'shift'。
function parseAccel(accel: string): { modifiers: Set<string>; key: string } {
  const modifiers = new Set<string>()
  let key = ''
  for (const raw of (accel || '').split('+').map((p) => p.trim()).filter(Boolean)) {
    const lower = raw.toLowerCase()
    if (['command', 'cmd', 'meta', 'super'].includes(lower)) modifiers.add('meta')
    else if (['control', 'ctrl'].includes(lower)) modifiers.add('ctrl')
    else if (['commandorcontrol', 'cmdorctrl'].includes(lower)) modifiers.add('cmdorctrl')
    else if (['alt', 'option'].includes(lower)) modifiers.add('alt')
    else if (lower === 'shift') modifiers.add('shift')
    else key = raw
  }
  return { modifiers, key }
}

// 把 DOM KeyboardEvent 的主键归一成 accelerator 主键写法（与设置页
// eventToAccelerator 保持一致）。
function eventMainKey(event: KeyboardEvent): string {
  const k = event.key
  if (k === ' ' || event.code === 'Space') return 'Space'
  if (k === 'ArrowUp') return 'Up'
  if (k === 'ArrowDown') return 'Down'
  if (k === 'ArrowLeft') return 'Left'
  if (k === 'ArrowRight') return 'Right'
  if (k === 'Enter') return 'Return'
  if (k === 'Tab') return 'Tab'
  if (k === 'Backspace') return 'Backspace'
  if (k === 'Delete') return 'Delete'
  if (/^F\d{1,2}$/.test(k)) return k
  if (k.length === 1) return k.toUpperCase()
  return ''
}

// 事件是否精确匹配某 accelerator。精确匹配修饰键（未要求的必须未按下），
// 避免 ⌘⇧K 误触发 ⌘K。空 accel 恒不匹配（该快捷键停用）。
export function matchesAccelerator(event: KeyboardEvent, accel: string): boolean {
  if (!accel) return false
  const { modifiers, key } = parseAccel(accel)
  if (!key) return false
  if (eventMainKey(event) !== key) return false

  if (modifiers.has('shift') !== event.shiftKey) return false
  if (modifiers.has('alt') !== event.altKey) return false

  if (modifiers.has('cmdorctrl')) {
    return event.metaKey || event.ctrlKey
  }
  if (modifiers.has('meta') !== event.metaKey) return false
  if (modifiers.has('ctrl') !== event.ctrlKey) return false
  return true
}

// 归一化成用于冲突比较的规范串。cmdorctrl 在当前平台解析为 meta(mac)/ctrl(win)，
// 使 'Command+K' 与 'CommandOrControl+K' 在同机上判为同一绑定。
export function normalizeAccelerator(accel: string): string {
  if (!accel) return ''
  const { modifiers, key } = parseAccel(accel)
  if (!key) return ''
  const set = new Set<string>()
  for (const m of modifiers) {
    if (m === 'cmdorctrl') set.add(IS_MAC ? 'meta' : 'ctrl')
    else set.add(m)
  }
  const order = ['ctrl', 'alt', 'shift', 'meta']
  return [...order.filter((o) => set.has(o)), key.toUpperCase()].join('+')
}

// 从 app config 读取应用内快捷键。空串表示用户删除（停用），保留空串；
// 仅字段缺失时回退默认。
export function readAppShortcuts(config: unknown): Record<AppShortcutId, string> {
  const raw = (config && typeof config === 'object'
    ? (config as { shortcuts?: Record<string, unknown> }).shortcuts
    : null) || {}
  const pick = (id: AppShortcutId): string =>
    typeof raw[id] === 'string' ? (raw[id] as string) : DEFAULT_SHORTCUTS[id]
  return { search: pick('search'), newTask: pick('newTask'), settings: pick('settings') }
}
```

- [ ] **Step 2: Lint 门禁**

Run: `yarn lint`
Expected: 通过（无新增 error/warning）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/shortcuts.ts
git commit -m "feat(shortcuts): add shared accelerator utils and defaults

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 主进程 launcher 支持空快捷键不注册

**Files:**
- Modify: `src/main/index.ts`（`readLauncherSettings`，约 1726-1738；`applyLauncherConfig`，约 1747-1781）

**Interfaces:**
- Consumes: 无
- Produces: `readLauncherSettings()` 返回的 `hotkey` 现在可能是 `''`（用户删除）。`applyLauncherConfig()` 在 `hotkey` 为空时只解绑不注册。

- [ ] **Step 1: 修改 `readLauncherSettings` 区分"缺失回退默认"与"空串保留"**

将现有实现：

```ts
function readLauncherSettings(): { enabled: boolean; hotkey: string } {
  try {
    const cfg = asRecord(readHarnessclawConfig({}))
    const launcher = asRecord(cfg.launcher)
    const enabled = launcher.enabled === true
    const hotkey = typeof launcher.hotkey === 'string' && launcher.hotkey.trim().length > 0
      ? String(launcher.hotkey).trim()
      : DEFAULT_LAUNCHER_HOTKEY
    return { enabled, hotkey }
  } catch {
    return { enabled: false, hotkey: DEFAULT_LAUNCHER_HOTKEY }
  }
}
```

替换为（空串保留为 `''`，仅字段缺失/非字符串时回退默认）：

```ts
function readLauncherSettings(): { enabled: boolean; hotkey: string } {
  try {
    const cfg = asRecord(readHarnessclawConfig({}))
    const launcher = asRecord(cfg.launcher)
    const enabled = launcher.enabled === true
    // 空串 = 用户在「快捷设置」里删除了该快捷键 → 保留空串（后续不注册）。
    // 仅字段缺失或类型不对时才回退默认，避免首次运行没有快捷键。
    const hotkey = typeof launcher.hotkey === 'string'
      ? String(launcher.hotkey).trim()
      : DEFAULT_LAUNCHER_HOTKEY
    return { enabled, hotkey }
  } catch {
    return { enabled: false, hotkey: DEFAULT_LAUNCHER_HOTKEY }
  }
}
```

- [ ] **Step 2: 修改 `applyLauncherConfig` 在空 hotkey 时跳过注册**

在 `applyLauncherConfig()` 内，`if (!enabled) { ... return }` 之后、`try { globalShortcut.register(...) }` 之前，插入空值守卫。找到：

```ts
  if (!enabled) {
    writeAppLog('info', 'launcher.shortcut', 'Quick launcher disabled by config')
    return
  }

  try {
    const ok = globalShortcut.register(hotkey, () => {
```

改为：

```ts
  if (!enabled) {
    writeAppLog('info', 'launcher.shortcut', 'Quick launcher disabled by config')
    return
  }

  // 空快捷键 = 用户主动删除，仅解绑不注册（上方已解绑旧绑定）。
  if (!hotkey) {
    writeAppLog('info', 'launcher.shortcut', 'Quick launcher hotkey cleared — not registering')
    return
  }

  try {
    const ok = globalShortcut.register(hotkey, () => {
```

- [ ] **Step 3: Lint 门禁**

Run: `yarn lint`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(launcher): treat empty hotkey as unbound, skip registration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 「快捷设置」栏 UI（ShortcutRecorder + ShortcutsSection + 导航 + i18n）

**Files:**
- Modify: `src/renderer/src/components/pages/SettingsPage.tsx`
  - `SectionKey` 类型（约 7850）
  - `navGroups` 应用配置组（约 7875-7885）
  - 右侧渲染分支（约 7942-7955）
  - 新增 `ShortcutRecorder`、`ShortcutsSection` 组件（放在 `LauncherSection` 之前，约 7210 之前）
- Modify: `src/renderer/src/locales/zh.json`（`settings.nav` 约 1042；`settings.launcher` 之后约 1602 追加 `settings.shortcuts`）
- Modify: `src/renderer/src/locales/en.json`（对应位置）

**Interfaces:**
- Consumes: Task 1 的 `DEFAULT_SHORTCUTS`、`DEFAULT_TOGGLE_WINDOW_HOTKEY`、`normalizeAccelerator`。SettingsPage 本地已有的 `eventToAccelerator`、`parseAccelerator`、`renderToken`、`MODIFIER_SYMBOLS`、`KEY_SYMBOLS`、`GroupCard`、`SectionHeader`、`useAppConfig`、`Keyboard` 图标。
- Produces: `active === 'shortcuts'` 时渲染的 `<ShortcutsSection />`。

- [ ] **Step 1: 新增 i18n key（zh.json）**

在 `settings.nav` 对象内，`"launcher": "快捷助手",` 一行之后添加：

```json
      "shortcuts": "快捷设置",
```

在 `settings.launcher` 块结束的 `}` 之后（约 1602 行 `    },` 处，`launcher` 与其后一项之间）追加新块：

```json
    "shortcuts": {
      "header": {
        "title": "快捷设置",
        "subtitle": "查看并自定义快捷键。点击右侧胶囊录制，× 删除；冲突将红字提示且不生效。"
      },
      "group": {
        "global": "全局快捷键",
        "app": "应用内快捷键"
      },
      "item": {
        "toggleWindow": "显示/隐藏窗口",
        "search": "搜索",
        "newTask": "新任务",
        "settings": "打开设置"
      },
      "setBtn": "点击设置",
      "conflict": "快捷键冲突，请更换",
      "restoreDefaults": "恢复默认设置",
      "pressKeys": "按下组合键…",
      "capturingAria": "正在录制快捷键，按下组合键",
      "clearAria": "删除快捷键",
      "setAria": "点击设置快捷键"
    }
```

- [ ] **Step 2: 新增 i18n key（en.json）**

在 `settings.nav` 内 `"launcher": "Quick Launcher",` 之后添加：

```json
      "shortcuts": "Shortcuts",
```

在 en.json 的 `settings.launcher` 块结束 `}` 之后追加：

```json
    "shortcuts": {
      "header": {
        "title": "Shortcuts",
        "subtitle": "View and customize keyboard shortcuts. Click a chip to record, × to remove; conflicts are shown in red and not applied."
      },
      "group": {
        "global": "Global shortcuts",
        "app": "In-app shortcuts"
      },
      "item": {
        "toggleWindow": "Show / hide window",
        "search": "Search",
        "newTask": "New task",
        "settings": "Open settings"
      },
      "setBtn": "Click to set",
      "conflict": "Shortcut conflict, please choose another",
      "restoreDefaults": "Restore defaults",
      "pressKeys": "Press keys…",
      "capturingAria": "Recording shortcut, press a combination",
      "clearAria": "Remove shortcut",
      "setAria": "Click to set shortcut"
    }
```

- [ ] **Step 3: 在 SettingsPage.tsx 顶部补充 import**

找到 SettingsPage.tsx 从 `../../lib` 或本地相对路径的现有 import 区（文件头部），新增一行（若已从其它文件引入相邻路径，紧随其后即可）：

```ts
import { DEFAULT_SHORTCUTS, DEFAULT_TOGGLE_WINDOW_HOTKEY, normalizeAccelerator } from '../../lib/shortcuts'
```

已核实：`Keyboard`、`X`、`RotateCcw` 均已在 SettingsPage 的 lucide-react import 中，无需改动。`Command` **未导入**，需在该 import 块（约 19 行 `Keyboard,` 附近）新增一行 `Command,`（见 Step 6）。

- [ ] **Step 4: 新增 `ShortcutRecorder` 与 `ShortcutsSection` 组件**

在 `function LauncherSection()`（约 7217）之前插入：

```tsx
// 紧凑快捷键录制胶囊（对齐设计截图）：有值显示字形 + ×；空值显示「点击设置」；
// 录制中监听 keydown，Esc 取消。捕获到组合后交给上层做冲突检测。
function ShortcutRecorder({
  value,
  onCapture,
  onClear,
}: {
  value: string
  onCapture: (accel: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const { modifiers, key } = parseAccelerator(value)

  useEffect(() => {
    if (!capturing) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accel = eventToAccelerator(event)
      if (!accel) return
      onCapture(accel)
      setCapturing(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setCapturing(false)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [capturing, onCapture])

  if (!value && !capturing) {
    return (
      <button
        type="button"
        onClick={() => setCapturing(true)}
        aria-label={t('settings.shortcuts.setAria')}
        className="inline-flex items-center rounded-[8px] border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {t('settings.shortcuts.setBtn')}
      </button>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 transition-colors',
        capturing ? 'border-primary ring-2 ring-primary/20' : 'border-border bg-card',
      )}
    >
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setCapturing(true)
        }}
        aria-pressed={capturing}
        aria-label={capturing ? t('settings.shortcuts.capturingAria') : t('settings.shortcuts.setAria')}
        className="inline-flex items-center gap-1"
      >
        {capturing && !key ? (
          <span className="text-[12px] text-muted-foreground/70">{t('settings.shortcuts.pressKeys')}</span>
        ) : (
          <>
            {modifiers.map((m) => renderToken(m, false))}
            {key ? renderToken(key, false) : null}
          </>
        )}
      </button>
      {value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCapturing(false)
            onClear()
          }}
          aria-label={t('settings.shortcuts.clearAria')}
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

// ─── Shortcuts Section ─────────────────────────────────────────────────────
// 注册表驱动。显示/隐藏窗口复用 launcher.hotkey（与「快捷助手」栏同步）；
// 搜索/新任务/打开设置存 shortcuts.*。冲突检测仅在本 4 项之间。
function ShortcutsSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useAppConfig()
  const [conflictId, setConflictId] = useState<string | null>(null)

  const launcher = (config?.launcher || {}) as { enabled?: boolean; hotkey?: string }
  const shortcuts = (config?.shortcuts || {}) as Record<string, string>

  const readShortcut = (id: string): string =>
    typeof shortcuts[id] === 'string' ? shortcuts[id] : (DEFAULT_SHORTCUTS as Record<string, string>)[id]

  interface Row {
    id: string
    group: 'global' | 'app'
    label: string
    value: string
    write: (next: string) => void
  }

  const rows: Row[] = [
    {
      id: 'toggleWindow',
      group: 'global',
      label: t('settings.shortcuts.item.toggleWindow'),
      value: typeof launcher.hotkey === 'string' ? launcher.hotkey : DEFAULT_TOGGLE_WINDOW_HOTKEY,
      write: (next) => updateConfig({ launcher: { ...launcher, hotkey: next } }),
    },
    ...(['search', 'newTask', 'settings'] as const).map((id) => ({
      id,
      group: 'app' as const,
      label: t(`settings.shortcuts.item.${id}`),
      value: readShortcut(id),
      write: (next: string) => updateConfig({ shortcuts: { ...shortcuts, [id]: next } }),
    })),
  ]

  const handleCapture = (row: Row, accel: string) => {
    const norm = normalizeAccelerator(accel)
    const clash = rows.some((r) => r.id !== row.id && r.value && normalizeAccelerator(r.value) === norm)
    if (clash) {
      setConflictId(row.id)
      return
    }
    setConflictId(null)
    row.write(accel)
  }

  const handleClear = (row: Row) => {
    if (conflictId === row.id) setConflictId(null)
    row.write('')
  }

  const handleRestoreDefaults = () => {
    setConflictId(null)
    updateConfig({
      launcher: { ...launcher, hotkey: DEFAULT_TOGGLE_WINDOW_HOTKEY },
      shortcuts: { ...DEFAULT_SHORTCUTS },
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  const groups: { key: 'global' | 'app'; title: string }[] = [
    { key: 'global', title: t('settings.shortcuts.group.global') },
    { key: 'app', title: t('settings.shortcuts.group.app') },
  ]

  return (
    <div>
      <SectionHeader icon={Keyboard} title={t('settings.shortcuts.header.title')} subtitle={t('settings.shortcuts.header.subtitle')} />
      {groups.map((group) => (
        <GroupCard key={group.key} title={group.title}>
          {rows.filter((r) => r.group === group.key).map((row) => (
            <SettingRow key={row.id} label={row.label}>
              <div className="flex flex-col items-end gap-1">
                <ShortcutRecorder
                  value={row.value}
                  onCapture={(accel) => handleCapture(row, accel)}
                  onClear={() => handleClear(row)}
                />
                {conflictId === row.id && (
                  <span className="text-xs text-red-600">{t('settings.shortcuts.conflict')}</span>
                )}
              </div>
            </SettingRow>
          ))}
        </GroupCard>
      ))}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleRestoreDefaults}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t('settings.shortcuts.restoreDefaults')}
        </button>
      </div>
    </div>
  )
}
```

注：`X` 与 `RotateCcw` 已在 SettingsPage 的 lucide-react import 中，无需新增。

- [ ] **Step 5: 注册 SectionKey**

将（约 7850）：

```ts
type SectionKey = 'auth' | 'models' | 'agents' | 'channels' | 'search' | 'tools' | 'ui' | 'storage' | 'logs' | 'updates' | 'software' | 'launcher'
```

改为：

```ts
type SectionKey = 'auth' | 'models' | 'agents' | 'channels' | 'search' | 'tools' | 'ui' | 'storage' | 'logs' | 'updates' | 'software' | 'launcher' | 'shortcuts'
```

- [ ] **Step 6: 加入导航项**

在应用配置组内，`launcher` 项之后插入 `shortcuts` 项。找到：

```tsx
        { key: 'software', icon: SlidersHorizontal, label: t('settings.nav.software') },
        { key: 'launcher', icon: Keyboard, label: t('settings.nav.launcher') },
        { key: 'logs', icon: FileText, label: t('settings.nav.logs') },
```

改为：

```tsx
        { key: 'software', icon: SlidersHorizontal, label: t('settings.nav.software') },
        { key: 'launcher', icon: Keyboard, label: t('settings.nav.launcher') },
        { key: 'shortcuts', icon: Command, label: t('settings.nav.shortcuts') },
        { key: 'logs', icon: FileText, label: t('settings.nav.logs') },
```

`Command` 图标未导入，须在 SettingsPage 顶部 lucide-react import 块（约 19 行 `Keyboard,` 附近）新增一行：

```ts
  Command,
```

- [ ] **Step 7: 渲染 Section**

在右侧非全宽分支内，`launcher` 渲染之后加入 `shortcuts`。找到：

```tsx
            {active === 'launcher' && <LauncherSection />}
```

改为：

```tsx
            {active === 'launcher' && <LauncherSection />}
            {active === 'shortcuts' && <ShortcutsSection />}
```

- [ ] **Step 8: Lint 门禁**

Run: `yarn lint`
Expected: 通过。

- [ ] **Step 9: 手动运行验证**

Run: `yarn dev`（应用启动后）
逐项确认：
1. 左侧导航「应用配置」下出现「快捷设置」，点击进入。
2. 两个分区：「全局快捷键」含"显示/隐藏窗口"；「应用内快捷键」含搜索/新任务/打开设置，各显示默认组合胶囊。
3. 点某项 × → 变为「点击设置」；点「点击设置」→ 录制态；按 `⌘⇧P` 之类组合 → 写入并显示字形；按 `Esc` → 取消。
4. 把"搜索"录成与"新任务"相同的组合 → 该行下方红字「快捷键冲突，请更换」，且值未改变。
5. 「快捷助手」栏修改 hotkey 后，回到「快捷设置」看"显示/隐藏窗口"同步变化（反之亦然）。
6. 点「恢复默认设置」→ 四项回到默认。

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/pages/SettingsPage.tsx src/renderer/src/locales/zh.json src/renderer/src/locales/en.json
git commit -m "feat(settings): add shortcut settings section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 应用内快捷键改为读配置（App.tsx + Sidebar.tsx）

**Files:**
- Modify: `src/renderer/src/App.tsx`（`GlobalShortcuts`，约 95-126）
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`（keydown effect，约 467-503）

**Interfaces:**
- Consumes: Task 1 的 `readAppShortcuts`、`matchesAccelerator`；现有 `useAppConfig`。
- Produces: 无（行为改造）。

- [ ] **Step 1: App.tsx — 打开设置快捷键读配置**

在 App.tsx 顶部 import 区加入：

```ts
import { useAppConfig } from './hooks/useEngineConfig'
import { readAppShortcuts, matchesAccelerator } from './lib/shortcuts'
```

（若 `useAppConfig` 已从别处引入则复用，勿重复。）

将 `GlobalShortcuts` 现有实现：

```tsx
function GlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      if (event.altKey || event.shiftKey) return
      if (event.key !== ',') return

      // Don't override "," typed inside a composer / input / editable.
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      event.preventDefault()
      event.stopPropagation()
      if (location.pathname !== '/settings') {
        navigate('/settings')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [navigate, location.pathname])

  return null
}
```

替换为（用配置化快捷键匹配）：

```tsx
function GlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { config } = useAppConfig()
  const settingsHotkey = readAppShortcuts(config).settings

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesAccelerator(event, settingsHotkey)) return

      // Don't override the combo typed inside a composer / input / editable.
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      event.preventDefault()
      event.stopPropagation()
      if (location.pathname !== '/settings') {
        navigate('/settings')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [navigate, location.pathname, settingsHotkey])

  return null
}
```

- [ ] **Step 2: Sidebar.tsx — 搜索/新任务快捷键读配置**

在 Sidebar.tsx 顶部 import 区加入：

```ts
import { useAppConfig } from '../../hooks/useEngineConfig'
import { readAppShortcuts, matchesAccelerator } from '../../lib/shortcuts'
```

在 `Sidebar()` 组件体内（其它 `useState`/hook 附近）加入：

```ts
  const { config: appConfig } = useAppConfig()
  const appShortcuts = readAppShortcuts(appConfig)
```

将现有 keydown effect 中处理 `⌘K` 与 `⌘N` 的两段（约 467-491）：

```ts
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((prev) => {
          const next = !prev
          if (next) {
            setSearchQuery('')
            setSearchActiveIndex(0)
          }
          return next
        })
        return
      }

      // ⌘/Ctrl + N — new session. Handled here (rather than in
      // App.tsx) so we can close the search palette first when it's
      // open; otherwise the navigation would land on the homepage
      // with the overlay still mounted on top.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        closeSearch()
        navigate('/', { state: { focusComposer: true } })
        return
      }
```

替换为（用配置化匹配；`search` 默认 `⌘K`，`newTask` 默认 `⌘N`）：

```ts
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesAccelerator(event, appShortcuts.search)) {
        event.preventDefault()
        setSearchOpen((prev) => {
          const next = !prev
          if (next) {
            setSearchQuery('')
            setSearchActiveIndex(0)
          }
          return next
        })
        return
      }

      // New session. Handled here (rather than in App.tsx) so we can close
      // the search palette first when it's open; otherwise the navigation
      // would land on the homepage with the overlay still mounted on top.
      if (matchesAccelerator(event, appShortcuts.newTask)) {
        event.preventDefault()
        closeSearch()
        navigate('/', { state: { focusComposer: true } })
        return
      }
```

然后把该 effect 的依赖数组由 `[navigate]` 改为包含快捷键值，找到该 effect 结尾：

```ts
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
```

改为：

```ts
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, appShortcuts.search, appShortcuts.newTask])
```

注：该 effect 内的 `Escape` 分支与其余逻辑保持不变。

- [ ] **Step 3: Lint 门禁**

Run: `yarn lint`
Expected: 通过。

- [ ] **Step 4: 手动运行验证**

Run: `yarn dev`
1. 默认状态：`⌘K` 打开搜索，`⌘N` 新任务，`⌘,` 打开设置（与改造前一致）。
2. 到「快捷设置」把"搜索"改为 `⌘⇧K`：`⌘K` 不再打开搜索，`⌘⇧K` 打开搜索。
3. 删除"打开设置"快捷键：`⌘,` 不再打开设置。
4. 「恢复默认设置」后三者恢复原快捷键。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(shortcuts): make in-app shortcuts read from config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 新增「快捷设置」栏 + 分区 → Task 3。
- 左功能/右快捷键、× 删除、点击设置录制、冲突红字不写入 → Task 3（ShortcutRecorder + handleCapture/handleClear）。
- 恢复默认设置 → Task 3（handleRestoreDefaults）。
- 数据模型 `shortcuts.*` + 复用 `launcher.hotkey` → Task 1（默认/读取）、Task 3（读写）。
- 两栏同步同一 launcher.hotkey → Task 3（read/write launcher.hotkey，useAppConfig 广播）。
- 应用内快捷键写死改读配置 → Task 4。
- 应用内仅聚焦生效、主进程不为其注册 → Task 4（渲染层 keydown，无主进程改动）。
- 全局项空值不注册 → Task 2。
- i18n → Task 3 Step 1-2。
- 冲突仅本 4 项、normalizeAccelerator → Task 1 + Task 3。

**Placeholder scan:** 无 TBD/TODO/"类似上文"；所有代码步骤含完整代码。

**Type consistency:** `readAppShortcuts`/`matchesAccelerator`/`normalizeAccelerator`/`DEFAULT_SHORTCUTS`/`DEFAULT_TOGGLE_WINDOW_HOTKEY` 在 Task 1 定义，Task 3/4 按同名同签名使用。`ShortcutRecorder` props（value/onCapture/onClear）在 Task 3 定义并在同任务内使用。空串语义在 Task 1（readAppShortcuts 保留空串）、Task 2（launcher 空串不注册）、Task 3（write('') 清空）一致。
