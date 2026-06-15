import { randomUUID } from 'node:crypto'

export const DEFAULT_BROWSER_AGENT_CDP_PORT = 9222

const SESSION_MARKER_PREFIX = 'about:blank#harnessclaw-browser-session='
const DEFAULT_PARTITION = 'persist:browser-agent-default'

type MaybePromise<T> = T | Promise<T>

export interface BrowserAgentWindowOptions {
  width: number
  height: number
  show: boolean
  title: string
  autoHideMenuBar: boolean
  webPreferences: {
    preload?: string
    contextIsolation: boolean
    sandbox: boolean
    nodeIntegration: boolean
    partition?: string
  }
}

export interface BrowserAgentWebContentsLike {
  loadURL(url: string): MaybePromise<void>
  getURL?(): string
  getTitle?(): string
  canGoBack?(): boolean
  canGoForward?(): boolean
  goBack?(): void
  goForward?(): void
  reload?(): void
  focus?(): void
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  setWindowOpenHandler?(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  send?(channel: string, payload: unknown): void
  debugger?: BrowserAgentDebuggerLike
}

export interface BrowserAgentDebuggerLike {
  isAttached?(): boolean
  attach?(protocolVersion?: string): void
  sendCommand?(command: string, params?: Record<string, unknown>): MaybePromise<unknown>
  detach?(): void
}

export interface BrowserAgentWindowLike {
  id: number
  loadURL(url: string): MaybePromise<void>
  show(): void
  hide?(): void
  isVisible?(): boolean
  focus?(): void
  destroy(): void
  isDestroyed(): boolean
  getContentBounds?(): { width: number; height: number }
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  once?(event: 'closed', listener: () => void): void
  webContents?: BrowserAgentWebContentsLike
}

export interface BrowserAgentTabInfo {
  tab_id: string
  title: string
  url: string
  cdp_endpoint: string
  active: boolean
}

export interface BrowserAgentSessionInfo {
  session_id: string
  window_id: string
  cdp_endpoint: string
  partition: string
  visible: boolean
  last_used_turn_id?: string
  active_tab: BrowserAgentTabInfo
  tabs: BrowserAgentTabInfo[]
  closed?: boolean
  human_takeover?: {
    request_id: string
    message: string
  }
}

export interface BrowserAgentCloseResult {
  closed: boolean
  session_id: string
  window_id: string
}

export interface BrowserAgentCloseSessionsResult {
  closed_session_ids: string[]
  missing_session_ids: string[]
}

export interface BrowserAgentAskHumanResult {
  status: 'shown'
  session_id: string
  window_id: string
  message: string
  request_id?: string
}

export interface BrowserAgentSessionManagerLike {
  createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo>
  closeSession(input: Record<string, unknown>): BrowserAgentCloseResult
  askHuman(input: Record<string, unknown>): BrowserAgentAskHumanResult
  getSessionState(input: Record<string, unknown>): BrowserAgentSessionInfo
  listSessions(): BrowserAgentSessionInfo[]
  setVisibility(input: Record<string, unknown>): BrowserAgentSessionInfo
  hideSession(input: Record<string, unknown>): BrowserAgentSessionInfo
  hideSessionsForTurn(turnID: string): void
  closeSessions(input: Record<string, unknown>): BrowserAgentCloseSessionsResult
  finishHumanTakeover(requestID: string, status: 'success' | 'cancelled'): void
  closeAll(): void
}

export type BrowserAgentWindowFactory = (options: BrowserAgentWindowOptions) => BrowserAgentWindowLike
export type BrowserAgentCDPEndpointResolver = (
  markerURL: string,
  window?: BrowserAgentWindowLike,
) => Promise<string>

interface BrowserAgentTabRecord {
  tab_id: string
  window_id: string
  title: string
  url: string
  marker_url: string
  cdp_endpoint: string
  webContents: BrowserAgentWebContentsLike
}

interface BrowserAgentSessionRecord {
  session_id: string
  window_id: string
  partition: string
  visible: boolean
  last_used_turn_id?: string
  window: BrowserAgentWindowLike
  windows: Map<string, BrowserAgentWindowLike>
  tabs: BrowserAgentTabRecord[]
  active_tab_id: string
  human_takeover?: {
    request_id: string
    message: string
  }
}

interface BrowserAgentSessionManagerOptions {
  createWindow: BrowserAgentWindowFactory
  resolveCDPEndpoint: BrowserAgentCDPEndpointResolver
  createSessionID?: () => string
  onSessionChanged?: (session: BrowserAgentSessionInfo) => void
}

interface FetchResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
}

