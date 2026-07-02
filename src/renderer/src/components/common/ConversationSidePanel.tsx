import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ChevronDown, ChevronUp, ChevronRight, FileText, Terminal, Code, ExternalLink, Search, Folder, File, FolderOpen, Wrench, Globe, Sparkles, Check, Clock, Circle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import iconSidebarOpen from '../../assets/icon-sidebar-open.svg'
import iconSidebarCollapse from '../../assets/icon-sidebar-collapse.svg'
import emmaAvatar from '../../assets/emma-avatar.svg'
import agentAvatar from '../../assets/agent-avatar.svg'
import alexAvatar from '../../assets/alex-avatar.svg'
import emmaText from '../../assets/emma-text.svg'
import alexText from '../../assets/alex-text.svg'
import lilyAvatar from '../../assets/lily-avatar.svg'
import lilyText from '../../assets/lily-text.svg'
import maryAvatar from '../../assets/mary-avatar.svg'
import maryText from '../../assets/mary-text.svg'
import { resolveArtifactIcon } from '../../assets/artifact-icons'
import type { ArtifactRef } from '../pages/ChatPage'
import { getSecretaryForType } from '../../utils/secretaryAssignment'

// Agent LOGO imports
import emmaLeaderLogo from '../../assets/agent-logos/Emma_leader.svg'
import alexAgentLogo from '../../assets/agent-logos/Alex Agent.svg'
import browserAgentLogo from '../../assets/agent-logos/Browser Agent.svg'
import researchAgentLogo from '../../assets/agent-logos/Research Agent.svg'
import fileAgentLogo from '../../assets/agent-logos/File Agent.svg'
import appAgentLogo from '../../assets/agent-logos/App Agent.svg'
import codingAgentLogo from '../../assets/agent-logos/Coding Agent.svg'

const PANEL_WIDTH_EXPANDED = 280
const PANEL_WIDTH_COLLAPSED = 44

type PanelTab = 'plan' | 'logs' | 'artifacts'
/** 产物 tab 下的子模式：general=通用模式（产物列表），dev=开发模式（工作区文件树） */
type ArtifactMode = 'general' | 'dev'

/** 工作区文件树节点（镜像 preload 的 WorkspaceFileNode，组件内自洽不依赖 preload 类型） */
interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  modifiedAt?: number
  children?: WorkspaceFileNode[]
}

/**
 * 日志时间线条目 — 统一表示工具调用和子 agent 活动。
 * v2: 改成工具调用时间线，普通对话也有日志（Read/Edit/Bash等）。
 * v3: 支持按消息分组的时间轴展示。
 */
export interface AgentLogEntry {
  id: string
  /** 时间戳，用于排序和显示相对时间 */
  timestamp: number
  /** 条目类型：tool=工具调用，agent=子agent活动 */
  type: 'tool' | 'agent'

  // ─── 工具调用字段（type='tool'时必填）───
  /** 工具名（Read / Edit / Bash / WebSearch ...） */
  toolName?: string
  /** 工具状态：running / success / failed / cancelled */
  toolStatus?: 'running' | 'success' | 'failed' | 'cancelled'
  /** 一句话描述（来自 intent 或 content 前50字） */
  description: string
  /** 耗时（毫秒） */
  durationMs?: number
  /** 错误类型（失败时） */
  errorType?: string
  /** 错误消息（开发者用，展开后显示） */
  errorMessage?: string
  /** 子 agent 名称（如果是子 agent 的工具调用） */
  subagentName?: string
  /** 工具调用的 callId，用于展开/折叠状态管理 */
  callId?: string
  /** 工具调用参数（展开后显示，JSON字符串） */
  toolInput?: string
  /** 工具调用输出（展开后显示） */
  toolOutput?: string
  /** 搜索结果链接（WebSearch 专用） */
  searchUrls?: Array<{ url: string; title?: string }>
  /** 搜索查询（WebSearch 专用） */
  searchQuery?: string
  /** 搜索结果数（WebSearch 专用） */
  searchResultCount?: number

  // ─── 子 agent 字段（type='agent'时必填，向后兼容旧逻辑）───
  /** Display name shown under the avatar (Emma / Lily / Mary …). */
  name?: string
  /** Resolved avatar image URL. */
  avatarSrc?: string
  /** Role label shown on the activity row (Leader / Browser Agent …). */
  role?: string
  /** Which leading icon to draw next to the role label. */
  roleIcon?: 'leader' | 'browser' | 'file' | 'generic'
  /** Optional orange count badge (event count, etc.). */
  badge?: string
  status?: 'running' | 'completed' | 'failed'
}

/** 消息分组的日志条目（v3 新增） */
export interface MessageGroupedLog {
  /** 消息 ID */
  messageId: string
  /** 消息时间戳 */
  timestamp: number
  /** 消息角色 (user / assistant) */
  role: 'user' | 'assistant'
  /** 消息内容摘要（前50字） */
  contentPreview?: string
  /** 该消息下的所有日志条目 */
  entries: AgentLogEntry[]
}

/**
 * v4: Agent 树状日志节点（日志模块改造 - 2026/06/22）
 * 用于右侧日志面板展示 Emma(Leader) → 子 Agent → 工具调用的层级结构
 */
export interface AgentTreeNode {
  /** Agent ID (引擎的 agent_id,主 agent 用 "main") */
  id: string
  /** Agent 名称 (Emma / Browser Agent / Research Agent ...) */
  name: string
  /** Agent 类型标签 (browser / research / file / app / coding / ...) */
  type?: string
  /** Agent 状态 */
  status: 'running' | 'completed' | 'failed' | 'max_turns' | 'timeout'
  /** 一句话描述 (来自 agent_desc 或 task) */
  description?: string
  /** 开始时间戳 */
  startTime: number
  /** 结束时间戳 (running 时为空) */
  endTime?: number
  /** 耗时(毫秒) */
  durationMs?: number
  /** 该 Agent 执行的工具调用列表 */
  tools: AgentLogEntry[]
  /** 子 Agent 列表 */
  children: AgentTreeNode[]
  /** 父 Agent ID (用于构建树时查找,渲染时可选) */
  parentId?: string
  /** 头像 URL (Emma / Lily / Mary 等角色头像) */
  avatarSrc?: string
  /** Agent 元数据 JSON (subagent_end 事件的完整字段,用于展开查看详情) */
  metadata?: Record<string, unknown>
}

