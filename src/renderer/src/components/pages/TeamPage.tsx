import { Plus, Users } from 'lucide-react'

export function TeamPage() {
  return (
    <div className="flex min-h-full justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="w-full max-w-[1180px]">
        <header className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-foreground">
                <Users size={16} className="text-muted-foreground" />
                <h1 className="text-lg font-semibold tracking-tight">Team</h1>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">0</span>
              </div>
            </div>

            <div className="flex justify-start sm:justify-end">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Plus size={14} />
                <span>新建团队空间</span>
              </button>
            </div>
          </div>
        </header>

        <section className="pt-5" />
      </div>
    </div>
  )
}