type FetchLike = (url: string) => Promise<FetchResponseLike>

interface ResolverOptions {
  retries?: number
  delayMs?: number
}

export class BrowserAgentSessionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserAgentSessionError'
    this.code = code
  }
}

export class BrowserAgentSessionManager implements BrowserAgentSessionManagerLike {
  private readonly createWindow: BrowserAgentWindowFactory
  private readonly resolveCDPEndpoint: BrowserAgentCDPEndpointResolver
  private readonly createSessionID: () => string
  private readonly onSessionChanged?: (session: BrowserAgentSessionInfo) => void
  private readonly sessionsByID = new Map<string, BrowserAgentSessionRecord>()
  private readonly sessionsByWindowID = new Map<string, string>()

  constructor(options: BrowserAgentSessionManagerOptions) {
    this.createWindow = options.createWindow
    this.resolveCDPEndpoint = options.resolveCDPEndpoint
    this.createSessionID = options.createSessionID || defaultSessionID
    this.onSessionChanged = options.onSessionChanged
  }

  async createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const sessionID = this.normalizeSessionID(input.session_id)
    const startURL = optionalString(input.start_url)
    const visibility = input.visibility === 'visible' ? 'visible' : 'hidden'
    const partition = this.resolvePartition()
    const lastUsedTurnID = optionalString(input.last_used_turn_id) || optionalString(input.turn_id)
    if (startURL) {
      validateHTTPURL(startURL, 'start_url')
    }
    if (this.sessionsByID.has(sessionID)) {
      throw new BrowserAgentSessionError('duplicate_session', `Browser session already exists: ${sessionID}`)
    }

