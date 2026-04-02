import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const appAPI = {
  isFirstLaunch: () => ipcRenderer.invoke('app:isFirstLaunch'),
  markLaunched: () => ipcRenderer.invoke('app:markLaunched'),
}

const configAPI = {
  read: () => ipcRenderer.invoke('config:read'),
  save: (data: unknown) => ipcRenderer.invoke('config:save', data),
}

const appConfigAPI = {
  read: () => ipcRenderer.invoke('app-config:read'),
  save: (data: unknown) => ipcRenderer.invoke('app-config:save', data),
}

const clawhubAPI = {
  getStatus: () => ipcRenderer.invoke('clawhub:getStatus'),
  install: () => ipcRenderer.invoke('clawhub:install'),
  verifyToken: (token: string) => ipcRenderer.invoke('clawhub:verifyToken', token),
  explore: () => ipcRenderer.invoke('clawhub:explore'),
  search: (query: string) => ipcRenderer.invoke('clawhub:search', query),
  installSkill: (slug: string) => ipcRenderer.invoke('clawhub:installSkill', slug),
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
}

const dbAPI = {
  listSessions: () => ipcRenderer.invoke('db:listSessions'),
  getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('db:deleteSession', sessionId),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('appBridge', appAPI)
    contextBridge.exposeInMainWorld('config', configAPI)
    contextBridge.exposeInMainWorld('nanobotConfig', configAPI)
    contextBridge.exposeInMainWorld('appConfig', appConfigAPI)
    contextBridge.exposeInMainWorld('clawhub', clawhubAPI)
    contextBridge.exposeInMainWorld('harnessclaw', harnessclawAPI)
    contextBridge.exposeInMainWorld('skills', skillsAPI)
    contextBridge.exposeInMainWorld('db', dbAPI)
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
  window.config = configAPI
  // @ts-ignore (define in dts)
  window.nanobotConfig = configAPI
  // @ts-ignore (define in dts)
  window.appConfig = appConfigAPI
  // @ts-ignore (define in dts)
  window.clawhub = clawhubAPI
  // @ts-ignore (define in dts)
  window.harnessclaw = harnessclawAPI
  // @ts-ignore (define in dts)
  window.skills = skillsAPI
  // @ts-ignore (define in dts)
  window.db = dbAPI
}
