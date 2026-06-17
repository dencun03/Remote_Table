/**
 * preload.js — Мост между Electron (main process) и React (renderer)
 *
 * Безопасно экспонирует ограниченный набор IPC-методов в window.electronAPI
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Управление окном ──
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // ── Состояние приложения ──
  getAppState: () => ipcRenderer.invoke('app:getState'),
  setConnectionStatus: (status) =>
    ipcRenderer.invoke('app:setConnectionStatus', { status }),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPaths: () => ipcRenderer.invoke('app:getPaths'),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  // ── Python-процессы (relay-сервер и т.д.) ──
  startPython: (name, script, args) =>
    ipcRenderer.invoke('python:start', { name, script, args }),
  stopPython: (name) => ipcRenderer.invoke('python:stop', { name }),
  stopAllPython: () => ipcRenderer.invoke('python:stopAll'),

  // ── Системные утилиты ──
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', { url }),

  // ── Слушатели событий от main-процесса ──
  onPythonOutput: (callback) =>
    ipcRenderer.on('python:output', (_event, data) => callback(data)),
  onPythonStopped: (callback) =>
    ipcRenderer.on('python:stopped', (_event, data) => callback(data)),
  onAppState: (callback) =>
    ipcRenderer.on('app:state', (_event, data) => callback(data)),
  removeListener: (channel, callback) =>
    ipcRenderer.removeListener(channel, callback),
})