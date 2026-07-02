import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { WelcomeShaderBackground } from '../WelcomeShaderBackground'

/**
 * Centered modal that asks the user to confirm deleting a session. Used by
 * both the chat title dropdown and the sidebar recent-conversation menu so
 * the destructive flow stays visually identical across surfaces.
 *
 * 按设计稿重做:350×231 白卡(R22),上部是一块内嵌圆角(R16)的动态橙色 shader
 * 背景(与引导页/更新弹窗同款,底部渐隐到白),标题与描述居中浮在其上;shader
 * 背景底部距卡片底 42px;底部两个等宽胶囊按钮——取消(白底描边)、删除(红 #F53F3F)。
 */
export function ConfirmDeleteSessionDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** Session title used to build the default single-session description. */
  title?: string
  /**
   * Explicit description text. When provided it overrides the auto-built
   * "您正在删除「{title}」…" line — used by callers that need different
   * wording such as batch-delete ("所选的 N 条对话…").
   */
  description?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  if (!open) return null

  const descriptionText = description ?? t('sessions.delete.desc', { title: title ?? '' })

  return createPortal(
    <div
      className="titlebar-no-drag fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[6px]"
      style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="flex flex-col items-center"
        style={{
          width: 350,
          height: 231,
          borderRadius: 22,
          padding: '6px 6px 12px',
          gap: 12,
          background: '#FFFFFF',
          boxShadow: '0 24px 80px rgba(15,23,42,0.28)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* 上部分:流动暖色渐变 + 标题/描述 */}
        <div
          className="relative w-full flex-1 self-stretch overflow-hidden"
          style={{ borderRadius: 16, background: '#FFF8EF' }}
        >
          {/* 动态橙色 shader 背景（与引导页/更新弹窗同款） */}
          <WelcomeShaderBackground className="pointer-events-none absolute inset-0 h-full w-full" />
          {/* 向下淡出到白，干净过渡到按钮区 */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0) 28%, #FFFFFF 100%)' }}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
            <h3
              className="text-[20px] font-medium text-[#4E5969]"
              style={{ fontFamily: 'Source Han Sans CN', fontVariationSettings: '"opsz" auto' }}
            >
              {t('sessions.delete.title')}
            </h3>
            <p className="mt-3 max-w-[280px] break-words text-sm leading-5 text-[#4E5969]">
              {descriptionText}
            </p>
          </div>
        </div>

        {/* 底部:取消 / 删除 */}
        <div className="flex w-full items-center" style={{ gap: 24 }}>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-[39px] flex-1 items-center justify-center text-[16px] font-medium text-[#4E5969] transition-colors hover:bg-[#F7F8FA]"
            style={{ borderRadius: 20, padding: '8px 32px', border: '1px solid #DADEE4', background: '#FFFFFF', fontFamily: 'Source Han Sans CN', fontVariationSettings: '"opsz" auto' }}
          >
            {t('sessions.delete.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-[39px] flex-1 items-center justify-center text-[16px] font-medium text-white transition-opacity hover:opacity-90"
            style={{ borderRadius: 20, padding: '8px 32px', background: '#F53F3F', fontFamily: 'Source Han Sans CN', fontVariationSettings: '"opsz" auto' }}
          >
            {t('sessions.delete.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
