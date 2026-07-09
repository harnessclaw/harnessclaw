import { useCallback } from 'react'
import { useWindowMaximized } from '../../hooks/useWindowMaximized'

/**
 * Custom resize edges for the frameless + transparent main window. A native
 * frameless/transparent window on Windows loses the OS resize borders, so we
 * overlay 8 thin no-drag strips (4 edges + 4 corners). Dragging one reads the
 * current outer bounds once, then rewrites them from the pointer delta via the
 * `window.windowControls` bridge. Hidden while maximized.
 */

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

// Keep in sync with MIN_WINDOW_WIDTH / MIN_WINDOW_HEIGHT in main. Electron also
// clamps setBounds to these, but clamping here keeps the anchored (top/left)
// edge from drifting once the min size is hit.
const MIN_W = 960
const MIN_H = 650

// 主窗口内容内缩 12px 承载投影(见 AppLayout 的 m-3)。若命中区只贴窗口最外沿，用户在
// 「可视卡片边缘」就无法缩放，得把鼠标移到阴影外沿才行。把命中区加厚到覆盖这圈留白
// (12px)并略进入卡片，让缩放从可视边界即可触发。若改动 AppLayout 的 m-3，这里同步。
const EDGE = 16 // px thickness of the edge strips
const CORNER = 22 // px size of the corner squares

export function WindowResizeHandles() {
  const maximized = useWindowMaximized()

  const startResize = useCallback(
    (edge: Edge) => (event: React.MouseEvent) => {
      if (event.button !== 0) return
      const controls = window.windowControls
      if (!controls?.getBounds || !controls.setBounds) return
      event.preventDefault()

      const startScreenX = event.screenX
      const startScreenY = event.screenY

      void controls.getBounds().then((start) => {
        if (!start) return

        let raf = 0
        let pending: { x: number; y: number; width: number; height: number } | null = null
        const flush = () => {
          raf = 0
          if (pending) {
            void controls.setBounds(pending)
            pending = null
          }
        }

        const onMove = (e: MouseEvent) => {
          const dx = e.screenX - startScreenX
          const dy = e.screenY - startScreenY
          let { x, y, width, height } = start
          if (edge.includes('e')) width = start.width + dx
          if (edge.includes('s')) height = start.height + dy
          if (edge.includes('w')) {
            x = start.x + dx
            width = start.width - dx
          }
          if (edge.includes('n')) {
            y = start.y + dy
            height = start.height - dy
          }
          // Clamp to min size; when the west/north edge is the one being
          // dragged, pin x/y so the opposite edge stays put at the min size.
          if (width < MIN_W) {
            if (edge.includes('w')) x = start.x + (start.width - MIN_W)
            width = MIN_W
          }
          if (height < MIN_H) {
            if (edge.includes('n')) y = start.y + (start.height - MIN_H)
            height = MIN_H
          }
          pending = {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
          }
          if (!raf) raf = requestAnimationFrame(flush)
        }

        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          if (raf) cancelAnimationFrame(raf)
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      })
    },
    [],
  )

  if (maximized) return null

  // no-drag lives on each strip (NOT the full-window container) — a
  // full-window no-drag overlay makes the whole window non-draggable,
  // because -webkit-app-region ignores pointer-events.
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      {/* Edges */}
      <div
        onMouseDown={startResize('n')}
        className="pointer-events-auto absolute inset-x-0 top-0"
        style={{ ...noDrag, height: EDGE, cursor: 'ns-resize' }}
      />
      <div
        onMouseDown={startResize('s')}
        className="pointer-events-auto absolute inset-x-0 bottom-0"
        style={{ ...noDrag, height: EDGE, cursor: 'ns-resize' }}
      />
      <div
        onMouseDown={startResize('w')}
        className="pointer-events-auto absolute inset-y-0 left-0"
        style={{ ...noDrag, width: EDGE, cursor: 'ew-resize' }}
      />
      <div
        onMouseDown={startResize('e')}
        className="pointer-events-auto absolute inset-y-0 right-0"
        style={{ ...noDrag, width: EDGE, cursor: 'ew-resize' }}
      />
      {/* Corners (sit above the edge strips) */}
      <div
        onMouseDown={startResize('nw')}
        className="pointer-events-auto absolute left-0 top-0"
        style={{ ...noDrag, width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      />
      <div
        onMouseDown={startResize('ne')}
        className="pointer-events-auto absolute right-0 top-0"
        style={{ ...noDrag, width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      />
      <div
        onMouseDown={startResize('sw')}
        className="pointer-events-auto absolute bottom-0 left-0"
        style={{ ...noDrag, width: CORNER, height: CORNER, cursor: 'nesw-resize' }}
      />
      <div
        onMouseDown={startResize('se')}
        className="pointer-events-auto absolute bottom-0 right-0"
        style={{ ...noDrag, width: CORNER, height: CORNER, cursor: 'nwse-resize' }}
      />
    </div>
  )
}
