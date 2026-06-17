/**
 * RemoteSupport — Preload скрипт
 *
 * Безопасный мост между Electron (main) и рендерером (HTML).
 * Предоставляет только разрешённые API через contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== Управление окном ====================
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // ==================== Python-процессы ====================
  python: {
    start: (name, script, args) => ipcRenderer.invoke('python:start', { name, script, args }),
    stop: (name) => ipcRenderer.invoke('python:stop', { name }),
    stopAll: () => ipcRenderer.invoke('python:stopAll'),

    // События от Python-процессов
    onOutput: (callback) => {
      ipcRenderer.on('python:output', (_, data) => callback(data))
    },
    onStopped: (callback) => {
      ipcRenderer.on('python:stopped', (_, data) => callback(data))
    },
  },

  // ==================== Состояние приложения ====================
  app: {
    getState: () => ipcRenderer.invoke('app:getState'),
    setConnectionStatus: (status) => ipcRenderer.invoke('app:setConnectionStatus', { status }),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPaths: () => ipcRenderer.invoke('app:getPaths'),

    // Событие изменения состояния
    onStateChange: (callback) => {
      ipcRenderer.on('app:state', (_, state) => callback(state))
    },
  },

  // ==================== Системные утилиты ====================
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', { url }),
  },

  // ==================== Детекция среды ====================
  isElectron: true,
})