/** 兼容旧版 plan step 接口的简化日志条目（HEAD 行为）。 */
interface LegacyLogStep {
  id: string
  description?: string
  status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
  summary?: string
}

interface ConversationSidePanelProps {
  /** Plan 模式数据 — 只在 plan 模式下显示计划 tab */
  planData?: {
    planId: string
    goal: string
    steps: Array<{
      id: string
      description?: string
      status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
      summary?: string
    }>
    planStatus?: 'created' | 'running' | 'completed' | 'failed'
  }
  /** 新接口：完整工具调用 timeline。和 steps 二选一，优先级高于 steps。 */
  logEntries?: AgentLogEntry[]
  /** v3: 按消息分组的日志时间轴（优先级高于 logEntries） */
  messageGroupedLogs?: MessageGroupedLog[]
  /** v4: Agent 树状日志（日志模块改造）。优先级最高,存在时渲染树状结构。 */
  agentTreeLogs?: AgentTreeNode[]
  /** 旧接口：plan steps（HEAD 行为）。当 logEntries 缺省时退回此渲染。 */
  steps?: LegacyLogStep[]
  /** 通用模式产物卡片列表：来自 agent 声明的产物 + meta.json outputs 兜底（ChatPage 合并后传入）。 */
  artifacts: ArtifactRef[]
  /** 通用模式点击产物 → 宿主打开预览（fetch + read 走 openArtifactPreview）。 */
  onSelectArtifact: (artifact: ArtifactRef) => void
  /** 通用模式点击「打开文件所在位置」→ 宿主在系统文件管理器中定位该产物文件。 */
  onRevealArtifact?: (artifact: ArtifactRef) => void
  /** 当前会话 ID — 开发模式据此读取工作区文件树（window.workspace.listSession） */
  sessionId?: string
  /** 开发模式点击文件 → 宿主打开文件预览（复用 FilePreviewDrawer） */
  onSelectWorkspaceFile?: (path: string, fileName: string) => void
}

const TAB_STORAGE_KEY = 'chat-side-panel-tab'

function readStoredTab(): PanelTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v === 'plan') return 'plan'
    if (v === 'artifacts') return 'artifacts'
    return 'logs'
  } catch {
    return 'logs'
  }
}

const ARTIFACT_MODE_STORAGE_KEY = 'chat-side-panel-artifact-mode'

function readStoredArtifactMode(): ArtifactMode {
  try {
    const v = localStorage.getItem(ARTIFACT_MODE_STORAGE_KEY)
    return v === 'dev' ? 'dev' : 'general'
  } catch {
    return 'general'
  }
}


// 兼容旧 plan-step 接口的状态点颜色 / 文本格式化（HEAD 行为）。
function legacyStatusDot(status?: LegacyLogStep['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500'
    case 'running':
    case 'dispatched':
      return 'bg-sky-500 animate-pulse'
    case 'failed':
      return 'bg-red-500'
    case 'skipped':
      return 'bg-muted-foreground/40'
    default:
      return 'bg-muted-foreground/30'
  }
}
function legacyStepLabel(step: LegacyLogStep, t: (k: string) => string): string {
  const desc = (step.description || '').trim()
  if (!desc) return t('chat.sidePanel.unnamedStep')
  if (step.status === 'completed') return t('chat.sidePanel.completedPrefix') + desc
  return desc
}

// 根据工具名返回对应图标（工具调用专用）
function getToolIcon(toolName: string, status?: AgentLogEntry['toolStatus']) {
  if (status === 'running') {
    return <Loader2 size={14} className="flex-shrink-0 animate-spin text-amber-500" aria-hidden="true" />
  }

  const name = toolName.toLowerCase()

  if (name.includes('read') || name.includes('file')) {
    return <FileText size={14} className="flex-shrink-0 text-sky-500" aria-hidden="true" />
  }
  if (name.includes('bash') || name.includes('shell') || name.includes('powershell')) {
    return <Terminal size={14} className="flex-shrink-0 text-green-500" aria-hidden="true" />
  }
  if (name.includes('search') || name.includes('web')) {
    return <Globe size={14} className="flex-shrink-0 text-blue-500" aria-hidden="true" />
  }
  if (name.includes('edit') || name.includes('write') || name.includes('code')) {
    return <Code size={14} className="flex-shrink-0 text-purple-500" aria-hidden="true" />
  }

  // 默认通用图标
  return <Sparkles size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
}

// 根据 plan step 状态返回对应图标
function getPlanStepIcon(status?: string) {
  switch (status) {
    case 'completed':
      return <Check size={14} className="text-emerald-500" />
    case 'running':
    case 'dispatched':
      return <Clock size={14} className="text-orange-500" />
    case 'failed':
      return <XCircle size={14} className="text-red-500" />
    case 'skipped':
      return <XCircle size={14} className="text-muted-foreground" />
    default:
      return <Circle size={14} className="text-muted-foreground" />
  }
}


