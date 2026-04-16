import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const appAPI = {
  isFirstLaunch: () => ipcRenderer.invoke('app:isFirstLaunch'),
  markLaunched: () => ipcRenderer.invoke('app:markLaunched'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:update:check'),
  onUpdateEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('app:update-event', handler)
    return () => ipcRenderer.removeListener('app:update-event', handler)
  },
}

const configAPI = {
  read: () => ipcRenderer.invoke('config:read'),
  save: (data: unknown) => ipcRenderer.invoke('config:save', data),
}

const appConfigAPI = {
  read: () => ipcRenderer.invoke('app-config:read'),
  save: (data: unknown) => ipcRenderer.invoke('app-config:save', data),
}

const appRuntimeAPI = {
  getStatus: () => ipcRenderer.invoke('app-runtime:getStatus'),
  getLogLevel: () => ipcRenderer.invoke('app-runtime:getLogLevel'),
  getLogs: (options?: {
    after?: string
    level?: 'error' | 'info' | 'debug'
    query?: string
    file?: 'all' | 'app' | 'renderer'
    limit?: number
  }) => ipcRenderer.invoke('app-runtime:getLogs', options),
  openLogsDirectory: () => ipcRenderer.invoke('app-runtime:openLogsDirectory'),
  logRenderer: (level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) =>
    ipcRenderer.invoke('app-runtime:logRenderer', level, message, details),
  trackUsage: (entry: {
    category: string
    action: string
    status: string
    details?: Record<string, unknown>
    sessionId?: string
  }) => ipcRenderer.invoke('app-runtime:trackUsage', entry),
  exportData: (type: 'logs' | 'chat' | 'config') => ipcRenderer.invoke('app-runtime:exportData', type),
  onStatus: (callback: (status: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: Record<string, unknown>): void => callback(status)
    ipcRenderer.on('app-runtime:status', handler)
    return () => ipcRenderer.removeListener('app-runtime:status', handler)
  },
}

const harnessclawAPI = {
  connect: () => ipcRenderer.invoke('harnessclaw:connect'),
  disconnect: () => ipcRenderer.invoke('harnessclaw:disconnect'),
  send: (content: string, sessionId?: string) => ipcRenderer.invoke('harnessclaw:send', content, sessionId),
  command: (cmd: string, sessionId?: string) => ipcRenderer.invoke('harnessclaw:command', cmd, sessionId),
  stop: (sessionId?: string) => ipcRenderer.invoke('harnessclaw:stop', sessionId),
  subscribe: (sessionId: string) => ipcRenderer.invoke('harnessclaw:subscribe', sessionId),
  unsubscribe: (sessionId: string) => ipcRenderer.invoke('harnessclaw:unsubscribe', sessionId),
  listSessions: () => ipcRenderer.invoke('harnessclaw:listSessions'),
  probe: () => ipcRenderer.invoke('harnessclaw:probe'),
  respondPermission: (requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => ipcRenderer.invoke('harnessclaw:respondPermission', requestId, approved, scope, message),
  getStatus: () => ipcRenderer.invoke('harnessclaw:status'),
  onStatus: (callback: (status: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: string): void => callback(status)
    ipcRenderer.on('harnessclaw:status', handler)
    return () => ipcRenderer.removeListener('harnessclaw:status', handler)
  },
  onEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('harnessclaw:event', handler)
    return () => ipcRenderer.removeListener('harnessclaw:event', handler)
  },
}

const skillsAPI = {
  list: () => ipcRenderer.invoke('skills:list'),
  read: (id: string) => ipcRenderer.invoke('skills:read', id),
  delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  listRepositories: () => ipcRenderer.invoke('skills:listRepositories'),
  saveRepository: (input: {
    id?: string
    name?: string
    repoUrl: string
    branch?: string
    basePath?: string
    proxy?: {
      enabled?: boolean
      protocol?: 'http' | 'https' | 'socks5'
      host?: string
      port?: string
    }
    enabled?: boolean
  }) => ipcRenderer.invoke('skills:saveRepository', input),
  removeRepository: (id: string) => ipcRenderer.invoke('skills:removeRepository', id),
  discover: (repositoryId?: string) => ipcRenderer.invoke('skills:discover', repositoryId),
  listDiscovered: (repositoryId?: string) => ipcRenderer.invoke('skills:listDiscovered', repositoryId),
  previewDiscovered: (repositoryId: string, skillPath: string) =>
    ipcRenderer.invoke('skills:previewDiscovered', repositoryId, skillPath),
  installDiscovered: (repositoryId: string, skillPath: string) =>
    ipcRenderer.invoke('skills:installDiscovered', repositoryId, skillPath),
  onDiscoveryEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('skills:discovery-event', handler)
    return () => ipcRenderer.removeListener('skills:discovery-event', handler)
  },
}

const dbAPI = {
  listSessions: () => ipcRenderer.invoke('db:listSessions'),
  getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('db:deleteSession', sessionId),
  updateSessionTitle: (sessionId: string, title: string) => ipcRenderer.invoke('db:updateSessionTitle', sessionId, title),
  onSessionsChanged: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('db:sessionsChanged', handler)
    return () => ipcRenderer.removeListener('db:sessionsChanged', handler)
  },
}

const filesAPI = {
  pick: () => ipcRenderer.invoke('files:pick'),
  resolve: (paths: string[]) => ipcRenderer.invoke('files:resolve', paths),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('appBridge', appAPI)
    contextBridge.exposeInMainWorld('engineConfig', configAPI)
    contextBridge.exposeInMainWorld('config', configAPI)
    contextBridge.exposeInMainWorld('nanobotConfig', configAPI)
    contextBridge.exposeInMainWorld('appConfig', appConfigAPI)
    contextBridge.exposeInMainWorld('appRuntime', appRuntimeAPI)
    contextBridge.exposeInMainWorld('harnessclaw', harnessclawAPI)
    contextBridge.exposeInMainWorld('skills', skillsAPI)
    contextBridge.exposeInMainWorld('db', dbAPI)
    contextBridge.exposeInMainWorld('files', filesAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.appBridge = appAPI
  // @ts-ignore (define in dts)
  window.engineConfig = configAPI
  // @ts-ignore (define in dts)
  window.config = configAPI
  // @ts-ignore (define in dts)
  window.nanobotConfig = configAPI
  // @ts-ignore (define in dts)
  window.appConfig = appConfigAPI
  // @ts-ignore (define in dts)
  window.appRuntime = appRuntimeAPI
  // @ts-ignore (define in dts)
  window.harnessclaw = harnessclawAPI
  // @ts-ignore (define in dts)
  window.skills = skillsAPI
  // @ts-ignore (define in dts)
  window.db = dbAPI
  // @ts-ignore (define in dts)
  window.files = filesAPI
}
