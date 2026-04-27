import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Cog,
  FileText,
  ImagePlus,
  Layers3,
  Play,
  Plus,
  Rocket,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Users,
  Workflow,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '../../lib/utils'

type TeamView = 'agents' | 'teams'
type AgentTypeOption = 'sync' | 'async' | 'teammate' | 'coordinator' | 'custom'
type ProfileOption = 'full' | 'explore' | 'plan'

interface AgentRecord {
  id: string
  icon: string
  name: string
  display_name: string
  description: string
  agent_type: AgentTypeOption
  profile: ProfileOption
  system_prompt: string
  model: string
  max_turns: number
  allowed_tools: string[]
  disallowed_tools: string[]
  tools: string[]
  skills: string[]
  auto_team: boolean
  sub_agents: string[]
  created_at: number
}

interface AgentTeamRecord {
  id: string
  name: string
  description: string
  agent_ids: string[]
  created_at: number
}

interface AgentDraft {
  icon: string
  name: string
  display_name: string
  description: string
  agent_type: AgentTypeOption
  profile: ProfileOption
  system_prompt: string
  model: string
  max_turns: string
  allowed_tools: string
  disallowed_tools: string
  tools: string
  skills: string
  auto_team: boolean
  sub_agents: string[]
}

interface AgentTeamDraft {
  name: string
  description: string
  agent_ids: string[]
}

interface SopDraft {
  name: string
  objective: string
  scenario: string
  constraints: string
  agent_ids: string[]
}

const EMPTY_SOP_DRAFT: SopDraft = {
  name: '',
  objective: '',
  scenario: '',
  constraints: '',
  agent_ids: [],
}

const SOP_STEPS = [
  { num: 1, label: '定义目标', icon: Target },
  { num: 2, label: '选择成员', icon: UserPlus },
  { num: 3, label: '设计流程', icon: Workflow },
  { num: 4, label: '配置协作', icon: Settings2 },
  { num: 5, label: '测试与发布', icon: Rocket },
] as const

const SOP_OVERVIEW = [
  { title: '定义目标', items: ['团队名称 / 目标描述', '应用场景', '边界约束'] },
  { title: '选择成员', items: ['从 Agent 集选择', '角色分配', '能力匹配'] },
  { title: '设计流程', items: ['配置交互流程', '设置消息路由', '定义触发条件'] },
  { title: '配置协作', items: ['配置共享上下文', '设置协作策略', '定义冲突解决'] },
  { title: '测试与发布', items: ['测试团队协作', '调试优化', '发布上线'] },
]

const AGENT_TYPE_OPTIONS: AgentTypeOption[] = ['sync', 'async', 'teammate', 'coordinator', 'custom']
const AGENT_TYPE_LABELS: Record<AgentTypeOption, string> = {
  sync: 'sync（同步子体）',
  async: 'async（异步子体）',
  teammate: 'teammate（协作体）',
  coordinator: 'coordinator（编排体）',
  custom: 'custom（自定义体）',
}
const PROFILE_OPTIONS: ProfileOption[] = ['full', 'explore', 'plan']
const PROFILE_LABELS: Record<ProfileOption, string> = {
  full: 'full（全能模式）',
  explore: 'explore（探索模式）',
  plan: 'plan（规划模式）',
}
// Default cartoon avatar SVGs (open-source style, DiceBear Adventurer inspired)
function buildAvatarSvg(bgColor: string, faceColor: string, eyeStyle: string, mouthStyle: string, accessory: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bgColor}"/><circle cx="32" cy="34" r="18" fill="${faceColor}"/>${eyeStyle}${mouthStyle}${accessory}</svg>`)}`
}

