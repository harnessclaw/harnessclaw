const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BrowserAgentSessionManager,
  createRemoteDebuggingTargetResolver,
} = require('../out/main/browser-agent-session.js')

class FakeWindow {
  constructor(id, options) {
    this.id = id
    this.options = options
    this.loaded = []
    this.visible = false
    this.focused = false
    this.destroyed = false
    this.sent = []
    this.bounds = { width: 1280, height: 900 }
    this.listeners = new Map()
    this.webContentsListeners = new Map()
    this.webContents = {
      loadURL: async (url) => this.loadURL(url),
      getURL: () => this.loaded[this.loaded.length - 1] || '',
      getTitle: () => '',
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      focus: () => {},
      on: (event, listener) => {
        if (typeof listener === 'function') {
          const listeners = this.webContentsListeners.get(event) || []
          listeners.push(listener)
          this.webContentsListeners.set(event, listeners)
        }
        return this.webContents
      },
      setWindowOpenHandler: () => {},
      send: (channel, payload) => {
        this.sent.push({ channel, payload })
      },
    }
  }

  async loadURL(url) {
    this.loaded.push(url)
  }

  show() {
    this.visible = true
  }

  hide() {
    this.visible = false
  }

  isVisible() {
    return this.visible
  }

  focus() {
    this.focused = true
  }

  getContentBounds() {
    return this.bounds
  }

  on(event, listener) {
    if (typeof listener === 'function') {
      const listeners = this.listeners.get(event) || []
      listeners.push(listener)
      this.listeners.set(event, listeners)
    }
    return this
  }

  once(event, listener) {
    const listeners = this.listeners.get(event) || []
    const wrapped = (...args) => {
      this.listeners.set(event, (this.listeners.get(event) || []).filter((item) => item !== wrapped))
      listener(...args)
    }
    listeners.push(wrapped)
    this.listeners.set(event, listeners)
    return this
  }

  destroy() {
    this.destroyed = true
    this.emit('closed')
  }

  isDestroyed() {
    return this.destroyed
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) {
      listener(...args)
    }
  }

  emitWebContents(event, ...args) {
    for (const listener of this.webContentsListeners.get(event) || []) {
      listener(...args)
    }
  }

  closeFromUser() {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }
}

class FakeWebView {
  constructor(id) {
    this.id = id
    this.bounds = null
    this.listeners = new Map()
    this.webContents = {
      loaded: [],
      title: '',
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      focus: () => {},
      getURL: () => this.webContents.loaded[this.webContents.loaded.length - 1] || '',
      getTitle: () => this.webContents.title,
      loadURL: async (url) => {
        this.webContents.loaded.push(url)
        this.emit('did-navigate')
      },
      on: (event, listener) => {
        const listeners = this.listeners.get(event) || []
        listeners.push(listener)
        this.listeners.set(event, listeners)
        return this.webContents
      },
      setWindowOpenHandler: () => {},
    }
  }

  setBounds(bounds) {
    this.bounds = bounds
  }

  emit(event) {
    for (const listener of this.listeners.get(event) || []) {
      listener()
    }
  }
}

test('creates global persistent browser session in the BrowserWindow without loading a custom shell', async () => {
  let nextId = 41
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint(markerURL) {
      assert.match(markerURL, /^about:blank#harnessclaw-browser-session=/)
      return 'ws://127.0.0.1:9222/devtools/page/page-41'
    },
    createSessionID() {
      return 'sess_test_1'
    },
  })

  const result = await manager.createSession({
    start_url: 'https://example.com',
    visibility: 'visible',
    partition: 'persist:custom-isolated',
    task_id: 'task A',
  })

  assert.equal(result.session_id, 'sess_test_1')
  assert.equal(result.window_id, '41')
  assert.equal(result.cdp_endpoint, 'ws://127.0.0.1:9222/devtools/page/page-41')
  assert.equal(result.active_tab.url, 'https://example.com')
  assert.equal(result.tabs.length, 1)
  assert.equal(result.partition, 'persist:browser-agent-default')
  assert.equal(windows[0].options.webPreferences.sandbox, true)
  assert.equal(windows[0].options.webPreferences.contextIsolation, true)
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false)
  assert.equal(windows[0].options.webPreferences.partition, 'persist:browser-agent-default')
  assert.equal(windows[0].loaded[0], 'about:blank#harnessclaw-browser-session=sess_test_1')
  assert.equal(windows[0].loaded[1], 'https://example.com')
  assert.equal(windows[0].loaded.length, 2)
  assert.equal(windows[0].visible, true)
  assert.equal(windows[0].focused, true)
})

