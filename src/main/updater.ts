import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { request } from 'node:https'

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

async function showDownloadPrompt(window: BrowserWindow, version: string): Promise<void> {
  if (promptInFlight || window.isDestroyed()) return
  promptInFlight = true
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '发现新版本',
      message: `发现新版本 ${version}`,
      detail: '是否现在下载并安装更新？',
      noLink: true,
    })

    if (result.response === 0) {
      sendUpdateEvent(window, 'download-started', { version })
      // Release the prompt lock before the long download so that
      // showInstallPrompt can fire as soon as the download completes.
      promptInFlight = false
      await autoUpdater.downloadUpdate()
    } else {
      sendUpdateEvent(window, 'download-deferred', { version })
    }
  } finally {
    promptInFlight = false
  }
}

async function showInstallPrompt(window: BrowserWindow, version: string): Promise<void> {
  if (promptInFlight || window.isDestroyed()) return
  promptInFlight = true
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '更新已准备完成',
      message: `版本 ${version} 已下载完成`,
      detail: '重启应用后将安装更新。',
      noLink: true,
    })

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  } finally {
    promptInFlight = false
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
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes) || await fetchReleaseNotes(info.version)
    sendUpdateEvent(window, 'available', {
      version: info.version,
      releaseNotes,
    })
    void showDownloadPrompt(window, info.version)
  })

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateEvent(window, 'not-available', { version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent(window, 'download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    sendUpdateEvent(window, 'downloaded', { version: info.version })
    void showInstallPrompt(window, info.version)
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
