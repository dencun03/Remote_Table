interface ElectronAPI {
  // Управление окном
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => boolean
}

interface ControlAPI {
  startServer: () => Promise<{ success: boolean; pid?: number; message?: string }>
  stopServer: () => Promise<{ success: boolean; message?: string }>
  startClient: (host: string, port?: number) => Promise<{ success: boolean; pid?: number; message?: string }>
  stopClient: () => Promise<{ success: boolean; message?: string }>
  getLocalIP: () => Promise<{ ip: string; all: string[] }>
  isRunning: (name: 'controlServer' | 'controlClient') => Promise<{ running: boolean }>
}

interface Window {
  electronAPI?: ElectronAPI & {
    getAppState?: () => Promise<Record<string, unknown>>
    setConnectionStatus?: (status: string) => Promise<{ success: boolean }>
    getVersion?: () => Promise<string>
    getPaths?: () => Promise<Record<string, unknown>>
    getSystemInfo?: () => Promise<Record<string, unknown>>
    startPython?: (name: string, script: string, args: string[]) => Promise<{ success: boolean; pid?: number; message?: string }>
    stopPython?: (name: string) => Promise<{ success: boolean; message?: string }>
    stopAllPython?: () => Promise<{ success: boolean }>
    openExternal?: (url: string) => Promise<void>
    onPythonOutput?: (callback: (data: { name: string; type: string; data: string }) => void) => void
    onPythonStopped?: (callback: (data: { name: string; code: number }) => void) => void
    onAppState?: (callback: (data: Record<string, unknown>) => void) => void
    removeListener?: (channel: string, callback: (...args: unknown[]) => void) => void
    control?: ControlAPI
  }
}

export {}