    const win = this.createWindow({
      width: 1280,
      height: 900,
      show: visibility === 'visible',
      title: 'HarnessClaw Browser Agent',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition,
      },
    })

    const record: BrowserAgentSessionRecord = {
      session_id: sessionID,
      window_id: String(win.id),
      partition,
      visible: visibility === 'visible',
      last_used_turn_id: lastUsedTurnID || undefined,
      window: win,
      windows: new Map(),
      tabs: [],
      active_tab_id: '',
    }
    this.attachWindow(record, win)

    try {
      const tab = await this.createWindowTab(record, startURL)
      record.tabs.push(tab)
      record.active_tab_id = tab.tab_id

      this.sessionsByID.set(sessionID, record)
      this.sessionsByWindowID.set(record.window_id, sessionID)
      if (visibility === 'visible') {
        this.showRecord(record)
      }
      this.publish(record)
      return publicSessionInfo(record)
    } catch (err) {
      for (const windowID of record.windows.keys()) {
        this.sessionsByWindowID.delete(windowID)
      }
      if (!win.isDestroyed()) {
        win.destroy()
      }
      throw err
    }
  }

  closeSession(input: Record<string, unknown>): BrowserAgentCloseResult {
    const record = this.requireSession(input)
    const closedInfo: BrowserAgentSessionInfo = { ...publicSessionInfo(record), visible: false, closed: true }
    this.onSessionChanged?.(closedInfo)
    this.forgetSession(record.session_id)
    this.destroyRecordWindows(record)
    return {
      closed: true,
      session_id: record.session_id,
      window_id: record.window_id,
    }
  }

  askHuman(input: Record<string, unknown>): BrowserAgentAskHumanResult {
    const record = this.requireSession(input)
    const message = optionalString(input.message)
    if (!message) {
      throw new BrowserAgentSessionError('invalid_input', 'message is required')
    }
    this.markUsed(record, input)
    const requestID = optionalString(input.request_id)
    if (requestID) {
      record.human_takeover = { request_id: requestID, message }
    }
    this.showRecord(record)
    this.publish(record)
    return {
      status: 'shown',
      session_id: record.session_id,
      window_id: record.window_id,
      message,
      request_id: requestID || undefined,
    }
  }

  getSessionState(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const record = this.requireSession(input)
    this.markUsed(record, input)
    this.refreshTabState(record)
    this.publish(record)
    return publicSessionInfo(record)
  }

  listSessions(): BrowserAgentSessionInfo[] {
    return [...this.sessionsByID.values()].map((record) => publicSessionInfo(record))
  }

  getSession(sessionID: string): BrowserAgentSessionInfo | undefined {
    const record = this.sessionsByID.get(sessionID)
    return record ? publicSessionInfo(record) : undefined
  }

  setVisibility(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const record = this.requireSession(input)
    const visible = input.visible === true || input.visibility === 'visible'
    if (visible) {
      this.showRecord(record)
    } else {
      this.hideRecord(record)
    }
    this.publish(record)
    return publicSessionInfo(record)
  }

  hideSession(input: Record<string, unknown>): BrowserAgentSessionInfo {
    return this.setVisibility({ ...input, visible: false })
  }

  hideSessionsForTurn(turnID: string): void {
    const normalized = turnID.trim()
    if (!normalized) return
    for (const record of this.sessionsByID.values()) {
      if (record.last_used_turn_id === normalized) {
        this.hideRecord(record)
        this.publish(record)
      }
    }
  }

  closeSessions(input: Record<string, unknown>): BrowserAgentCloseSessionsResult {
    const sessionIDs = normalizeSessionIDs(input.session_ids)
    const closed: string[] = []
    const missing: string[] = []
    for (const sessionID of sessionIDs) {
      const record = this.sessionsByID.get(sessionID)
      if (!record) {
        missing.push(sessionID)
        continue
      }
      const closedInfo: BrowserAgentSessionInfo = { ...publicSessionInfo(record), visible: false, closed: true }
      this.onSessionChanged?.(closedInfo)
      this.forgetSession(record.session_id)
      this.destroyRecordWindows(record)
      closed.push(record.session_id)
    }
    return {
      closed_session_ids: closed,
      missing_session_ids: missing,
    }
  }

  async navigate(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const record = this.requireSession(input)
    const url = optionalString(input.url)
    if (!url) throw new BrowserAgentSessionError('invalid_input', 'url is required')
    validateHTTPURL(url, 'url')
    const tab = this.activeTab(record)
    await this.loadTabURL(tab, url)
    this.publish(record)
    return publicSessionInfo(record)
  }

  goBack(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.goBack?.()
    return this.getSessionState(input)
  }

  goForward(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.goForward?.()
    return this.getSessionState(input)
  }

  reload(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.reload?.()
    return this.getSessionState(input)
  }

  finishHumanTakeover(requestID: string, status: 'success' | 'cancelled'): void {
    for (const record of this.sessionsByID.values()) {
      if (record.human_takeover?.request_id === requestID) {
        record.human_takeover = undefined
        if (status === 'success') {
          this.showRecord(record)
        }
        this.publish(record)
        return
      }
    }
  }

  closeAll(): void {
    for (const record of [...this.sessionsByID.values()]) {
      const closedInfo: BrowserAgentSessionInfo = { ...publicSessionInfo(record), visible: false, closed: true }
      this.onSessionChanged?.(closedInfo)
      this.forgetSession(record.session_id)
      this.destroyRecordWindows(record)
    }
  }

  private attachWindow(record: BrowserAgentSessionRecord, win: BrowserAgentWindowLike): void {
    if (win.isDestroyed()) return
    const windowID = String(win.id)
    if (record.windows.has(windowID)) return
    record.windows.set(windowID, win)
    this.sessionsByWindowID.set(windowID, record.session_id)
    win.on?.('close', () => this.handleWindowClosed(record.session_id, windowID))
    win.once?.('closed', () => this.handleWindowClosed(record.session_id, windowID))
    win.on?.('focus', () => this.activateWindowTab(record, windowID))
    win.webContents?.on?.('did-create-window', (createdWindow: unknown, details: unknown) => {
      const child = asBrowserAgentWindow(createdWindow)
      if (!child) return
      this.attachWindow(record, child)
      void this.registerWindowTab(record, child, windowOpenURL(details))
    })
    if (record.visible) {
      this.showWindow(win)
    } else {
      this.hideWindow(win)
    }
  }

  private async createWindowTab(record: BrowserAgentSessionRecord, url?: string): Promise<BrowserAgentTabRecord> {
    if (!record.window.webContents) {
      throw new BrowserAgentSessionError('window_not_ready', 'Browser window has no webContents')
    }
    const markerURL = sessionMarkerURL(record.session_id)
    const tabID = `tab_${record.session_id}`
    const publishIfRegistered = (): void => {
      if (!record.tabs.some((candidate) => candidate.tab_id === tabID)) return
      this.publish(record)
    }
    record.window.webContents.on?.('page-title-updated', publishIfRegistered)
    record.window.webContents.on?.('did-navigate', publishIfRegistered)
    await record.window.loadURL(markerURL)
    const cdpEndpoint = await this.resolveCDPEndpoint(markerURL, record.window)
    const tab: BrowserAgentTabRecord = {
      tab_id: tabID,
      window_id: record.window_id,
      title: 'New Tab',
      url: markerURL,
      marker_url: markerURL,
      cdp_endpoint: cdpEndpoint,
      webContents: record.window.webContents,
    }
    if (url) {
      await this.loadTabURL(tab, url)
    }
    return tab
  }

  private async registerWindowTab(
    record: BrowserAgentSessionRecord,
    win: BrowserAgentWindowLike,
    urlHint?: string,
  ): Promise<void> {
    if (!win.webContents || win.isDestroyed()) {
      return
    }
    const windowID = String(win.id)
    const tabID = `tab_${record.session_id}_${windowID}`
    const url = urlHint || win.webContents.getURL?.() || 'about:blank'
    let cdpEndpoint: string
    try {
      cdpEndpoint = await this.resolveCDPEndpoint(url, win)
    } catch {
      return
    }
    const existing = record.tabs.find((candidate) => candidate.tab_id === tabID)
    if (existing) {
      existing.url = url
      existing.title = win.webContents.getTitle?.() || titleFromURL(url)
      existing.cdp_endpoint = cdpEndpoint
      record.active_tab_id = existing.tab_id
      this.publish(record)
      return
    }
    const tab: BrowserAgentTabRecord = {
      tab_id: tabID,
      window_id: windowID,
      title: win.webContents.getTitle?.() || titleFromURL(url),
      url,
      marker_url: '',
      cdp_endpoint: cdpEndpoint,
      webContents: win.webContents,
    }
    record.tabs.push(tab)
    record.active_tab_id = tab.tab_id
    const publishIfRegistered = (): void => {
      if (!record.tabs.some((candidate) => candidate.tab_id === tabID)) return
      record.active_tab_id = tabID
      this.publish(record)
    }
    win.webContents.on?.('page-title-updated', publishIfRegistered)
    win.webContents.on?.('did-navigate', publishIfRegistered)
    this.publish(record)
  }

  private async loadTabURL(tab: BrowserAgentTabRecord, url: string): Promise<void> {
    await tab.webContents.loadURL(url)
    tab.url = url
    tab.title = titleFromURL(url)
  }

  private refreshTabState(record: BrowserAgentSessionRecord): void {
    for (const tab of record.tabs) {
      const url = tab.webContents.getURL?.()
      const title = tab.webContents.getTitle?.()
      if (url) tab.url = url
      if (title) tab.title = title
    }
  }

  private activeTab(record: BrowserAgentSessionRecord): BrowserAgentTabRecord {
    const tab = record.tabs.find((candidate) => candidate.tab_id === record.active_tab_id) || record.tabs[0]
    if (!tab) {
      throw new BrowserAgentSessionError('session_not_ready', `Browser session has no tabs: ${record.session_id}`)
    }
    return tab
  }

  private activateWindowTab(record: BrowserAgentSessionRecord, windowID: string): void {
    const tab = record.tabs.find((candidate) => candidate.window_id === windowID)
    if (!tab) {
      return
    }
    record.active_tab_id = tab.tab_id
    this.publish(record)
  }

  private requireSession(input: Record<string, unknown>): BrowserAgentSessionRecord {
    const sessionID = optionalString(input.session_id)
    const windowID = optionalString(input.window_id)
    const resolvedSessionID = sessionID || (windowID ? this.sessionsByWindowID.get(windowID) : undefined)
    if (!resolvedSessionID) {
      throw new BrowserAgentSessionError('session_not_found', 'session_id is required')
    }
    const record = this.sessionsByID.get(resolvedSessionID)
    if (!record) {
      throw new BrowserAgentSessionError('session_not_found', `Browser session not found: ${resolvedSessionID}`)
    }
    return record
  }

  private normalizeSessionID(raw: unknown): string {
    const requested = optionalString(raw)
    return requested || this.createSessionID()
  }

  private resolvePartition(): string {
    return DEFAULT_PARTITION
  }

  private markUsed(record: BrowserAgentSessionRecord, input: Record<string, unknown>): void {
    const turnID = optionalString(input.last_used_turn_id) || optionalString(input.turn_id)
    if (turnID) {
      record.last_used_turn_id = turnID
    }
  }

  private showRecord(record: BrowserAgentSessionRecord): void {
    let shown = false
    for (const win of record.windows.values()) {
      if (win.isDestroyed()) continue
      this.showWindow(win)
      shown = true
    }
    const primary = record.windows.get(record.window_id)
    if (primary && !primary.isDestroyed()) {
      primary.focus?.()
    }
    if (shown) record.visible = true
  }

  private hideRecord(record: BrowserAgentSessionRecord): void {
    for (const win of record.windows.values()) {
      this.hideWindow(win)
    }
    record.visible = false
  }

  private showWindow(win: BrowserAgentWindowLike): void {
    if (win.isDestroyed()) return
    win.show()
  }

  private hideWindow(win: BrowserAgentWindowLike): void {
    if (win.isDestroyed()) return
    win.hide?.()
  }

  private destroyRecordWindows(record: BrowserAgentSessionRecord): void {
    for (const win of [...record.windows.values()]) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
  }

  private publish(record: BrowserAgentSessionRecord): void {
    if (record.tabs.length === 0) return
    this.refreshTabState(record)
    const info = publicSessionInfo(record)
    this.onSessionChanged?.(info)
  }

  private handleWindowClosed(sessionID: string, windowID?: string): void {
    const record = this.sessionsByID.get(sessionID)
    if (!record) return
    const closedWindowID = windowID || record.window_id
    record.windows.delete(closedWindowID)
    this.sessionsByWindowID.delete(closedWindowID)
    const primaryClosed = closedWindowID === record.window_id
    if (primaryClosed || record.windows.size === 0) {
      record.visible = false
      if (record.tabs.length > 0) {
        this.onSessionChanged?.({ ...publicSessionInfo(record), visible: false, closed: true })
      }
      this.forgetSession(sessionID)
      this.destroyRecordWindows(record)
      return
    }
    record.tabs = record.tabs.filter((tab) => tab.window_id !== closedWindowID)
    if (!record.tabs.some((tab) => tab.tab_id === record.active_tab_id)) {
      record.active_tab_id = record.tabs[0]?.tab_id || ''
    }
    record.visible = [...record.windows.values()].some((win) => !win.isDestroyed() && win.isVisible?.() === true)
    this.publish(record)
  }

  private forgetSession(sessionID: string): void {
    const record = this.sessionsByID.get(sessionID)
    if (!record) {
      return
    }
    this.sessionsByID.delete(sessionID)
    for (const windowID of record.windows.keys()) {
      this.sessionsByWindowID.delete(windowID)
    }
  }
}