// 格式化相对时间（刚刚、2分钟前、1小时前）
function formatRelativeTime(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 5000) return t('chat.sidePanel.relativeTime.justNow')
  if (diff < 60000) return t('chat.sidePanel.relativeTime.secondsAgo', { count: Math.floor(diff / 1000) })
  if (diff < 3600000) return t('chat.sidePanel.relativeTime.minutesAgo', { count: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('chat.sidePanel.relativeTime.hoursAgo', { count: Math.floor(diff / 3600000) })
  return t('chat.sidePanel.relativeTime.daysAgo', { count: Math.floor(diff / 86400000) })
}

// 格式化耗时（1.2s、350ms）
function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// 错误类型 → 人类可读文本。和 ChatPage 的 getToolErrorPresentation 保持
// 一致的取值集合（v2 §12 categorized failure types）。
const ERROR_TYPE_KEYS = new Set([
  'invalid_input', 'permission_denied', 'tool_timeout', 'user_aborted',
  'rate_limit', 'overloaded', 'model_error', 'contract_fail',
  'dependency_fail', 'internal',
])
function getErrorTypeLabel(errorType: string, t: (key: string) => string): string {
  if (ERROR_TYPE_KEYS.has(errorType)) return t(`chat.sidePanel.errorType.${errorType}`)
  return errorType
}

// 获取产物类型图标。链接类型用外链图标；文件类型优先用彩色 SVG（按扩展名/
// mimeType），未命中再回退到通用 FileText。
function getArtifactIcon(artifact: ArtifactRef) {
  const isLink = artifact.type === 'link' || artifact.uri?.startsWith('http')
  if (isLink) {
    return <ExternalLink size={20} className="flex-shrink-0 text-blue-500" aria-hidden="true" />
  }
  const iconSrc = resolveArtifactIcon({
    name: artifact.name,
    uri: artifact.uri,
    mimeType: artifact.mime_type,
  })
  if (iconSrc) {
    return <img src={iconSrc} alt="" className="h-5 w-[14px] flex-shrink-0 object-contain" aria-hidden="true" />
  }
  return <FileText size={20} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
}

// 通过主进程 shell.openExternal 打开外部 URL。和 SettingsPage / ChatPage 的
// 处理方式保持一致,不依赖 BrowserWindow 的 setWindowOpenHandler 隐式行为。
function openExternalUrl(url: string) {
  const fn = window.appRuntime?.openExternal
  if (fn) {
    void fn(url)
  } else {
    // 兜底:开发环境或 preload 未注入时,走 window.open(setWindowOpenHandler 会拦截)
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// ─── Agent 类型到头像映射 ──────────────────────────────────────────────────
// 根据 Agent 类型(或 id)返回对应的头像。Emma 是 Leader,其他专业 Agent 用通用 Agent 头像。
function getAgentAvatar(agent: { id: string; name: string; type?: string }): string {
  // Emma / Leader / main agent
  if (agent.id === 'main' || agent.id === 'main-end' || agent.name.toLowerCase().includes('emma') || agent.type?.includes('leader')) {
    return emmaAvatar
  }
  // Alex / Freelancer agent
  if (agent.type?.includes('freelancer')) {
    return alexAvatar
  }
  // 其他子 Agent：随机使用 Lily 或 Mary（同一 type 保持一致）
  if (agent.type) {
    const secretary = getSecretaryForType(agent.type)
    return secretary === 'lily' ? lilyAvatar : maryAvatar
  }
  // 兜底
  return agentAvatar
}

// ─── Agent 头像下方文字/图片映射 ──────────────────────────────────────────────
function getAgentNameDisplay(agent: { id: string; name: string; type?: string }): { type: 'image' | 'text'; value: string } {
  // Emma / Leader / main agent - 使用 emmaText 图片
  if (agent.id === 'main' || agent.id === 'main-end' || agent.name.toLowerCase().includes('emma') || agent.type?.includes('leader')) {
    return { type: 'image', value: emmaText }
  }
  // Alex / Freelancer agent - 使用 alexText 图片
  if (agent.type?.includes('freelancer')) {
    return { type: 'image', value: alexText }
  }
  // 其他子 Agent：使用 Lily 或 Mary 的文字图片
  if (agent.type) {
    const secretary = getSecretaryForType(agent.type)
    return { type: 'image', value: secretary === 'lily' ? lilyText : maryText }
  }
  // 兜底：纯文字
  return { type: 'text', value: agent.name }
}

// ─── Agent 类型到图标映射 ──────────────────────────────────────────────────
// 根据 Agent 类型返回对应的 LOGO 图片
function getAgentTypeLogo(agent: { id: string; name: string; type?: string }): string | null {
  // Emma / Leader / main agent
  if (agent.id === 'main' || agent.id === 'main-end' || agent.name.toLowerCase().includes('emma') || agent.type?.includes('leader')) {
    return emmaLeaderLogo
  }

  if (!agent.type) return null

  const type = agent.type.toLowerCase()

  if (type.includes('freelancer')) {
    return alexAgentLogo
  }
  if (type.includes('browser')) {
    return browserAgentLogo
  }
  if (type.includes('research')) {
    return researchAgentLogo
  }
  if (type.includes('file')) {
    return fileAgentLogo
  }
  if (type.includes('app')) {
    return appAgentLogo
  }
  if (type.includes('coding') || type.includes('code')) {
    return codingAgentLogo
  }

  return null
}

// ─── Agent 卡片（扁平列表，不递归） ───────────────────────────────────
interface AgentCardProps {
  agent: AgentTreeNode
  isExpanded: boolean
  toggleExpanded: (agentId: string, next: boolean) => void
  expandedLogs: Record<string, boolean>
  toggleLogExpanded: (id: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
  formatRelativeTime: (timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string) => string
  getToolIcon: (toolName: string, status?: AgentLogEntry['toolStatus']) => JSX.Element
}

function AgentCard({
  agent,
  isExpanded,
  toggleExpanded,
  expandedLogs,
  toggleLogExpanded,
  t,
  formatRelativeTime,
  getToolIcon,
}: AgentCardProps) {
  const statusColor = {
    running: 'text-amber-500',
    completed: 'text-emerald-500',
    failed: 'text-red-500',
    max_turns: 'text-orange-500',
    timeout: 'text-orange-500',
  }[agent.status] || 'text-muted-foreground'

  const statusDot = {
    running: 'bg-amber-500 animate-pulse',
    completed: 'bg-emerald-500',
    failed: 'bg-red-500',
    max_turns: 'bg-orange-500',
    timeout: 'bg-orange-500',
  }[agent.status] || 'bg-muted-foreground'

  const hasTools = agent.tools.length > 0
  const hasMetadata = !!agent.metadata && Object.keys(agent.metadata).length > 0
  const hasContent = hasTools || hasMetadata
  const avatarSrc = agent.avatarSrc || getAgentAvatar(agent)
  const agentLogo = getAgentTypeLogo(agent)

  // 运行中默认展开方便实时查看；完成后默认收起。两种状态都可手动下拉/收起。
  const isRunning = agent.status === 'running'
  const canExpand = hasContent

  // 完成后图标下方显示总结文字：
  //  - Emma 收尾节点 (main-end)：固定文案"已完成任务"
  //  - Emma 开头节点 (main/leader) 完成：固定文案"已完成任务规划和工作安排"
  //  - 通用智能体 (freelancer) 完成：固定文案"已完成工作"
  //  - Browser Agent 完成：固定文案"已完成浏览器调度，打开网页并且截图"
  //  - Research Agent 完成：固定文案"已完成文件夹搜索和整理"
  //  - Coding Agent 完成：固定文案"代码已经完成编写"
  //  - File Agent 完成：固定文案"已完成文件处理工作"
  //  - App Agent 完成：固定文案"已完成APP相关处理"
  //  - 其他子 Agent 完成：已完成 + 任务描述（subagent_start 分配的任务内容）
  //  - 运行中：显示原始任务描述（Emma 为"任务规划中"）
  const isEndNode = agent.id === 'main-end'
  const isLeader = agent.id === 'main' || agent.type?.includes('leader')
  const isFreelancer = agent.type?.includes('freelancer')
  const agentType = agent.type?.toLowerCase() || ''
  const isCompleted = agent.status === 'completed'
  let displayDescription = agent.description
  if (isEndNode) {
    displayDescription = t('chat.sidePanel.allTasksCompleted')
  } else if (isLeader && isCompleted) {
    displayDescription = t('chat.sidePanel.completedTask')
  } else if (isFreelancer && isCompleted) {
    displayDescription = t('chat.sidePanel.completedWork')
  } else if (isCompleted) {
    // 根据 agent type 显示专属完成文案
    if (agentType.includes('browser')) {
      displayDescription = t('chat.sidePanel.completedBrowser')
    } else if (agentType.includes('research')) {
      displayDescription = t('chat.sidePanel.completedResearch')
    } else if (agentType.includes('coding') || agentType.includes('code')) {
      displayDescription = t('chat.sidePanel.completedCoding')
    } else if (agentType.includes('file')) {
      displayDescription = t('chat.sidePanel.completedFile')
    } else if (agentType.includes('app')) {
      displayDescription = t('chat.sidePanel.completedApp')
    } else {
      // 兜底：如果有描述就用"已完成 + 描述"，否则用通用"已完成工作"
      displayDescription = agent.description
        ? `${t('chat.sidePanel.completedPrefix')}${agent.description}`
        : t('chat.sidePanel.completedWork')
    }
  }

  return (
    <div>
      {/* Agent 头部 */}
      <button
        onClick={() => canExpand && toggleExpanded(agent.id, !isExpanded)}
        disabled={!canExpand}
        className={cn(
          'flex w-full items-start gap-2.5 px-2 py-2.5 text-left transition-colors rounded-lg',
          canExpand ? 'hover:bg-accent/30 cursor-pointer' : 'cursor-default'
        )}
      >
        {/* 左侧：头像 + 名字垂直布局（设计图：头像 24×24，名字在正下方，45% 灰） */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <img
            src={avatarSrc}
            alt={agent.name}
            className="h-6 w-6 rounded-full object-cover"
          />
          {/* 头像下方：根据 agent 类型显示图片或文字 */}
          {(() => {
            const nameDisplay = getAgentNameDisplay(agent)
            if (nameDisplay.type === 'image') {
              return (
                <img
                  src={nameDisplay.value}
                  alt={agent.name}
                  className="h-[9px] object-contain opacity-45"
                />
              )
            } else {
              return <p className="text-[9px] text-muted-foreground/45">{nameDisplay.value}</p>
            }
          })()}
        </div>

        {/* 右侧：内容区（上排 LOGO，下排 文案，文案行尾放"工作中"/展开箭头） */}
        <div className="min-w-0 flex-1">
          {/* LOGO 胶囊（设计图高 23，含图标+文字，无状态点） */}
          <div className="flex items-center mb-[18px]">
            {agentLogo && (
              <img
                src={agentLogo}
                alt={agent.name}
                className="h-[23px] flex-shrink-0"
              />
            )}
          </div>

          {/* 文案行：完成文案 + 行尾状态/箭头（Figma：font 10px / line-height 20px / 黑 45%） */}
          <div className="flex items-end gap-1">
            {displayDescription && (
              <p className="min-w-0 text-[10px] leading-[20px] text-black/45 dark:text-white/45">
                {displayDescription}
              </p>
            )}

            {/* 行尾：运行中显示"工作中"（渐变文字）+ 展开箭头，完成后只显示展开/折叠图标 */}
            {isRunning ? (
              <>
                <span
                  className="flex-shrink-0 text-[10px] leading-[20px] dark:hidden"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, rgba(0,0,0,0.8) 28%, rgba(0,0,0,0) 68%, rgba(0,0,0,0.8) 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                  }}
                >
                  {t('chat.sidePanel.working')}
                </span>
                <span
                  className="hidden dark:flex flex-shrink-0 text-[10px] leading-[20px]"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, rgba(255,255,255,0.8) 28%, rgba(255,255,255,0) 68%, rgba(255,255,255,0.8) 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                  }}
                >
                  {t('chat.sidePanel.working')}
                </span>
                {canExpand && (
                  <span className="flex-shrink-0 pb-0.5 text-muted-foreground/45">
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </span>
                )}
              </>
            ) : (
              canExpand && (
                <span className="flex-shrink-0 pb-0.5 text-muted-foreground/45">
                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </span>
              )
            )}
          </div>

          {/* 耗时（设计样例无此行，单独置于文案下方，不影响箭头对齐） */}
          {agent.durationMs !== undefined && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/40">
              {formatDuration(agent.durationMs)}
            </p>
          )}
        </div>
      </button>

      {/* 展开的内容：元数据 + 工具列表（运行中不可展开） */}
      {isExpanded && canExpand && (
        <div className="ml-[20px] mt-2 border-l-2 border-muted-foreground/10 pl-3">{/* 头像中心位置：8px padding + 12px 半径 = 20px */}
          {/* Agent 元数据 JSON (subagent_end 完整字段) */}
          {hasMetadata && (
            <div className="mb-2">
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Agent 元数据:</p>
              <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap break-words font-mono bg-muted/20 rounded px-1.5 py-1 max-h-32 overflow-y-auto">
                {JSON.stringify(agent.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* 工具列表 */}
          {hasTools && (
          <div className="space-y-1.5">
            {agent.tools.map((tool) => {
                const toolExpanded = expandedLogs[tool.id] || false
                const hasDetails = !!(
                  tool.durationMs ||
                  tool.errorMessage ||
                  tool.toolInput ||
                  tool.toolOutput
                )
                return (
                  <div key={tool.id} className="rounded border border-border/60 bg-background/40 text-xs">
                    {/* 工具头部 */}
                    <button
                      onClick={() => hasDetails && toggleLogExpanded(tool.id)}
                      disabled={!hasDetails}
                      className={cn(
                        'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors',
                        hasDetails && 'hover:bg-accent/30 cursor-pointer',
                        !hasDetails && 'cursor-default'
                      )}
                    >
                      {/* 工具图标 */}
                      {getToolIcon(tool.toolName || '', tool.toolStatus)}
                      <div className="min-w-0 flex-1">
                        {/* 工具名 + 描述 */}
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground text-[11px]">
                            {tool.toolName || 'Tool'}
                          </span>
                          {tool.toolStatus && (
                            <span className={cn(
                              'text-[10px]',
                              tool.toolStatus === 'success' ? 'text-emerald-500' :
                              tool.toolStatus === 'failed' ? 'text-red-500' :
                              tool.toolStatus === 'running' ? 'text-amber-500' :
                              'text-muted-foreground'
                            )}>
                              {tool.toolStatus === 'success' ? '✓' :
                               tool.toolStatus === 'failed' ? '✗' :
                               tool.toolStatus === 'running' ? '...' : ''}
                            </span>
                          )}
                        </div>
                        {tool.description && (
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {tool.description}
                          </p>
                        )}
                      </div>
                      {/* 耗时 */}
                      {tool.durationMs !== undefined && (
                        <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                          {formatDuration(tool.durationMs)}
                        </span>
                      )}
                      {/* 展开图标 */}
                      {hasDetails && (
                        toolExpanded ? <ChevronUp size={12} className="flex-shrink-0 text-muted-foreground" /> : <ChevronDown size={12} className="flex-shrink-0 text-muted-foreground" />
                      )}
                    </button>

                    {/* 展开的工具详情 */}
                    {toolExpanded && hasDetails && (
                      <div className="border-t border-border/40 px-2 py-2 space-y-1.5 bg-muted/20">
                        {tool.toolInput && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">输入:</p>
                            <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap break-words font-mono bg-background/60 rounded px-1.5 py-1 max-h-32 overflow-y-auto">
                              {tool.toolInput}
                            </pre>
                          </div>
                        )}
                        {tool.toolOutput && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">输出:</p>
                            <pre className="text-[10px] text-foreground/80 whitespace-pre-wrap break-words font-mono bg-background/60 rounded px-1.5 py-1 max-h-32 overflow-y-auto">
                              {tool.toolOutput}
                            </pre>
                          </div>
                        )}
                        {tool.errorMessage && (
                          <div>
                            <p className="text-[10px] font-medium text-red-500 mb-0.5">错误:</p>
                            <p className="text-[10px] text-red-500/80 whitespace-pre-wrap break-words">
                              {tool.errorMessage}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


export function ConversationSidePanel({ planData, logEntries, messageGroupedLogs, agentTreeLogs, steps, artifacts, onSelectArtifact, onRevealArtifact, sessionId, onSelectWorkspaceFile }: ConversationSidePanelProps) {
  const { t } = useTranslation()

  // DEBUG: 检查 planData
  useEffect(() => {
    if (planData) {
      console.log('[ConversationSidePanel] planData:', planData)
    }
  }, [planData])
  // 优先级：agentTreeLogs > messageGroupedLogs > logEntries > steps
  const useAgentTree = !!agentTreeLogs && agentTreeLogs.length > 0
  const useGroupedLogs = !useAgentTree && !!messageGroupedLogs && messageGroupedLogs.length > 0
  const useLegacySteps = !useAgentTree && !useGroupedLogs && !logEntries && Array.isArray(steps)
  const effectiveLogEntries = logEntries ?? []
  const effectiveSteps = steps ?? []
  const effectiveGroupedLogs = messageGroupedLogs ?? []
  const effectiveAgentTreeLogs = agentTreeLogs ?? []

  // 拍平 Agent 树：将树状结构转成扁平列表（Emma + 所有子 Agent 同级）
  const flattenAgentTree = (nodes: AgentTreeNode[]): AgentTreeNode[] => {
    const result: AgentTreeNode[] = []
    const traverse = (node: AgentTreeNode) => {
      result.push(node)
      node.children.forEach(traverse)
    }
    nodes.forEach(traverse)
    return result
  }

  const flatAgentList = flattenAgentTree(effectiveAgentTreeLogs)
  // Default closed every visit (tab choice is persisted, expanded state isn't).
  const [expanded, setExpanded] = useState(false)
  // Plan 模式下默认显示 plan tab，否则读取存储的 tab
  const [activeTab, setActiveTab] = useState<PanelTab>(() => {
    if (planData) return 'plan'
    return readStoredTab()
  })
  // 产物 tab 下的子模式（通用/开发），持久化到 localStorage。
  const [artifactMode, setArtifactMode] = useState<ArtifactMode>(() => readStoredArtifactMode())
  // 展开状态：key = entry.id, value = true 表示展开
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})
  // 消息分组展开状态：key = messageId, value = true 表示展开
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({})
  // Agent 树节点展开状态：key = agent.id, value = true 表示展开
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({})
  // logEntries 变化时(切会话/切对话),清理已经不在列表里的展开状态。
  useEffect(() => {
    if (useAgentTree) {
      setExpandedAgents((prev) => {
        const liveIds = new Set<string>()
        const collectIds = (nodes: AgentTreeNode[]) => {
          nodes.forEach((n) => {
            liveIds.add(n.id)
            collectIds(n.children)
          })
        }
        collectIds(effectiveAgentTreeLogs)
        let changed = false
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) {
          if (liveIds.has(key)) {
            next[key] = prev[key]
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    } else if (useGroupedLogs) {
      setExpandedMessages((prev) => {
        const liveIds = new Set(effectiveGroupedLogs.map((g) => g.messageId))
        let changed = false
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) {
          if (liveIds.has(key)) {
            next[key] = prev[key]
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    } else {
      setExpandedLogs((prev) => {
        const liveIds = new Set(effectiveLogEntries.map((e) => e.id))
        let changed = false
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) {
          if (liveIds.has(key)) {
            next[key] = prev[key]
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [useAgentTree, useGroupedLogs, effectiveLogEntries, effectiveGroupedLogs, effectiveAgentTreeLogs])
  // 相对时间需要随时间推移自动刷新("刚刚"→"1 分钟前")。仅在面板展开
  // 且当前在日志 tab 时启动 60s ticker,避免后台空转。
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!expanded || activeTab !== 'logs') return
    const id = window.setInterval(() => forceTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [expanded, activeTab])

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    } catch {
      // ignore — non-critical persistence
    }
  }, [activeTab])

  useEffect(() => {
    try {
      localStorage.setItem(ARTIFACT_MODE_STORAGE_KEY, artifactMode)
    } catch {
      // ignore — non-critical persistence
    }
  }, [artifactMode])

  const toggleExpanded = () => setExpanded((prev) => !prev)
  const toggleLogExpanded = (id: string) => {
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }
  const toggleAgentExpanded = (agentId: string, next: boolean) => {
    setExpandedAgents((prev) => ({ ...prev, [agentId]: next }))
  }

  return (
    <>
      {/* Vertical divider - only shown when panel is expanded */}
      {expanded && (
        <div className="relative h-full w-0 flex-shrink-0">
          <div className="absolute top-0 right-0 h-full w-px bg-[#DADEE4]" />
        </div>
      )}

      <aside
        aria-label={t('chat.sidePanel.label')}
        style={{ width: expanded ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH_COLLAPSED }}
        className="relative flex-shrink-0 flex flex-col select-none overflow-hidden transition-[width] duration-200"
      >
      {/* Header: collapse/expand toggle pinned left, tabs centered (when
          expanded). pt-[45px] + the 18px icon centered in the 36px button puts
          the icon 54px from the top boundary, per design spec. */}
      <div className="relative flex flex-shrink-0 items-center justify-center pl-2 pr-[26px] pt-[45px] pb-3">
        <button
          onClick={toggleExpanded}
          title={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-label={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-expanded={expanded}
          className={cn(
            'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent',
            expanded && 'absolute left-2'
          )}
        >
          <img
            src={expanded ? iconSidebarCollapse : iconSidebarOpen}
            alt=""
            className="h-[18px] w-[18px]"
            aria-hidden="true"
          />
        </button>

        {expanded && (
          <div role="tablist" aria-label={t('chat.sidePanel.tabsAria')} className="flex items-center gap-1">
            {planData && (
              <button
                role="tab"
                aria-selected={activeTab === 'plan'}
                onClick={() => setActiveTab('plan')}
                className={cn(
                  'inline-flex h-8 w-12 items-center justify-center rounded-[10px] text-xs font-medium transition-colors',
                  activeTab === 'plan'
                    ? 'bg-white text-foreground shadow-[0px_2px_4px_0px_rgba(46,51,68,0.0373)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('chat.sidePanel.tabPlan')}
              </button>
            )}
            <button
              role="tab"
              aria-selected={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
              className={cn(
                'inline-flex h-8 w-12 items-center justify-center rounded-[10px] text-xs font-medium transition-colors',
                activeTab === 'logs'
                  ? 'bg-white text-foreground shadow-[0px_2px_4px_0px_rgba(46,51,68,0.0373)]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabLogs')}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'artifacts'}
              onClick={() => setActiveTab('artifacts')}
              className={cn(
                'inline-flex h-8 w-12 items-center justify-center rounded-[10px] text-xs font-medium transition-colors',
                activeTab === 'artifacts'
                  ? 'bg-white text-foreground shadow-[0px_2px_4px_0px_rgba(46,51,68,0.0373)]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabArtifacts')}
            </button>
          </div>
        )}
      </div>

      {/* Body — only rendered while expanded; collapsed state is just the header button. */}
      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {activeTab === 'plan' && planData ? (
            // Plan tab：显示 plan steps 列表
            planData.steps.length === 0 ? (
              <EmptyState
                title={t('chat.sidePanel.noPlan')}
                desc={t('chat.sidePanel.noPlanDesc')}
              />
            ) : (
              <div className="space-y-2">
                {planData.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start gap-2">
                      {getPlanStepIcon(step.status)}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-foreground">
                          Plan-step-{idx + 1} {step.description || t('chat.sidePanel.unnamedStep')}
                        </div>
                        {step.summary && (
                          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                            {step.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === 'logs' ? (
            useAgentTree ? (
              effectiveAgentTreeLogs.length === 0 ? (
                <EmptyState
                  title={t('chat.sidePanel.noLogs')}
                  desc={t('chat.sidePanel.noLogsDesc')}
                />
              ) : (
                <div>
                  {flatAgentList.map((agent, index) => (
                    <div key={agent.id}>
                      <AgentCard
                        agent={agent}
                        isExpanded={expandedAgents[agent.id] ?? agent.status === 'running'}
                        toggleExpanded={toggleAgentExpanded}
                        expandedLogs={expandedLogs}
                        toggleLogExpanded={toggleLogExpanded}
                        t={t}
                        formatRelativeTime={formatRelativeTime}
                        getToolIcon={getToolIcon}
                      />
                      {/* 虚线连接器 - 除了最后一个 Agent */}
                      {index < flatAgentList.length - 1 && (
                        <div className="flex justify-start pl-2 py-1">
                          <div className="ml-[12px] h-6 border-l-[1.5px] border-dashed border-border" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : useGroupedLogs ? (
              effectiveGroupedLogs.length === 0 ? (
                <EmptyState
                  title={t('chat.sidePanel.noLogs')}
                  desc={t('chat.sidePanel.noLogsDesc')}
                />
              ) : (
                <ul className="space-y-3">
                  {effectiveGroupedLogs.map((group) => {
                    const messageExpanded = expandedMessages[group.messageId] !== false // 默认展开
                    const toolCount = group.entries.length
                    return (
                      <li key={group.messageId} className="rounded-lg border border-border bg-card/30">
                        {/* 消息头部 */}
                        <button
                          onClick={() => toggleMessageExpanded(group.messageId)}
                          className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-xs font-medium",
                                group.role === 'user' ? 'text-primary' : 'text-foreground'
                              )}>
                                {group.role === 'user' ? '用户' : 'AI'}
                              </span>
                              {toolCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  <Wrench size={10} />
                                  <span>{toolCount}</span>
                                </span>
                              )}
                            </div>
                            {group.contentPreview && (
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {group.contentPreview}
                              </p>
                            )}
                          </div>
                          {messageExpanded ? <ChevronUp size={14} className="flex-shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground" />}
                        </button>

                        {/* 展开的工具列表 */}
                        {messageExpanded && group.entries.length > 0 && (
                          <div className="border-t border-border px-2 py-2 space-y-1.5">
                            {group.entries.map((entry) => {
                              const isExpanded = expandedLogs[entry.id] || false
                              const hasDetails = !!(
                                entry.durationMs ||
                                entry.errorMessage ||
                                entry.searchUrls?.length ||
                                entry.searchQuery ||
                                entry.searchResultCount !== undefined
                              )

                              return (
                                <div key={entry.id} className="rounded border border-border/50 bg-background px-2 py-1.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        {getToolIcon(entry.toolName || '', entry.toolStatus)}
                                        <span className="truncate text-[11px] font-medium text-foreground">
                                          {entry.toolName || 'Unknown'}
                                        </span>
                                        {entry.toolStatus === 'success' && (
                                          <span className="flex-shrink-0 text-[9px] text-green-600">✓</span>
                                        )}
                                        {entry.toolStatus === 'failed' && (
                                          <span className="flex-shrink-0 text-[9px] text-red-600">✗</span>
                                        )}
                                        {entry.toolStatus === 'running' && (
                                          <Loader2 size={9} className="flex-shrink-0 animate-spin text-amber-500" />
                                        )}
                                      </div>
                                      {entry.description && (
                                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground line-clamp-1">
                                          {entry.description}
                                        </p>
                                      )}
                                    </div>
                                    {hasDetails && (
                                      <button
                                        onClick={() => toggleLogExpanded(entry.id)}
                                        className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label={isExpanded ? t('chat.sidePanel.collapse') : t('chat.sidePanel.expand')}
                                      >
                                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                      </button>
                                    )}
                                  </div>

                                  {/* 展开内容 */}
                                  {isExpanded && hasDetails && (
                                    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5">
                                      {entry.durationMs !== undefined && (
                                        <div className="text-[10px] text-muted-foreground">
                                          <span className="font-medium">{t('chat.sidePanel.duration')}</span> {formatDuration(entry.durationMs)}
                                        </div>
                                      )}
                                      {entry.errorType && (
                                        <div className="rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700 dark:bg-red-950/30 dark:text-red-300">
                                          <span className="font-medium">{t('chat.sidePanel.error')}</span> {getErrorTypeLabel(entry.errorType, t)}
                                          {entry.errorMessage && (
                                            <div className="mt-0.5 text-[9px] opacity-80 [overflow-wrap:anywhere]">{entry.errorMessage}</div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : useLegacySteps ? (
              effectiveSteps.length === 0 ? (
                <EmptyState
                  title={t('chat.sidePanel.noLogs')}
                  desc={t('chat.sidePanel.noLogsDesc')}
                />
              ) : (
                <ul className="space-y-3">
                  {effectiveSteps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', legacyStatusDot(step.status))} aria-hidden="true" />
                      <p className="text-xs leading-5 text-muted-foreground">{legacyStepLabel(step, t)}</p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
            effectiveLogEntries.length === 0 ? (
              <EmptyState
                title={t('chat.sidePanel.noLogs')}
                desc={t('chat.sidePanel.noLogsDesc')}
              />
            ) : (
              <ul className="space-y-2">
                {effectiveLogEntries.map((entry) => {
                  const isExpanded = expandedLogs[entry.id] || false
                  const hasDetails = !!(
                    entry.durationMs ||
                    entry.errorMessage ||
                    entry.searchUrls?.length ||
                    entry.searchQuery ||
                    entry.searchResultCount !== undefined
                  )

                  return (
                    <li key={entry.id} className="rounded-lg border border-border bg-card/50 px-2.5 py-2">
                      {/* 头部：时间 + 图标 + 工具名 + 状态 + 展开按钮 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {getToolIcon(entry.toolName || '', entry.toolStatus)}
                            <span className="truncate text-xs font-medium text-foreground">
                              {entry.toolName || 'Unknown'}
                            </span>
                            {entry.toolStatus === 'success' && (
                              <span className="flex-shrink-0 text-[10px] text-green-600">✓</span>
                            )}
                            {entry.toolStatus === 'failed' && (
                              <span className="flex-shrink-0 text-[10px] text-red-600">✗</span>
                            )}
                            {entry.toolStatus === 'running' && (
                              <Loader2 size={10} className="flex-shrink-0 animate-spin text-amber-500" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatRelativeTime(entry.timestamp, t)}
                            {entry.subagentName && ` · ${entry.subagentName}`}
                          </p>
                          {entry.description && (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground line-clamp-2">
                              {entry.description}
                            </p>
                          )}
                        </div>
                        {hasDetails && (
                          <button
                            onClick={() => toggleLogExpanded(entry.id)}
                            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={isExpanded ? t('chat.sidePanel.collapse') : t('chat.sidePanel.expand')}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                      </div>

                      {/* 展开内容：耗时、错误、搜索结果 */}
                      {isExpanded && hasDetails && (
                        <div className="mt-2 space-y-2 border-t border-border pt-2">
                          {entry.durationMs !== undefined && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.duration')}</span> {formatDuration(entry.durationMs)}
                            </div>
                          )}
                          {entry.errorType && (
                            <div className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/30 dark:text-red-300">
                              <span className="font-medium">{t('chat.sidePanel.error')}</span> {getErrorTypeLabel(entry.errorType, t)}
                              {entry.errorMessage && (
                                <div className="mt-0.5 text-[10px] opacity-80 [overflow-wrap:anywhere]">{entry.errorMessage}</div>
                              )}
                            </div>
                          )}
                          {entry.searchQuery && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.query')}</span> {entry.searchQuery}
                            </div>
                          )}
                          {entry.searchResultCount !== undefined && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.resultCount')}</span> {entry.searchResultCount}
                            </div>
                          )}
                          {entry.searchUrls && entry.searchUrls.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-medium text-muted-foreground">
                                {t('chat.sidePanel.links')}{entry.searchUrls.length > 5 ? t('chat.sidePanel.linksTruncated', { count: entry.searchUrls.length }) : ''}:
                              </div>
                              {entry.searchUrls.slice(0, 5).map((url) => (
                                <button
                                  key={url.url}
                                  type="button"
                                  onClick={() => openExternalUrl(url.url)}
                                  className="flex w-full items-center gap-1.5 rounded bg-accent px-2 py-1 text-left text-[11px] text-foreground hover:bg-accent/80 transition-colors"
                                  title={url.url}
                                >
                                  <ExternalLink size={10} className="flex-shrink-0" />
                                  <span className="truncate">{url.title || url.url}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )
            )
          ) : (
            // 产物 tab 内容
            <div>
              {/* 产物子模式切换 - 右上角 */}
              <div className="mb-3 flex justify-end">
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    onClick={() => setArtifactMode('general')}
                    className={cn(
                      'px-2 py-1 transition-colors',
                      artifactMode === 'general'
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('chat.sidePanel.artifactModeGeneral')}
                  </button>
                  <span className="text-muted-foreground/40">|</span>
                  <button
                    onClick={() => setArtifactMode('dev')}
                    className={cn(
                      'px-2 py-1 transition-colors',
                      artifactMode === 'dev'
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('chat.sidePanel.artifactModeDev')}
                  </button>
                </div>
              </div>

              {/* 产物内容 */}
              {artifactMode === 'general' ? (
                artifacts.length === 0 ? (
                  <EmptyState
                    title={t('chat.sidePanel.noArtifacts')}
                    desc={t('chat.sidePanel.noArtifactsDesc')}
                  />
                ) : (
                  <ul className="space-y-2">
                    {artifacts.map((artifact) => {
                      const title = artifact.name || artifact.artifact_id
                      const isLink = artifact.type === 'link' || artifact.uri?.startsWith('http')

                      return (
                        <li key={artifact.artifact_id}>
                          <div className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/60">
                            {/* 左侧图标 */}
                            {getArtifactIcon(artifact)}
                            {/* 中间文件名 */}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-foreground">{title}</div>
                            </div>
                            {/* 右侧操作图标：预览 + 打开 */}
                            <div className="flex flex-shrink-0 items-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isLink && artifact.uri) {
                                    openExternalUrl(artifact.uri)
                                  } else {
                                    onSelectArtifact(artifact)
                                  }
                                }}
                                title={isLink ? t('chat.sidePanel.artifactOpenExternal') : t('chat.sidePanel.artifactPreview')}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                {isLink ? <ExternalLink size={14} /> : <Search size={14} />}
                              </button>
                              {!isLink && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRevealArtifact?.(artifact)
                                  }}
                                  title={t('chat.sidePanel.artifactOpen')}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                >
                                  <FolderOpen size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <WorkspaceFileTreeView sessionId={sessionId} onSelectFile={onSelectWorkspaceFile} />
              )}
            </div>
          )}
        </div>
      )}
    </aside>
    </>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{desc}</p>
    </div>
  )
}

/**
 * 开发模式：会话工作区文件树（窄面板版）。
 * 读 `~/.harnessclaw/workspace/session/<sid>`，渲染完整文件树（含 deliverables/、tasks/ 等）；
 * 点文件交给宿主（ChatPage）走 FilePreviewDrawer 预览，不在 280px 面板内塞预览。
 */
function WorkspaceFileTreeView({
  sessionId,
  onSelectFile,
}: {
  sessionId?: string
  onSelectFile?: (path: string, fileName: string) => void
}) {
  const { t } = useTranslation()
  const [tree, setTree] = useState<WorkspaceFileNode[]>([])
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!sessionId) {
      setTree([])
      setExists(false)
      setError(null)
      return
    }
    if (typeof window === 'undefined' || !window.workspace || typeof window.workspace.listSession !== 'function') {
      setError('workspace api unavailable')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.workspace.listSession(sessionId)
      if (!res.ok) {
        setError(res.error || 'failed')
        setTree([])
        setExists(false)
        return
      }
      setTree(res.tree)
      setExists(res.exists)
    } catch (err) {
      setError(String((err as Error)?.message || err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex items-center justify-center px-2 py-8 text-[11px] text-muted-foreground">
          {t('chat.header.workspaceLoading')}
        </div>
      ) : error ? (
        <div className="flex items-center justify-center px-2 py-8 text-[11px] text-destructive">
          {error}
        </div>
      ) : !exists || tree.length === 0 ? (
        <EmptyState
          title={t('chat.header.workspaceEmpty')}
          desc={t('chat.sidePanel.noArtifactsDesc')}
        />
      ) : (
        <ul>
          {tree.map((node) => (
            <WorkspaceTreeRow
              key={node.path}
              node={node}
              depth={0}
              onSelectFile={(path, fileName) => onSelectFile?.(path, fileName)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 文件树递归行：目录可展开/折叠，文件点击触发预览回调。 */
function WorkspaceTreeRow({
  node,
  depth,
  onSelectFile,
}: {
  node: WorkspaceFileNode
  depth: number
  onSelectFile: (path: string, fileName: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const indent = { paddingLeft: `${4 + depth * 12}px` }

  if (node.type === 'dir') {
    const children = node.children || []
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent rounded"
          style={indent}
        >
          {expanded ? (
            <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
          )}
          <Folder size={12} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded && children.length > 0 && (
          <ul>
            {children.map((child) => (
              <WorkspaceTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(node.path, node.name)}
        className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground rounded"
        style={indent}
        title={node.path}
      >
        <span className="w-[11px] shrink-0" aria-hidden="true" />
        <File size={12} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
    </li>
  )
}
