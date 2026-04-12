import {
  Archive,
  File,
  FileCode2,
  FileText,
  Image,
  Music4,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LocalAttachmentItem {
  id: string
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

interface AttachmentPreviewPanelProps {
  attachments: LocalAttachmentItem[]
  onRemove?: (id: string) => void
  removable?: boolean
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getAttachmentIcon(kind: LocalAttachmentItem['kind']) {
  switch (kind) {
    case 'image':
      return Image
    case 'video':
      return Video
    case 'audio':
      return Music4
    case 'archive':
      return Archive
    case 'code':
      return FileCode2
    case 'document':
    case 'data':
      return FileText
    default:
      return File
  }
}

function getTypeLabel(item: LocalAttachmentItem): string {
  const ext = item.extension ? item.extension.toUpperCase() : ''
  if (ext) return ext

  switch (item.kind) {
    case 'image':
      return 'IMAGE'
    case 'video':
      return 'VIDEO'
    case 'audio':
      return 'AUDIO'
    case 'archive':
      return 'ARCHIVE'
    case 'code':
      return 'CODE'
    case 'document':
      return 'DOC'
    case 'data':
      return 'DATA'
    default:
      return 'FILE'
  }
}

export function AttachmentPreviewPanel({
  attachments,
  onRemove,
  removable = true,
}: AttachmentPreviewPanelProps) {
  if (attachments.length === 0) return null

  return (
    <div className="mt-3 overflow-x-auto overflow-y-hidden pb-1">
      <div className="flex min-w-max flex-nowrap gap-2">
        {attachments.map((attachment) => {
          const Icon = getAttachmentIcon(attachment.kind)

          return (
            <div
              key={attachment.id}
              className="group relative flex h-[52px] w-56 max-w-[calc(100vw-8rem)] flex-shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/35 px-2.5 py-2"
              title={attachment.path}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                <Icon size={16} />
              </div>

              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{attachment.name}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{getTypeLabel(attachment)}</span>
                  <span>·</span>
                  <span>{formatSize(attachment.size)}</span>
                </div>
              </div>

              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id)}
                  disabled={!removable}
                  aria-label={`删除文件 ${attachment.name}`}
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
                    removable ? 'hover:bg-background hover:text-foreground' : 'cursor-not-allowed opacity-40'
                  )}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
