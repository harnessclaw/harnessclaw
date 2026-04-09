import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs'
import { homedir } from 'os'
import { spawn, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { harnessclawClient } from './harnessclaw'
import {
  HARNESSCLAW_DIR,
  ENGINE_CONFIG_PATH,
  resolveBundledBinaryPath,
  ensureDir,
  readEngineConfig,
  saveEngineConfig,
  readHarnessclawConfig,
  saveHarnessclawConfig,
} from './config'
import {
  getDb, closeDb, upsertSession, updateSessionTitle, listSessions as dbListSessions,
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent,
  getMessages, insertToolActivity
} from './db'

type PersistedSubagent = { taskId: string; label: string; status: string }

function normalizeSubagent(raw: unknown): PersistedSubagent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  const taskId = typeof candidate.task_id === 'string' ? candidate.task_id : ''
  const label = typeof candidate.label === 'string' ? candidate.label : ''
  const status = typeof candidate.status === 'string' ? candidate.status : ''
  if (!taskId || !label) return undefined
  return { taskId, label, status: status || 'ok' }
}

function isSameSubagent(
  left?: PersistedSubagent,
  right?: PersistedSubagent,
): boolean {
  return left?.taskId === right?.taskId
}

function getModuleKey(subagent?: PersistedSubagent): string {
  return subagent?.taskId || '__main__'
}

const HARNESSCLAW_LAUNCHED_FLAG = join(HARNESSCLAW_DIR, '.launched')
const HARNESSCLAW_ENGINE_BIN = resolveBundledBinaryPath('harnessclaw-engine')
const CLAWHUB_BIN = resolveBundledBinaryPath('clawhub')
const CLAWHUB_WORKDIR = join(HARNESSCLAW_DIR, 'workspace')
const SKILLS_DIR = join(HARNESSCLAW_DIR, 'workspace', 'skills')

let harnessclawEngineProcess: ChildProcess | null = null

function ensureClawhubBinary(): { ok: boolean; path: string; error?: string } {
  if (CLAWHUB_BIN && existsSync(CLAWHUB_BIN)) {
    return { ok: true, path: CLAWHUB_BIN }
  }
  return {
    ok: false,
    path: CLAWHUB_BIN || '',
    error: 'Bundled clawhub binary not found in resources/bin',
  }
}

function getClawhubStatus(): { installed: boolean; path: string } {
  const resolved = ensureClawhubBinary()
  return {
    installed: resolved.ok,
    path: resolved.path,
  }
}

