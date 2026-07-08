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