export function createRemoteDebuggingTargetResolver(
  port = DEFAULT_BROWSER_AGENT_CDP_PORT,
  fetchImpl: FetchLike = defaultFetch,
  options: ResolverOptions = {},
): BrowserAgentCDPEndpointResolver {
  const retries = options.retries ?? 20
  const delayMs = options.delayMs ?? 100
  return async (markerURL: string, window?: BrowserAgentWindowLike): Promise<string> => {
    let lastError: unknown
    let targetID = ''
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        if (!targetID) {
          targetID = await resolveWindowTargetID(window)
        }
        const res = await fetchImpl(`http://127.0.0.1:${port}/json/list`)
        if (!res.ok) {
          throw new BrowserAgentSessionError('cdp_list_failed', `CDP target list failed with HTTP ${res.status || 0}`)
        }
        const targets = await res.json()
        const endpoint = findMatchingTargetEndpoint(targets, markerURL, targetID)
        if (endpoint) {
          return endpoint
        }
        lastError = new BrowserAgentSessionError('cdp_target_not_found', 'Browser CDP target is not ready yet')
      } catch (err) {
        lastError = err
      }
      if (attempt < retries - 1) {
        await delay(delayMs)
      }
    }
    if (lastError instanceof BrowserAgentSessionError) {
      throw lastError
    }
    throw new BrowserAgentSessionError('cdp_target_not_found', String(lastError || 'Browser CDP target not found'))
  }
}