test('closes tracked browser session', async () => {
  const win = new FakeWindow(7, {})
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-7'
    },
    createSessionID() {
      return 'sess_close'
    },
  })

  await manager.createSession({})
  const result = manager.closeSession({ session_id: 'sess_close' })

  assert.equal(result.closed, true)
  assert.equal(win.destroyed, true)
  assert.equal(manager.getSession('sess_close'), undefined)
})

test('broadcasts closed session when the browser window is closed directly', async () => {
  const win = new FakeWindow(12, {})
  const changed = []
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-12'
    },
    createSessionID() {
      return 'sess_user_close'
    },
    onSessionChanged(session) {
      changed.push(session)
    },
  })

  await manager.createSession({})
  win.closeFromUser()

  assert.equal(manager.getSession('sess_user_close'), undefined)
  const closed = changed.find((session) => session.session_id === 'sess_user_close' && session.closed)
  assert.equal(closed?.visible, false)
  assert.equal(closed?.closed, true)
})

test('broadcasts closed session as soon as the browser window starts closing', async () => {
  const win = new FakeWindow(13, {})
  const changed = []
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-13'
    },
    createSessionID() {
      return 'sess_close_event'
    },
    onSessionChanged(session) {
      changed.push(session)
    },
  })

  await manager.createSession({})
  win.emit('close')

  assert.equal(manager.getSession('sess_close_event'), undefined)
  const closed = changed.find((session) => session.session_id === 'sess_close_event' && session.closed)
  assert.equal(closed?.visible, false)
  assert.equal(closed?.closed, true)
})

test('defaults new browser session to hidden and rejects non-http start URL', async () => {
  const win = new FakeWindow(9, {})
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      win.options = options
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-9'
    },
    createSessionID() {
      return 'sess_hidden'
    },
  })

  const result = await manager.createSession({})
  assert.equal(result.visible, false)
  assert.equal(win.options.show, false)
  assert.equal(win.visible, false)
  assert.equal(win.focused, false)

  await assert.rejects(
    () => manager.createSession({ start_url: 'file:///etc/passwd' }),
    /start_url scheme must be http or https/,
  )
})

test('shows window for human takeover', async () => {
  const win = new FakeWindow(8, {})
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-8'
    },
    createSessionID() {
      return 'sess_human'
    },
  })

  await manager.createSession({})
  const result = manager.askHuman({ session_id: 'sess_human', message: 'Please solve captcha' })

  assert.equal(result.status, 'shown')
  assert.equal(win.visible, true)
  assert.equal(win.focused, true)
})

test('toggles browser session visibility without destroying the window', async () => {
  const win = new FakeWindow(11, {})
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-11'
    },
    createSessionID() {
      return 'sess_toggle'
    },
  })

  await manager.createSession({ visibility: 'hidden' })
  assert.equal(win.visible, false)

  const shown = manager.setVisibility({ session_id: 'sess_toggle', visible: true })
  assert.equal(shown.visible, true)
  assert.equal(win.visible, true)
  assert.equal(win.focused, true)

  const hidden = manager.setVisibility({ session_id: 'sess_toggle', visible: false })
  assert.equal(hidden.visible, false)
  assert.equal(win.visible, false)
  assert.equal(win.destroyed, false)
})

