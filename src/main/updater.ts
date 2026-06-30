import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { request } from 'node:https'
import { reportTelemetry } from './telemetry-helper'

const { autoUpdater } = electronUpdater

const STARTUP_CHECK_DELAY_MS = 10_000
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const UPDATE_REPO_OWNER = 'harnessclaw'
const UPDATE_REPO_NAME = 'harnessclaw'
const GENERIC_UPDATE_BASE_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest/download/`

let initialized = false
let checkInFlight = false
let periodicCheckTimer: ReturnType<typeof setInterval> | null = null
let promptInFlight = false
let downloadedVersion = ''
let availableVersion = ''
const releaseNotesCache = new Map<string, string>()

function sendUpdateEvent(window: BrowserWindow, type: string, payload: Record<string, unknown> = {}): void {
  if (window.isDestroyed()) return
  window.webContents.send('app:update-event', { type, ...payload })
}

function getMacUpdateChannel(): string {
  return process.arch === 'arm64' ? 'latest-arm64' : 'latest-x64'
}

function normalizeReleaseNotes(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'note' in item && typeof item.note === 'string') {
          return item.note
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }
  return ''
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'HarnessClaw-Updater',
      },
    }, (response) => {
      const statusCode = response.statusCode || 0
      const chunks: Buffer[] = []

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (statusCode >= 200 && statusCode < 300) {
          resolve(body)
          return
        }
        reject(new Error(`Request failed: ${statusCode} ${body.trim()}`))
      })
    })

    req.on('error', reject)
    req.end()
  })
}

async function fetchReleaseNotes(version: string): Promise<string> {
  if (!version) return ''
  if (releaseNotesCache.has(version)) {
    return releaseNotesCache.get(version) || ''
  }

  try {
    const raw = await fetchText(`https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/tags/v${version}`)
    const parsed = JSON.parse(raw) as { body?: unknown }
    const notes = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    if (notes) {
      releaseNotesCache.set(version, notes)
    }
    return notes
  } catch (error) {
    console.warn('[AutoUpdater] failed to fetch release notes:', error)
    return ''
  }
}

async function checkForUpdates(window: BrowserWindow): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Auto update is disabled in development mode' }
  }
  if (checkInFlight) {
    return { ok: false, error: 'Update check already in progress' }
  }
  if (window.isDestroyed()) {
    return { ok: false, error: 'No active window' }
  }
  checkInFlight = true
  reportTelemetry({ category: 'feature_usage', action: 'update_checked' })
  try {
    sendUpdateEvent(window, 'checking')
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[AutoUpdater] check failed:', message)
    sendUpdateEvent(window, 'error', { message })
    return { ok: false, error: message }
  } finally {
    checkInFlight = false
  }
}

export function setupAutoUpdater(window: BrowserWindow): void {
  if (!app.isPackaged || initialized) return
  initialized = true

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: GENERIC_UPDATE_BASE_URL,
    channel: process.platform === 'darwin' ? getMacUpdateChannel() : 'latest',
  })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendUpdateEvent(window, 'checking')
  })

  autoUpdater.on('update-available', async (info) => {
    downloadedVersion = ''
    availableVersion = info.version || ''
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes) || await fetchReleaseNotes(info.version)
    sendUpdateEvent(window, 'available', {
      version: info.version,
      releaseNotes,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateEvent(window, 'not-available', { version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent(window, 'download-progress', {
      version: availableVersion,
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    downloadedVersion = info.version
    sendUpdateEvent(window, 'downloaded', { version: info.version })

    // Show system dialog for install confirmation
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Update Downloaded',
      message: `Version ${info.version} is ready to install`,
      detail: 'The application will restart to complete the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })

    if (response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (error) => {
    const message = error == null
      ? 'Unknown auto update error'
      : error instanceof Error
        ? error.message
        : String(error)
    console.error('[AutoUpdater] error:', message)
    sendUpdateEvent(window, 'error', { message })
  })

  window.on('closed', () => {
    if (periodicCheckTimer) {
      clearInterval(periodicCheckTimer)
      periodicCheckTimer = null
    }
    initialized = false
    promptInFlight = false
    checkInFlight = false
    downloadedVersion = ''
  })

  setTimeout(() => {
    if (!window.isDestroyed()) {
      void checkForUpdates(window)
    }
  }, STARTUP_CHECK_DELAY_MS)

  periodicCheckTimer = setInterval(() => {
    if (!window.isDestroyed()) {
      void checkForUpdates(window)
    }
  }, PERIODIC_CHECK_INTERVAL_MS)
}

export async function manuallyCheckForUpdates(window: BrowserWindow): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Auto update is disabled in development mode' }
  }

  const result = await checkForUpdates(window)
  if (!result.ok) {
    return result
  }

  return { ok: true, version: downloadedVersion || undefined }
}

export async function downloadUpdate(): Promise<{ ok: boolean }> {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    console.error('[AutoUpdater] download failed:', error)
    return { ok: false }
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true)
}
