import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import updateSecretaryAvatar from '@renderer/assets/update-secretary-avatar.svg'
import { WelcomeShaderBackground } from '../WelcomeShaderBackground'
import updateNowButton from '@renderer/assets/update-now-button.svg'
import updateBackgroundButton from '@renderer/assets/update-background-button.svg'

type UpdateStatus = 'discovered' | 'downloading' | 'error'

interface ReleaseNote {
  text: string
}

export function UpdateModal() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>('discovered')
  const [version, setVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([])
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [userDismissed, setUserDismissed] = useState(false)
  // Keep latest userDismissed accessible inside the event callback,
  // which is registered once and would otherwise capture a stale value.
  const userDismissedRef = useRef(false)
  userDismissedRef.current = userDismissed

  useEffect(() => {
    const unsubscribe = window.appBridge.onUpdateEvent((event) => {
      if (event.type === 'available') {
        const dismissKey = `updateModal.dismissed.${event.version}`
        if (sessionStorage.getItem(dismissKey)) return

        setVersion(event.version || '')
        setReleaseNotes(parseReleaseNotes(event.releaseNotes))
        setStatus('discovered')
        setProgress(0)
        setUserDismissed(false)
        setVisible(true)
      }

      if (event.type === 'download-progress') {
        setStatus('downloading')
        setProgress(event.percent || 0)
        // Respect user's dismiss action - don't force modal back
        if (!userDismissedRef.current) {
          setVisible(true)
        }
      }

      if (event.type === 'error') {
        setStatus('error')
        setErrorMessage(event.message || t('updateModal.errorMessage'))
        setUserDismissed(false)
        setVisible(true)
      }

      // 'downloaded' event is handled by system dialog in main process
      // No need to show modal for completed state
    })

    return () => {
      unsubscribe()
    }
  }, [t])

  const handleClose = () => {
    setVisible(false)
    setUserDismissed(true)
    sessionStorage.setItem(`updateModal.dismissed.${version}`, 'true')
  }

  const handleClick = async () => {
    if (status === 'discovered' || status === 'error') {
      await window.appBridge.downloadUpdate()
    } else if (status === 'downloading') {
      setVisible(false)
      setUserDismissed(true)
    }
  }

  if (!visible) return null

  const title = status === 'error'
    ? t('updateModal.updateFailed')
    : t('updateModal.title', { version })

  const buttonText =
    status === 'discovered'
      ? t('updateModal.updateNow')
      : status === 'downloading'
        ? t('updateModal.backgroundUpdate')
        : t('updateModal.retry')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative h-[440px] w-[350px] overflow-hidden rounded-[22px] bg-white shadow-2xl">
        {/* Inset animated shader panel — orange gradient framed with ~4px white
            edges (top/left/right); its bottom sits 134px above the card bottom,
            leaving a white strip for the action button (per design). */}
        <div
          className="pointer-events-none absolute left-1 right-1 top-1 overflow-hidden rounded-2xl"
          style={{ bottom: '134px' }}
        >
          <WelcomeShaderBackground className="absolute inset-0 h-full w-full" />
        </div>

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-5 w-5 items-center justify-center text-gray-500 transition-colors hover:text-gray-800"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* 64×64 circular secretary avatar, overlaid on background placeholder circle */}
        <img
          src={updateSecretaryAvatar}
          alt="Secretary"
          className="absolute h-16 w-16 rounded-full object-cover"
          style={{ left: '143px', top: '36px' }}
        />

        {/* Content area (title + notes/progress), overlaid on gradient decoration */}
        <div className="absolute top-[115px] left-0 right-0 px-6 flex flex-col items-center">
          <h2 className="text-center text-[16px] font-medium mb-2" style={{ color: '#222529' }}>
            {title}
          </h2>

          {/* Release notes - show for discovered and downloading states */}
          {releaseNotes.length > 0 && (status === 'discovered' || status === 'downloading') && (
            <div className="flex w-full mt-4" style={{ paddingLeft: '35px' }}>
              <div className="overflow-y-auto text-[13px] leading-relaxed" style={{ color: '#4E5969', maxHeight: '140px', maxWidth: '280px' }}>
                <ul className="space-y-1">
                  {releaseNotes.map((note, index) => (
                    <li key={index} className="flex items-start">
                      <span className="mr-2 mt-[2px] text-xs">·</span>
                      <span className="flex-1">{note.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Error message - only show for error state */}
          {status === 'error' && (
            <div className="w-full text-[13px] leading-relaxed" style={{ color: '#4E5969' }}>
              <p>{errorMessage}</p>
            </div>
          )}

          {/* Progress bar - only show for downloading state */}
          {status === 'downloading' && (
            <div className="w-full" style={{ marginTop: '80px' }}>
              <div className="mb-1.5 flex items-center justify-between text-xs" style={{ color: '#4E5969' }}>
                <span>{t('updateModal.downloadProgress')}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full mx-auto" style={{ width: '302px', backgroundColor: '#F2F4F6' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: '#4E5969'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Button - fixed position per design spec (top 354px) */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '354px' }}>
          {status === 'error' ? (
            <button
              onClick={handleClick}
              className="rounded-full text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{
                width: '192px',
                height: '39px',
                backgroundColor: '#4E5969'
              }}
            >
              {buttonText}
            </button>
          ) : (
            <button
              onClick={handleClick}
              className="block transition-opacity hover:opacity-90"
              style={{ width: '192px', height: '39px' }}
            >
              <img
                src={status === 'downloading' ? updateBackgroundButton : updateNowButton}
                alt={buttonText}
                className="h-full w-full"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Parse release notes and clean markdown syntax
 */
function parseReleaseNotes(notes: unknown): ReleaseNote[] {
  if (typeof notes === 'string') {
    return notes
      .split('\n')
      .map((line) => cleanMarkdown(line.trim()))
      .filter((line) => line.length > 0)
      .map((text) => ({ text }))
  }
  return []
}

/**
 * Clean markdown syntax from a line
 * - Remove leading ## headings
 * - Remove leading - / * / + list markers
 * - Remove ** bold markers
 * - Remove ` code markers
 */
function cleanMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')        // Remove heading markers
    .replace(/^[-*+]\s+/, '')         // Remove list markers
    .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove bold
    .replace(/`(.*?)`/g, '$1')        // Remove inline code
    .trim()
}