test('applies browser session visibility and close to popup windows', async () => {
  let nextId = 50
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-50'
    },
    createSessionID() {
      return 'sess_multi_window'
    },
  })

  await manager.createSession({ visibility: 'hidden' })
  const parent = windows[0]
  const popup = new FakeWindow(nextId++, { show: true })
  popup.visible = true

  parent.emitWebContents('did-create-window', popup)

  assert.equal(parent.visible, false)
  assert.equal(popup.visible, false)

  const shown = manager.setVisibility({ session_id: 'sess_multi_window', visible: true })
  assert.equal(shown.visible, true)
  assert.equal(parent.visible, true)
  assert.equal(popup.visible, true)

  const hidden = manager.setVisibility({ session_id: 'sess_multi_window', visible: false })
  assert.equal(hidden.visible, false)
  assert.equal(parent.visible, false)
  assert.equal(popup.visible, false)

  manager.closeSession({ session_id: 'sess_multi_window' })
  assert.equal(parent.destroyed, true)
  assert.equal(popup.destroyed, true)
})

test('tracks popup windows as active tabs with their own CDP endpoints', async () => {
  let nextId = 80
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint(targetURL, win) {
      return `ws://127.0.0.1:9222/devtools/page/window-${win?.id || 'unknown'}-${encodeURIComponent(targetURL)}`
    },
    createSessionID() {
      return 'sess_popup_target'
    },
  })

  const created = await manager.createSession({ visibility: 'visible' })
  const parent = windows[0]
  const popup = new FakeWindow(nextId++, { show: true })
  await popup.loadURL('https://popup.example/detail')

  parent.emitWebContents('did-create-window', popup, { url: 'https://popup.example/detail' })
  await new Promise((resolve) => setImmediate(resolve))

  const state = manager.getSessionState({ session_id: created.session_id })
  assert.equal(state.tabs.length, 2)
  assert.equal(state.active_tab.url, 'https://popup.example/detail')
  assert.equal(
    state.active_tab.cdp_endpoint,
    'ws://127.0.0.1:9222/devtools/page/window-81-https%3A%2F%2Fpopup.example%2Fdetail',
  )
})

test('closeAll destroys every browser window attached to active sessions', async () => {
  let nextId = 60
  const windows = []
  const changed = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-60'
    },
    createSessionID() {
      return 'sess_close_all'
    },
    onSessionChanged(session) {
      changed.push(session)
    },
  })

  await manager.createSession({ visibility: 'visible' })
  const parent = windows[0]
  const popup = new FakeWindow(nextId++, { show: true })
  popup.visible = true
  parent.emitWebContents('did-create-window', popup)

  manager.closeAll()

  assert.equal(parent.destroyed, true)
  assert.equal(popup.destroyed, true)
  assert.equal(manager.listSessions().length, 0)
  const closed = changed.find((session) => session.session_id === 'sess_close_all' && session.closed)
  assert.equal(closed?.visible, false)
})

test('closeSessions destroys only requested browser sessions', async () => {
  let nextId = 70
  let nextSessionIndex = 0
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint(markerURL) {
      return `ws://127.0.0.1:9222/devtools/page/${encodeURIComponent(markerURL)}`
    },
    createSessionID() {
      nextSessionIndex += 1
      return `sess_scoped_${nextSessionIndex}`
    },
  })

  const first = await manager.createSession({ visibility: 'visible' })
  const second = await manager.createSession({ visibility: 'visible' })

  const result = manager.closeSessions({ session_ids: [first.session_id, 'missing_session'] })

  assert.deepEqual(result.closed_session_ids, [first.session_id])
  assert.equal(windows[0].destroyed, true)
  assert.equal(windows[1].destroyed, false)
  assert.equal(manager.getSession(first.session_id), undefined)
  assert.equal(manager.getSession(second.session_id)?.session_id, second.session_id)
})