function runClawhub(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const resolved = ensureClawhubBinary()
    if (!resolved.ok) {
      resolve({ ok: false, stdout: '', stderr: resolved.error || `clawhub not found: ${resolved.path}`, code: null })
      return
    }

    const timeoutMs = options?.timeoutMs ?? 30000
    ensureDir(CLAWHUB_WORKDIR)
    const finalArgs = ['--workdir', CLAWHUB_WORKDIR, ...args]
    const commandLine = [resolved.path, ...finalArgs].join(' ')
    console.log('[ClawHub] Run:', commandLine, options?.cwd ? `(cwd: ${options.cwd})` : '')

    const child = spawn(resolved.path, finalArgs, {
      env: { ...process.env, HOME: homedir() },
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolve({ ok: false, stdout, stderr: stderr || `Timed out after ${timeoutMs}ms`, code: null })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: String(err), code: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

function startHarnessclawEngine(): void {
  if (harnessclawEngineProcess) return
  if (!HARNESSCLAW_ENGINE_BIN || !existsSync(HARNESSCLAW_ENGINE_BIN)) {
    console.warn('[HarnessclawEngine] Binary not found:', HARNESSCLAW_ENGINE_BIN || '<missing>')
    return
  }
  console.log('[HarnessclawEngine] Starting engine...')
  harnessclawEngineProcess = spawn(HARNESSCLAW_ENGINE_BIN, ['-config', ENGINE_CONFIG_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  harnessclawEngineProcess.stdout?.on('data', (data) => {
    process.stdout.write(`[HarnessclawEngine] ${data}`)
  })
  harnessclawEngineProcess.stderr?.on('data', (data) => {
    process.stderr.write(`[HarnessclawEngine] ${data}`)
  })
  harnessclawEngineProcess.on('error', (err) => {
    console.error('[HarnessclawEngine] Failed to start:', err)
    harnessclawEngineProcess = null
  })
  harnessclawEngineProcess.on('exit', (code) => {
    console.log('[HarnessclawEngine] Exited with code:', code)
    harnessclawEngineProcess = null
  })
}

function stopHarnessclawEngine(): void {
  if (!harnessclawEngineProcess) return
  console.log('[HarnessclawEngine] Stopping engine...')
  harnessclawEngineProcess.kill('SIGTERM')
  harnessclawEngineProcess = null
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#F5F5F7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openclaw.nanny')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // First-launch detection
  ipcMain.handle('app:isFirstLaunch', () => {
    return !existsSync(HARNESSCLAW_LAUNCHED_FLAG)
  })

  ipcMain.handle('app:markLaunched', () => {
    try {
      if (!existsSync(HARNESSCLAW_DIR)) {
        mkdirSync(HARNESSCLAW_DIR, { recursive: true })
      }
      writeFileSync(HARNESSCLAW_LAUNCHED_FLAG, new Date().toISOString(), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Config file read/write
  ipcMain.handle('config:read', () => {
    return readEngineConfig({ providers: {} })
  })

  ipcMain.handle('config:save', (_, data: unknown) => {
    ensureDir(HARNESSCLAW_DIR)
    return saveEngineConfig(data)
  })

  ipcMain.handle('app-config:read', () => {
    return readHarnessclawConfig({})
  })

  ipcMain.handle('app-config:save', (_, data: unknown) => {
    ensureDir(HARNESSCLAW_DIR)
    return saveHarnessclawConfig(data)
  })

  ipcMain.handle('clawhub:getStatus', () => {
    return getClawhubStatus()
  })

  ipcMain.handle('clawhub:install', () => {
    return ensureClawhubBinary()
  })

  ipcMain.handle('clawhub:verifyToken', async (_, token: string) => {
    const trimmed = token.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Token is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = ensureClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Bundled clawhub binary not found', code: null }
      }
    }
    return runClawhub(['login', '--token', trimmed])
  })

  ipcMain.handle('clawhub:explore', async () => {
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = ensureClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Bundled clawhub binary not found', code: null }
      }
    }
    return runClawhub(['explore'])
  })

  ipcMain.handle('clawhub:search', async (_, query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Query is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = ensureClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Bundled clawhub binary not found', code: null }
      }
    }
    return runClawhub(['search', trimmed])
  })

  ipcMain.handle('clawhub:installSkill', async (_, slug: string) => {
    const trimmed = slug.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Skill slug is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = ensureClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Bundled clawhub binary not found', code: null }
      }
    }
    ensureDir(SKILLS_DIR)
    return runClawhub(['install', trimmed], { cwd: SKILLS_DIR, timeoutMs: 120000 })
  })

  // Skills reader
  ipcMain.handle('skills:list', () => {
    try {
      if (!existsSync(SKILLS_DIR)) return []
      const dirs = readdirSync(SKILLS_DIR).filter((name) => {
        const full = join(SKILLS_DIR, name)
        return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'))
      })
      return dirs.map((dirName) => {
        const md = readFileSync(join(SKILLS_DIR, dirName, 'SKILL.md'), 'utf-8')
        // Parse YAML frontmatter
        const match = md.match(/^---\n([\s\S]*?)\n---/)
        const meta: Record<string, string> = {}
        if (match) {
          match[1].split('\n').forEach((line) => {
            const idx = line.indexOf(':')
            if (idx > 0) {
              meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
            }
          })
        }
        // Check for references and templates dirs
        const hasRefs = existsSync(join(SKILLS_DIR, dirName, 'references'))
        const hasTemplates = existsSync(join(SKILLS_DIR, dirName, 'templates'))
        return {
          id: dirName,
          name: meta.name || dirName,
          description: meta.description || '',
          allowedTools: meta['allowed-tools'] || '',
          hasReferences: hasRefs,
          hasTemplates: hasTemplates,
        }
      })
    } catch (err) {
      console.error('[Skills] Failed to list:', err)
      return []
    }
  })

  ipcMain.handle('skills:read', (_, id: string) => {
    try {
      const filePath = join(SKILLS_DIR, id, 'SKILL.md')
      if (!existsSync(filePath)) return ''
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error('[Skills] Failed to read:', err)
      return ''
    }
  })

  ipcMain.handle('skills:delete', (_, id: string) => {
    try {
      const trimmed = id.trim()
      if (!trimmed || trimmed.includes('..') || trimmed.includes('/')) {
        return { ok: false, error: 'Invalid skill id' }
      }
      const skillDir = join(SKILLS_DIR, trimmed)
      if (!existsSync(skillDir)) {
        return { ok: false, error: 'Skill not found' }
      }
      rmSync(skillDir, { recursive: true, force: true })
      console.log('[Skills] Deleted:', trimmed)
      return { ok: true }
    } catch (err) {
      console.error('[Skills] Failed to delete:', err)
      return { ok: false, error: String(err) }
    }
  })

  // Start bundled harnessclaw engine, then connect Harnessclaw (auto-retries until engine is ready)
  startHarnessclawEngine()
  getDb() // Initialize DB on startup
  harnessclawClient.connect()

  harnessclawClient.on('statusChange', (status) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:status', status)
    })
  })

  // DB IPC handlers
  ipcMain.handle('db:listSessions', () => {
    try {
      return dbListSessions()
    } catch (err) {
      console.error('[DB] listSessions error:', err)
      return []
    }
  })

  ipcMain.handle('db:getMessages', (_, sessionId: string) => {
    try {
      return getMessages(sessionId)
    } catch (err) {
      console.error('[DB] getMessages error:', err)
      return []
    }
  })

  ipcMain.handle('db:deleteSession', (_, sessionId: string) => {
    try {
      dbDeleteSession(sessionId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Track pending assistant message IDs per session for DB writes
  const pendingDbAssistantIds: Record<string, string> = {}
  const pendingDbSegments: Record<string, {
    segments: Array<{ text: string; ts: number; subagent?: PersistedSubagent }>
    lastToolTsByModule: Record<string, number>
  }> = {}

  harnessclawClient.on('event', (event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:event', event)
    })

    // Write to DB based on event type
    const type = event.type as string
    const sid = event.session_id as string | undefined
    const subagent = normalizeSubagent(event.subagent)
    try {
      const ensureDbAssistantMessage = (sessionId: string, now: number): string => {
        let aid = pendingDbAssistantIds[sessionId]
        if (aid) return aid

        aid = `ast-${now}`
        pendingDbAssistantIds[sessionId] = aid
        pendingDbSegments[sessionId] = { segments: [], lastToolTsByModule: {} }
        insertMessage({ id: aid, sessionId, role: 'assistant', content: '', contentSegments: [], createdAt: now })
        return aid
      }

      switch (type) {
        case 'connected': {
          // Don't auto-create session in DB — session is created when user sends first message
          break
        }
        case 'turn_start': {
          if (sid) {
            const now = Date.now()
            if (subagent) {
              const aid = ensureDbAssistantMessage(sid, now)
              insertToolActivity(aid, {
                type: 'status',
                name: 'turn_start',
                content: subagent.status === 'running' ? '子任务启动' : '开始总结',
                subagent,
              })
              break
            }
            const id = `ast-${now}`
            pendingDbAssistantIds[sid] = id
            pendingDbSegments[sid] = { segments: [], lastToolTsByModule: {} }
            insertMessage({ id, sessionId: sid, role: 'assistant', content: '', contentSegments: [], createdAt: now })
          }
          break
        }
        case 'task_start': {
          if (sid && subagent) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            insertToolActivity(aid, {
              type: 'status',
              name: 'task_start',
              content: '子任务已创建',
              subagent,
            })
          }
          break
        }
        case 'tool_hint': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, { type: 'hint', content: (event.content as string) || '', subagent })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'tool_call': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'call',
                name: event.name as string,
                content: JSON.stringify(event.arguments, null, 2),
                callId: event.call_id as string,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'tool_result': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'result',
                name: event.name as string,
                content: (event.content as string) || '',
                callId: event.call_id as string,
                isError: event.is_error as boolean,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'permission_request': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'permission',
                name: event.name as string,
                content: JSON.stringify({
                  tool_input: (event.tool_input as string) || '',
                  message: (event.content as string) || '',
                  is_read_only: event.is_read_only === true,
                  options: Array.isArray(event.options) ? event.options : [],
                }),
                callId: event.request_id as string,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'permission_result': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'permission_result',
                name: event.name as string,
                content: JSON.stringify({
                  approved: event.approved === true,
                  scope: event.scope === 'session' ? 'session' : 'once',
                  message: (event.content as string) || '',
                }),
                callId: event.request_id as string,
                isError: event.approved !== true,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'text_delta': {
          if (sid) {
            let aid = pendingDbAssistantIds[sid]
            const chunk = event.content as string
            const now = Date.now()
            if (!aid) {
              aid = ensureDbAssistantMessage(sid, now)
              const initialSegments = chunk ? [{ text: chunk, ts: now, subagent }] : []
              pendingDbSegments[sid] = { ...(pendingDbSegments[sid] || { lastToolTsByModule: {}, segments: [] }), segments: initialSegments }
              updateMessageContent(aid, chunk || '', initialSegments)
            } else if (chunk) {
              const state = pendingDbSegments[sid] || { segments: [], lastToolTsByModule: {} }
              const segments = [...state.segments]
              const moduleKey = getModuleKey(subagent)
              const lastSegIndex = [...segments].reverse().findIndex((seg) => getModuleKey(seg.subagent) === moduleKey)
              const resolvedLastSegIndex = lastSegIndex === -1 ? -1 : segments.length - 1 - lastSegIndex
              const lastSeg = resolvedLastSegIndex >= 0 ? segments[resolvedLastSegIndex] : undefined
              const lastRelatedToolTs = state.lastToolTsByModule[moduleKey] || 0
              if (lastSeg && lastRelatedToolTs <= lastSeg.ts && isSameSubagent(lastSeg.subagent, subagent)) {
                segments[resolvedLastSegIndex] = { ...lastSeg, text: lastSeg.text + chunk, ts: lastSeg.ts }
              } else {
                segments.push({ text: chunk, ts: now, subagent })
              }
              pendingDbSegments[sid] = { ...state, segments }
              updateMessageContent(aid, chunk, segments)
            }
          }
          break
        }
        case 'response': {
          if (sid) {
            let aid = pendingDbAssistantIds[sid]
            const content = (event.content as string) || ''
            const now = Date.now()
            const toolsUsed = event.tools_used as string[] | undefined
            const usage = event.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined

            if (!aid) {
              aid = ensureDbAssistantMessage(sid, now)
              const segments = content ? [{ text: content, ts: now, subagent }] : []
              pendingDbSegments[sid] = { segments, lastToolTsByModule: {} }
              updateMessageContent(aid, content, segments)
            } else {
              const segments = pendingDbSegments[sid]?.segments || []
              if (content && segments.length === 0) {
                pendingDbSegments[sid] = { segments: [{ text: content, ts: now, subagent }], lastToolTsByModule: {} }
              }
              updateMessageContent(aid, content, pendingDbSegments[sid]?.segments)
            }

            if (!subagent) {
              updateMessageContent(aid, '', pendingDbSegments[sid]?.segments, toolsUsed, usage)
              delete pendingDbAssistantIds[sid]
              delete pendingDbSegments[sid]
            }
          }
          break
        }
        case 'response_end': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              if (subagent) {
                insertToolActivity(aid, {
                  type: 'status',
                  name: 'response_end',
                  content: subagent.status === 'error' ? '子任务失败' : '子任务完成',
                  subagent,
                })
                break
              }
              const toolsUsed = event.tools_used as string[] | undefined
              const usage = event.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined
              // Content already accumulated via text_delta; just update metadata
              updateMessageContent(aid, '', pendingDbSegments[sid]?.segments, toolsUsed, usage)
              delete pendingDbAssistantIds[sid]
              delete pendingDbSegments[sid]
            }
          }
          break
        }
        case 'task_end': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid && subagent) {
              insertToolActivity(aid, {
                type: 'status',
                name: 'task_end',
                content: subagent.status === 'error' ? '子任务生命周期结束，状态失败' : '子任务生命周期结束',
                subagent,
              })
            }
          }
          break
        }
      }
    } catch (err) {
      console.error('[DB] Event write error:', type, err)
    }
  })

  ipcMain.handle('harnessclaw:connect', () => {
    harnessclawClient.connect()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:disconnect', () => {
    harnessclawClient.disconnect()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:send', async (_, content: string, sessionId?: string) => {
    const ok = await harnessclawClient.send(content, sessionId)
    if (!ok) {
      return { ok: false, error: 'Failed to send message to Harnessclaw' }
    }
    // Write user message to DB
    if (sessionId) {
      try {
        upsertSession(sessionId)
        const msgId = `usr-${Date.now()}`
        insertMessage({ id: msgId, sessionId, role: 'user', content, createdAt: Date.now() })
        // Use first user message as session title
        const msgs = getMessages(sessionId)
        const userMsgs = msgs.filter((m) => m.role === 'user')
        if (userMsgs.length === 1) {
          const title = content.trim().replace(/\n/g, ' ')
          const truncated = title.length > 50 ? title.slice(0, 50) + '...' : title
          updateSessionTitle(sessionId, truncated)
        }
      } catch (err) {
        console.error('[DB] Send write error:', err)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:command', (_, cmd: string, sessionId?: string) => {
    harnessclawClient.command(cmd, sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:stop', async (_, sessionId?: string) => {
    const ok = await harnessclawClient.stop(sessionId)
    return ok ? { ok: true } : { ok: false, error: 'Failed to interrupt Harnessclaw session' }
  })

  ipcMain.handle('harnessclaw:subscribe', (_, sessionId: string) => {
    harnessclawClient.subscribe(sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:unsubscribe', (_, sessionId: string) => {
    harnessclawClient.unsubscribe(sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:listSessions', () => {
    harnessclawClient.listSessions()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:probe', async () => {
    const ok = await harnessclawClient.probe()
    return { ok }
  })

  ipcMain.handle('harnessclaw:respondPermission', (_, requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => {
    const ok = harnessclawClient.respondPermission(requestId, approved, scope === 'session' ? 'session' : 'once', message)
    return ok ? { ok: true } : { ok: false, error: 'Permission request not found or socket unavailable' }
  })

  ipcMain.handle('harnessclaw:status', () => {
    return harnessclawClient.getStatus()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  harnessclawClient.disconnect()
  stopHarnessclawEngine()
  closeDb()
})