export const createRemoteDebuggingEndpointResolver = createRemoteDebuggingTargetResolver

function defaultSessionID(): string {
  return `browser_${randomUUID().slice(0, 8)}`
}

function sessionMarkerURL(sessionID: string): string {
  return `${SESSION_MARKER_PREFIX}${encodeURIComponent(sessionID)}`
}

function publicSessionInfo(record: BrowserAgentSessionRecord): BrowserAgentSessionInfo {
  const active = record.tabs.find((tab) => tab.tab_id === record.active_tab_id) || record.tabs[0]
  const activeInfo = publicTabInfo(record, active)
  return {
    session_id: record.session_id,
    window_id: record.window_id,
    cdp_endpoint: activeInfo.cdp_endpoint,
    partition: record.partition,
    visible: record.visible,
    last_used_turn_id: record.last_used_turn_id,
    active_tab: activeInfo,
    tabs: record.tabs.map((tab) => publicTabInfo(record, tab)),
    human_takeover: record.human_takeover,
  }
}

function publicTabInfo(record: BrowserAgentSessionRecord, tab: BrowserAgentTabRecord): BrowserAgentTabInfo {
  return {
    tab_id: tab.tab_id,
    title: tab.title || titleFromURL(tab.url),
    url: tab.url,
    cdp_endpoint: tab.cdp_endpoint,
    active: tab.tab_id === record.active_tab_id,
  }
}

