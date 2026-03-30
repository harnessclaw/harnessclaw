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

const emmaAPI = {
  connect: () => ipcRenderer.invoke('emma:connect'),
  disconnect: () => ipcRenderer.invoke('emma:disconnect'),
  send: (content: string, sessionId?: string) => ipcRenderer.invoke('emma:send', content, sessionId),
  command: (cmd: string, sessionId?: string) => ipcRenderer.invoke('emma:command', cmd, sessionId),
  stop: (sessionId?: string) => ipcRenderer.invoke('emma:stop', sessionId),
  subscribe: (sessionId: string) => ipcRenderer.invoke('emma:subscribe', sessionId),
  unsubscribe: (sessionId: string) => ipcRenderer.invoke('emma:unsubscribe', sessionId),
  listSessions: () => ipcRenderer.invoke('emma:listSessions'),
  getStatus: () => ipcRenderer.invoke('emma:status'),
  onStatus: (callback: (status: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: string): void => callback(status)
    ipcRenderer.on('emma:status', handler)
    return () => ipcRenderer.removeListener('emma:status', handler)
  },
  onEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('emma:event', handler)
    return () => ipcRenderer.removeListener('emma:event', handler)
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
    contextBridge.exposeInMainWorld('emma', emmaAPI)
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
  window.emma = emmaAPI
  // @ts-ignore (define in dts)
  window.skills = skillsAPI
  // @ts-ignore (define in dts)
  window.db = dbAPI
}
