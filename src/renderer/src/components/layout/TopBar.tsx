import { HarnessclawStatusBadge } from '../common/HarnessclawStatusBadge'

export function TopBar() {
  return (
    <div className="titlebar-drag flex h-14 flex-shrink-0 items-start justify-end bg-transparent px-5 pt-3 sm:px-6">
      <div className="titlebar-no-drag">
        <HarnessclawStatusBadge />
      </div>
    </div>
  )
}