function asBrowserAgentWindow(value: unknown): BrowserAgentWindowLike | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<BrowserAgentWindowLike>
  if (typeof candidate.id !== 'number') return undefined
  if (typeof candidate.show !== 'function') return undefined
  if (typeof candidate.destroy !== 'function') return undefined
  if (typeof candidate.isDestroyed !== 'function') return undefined
  return candidate as BrowserAgentWindowLike
}

function windowOpenURL(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined
  const url = (details as Record<string, unknown>).url
  return typeof url === 'string' && url.trim() ? url.trim() : undefined
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSessionIDs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sessionIDs: string[] = []
  for (const item of value) {
    const sessionID = optionalString(item)
    if (!sessionID || seen.has(sessionID)) continue
    seen.add(sessionID)
    sessionIDs.push(sessionID)
  }
  return sessionIDs
}

function validateHTTPURL(raw: string, field: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (err) {
    throw new BrowserAgentSessionError('invalid_input', `${field}: ${String(err)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserAgentSessionError('invalid_input', `${field} scheme must be http or https`)
  }
  if (!parsed.host) {
    throw new BrowserAgentSessionError('invalid_input', `${field} host is required`)
  }
}

function titleFromURL(raw: string): string {
  try {
    const parsed = new URL(raw)
    return parsed.hostname || 'New Tab'
  } catch {
    return raw.startsWith('about:') ? 'New Tab' : raw
  }
}

async function resolveWindowTargetID(window?: BrowserAgentWindowLike): Promise<string> {
  const dbg = window?.webContents?.debugger
  if (!dbg || typeof dbg.sendCommand !== 'function') {
    return ''
  }
  let attachedHere = false
  try {
    const isAttached = typeof dbg.isAttached === 'function' ? dbg.isAttached() : false
    if (!isAttached) {
      if (typeof dbg.attach !== 'function') {
        return ''
      }
      dbg.attach('1.3')
      attachedHere = true
    }
    const info = await dbg.sendCommand('Target.getTargetInfo')
    return extractTargetID(info)
  } catch {
    return ''
  } finally {
    if (attachedHere && typeof dbg.detach === 'function') {
      try {
        dbg.detach()
      } catch {
        // The window may be closing while the resolver is retrying.
      }
    }
  }
}

function extractTargetID(info: unknown): string {
  if (!info || typeof info !== 'object') {
    return ''
  }
  const direct = (info as Record<string, unknown>).targetId
  if (typeof direct === 'string') {
    return direct
  }
  const targetInfo = (info as Record<string, unknown>).targetInfo
  if (!targetInfo || typeof targetInfo !== 'object') {
    return ''
  }
  const nested = (targetInfo as Record<string, unknown>).targetId
  return typeof nested === 'string' ? nested : ''
}

function findMatchingTargetEndpoint(targets: unknown, markerURL: string, targetID = ''): string {
  if (!Array.isArray(targets)) {
    return ''
  }
  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue
    }
    const entry = target as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id : ''
    const targetURL = typeof entry.url === 'string' ? entry.url : ''
    const endpoint = typeof entry.webSocketDebuggerUrl === 'string' ? entry.webSocketDebuggerUrl : ''
    if (targetID && endpoint && (id === targetID || endpoint.endsWith(`/devtools/page/${targetID}`))) {
      return endpoint
    }
    if (endpoint && targetURL === markerURL) {
      return endpoint
    }
  }
  return ''
}

async function defaultFetch(url: string): Promise<FetchResponseLike> {
  if (typeof fetch !== 'function') {
    throw new BrowserAgentSessionError('cdp_fetch_unavailable', 'fetch is unavailable in this runtime')
  }
  return fetch(url)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
