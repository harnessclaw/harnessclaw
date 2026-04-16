import { Plus, Users, ShieldCheck } from 'lucide-react'

const teamHighlights = [
  {
    title: '协作成员',
    description: '后续可以在这里管理成员权限、默认技能仓库和项目可见范围。',
  },
  {
    title: '共享规范',
    description: '适合挂团队规则、发布约束和工作流约定，保证协作时上下游一致。',
  },
]

export function TeamPage() {
  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="max-w-5xl">
        <div className="rounded-[28px] border border-border bg-card px-6 py-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                <Users size={14} />
                <span>团队协作</span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Team</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  这里作为团队入口，当前先提供结构位，后续适合接入成员、权限和共享配置管理。
                </p>
              </div>
            </div>

            <button className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
              <Plus size={14} />
              <span>邀请成员</span>
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {teamHighlights.map((item) => (
            <div
              key={item.title}
              className="rounded-[24px] border border-border bg-card/80 px-5 py-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck size={14} className="text-muted-foreground" />
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
