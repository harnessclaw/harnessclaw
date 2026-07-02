import { useEffect, useState } from 'react'

/**
 * Tracks the main window's maximized state (incl. OS snap), mirroring the
 * `window.windowControls` bridge used by <WindowControls>. Used to drop the
 * R22 rounded corners to square when maximized and to hide the custom resize
 * handles.
 */
export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const controls = window.windowControls
    if (!controls) return
    void controls.isMaximized().then(setMaximized)
    return controls.onMaximizedChanged(setMaximized)
  }, [])

  return maximized
}
