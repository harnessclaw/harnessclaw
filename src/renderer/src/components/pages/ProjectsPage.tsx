import { FolderKanban, Plus, Sparkles } from 'lucide-react'

const projectHighlights = [
  {
    title: '统一上下文',
    description: '把相关对话、技能和产出收拢到同一个项目空间里，避免切换时丢上下文。',
  },
  {
    title: '按目标推进',
    description: '把版本发布、缺陷修复、需求验证拆成清晰的项目节点，后续更适合接入真实数据。',
  },
]

export function ProjectsPage() {
  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="max-w-5xl">
        <div className="rounded-[28px] border border-border bg-card px-6 py-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                <FolderKanban size={14} />
                <span>项目空间</span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">项目</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  这里作为后续项目管理入口，先承接侧边栏导航结构，后面可以继续接入真实项目列表和状态面板。
                </p>
              </div>
            </div>

            <button className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
              <Plus size={14} />
              <span>新建项目</span>
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {projectHighlights.map((item) => (
            <div
              key={item.title}
              className="rounded-[24px] border border-border bg-card/80 px-5 py-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles size={14} className="text-muted-foreground" />
                <span>{item.title}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