const DEFAULT_AVATARS: string[] = [
  // 1 - blue bot
  buildAvatarSvg('#dbeafe', '#fff',
    '<circle cx="24" cy="30" r="3" fill="#3b82f6"/><circle cx="40" cy="30" r="3" fill="#3b82f6"/>',
    '<path d="M26 39 Q32 44 38 39" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round"/>',
    '<rect x="28" y="12" width="8" height="6" rx="3" fill="#93c5fd"/>'),
  // 2 - purple cat
  buildAvatarSvg('#ede9fe', '#fff',
    '<ellipse cx="24" cy="30" rx="2.5" ry="3" fill="#7c3aed"/><ellipse cx="40" cy="30" rx="2.5" ry="3" fill="#7c3aed"/>',
    '<path d="M28 38 Q32 42 36 38" stroke="#7c3aed" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    '<polygon points="18,20 22,28 14,28" fill="#c4b5fd"/><polygon points="46,20 50,28 42,28" fill="#c4b5fd"/>'),
  // 3 - green happy
  buildAvatarSvg('#dcfce7', '#fff',
    '<circle cx="24" cy="30" r="2.5" fill="#16a34a"/><circle cx="40" cy="30" r="2.5" fill="#16a34a"/>',
    '<path d="M24 38 Q32 46 40 38" stroke="#16a34a" stroke-width="2" fill="none" stroke-linecap="round"/>',
    '<circle cx="32" cy="14" r="4" fill="#86efac"/>'),
  // 4 - orange cool
  buildAvatarSvg('#ffedd5', '#fff',
    '<rect x="20" y="28" width="8" height="4" rx="2" fill="#ea580c"/><rect x="36" y="28" width="8" height="4" rx="2" fill="#ea580c"/>',
    '<path d="M28 39 L36 39" stroke="#ea580c" stroke-width="2" stroke-linecap="round"/>',
    ''),
  // 5 - pink kawaii
  buildAvatarSvg('#fce7f3', '#fff',
    '<circle cx="24" cy="30" r="2" fill="#db2777"/><circle cx="40" cy="30" r="2" fill="#db2777"/><circle cx="19" cy="35" r="3" fill="#fbcfe8" opacity="0.6"/><circle cx="45" cy="35" r="3" fill="#fbcfe8" opacity="0.6"/>',
    '<path d="M28 38 Q32 42 36 38" stroke="#db2777" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
    ''),
  // 6 - cyan robot
  buildAvatarSvg('#cffafe', '#fff',
    '<rect x="21" y="27" width="6" height="6" rx="1" fill="#0891b2"/><rect x="37" y="27" width="6" height="6" rx="1" fill="#0891b2"/>',
    '<rect x="27" y="39" width="10" height="3" rx="1.5" fill="#0891b2"/>',
    '<rect x="14" y="30" width="4" height="8" rx="2" fill="#67e8f9"/><rect x="46" y="30" width="4" height="8" rx="2" fill="#67e8f9"/>'),
  // 7 - amber star
  buildAvatarSvg('#fef3c7', '#fff',
    '<circle cx="24" cy="31" r="2" fill="#d97706"/><circle cx="40" cy="31" r="2" fill="#d97706"/>',
    '<path d="M27 38 Q32 43 37 38" stroke="#d97706" stroke-width="2" fill="none" stroke-linecap="round"/>',
    '<polygon points="32,8 34,14 40,14 35,18 37,24 32,20 27,24 29,18 24,14 30,14" fill="#fbbf24" opacity="0.7"/>'),
  // 8 - red fierce
  buildAvatarSvg('#fee2e2', '#fff',
    '<path d="M21 28 L27 28" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="31" r="2" fill="#dc2626"/><path d="M37 28 L43 28" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"/><circle cx="40" cy="31" r="2" fill="#dc2626"/>',
    '<path d="M28 40 Q32 37 36 40" stroke="#dc2626" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    ''),
  // 9 - indigo wizard
  buildAvatarSvg('#e0e7ff', '#fff',
    '<circle cx="24" cy="31" r="2.5" fill="#4f46e5"/><circle cx="40" cy="31" r="2.5" fill="#4f46e5"/>',
    '<path d="M28 39 Q32 42 36 39" stroke="#4f46e5" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    '<polygon points="32,6 38,22 26,22" fill="#a5b4fc" opacity="0.7"/><circle cx="32" cy="10" r="2" fill="#e0e7ff"/>'),
  // 10 - emerald leaf
  buildAvatarSvg('#d1fae5', '#fff',
    '<circle cx="25" cy="30" r="2" fill="#059669"/><circle cx="39" cy="30" r="2" fill="#059669"/>',
    '<path d="M27 38 Q32 43 37 38" stroke="#059669" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    '<ellipse cx="32" cy="14" rx="8" ry="4" fill="#6ee7b7" opacity="0.6"/>'),
  // 11 - slate ghost
  buildAvatarSvg('#f1f5f9', '#fff',
    '<circle cx="24" cy="30" r="3.5" fill="#475569"/><circle cx="24" cy="29" r="1.5" fill="#fff"/><circle cx="40" cy="30" r="3.5" fill="#475569"/><circle cx="40" cy="29" r="1.5" fill="#fff"/>',
    '<ellipse cx="32" cy="40" rx="3" ry="2" fill="#475569"/>',
    ''),
  // 12 - rose heart
  buildAvatarSvg('#ffe4e6', '#fff',
    '<circle cx="24" cy="31" r="2" fill="#e11d48"/><circle cx="40" cy="31" r="2" fill="#e11d48"/>',
    '<path d="M28 38 Q32 43 36 38" stroke="#e11d48" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    '<path d="M28,14 Q28,10 32,14 Q36,10 36,14 Q36,18 32,22 Q28,18 28,14Z" fill="#fb7185" opacity="0.7"/>'),
]

const TOOL_OPTIONS = ['read_file', 'write_file', 'search_code', 'terminal', 'browser', 'git', 'tasks', 'notes']
const SKILL_OPTIONS = ['frontend-design', 'shape', 'critique', 'layout', 'polish', 'harden', 'adapt', 'clarify']

const EMPTY_AGENT_DRAFT: AgentDraft = {
  icon: DEFAULT_AVATARS[0],
  name: '',
  display_name: '',
  description: '',
  agent_type: 'sync',
  profile: 'full',
  system_prompt: '',
  model: '',
  max_turns: '',
  allowed_tools: '',
  disallowed_tools: '',
  tools: '',
  skills: '',
  auto_team: false,
  sub_agents: [],
}

const EMPTY_TEAM_DRAFT: AgentTeamDraft = {
  name: '',
  description: '',
  agent_ids: [],
}

function mapApiAgentToRecord(agent: ConsoleAgentDefinition): AgentRecord {
  return {
    id: agent.name,
    icon: DEFAULT_AVATARS[Math.abs(hashString(agent.name)) % DEFAULT_AVATARS.length],
    name: agent.name,
    display_name: agent.display_name || '',
    description: agent.description || '',
    agent_type: (agent.agent_type as AgentTypeOption) || 'sync',
    profile: (agent.profile as ProfileOption) || 'full',
    system_prompt: agent.system_prompt || '',
    model: agent.model || '',
    max_turns: agent.max_turns || 0,
    allowed_tools: agent.allowed_tools || [],
    disallowed_tools: agent.disallowed_tools || [],
    tools: agent.tools || [],
    skills: agent.skills || [],
    auto_team: agent.auto_team || false,
    sub_agents: (agent.sub_agents || []).map((s) => s.name),
    created_at: Date.now(),
  }
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

const VIEW_META: Record<TeamView, { label: string; buttonLabel: string; emptyTitle: string; emptyDescription: string }> = {
  agents: {
    label: '角色',
    buttonLabel: '新建角色',
    emptyTitle: '还没有角色',
    emptyDescription: '从上方创建第一个角色，后续可用于 Team 组合。',
  },
  teams: {
    label: 'Agent Team',
    buttonLabel: '新建 Agent Team',
    emptyTitle: '还没有 Agent Team',
    emptyDescription: '创建一个 Team，把多个角色组合成固定协作编组。',
  },
}

function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function splitLineValues(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatRelativeDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

export function TeamPage() {
  const [activeView, setActiveView] = useState<TeamView>('agents')
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [teams, setTeams] = useState<AgentTeamRecord[]>([])
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(EMPTY_AGENT_DRAFT)
  const [sopStep, setSopStep] = useState(1)
  const [sopDraft, setSopDraft] = useState<SopDraft>(EMPTY_SOP_DRAFT)
  const [sopActive, setSopActive] = useState(false)
  const [agentNameError, setAgentNameError] = useState('')
  const [agentSaving, setAgentSaving] = useState(false)
  const agentNameInputRef = useRef<HTMLInputElement | null>(null)

  const loadAgents = useCallback(async () => {
    try {
      const res = await window.agentApi.listAgents({ source: 'custom', limit: 100 })
      if (res.code === 'OK' && Array.isArray(res.data)) {
        setAgents(res.data.map(mapApiAgentToRecord))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadAgents()
  }, [])

  const currentMeta = VIEW_META[activeView]
  const currentCount = activeView === 'agents' ? agents.length : teams.length

  const agentLookup = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    [agents],
  )

  const resetAgentDraft = () => {
    setAgentDraft(EMPTY_AGENT_DRAFT)
    setAgentNameError('')
    setEditingAgentId(null)
  }

  const openCreateDialog = () => {
    if (activeView === 'agents') {
      resetAgentDraft()
      setAgentDialogOpen(true)
      return
    }
    setSopDraft(EMPTY_SOP_DRAFT)
    setSopStep(1)
    setSopActive(true)
  }

  const openEditAgent = (agent: AgentRecord) => {
    setEditingAgentId(agent.id)
    setAgentDraft({
      icon: agent.icon,
      name: agent.name,
      display_name: agent.display_name,
      description: agent.description,
      agent_type: agent.agent_type,
      profile: agent.profile,
      system_prompt: agent.system_prompt,
      model: agent.model,
      max_turns: agent.max_turns > 0 ? String(agent.max_turns) : '',
      allowed_tools: agent.allowed_tools.join(', '),
      disallowed_tools: agent.disallowed_tools.join(', '),
      tools: agent.tools.join(', '),
      skills: agent.skills.join(', '),
      auto_team: agent.auto_team,
      sub_agents: agent.sub_agents,
    })
    setAgentNameError('')
    setAgentDialogOpen(true)
  }


  const handleSaveAgent = async () => {
    const normalizedName = agentDraft.name.trim()
    if (!normalizedName) {
      setAgentNameError('请填写角色标识。')
      return
    }
    if (!/^[@a-zA-Z0-9_-]+$/.test(normalizedName)) {
      setAgentNameError('角色标识仅支持字母、数字、_、-，可带 @ 前缀。')
      return
    }

    const payload: Record<string, unknown> = {
      name: normalizedName,
      display_name: agentDraft.display_name.trim() || undefined,
      description: agentDraft.description.trim() || undefined,
      agent_type: agentDraft.agent_type,
      profile: agentDraft.profile,
      system_prompt: agentDraft.system_prompt.trim() || undefined,
      model: agentDraft.model.trim() || undefined,
      max_turns: Math.min(Math.max(Number(agentDraft.max_turns || 0) || 0, 0), 25) || undefined,
      allowed_tools: splitLineValues(agentDraft.allowed_tools),
      disallowed_tools: splitLineValues(agentDraft.disallowed_tools),
      tools: splitLineValues(agentDraft.tools),
      skills: splitLineValues(agentDraft.skills),
      auto_team: agentDraft.auto_team,
    }

    setAgentSaving(true)
    try {
      let res: ConsoleResponse<ConsoleAgentDefinition>
      if (editingAgentId) {
        const { name: _, ...fields } = payload
        res = await window.agentApi.updateAgent(editingAgentId, fields)
      } else {
        res = await window.agentApi.createAgent(payload)
      }

      if (res.code === 'OK') {
        setAgentDialogOpen(false)
        resetAgentDraft()
        void loadAgents()
      } else if (res.code === 'CONFLICT') {
        setAgentNameError('角色标识已存在，请更换。')
      } else {
        setAgentNameError(res.message || '保存失败，请稍后再试。')
      }
    } catch {
      setAgentNameError('网络错误，请检查引擎是否已启动。')
    } finally {
      setAgentSaving(false)
    }
  }

  const handleDeleteAgent = async (agentId: string) => {
    try {
      const res = await window.agentApi.deleteAgent(agentId)
      if (res.code === 'OK' || res.code === 'NOT_FOUND') {
        setAgentDialogOpen(false)
        resetAgentDraft()
        void loadAgents()
      } else {
        setAgentNameError(res.message || '删除失败。')
      }
    } catch {
      setAgentNameError('网络错误，请检查引擎是否已启动。')
    }
  }

  const [sopNameError, setSopNameError] = useState('')

  const handleSopPublish = () => {
    if (!sopDraft.name.trim()) {
      setSopNameError('请填写团队名称后再发布。')
      setSopStep(1)
      return
    }
    setSopNameError('')
    const nextTeam: AgentTeamRecord = {
      id: createId('team'),
      name: sopDraft.name.trim(),
      description: sopDraft.objective.trim(),
      agent_ids: sopDraft.agent_ids,
      created_at: Date.now(),
    }
    setTeams((current) => [nextTeam, ...current])
    setSopActive(false)
    setSopDraft(EMPTY_SOP_DRAFT)
    setSopStep(1)
  }

  const handleDeleteTeam = (teamId: string) => {
    setTeams((current) => current.filter((team) => team.id !== teamId))
  }

  return (
    <div className="flex min-h-full justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="w-full max-w-[1180px]">
        <header className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-foreground sm:gap-3">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-muted-foreground" />
                  <h1 className="text-lg font-semibold tracking-tight">Agent Team</h1>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {currentCount}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <TopSwitchButton
                    active={activeView === 'agents'}
                    icon={<Bot size={14} />}
                    label="角色"
                    onClick={() => setActiveView('agents')}
                  />
                  <TopSwitchButton
                    active={activeView === 'teams'}
                    icon={<Layers3 size={14} />}
                    label="Agent Team"
                    onClick={() => setActiveView('teams')}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-start sm:justify-end">
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Plus size={14} />
                <span>{currentMeta.buttonLabel}</span>
              </button>
            </div>
          </div>
        </header>

        <section className="space-y-4 pt-5">
          {activeView === 'agents' ? (
            agents.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {agents.map((agent) => (
                  <article
                    key={agent.id}
                    onClick={() => openEditAgent(agent)}
                    className="cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:border-foreground/10 hover:shadow-md"
                  >
                    <div className="border-b border-border/80 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <img
                          src={agent.icon}
                          alt=""
                          className="h-11 w-11 flex-shrink-0 rounded-2xl bg-muted object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-foreground">
                              {agent.display_name.trim() || agent.name}
                            </h3>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              {agent.agent_type}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{agent.name}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 bg-muted/18 px-4 py-3">
                      <p className="line-clamp-3 min-h-[60px] text-xs leading-5 text-muted-foreground">
                        {agent.description || '暂未填写角色描述。'}
                      </p>

                      <div className="flex flex-wrap gap-1.5">
                        <InlineMeta label={agent.profile} />
                        <InlineMeta label={agent.model || '继承默认模型'} />
                        <InlineMeta label={agent.max_turns > 0 ? `${agent.max_turns} 轮` : '自动轮次'} />
                      </div>

                      {(agent.skills.length > 0 || agent.allowed_tools.length > 0) ? (
                        <div className="space-y-2">
                          {agent.skills.length > 0 ? (
                            <CardGroup title="技能" icon={<Sparkles size={12} />}>
                              {agent.skills.map((skill) => <InlineMeta key={skill} label={skill} />)}
                            </CardGroup>
                          ) : null}
                          {agent.allowed_tools.length > 0 ? (
                            <CardGroup title="允许工具" icon={<Wrench size={12} />}>
                              {agent.allowed_tools.map((tool) => <InlineMeta key={tool} label={tool} />)}
                            </CardGroup>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyStateCard
                title={currentMeta.emptyTitle}
                description={currentMeta.emptyDescription}
                buttonLabel={currentMeta.buttonLabel}
                onCreate={openCreateDialog}
              />
            )
          ) : (
            <SopWizardView
              active={sopActive}
              step={sopStep}
              draft={sopDraft}
              agents={agents}
              teams={teams}
              agentLookup={agentLookup}
              nameError={sopNameError}
              onSetStep={setSopStep}
              onChangeDraft={setSopDraft}
              onStart={openCreateDialog}
              onPublish={handleSopPublish}
              onCancel={() => { setSopActive(false); setSopStep(1); setSopDraft(EMPTY_SOP_DRAFT); setSopNameError('') }}
              onDeleteTeam={handleDeleteTeam}
              onClearNameError={() => setSopNameError('')}
            />
          )}
        </section>
      </div>

      <AgentDialog
        open={agentDialogOpen}
        editingId={editingAgentId}
        draft={agentDraft}
        agents={agents}
        nameError={agentNameError}
        nameInputRef={agentNameInputRef}
        onClose={() => {
          setAgentDialogOpen(false)
          resetAgentDraft()
        }}
        onChangeDraft={setAgentDraft}
        saving={agentSaving}
        onSubmit={handleSaveAgent}
        onDelete={editingAgentId ? () => void handleDeleteAgent(editingAgentId) : undefined}
        onClearNameError={() => setAgentNameError('')}
      />
    </div>
  )
}

function AvatarPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (avatar: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onChange(reader.result)
          setMenuOpen(false)
        }
      }
      reader.readAsDataURL(file)
      event.target.value = ''
    },
    [onChange],
  )

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Avatar preview — click to toggle menu */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-border bg-card transition-colors hover:border-foreground/20"
      >
        <img src={value} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus size={18} className="text-white" />
        </div>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Popover menu */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-full z-[91] mt-2 w-[180px] rounded-2xl border border-border bg-background p-2 shadow-[0_12px_40px_rgba(0,0,0,0.15)]">
            <div className="grid grid-cols-4 gap-1.5">
              {DEFAULT_AVATARS.map((avatar, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    onChange(avatar)
                    setMenuOpen(false)
                  }}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border transition-all',
                    value === avatar
                      ? 'border-foreground/20 ring-1 ring-foreground/10'
                      : 'border-border hover:border-foreground/15',
                  )}
                >
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              {/* Upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TopSwitchButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-foreground/12 bg-card text-foreground shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function InlineMeta({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-background px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm">
      {label}
    </span>
  )
}

function CardGroup({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  )
}

function EmptyStateCard({
  title,
  description,
  buttonLabel,
  onCreate,
}: {
  title: string
  description: string
  buttonLabel: string
  onCreate: () => void
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-border bg-card px-5 py-8 text-center sm:px-6">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        <Plus size={16} />
        <span>{buttonLabel}</span>
      </button>
    </div>
  )
}

function AgentDialog({
  open,
  editingId,
  draft,
  agents,
  nameError,
  saving,
  nameInputRef,
  onClose,
  onChangeDraft,
  onSubmit,
  onDelete,
  onClearNameError,
}: {
  open: boolean
  editingId: string | null
  draft: AgentDraft
  agents: AgentRecord[]
  nameError: string
  saving?: boolean
  nameInputRef: React.RefObject<HTMLInputElement | null>
  onClose: () => void
  onChangeDraft: React.Dispatch<React.SetStateAction<AgentDraft>>
  onSubmit: () => void
  onDelete?: () => void
  onClearNameError: () => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const isEditing = editingId !== null

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/32">
      <div
        className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-dialog-title"
          className="flex max-h-[calc(100vh-48px)] w-full max-w-[760px] flex-col rounded-[26px] border border-border bg-background shadow-[0_28px_80px_rgba(15,23,42,0.22)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-border/70 px-5 py-4 sm:px-6">
            <div>
              <h2 id="agent-dialog-title" className="text-lg font-semibold text-foreground">
                {isEditing ? '编辑角色' : '新建角色'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEditing ? '修改角色配置，保存后立即生效。' : '创建角色，后续可单独使用或加入 Agent Team。'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭角色对话框"
            >
              <X size={16} />
            </button>
          </div>

          <form
            className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-8 items-center rounded-full bg-muted px-3 text-xs font-medium text-foreground">
                  基础信息
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                <div>
                  <AvatarPicker
                    value={draft.icon}
                    onChange={(icon) => onChangeDraft((current) => ({ ...current, icon }))}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldBlock label="名称 *" description="@-mention 唯一标识">
                    <input
                      ref={nameInputRef}
                      value={draft.name}
                      disabled={isEditing}
                      onChange={(event) => {
                        onClearNameError()
                        onChangeDraft((current) => ({ ...current, name: event.target.value }))
                      }}
                      placeholder="@planner"
                      className={cn(
                        'w-full rounded-2xl border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring',
                        nameError ? 'border-destructive' : 'border-border',
                        isEditing && 'cursor-not-allowed opacity-60',
                      )}
                    />
                    {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
                  </FieldBlock>

                  <FieldBlock label="显示名称" description="用于 UI 展示">
                    <input
                      value={draft.display_name}
                      onChange={(event) => onChangeDraft((current) => ({ ...current, display_name: event.target.value }))}
                      placeholder="Planner"
                      className="w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                    />
                  </FieldBlock>

                  <FieldBlock label="角色类型" description="工具过滤策略">
                    <SelectField
                      value={draft.agent_type}
                      options={AGENT_TYPE_OPTIONS}
                      labels={AGENT_TYPE_LABELS}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, agent_type: value as AgentTypeOption }))}
                    />
                  </FieldBlock>

                  <FieldBlock label="角色模板" description="预设模板">
                    <SelectField
                      value={draft.profile}
                      options={PROFILE_OPTIONS}
                      labels={PROFILE_LABELS}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, profile: value as ProfileOption }))}
                    />
                  </FieldBlock>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldBlock label="描述" description="能力说明">
                  <textarea
                    value={draft.description}
                    onChange={(event) => onChangeDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={4}
                    placeholder="例如：负责梳理计划、拆解任务和推动执行顺序。"
                    className="w-full resize-y rounded-2xl border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring max-h-[200px] overflow-y-auto"
                  />
                </FieldBlock>

                <FieldBlock label="系统提示词" description="自定义系统提示">
                  <textarea
                    value={draft.system_prompt}
                    onChange={(event) => onChangeDraft((current) => ({ ...current, system_prompt: event.target.value }))}
                    rows={4}
                    placeholder="使用多行文本定义角色行为、边界和风格。"
                    className="w-full resize-y rounded-2xl border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring max-h-[200px] overflow-y-auto"
                  />
                </FieldBlock>
              </div>
            </section>

            <section className="rounded-[24px] border border-border/80 bg-muted/12 px-4 py-4">
              <button
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">高级设置</p>
                  <p className="mt-1 text-xs text-muted-foreground">模型、轮次、工具、技能与自动组队预设</p>
                </div>
                <ChevronDown
                  size={16}
                  className={cn('text-muted-foreground transition-transform', advancedOpen && 'rotate-180')}
                />
              </button>

              {advancedOpen ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FieldBlock label="模型" description="留空则继承默认模型">
                    <input
                      value={draft.model}
                      onChange={(event) => onChangeDraft((current) => ({ ...current, model: event.target.value }))}
                      placeholder="claude-opus-4-6"
                      className="w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                    />
                  </FieldBlock>

                  <FieldBlock label="最大轮次" description="1-25，留空自动">
                    <input
                      value={draft.max_turns}
                      onChange={(event) => onChangeDraft((current) => ({ ...current, max_turns: event.target.value }))}
                      placeholder="8"
                      className="w-full rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                    />
                  </FieldBlock>

                  <FieldBlock label="允许工具" description="逗号或换行分隔">
                    <TokenTextarea
                      value={draft.allowed_tools}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, allowed_tools: value }))}
                      suggestions={TOOL_OPTIONS}
                      placeholder="read_file, terminal"
                    />
                  </FieldBlock>

                  <FieldBlock label="禁用工具" description="额外黑名单">
                    <TokenTextarea
                      value={draft.disallowed_tools}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, disallowed_tools: value }))}
                      suggestions={TOOL_OPTIONS}
                      placeholder="browser"
                    />
                  </FieldBlock>

                  <FieldBlock label="工具" description="独立工具白名单">
                    <TokenTextarea
                      value={draft.tools}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, tools: value }))}
                      suggestions={TOOL_OPTIONS}
                      placeholder="terminal, git"
                    />
                  </FieldBlock>

                  <FieldBlock label="技能" description="技能白名单">
                    <TokenTextarea
                      value={draft.skills}
                      onChange={(value) => onChangeDraft((current) => ({ ...current, skills: value }))}
                      suggestions={SKILL_OPTIONS}
                      placeholder="shape, critique"
                    />
                  </FieldBlock>

                  <div className="sm:col-span-2 space-y-3">
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.auto_team}
                        onChange={(event) => onChangeDraft((current) => ({ ...current, auto_team: event.target.checked }))}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span>自动组队</span>
                    </label>

                    <FieldBlock label="子角色" description="自动组队开启时可预定义子 Agent">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {agents.length > 0 ? agents.map((agent) => {
                          const checked = draft.sub_agents.includes(agent.id)
                          const label = agent.display_name.trim() || agent.name
                          return (
                            <label
                              key={agent.id}
                              className={cn(
                                'flex items-center justify-between rounded-2xl border px-3 py-2 text-sm transition-colors',
                                checked ? 'border-foreground/12 bg-card' : 'border-border bg-background'
                              )}
                            >
                              <span className="truncate text-foreground">{label}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => onChangeDraft((current) => ({
                                  ...current,
                                  sub_agents: event.target.checked
                                    ? [...current.sub_agents, agent.id]
                                    : current.sub_agents.filter((id) => id !== agent.id),
                                }))}
                                className="h-4 w-4 rounded border-border"
                              />
                            </label>
                          )
                        }) : (
                          <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-4 text-sm text-muted-foreground sm:col-span-2">
                            先创建角色，随后可在这里选择预定义子 Agent。
                          </div>
                        )}
                      </div>
                    </FieldBlock>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="flex items-center gap-2 pt-2">
              {isEditing && onDelete ? (
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-destructive/30 px-4 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 size={14} />
                  删除
                </button>
              ) : null}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90',
                  saving && 'cursor-not-allowed opacity-60',
                )}
              >
                {saving ? '保存中…' : isEditing ? '保存' : '创建角色'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── SOP Wizard View ── */

function SopWizardView({
  active,
  step,
  draft,
  agents,
  teams,
  agentLookup,
  nameError,
  onSetStep,
  onChangeDraft,
  onStart,
  onPublish,
  onCancel,
  onDeleteTeam,
  onClearNameError,
}: {
  active: boolean
  step: number
  draft: SopDraft
  agents: AgentRecord[]
  teams: AgentTeamRecord[]
  agentLookup: Record<string, AgentRecord>
  nameError: string
  onSetStep: (step: number) => void
  onChangeDraft: React.Dispatch<React.SetStateAction<SopDraft>>
  onStart: () => void
  onPublish: () => void
  onCancel: () => void
  onDeleteTeam: (id: string) => void
  onClearNameError: () => void
}) {
  if (!active) {
    // Show existing teams list or empty state
    return (
      <div className="space-y-5">
        {teams.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <article
                key={team.id}
                className="group overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:border-foreground/10 hover:shadow-md"
              >
                <div className="border-b border-border/80 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">{team.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {team.agent_ids.length} 个角色
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDeleteTeam(team.id)}
                        className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <Layers3 size={16} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 bg-muted/18 px-4 py-3">
                  <p className="line-clamp-3 min-h-[40px] text-xs leading-5 text-muted-foreground">
                    {team.description || '暂未填写 Team 描述。'}
                  </p>
                  {team.agent_ids.length > 0 && (
                    <CardGroup title="组合角色" icon={<Boxes size={12} />}>
                      {team.agent_ids.map((agentId) => {
                        const agent = agentLookup[agentId]
                        return (
                          <InlineMeta
                            key={agentId}
                            label={agent ? (agent.display_name.trim() || agent.name) : '未知角色'}
                          />
                        )
                      })}
                    </CardGroup>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyStateCard
            title="还没有 Agent Team"
            description="通过标准 SOP 流程组建高效的 Agent 团队。"
            buttonLabel="新建 Agent Team"
            onCreate={onStart}
          />
        )}
      </div>
    )
  }

  const nextLabel = step < 5 ? `下一步　${SOP_STEPS[step]?.label ?? ''}` : '发布上线'

  return (
    <div className="flex min-h-full flex-col justify-end space-y-5 pb-5">
      {/* ── Stepper ── */}
      <div className="flex items-center justify-center gap-0">
        {SOP_STEPS.map((s, i) => {
          const Icon = s.icon
          const isActive = s.num === step
          const isDone = s.num < step
          return (
            <div key={s.num} className="flex items-center">
              <button
                type="button"
                onClick={() => onSetStep(s.num)}
                className="flex cursor-pointer flex-col items-center gap-1"
              >
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                    isActive
                      ? 'bg-[#3b82f6] text-white shadow-sm shadow-blue-500/25'
                      : isDone
                        ? 'bg-[#3b82f6]/15 text-[#3b82f6]'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? <CircleCheck size={13} /> : <Icon size={13} />}
                </div>
                <span
                  className={cn(
                    'whitespace-nowrap text-[10px] font-medium',
                    isActive ? 'text-[#3b82f6]' : isDone ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < SOP_STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-2.5 mt-[-16px] h-[2px] w-8',
                    s.num < step ? 'bg-[#3b82f6]/30' : 'bg-border',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Step Content ── */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border/70 px-4 py-2">
          <h3 className="text-xs font-semibold text-foreground">
            Step {step}: {SOP_STEPS[step - 1].label}
          </h3>
        </div>

        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[1fr_1fr]">
          {/* Left: form */}
          <div className="space-y-2.5">
            {step === 1 && (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  描述团队的目标和用途，让 AI 团队能准确执行的方向。
                </p>
                <FieldBlock label="团队名称">
                  <input
                    value={draft.name}
                    onChange={(e) => {
                      onClearNameError()
                      onChangeDraft((d) => ({ ...d, name: e.target.value }))
                    }}
                    placeholder="起一个 2-8 字的名称"
                    className={cn(
                      'w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring',
                      nameError ? 'border-destructive' : 'border-border',
                    )}
                  />
                  {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                </FieldBlock>
                <FieldBlock label="团队目标">
                  <textarea
                    value={draft.objective}
                    onChange={(e) => onChangeDraft((d) => ({ ...d, objective: e.target.value }))}
                    rows={2}
                    placeholder="描述你要完成的具体目标任务"
                    className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                  />
                </FieldBlock>
                <FieldBlock label="应用场景">
                  <input
                    value={draft.scenario}
                    onChange={(e) => onChangeDraft((d) => ({ ...d, scenario: e.target.value }))}
                    placeholder="例如：代码审查、文档生成、项目管理"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                  />
                </FieldBlock>
                <FieldBlock label="边界与约束（可选）">
                  <input
                    value={draft.constraints}
                    onChange={(e) => onChangeDraft((d) => ({ ...d, constraints: e.target.value }))}
                    placeholder="例如：不允许访问生产环境数据"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                  />
                </FieldBlock>
              </>
            )}
            {step === 2 && (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  从已创建的角色中选择成员加入团队。
                </p>
                <div className="space-y-1.5">
                  {agents.length > 0 ? agents.map((agent) => {
                    const checked = draft.agent_ids.includes(agent.id)
                    const label = agent.display_name.trim() || agent.name
                    return (
                      <label
                        key={agent.id}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors',
                          checked ? 'border-[#3b82f6]/20 bg-[#3b82f6]/5' : 'border-border bg-background',
                        )}
                      >
                        <img src={agent.icon} alt="" className="h-8 w-8 flex-shrink-0 rounded-xl bg-muted object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{label}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{agent.name}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => onChangeDraft((d) => ({
                            ...d,
                            agent_ids: e.target.checked
                              ? [...d.agent_ids, agent.id]
                              : d.agent_ids.filter((id) => id !== agent.id),
                          }))}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                      </label>
                    )
                  }) : (
                    <div className="rounded-xl border border-dashed border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                      暂无可选角色，请先切换到"角色"创建角色。
                    </div>
                  )}
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  设计团队内部的交互流程和消息路由规则。
                </p>
                <div className="space-y-1.5">
                  <SopPlaceholderItem icon={<Workflow size={13} />} label="配置交互流程" />
                  <SopPlaceholderItem icon={<ArrowRight size={13} />} label="设置消息路由" />
                  <SopPlaceholderItem icon={<ClipboardList size={13} />} label="定义触发条件" />
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  配置团队协作策略和共享上下文。
                </p>
                <div className="space-y-1.5">
                  <SopPlaceholderItem icon={<Cog size={13} />} label="配置共享上下文" />
                  <SopPlaceholderItem icon={<Settings2 size={13} />} label="设置协作策略" />
                  <SopPlaceholderItem icon={<ClipboardList size={13} />} label="定义冲突解决" />
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  测试团队协作效果，确认无误后发布上线。
                </p>
                <div className="space-y-1.5">
                  <SopPlaceholderItem icon={<Play size={13} />} label="测试团队协作" />
                  <SopPlaceholderItem icon={<Cog size={13} />} label="调试优化" />
                  <SopPlaceholderItem icon={<Rocket size={13} />} label="发布上线" />
                </div>
              </>
            )}
          </div>

          {/* Right: flow diagram */}
          <div className="flex items-center justify-center">
            <SopFlowDiagram agents={agents} selectedIds={draft.agent_ids} />
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-8 items-center rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          取消
        </button>
        {step > 1 && (
          <button
            type="button"
            onClick={() => onSetStep(step - 1)}
            className="inline-flex min-h-8 items-center rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            上一步
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (step < 5) {
              onSetStep(step + 1)
            } else {
              onPublish()
            }
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {nextLabel}
          {step < 5 && <ChevronRight size={12} />}
        </button>
      </div>

      {/* ── Bottom SOP Overview ── */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">SOP 流程概览</h4>
        <div className="flex items-stretch gap-0">
          {SOP_OVERVIEW.map((col, i) => {
            const stepNum = i + 1
            const status = stepNum < step ? '已完成' : stepNum === step ? '进行中' : '待开始'
            const statusColor = stepNum < step
              ? 'bg-green-500/10 text-green-600'
              : stepNum === step
                ? 'bg-[#3b82f6]/10 text-[#3b82f6]'
                : 'bg-muted text-muted-foreground'
            return (
              <div key={col.title} className="flex min-w-0 flex-1 items-stretch">
                <div
                  className={cn(
                    'flex min-w-0 flex-1 flex-col rounded-lg border px-2.5 py-2',
                    stepNum === step ? 'border-[#3b82f6]/20 bg-[#3b82f6]/[0.03]' : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {stepNum}
                    </span>
                    <span className="text-xs font-semibold text-foreground">{col.title}</span>
                  </div>
                  <ul className="mt-1 flex-1 space-y-0.5">
                    {col.items.map((item) => (
                      <li key={item} className="flex items-center gap-1 text-[11px] text-foreground">
                        <span className="h-1 w-1 flex-shrink-0 rounded-full bg-foreground" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5">
                    <span className={cn('inline-block rounded-full px-1.5 py-px text-[10px] font-medium', statusColor)}>
                      {status}
                    </span>
                  </div>
                </div>
                {i < SOP_OVERVIEW.length - 1 && (
                  <div className="flex w-5 flex-shrink-0 items-center justify-center">
                    <ChevronRight size={12} className="text-muted-foreground/50" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SopPlaceholderItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
      {icon}
      <span>{label}</span>
      <span className="ml-auto text-[9px] text-muted-foreground/60">即将开放</span>
    </div>
  )
}

function SopFlowDiagram({ agents, selectedIds }: { agents: AgentRecord[]; selectedIds: string[] }) {
  const selected = agents.filter((a) => selectedIds.includes(a.id)).slice(0, 5)
  const placeholders = Math.max(3 - selected.length, 0)

  return (
    <div className="flex w-full flex-col items-center gap-2.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-4">
      <span className="text-[9px] font-medium text-muted-foreground">示例</span>

      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3b82f6]/15 text-[#3b82f6]">
        <Users size={14} />
      </div>

      <div className="h-3 w-[2px] bg-border" />

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {selected.map((agent) => (
          <div key={agent.id} className="flex flex-col items-center gap-0.5">
            <img src={agent.icon} alt="" className="h-7 w-7 rounded-lg bg-muted object-cover" />
            <span className="max-w-[48px] truncate text-[9px] text-muted-foreground">
              {agent.display_name.trim() || agent.name}
            </span>
          </div>
        ))}
        {Array.from({ length: placeholders }).map((_, i) => (
          <div key={`ph-${i}`} className="flex flex-col items-center gap-0.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-border bg-background">
              <Bot size={12} className="text-muted-foreground/40" />
            </div>
            <span className="text-[9px] text-muted-foreground/40">角色</span>
          </div>
        ))}
      </div>

      <div className="h-3 w-[2px] bg-border" />

      <div className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[9px] text-muted-foreground">
        产出物：高质量项目交付
      </div>
    </div>
  )
}

function FieldBlock({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
      </div>
      {children}
    </div>
  )
}

function SelectField({
  value,
  options,
  labels,
  onChange,
}: {
  value: string
  options: string[]
  labels?: Record<string, string>
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full appearance-none rounded-2xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors focus:border-ring"
    >
      {options.map((option) => (
        <option key={option} value={option}>{labels?.[option] ?? option}</option>
      ))}
    </select>
  )
}

function TokenTextarea({
  value,
  suggestions,
  placeholder,
  onChange,
}: {
  value: string
  suggestions: string[]
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-none rounded-2xl border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
      />
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(value.trim() ? `${value}\n${item}` : item)}
            className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  )
}