test('hides only browser sessions used by the completed turn', async () => {
  let nextId = 20
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint(markerURL) {
      return `ws://127.0.0.1:9222/devtools/page/${encodeURIComponent(markerURL)}`
    },
    createSessionID() {
      return `sess_turn_${nextId}`
    },
  })

  const first = await manager.createSession({ visibility: 'visible', last_used_turn_id: 'turn-a' })
  const second = await manager.createSession({ visibility: 'visible', last_used_turn_id: 'turn-b' })

  manager.hideSessionsForTurn('turn-a')

  assert.equal(manager.getSession(first.session_id).visible, false)
  assert.equal(manager.getSession(second.session_id).visible, true)
  assert.equal(windows[0].destroyed, false)
  assert.equal(windows[1].destroyed, false)
})

test('ignores the old shell web view path and exposes a single active CDP tab', async () => {
  let nextWindowId = 31
  let createWebViewCalled = false
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      return new FakeWindow(nextWindowId++, options)
    },
    createWebView() {
      createWebViewCalled = true
      return new FakeWebView(1)
    },
    async resolveCDPEndpoint(markerURL) {
      assert.equal(markerURL, 'about:blank#harnessclaw-browser-session=sess_tabs')
      return 'ws://127.0.0.1:9222/devtools/page/sess_tabs'
    },
    createSessionID() {
      return 'sess_tabs'
    },
  })

  const created = await manager.createSession({ visibility: 'visible', start_url: 'https://example.com' })
  assert.equal(createWebViewCalled, false)
  assert.equal(created.tabs.length, 1)
  assert.equal(created.active_tab.tab_id, created.tabs[0].tab_id)
  assert.equal(created.active_tab.cdp_endpoint, created.cdp_endpoint)
  assert.equal(created.active_tab.url, 'https://example.com')
  assert.equal(created.active_tab.title, 'example.com')

  const navigated = await manager.navigate({ session_id: 'sess_tabs', url: 'https://openai.com' })
  assert.equal(navigated.tabs.length, 1)
  assert.equal(navigated.active_tab.url, 'https://openai.com')
})

test('remote debugging resolver selects target by marker URL', async () => {
  const resolver = createRemoteDebuggingTargetResolver(9333, async (url) => {
    assert.equal(url, 'http://127.0.0.1:9333/json/list')
    return {
      ok: true,
      async json() {
        return [
          { url: 'https://example.com', webSocketDebuggerUrl: 'ws://wrong' },
          {
            url: 'about:blank#harnessclaw-browser-session=sess_target',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/target',
          },
        ]
      },
    }
  }, { retries: 1, delayMs: 1 })

  const endpoint = await resolver('about:blank#harnessclaw-browser-session=sess_target')
  assert.equal(endpoint, 'ws://127.0.0.1:9333/devtools/page/target')
})

test('remote debugging resolver selects BrowserWindow target by webContents target id before URL is ready', async () => {
  const attachCalls = []
  const detachCalls = []
  const window = {
    webContents: {
      debugger: {
        isAttached() {
          return false
        },
        attach(protocolVersion) {
          attachCalls.push(protocolVersion)
        },
        async sendCommand(command) {
          assert.equal(command, 'Target.getTargetInfo')
          return { targetInfo: { targetId: 'target-from-webcontents' } }
        },
        detach() {
          detachCalls.push(true)
        },
      },
    },
  }
  const resolver = createRemoteDebuggingTargetResolver(9444, async (url) => {
    assert.equal(url, 'http://127.0.0.1:9444/json/list')
    return {
      ok: true,
      async json() {
        return [
          {
            id: 'target-from-webcontents',
            url: 'about:blank',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/target-from-webcontents',
          },
        ]
      },
    }
  }, { retries: 1, delayMs: 1 })

  const endpoint = await resolver('about:blank#harnessclaw-browser-session=sess_target_id', window)

  assert.equal(endpoint, 'ws://127.0.0.1:9444/devtools/page/target-from-webcontents')
  assert.deepEqual(attachCalls, ['1.3'])
  assert.equal(detachCalls.length, 1)
})
