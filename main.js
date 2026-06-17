/**
 * RemoteSupport — Главный процесс Electron
 *
 * Управляет окном приложения, системным треем,
 * запуском Python-компонентов и IPC-мостом.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell } = require('electron')
const path = require('path')
const { spawn, exec } = require('child_process')

// ==================== Конфигурация ====================

const IS_DEV = !app.isPackaged
const NEXT_URL = IS_DEV ? 'http://localhost:3000' : `file://${path.join(__dirname, '../out/index.html')}`

/** Порты компонентов */
const PORTS = {
  relay: 6969,
  next: 3000,
}

/** Пути к Python-скриптам */
const PYTHON_PATHS = {
  relayServer: path.join(__dirname, '..', 'python', 'relay_server.py'),
  clientApp: path.join(__dirname, '..', 'python', 'client_app.py'),
  specialistApp: path.join(__dirname, '..', 'python', 'specialist_app.py'),
}

// ==================== Состояние приложения ====================

let mainWindow = null
let tray = null
let pythonProcesses = {}

const appState = {
  relayServerRunning: false,
  clientRunning: false,
  specialistRunning: false,
  relayServerPort: PORTS.relay,
  connectionStatus: 'disconnected', // disconnected, connecting, connected, active
}

// ==================== Определение Python ====================

function getPythonCommand() {
  // Попробуем python3, затем python
  try {
    const result = exec('python3 --version', { encoding: 'utf-8' })
    return 'python3'
  } catch {
    try {
      exec('python --version', { encoding: 'utf-8' })
      return 'python'
    } catch {
      return null
    }
  }
}

// ==================== Управление Python-процессами ====================

/**
 * Запуск Python-скрипта как дочернего процесса
 */
function startPythonProcess(name, scriptPath, args = []) {
  if (pythonProcesses[name]) {
    return { success: false, message: `Процесс ${name} уже запущен` }
  }

  const pythonCmd = getPythonCommand()
  if (!pythonCmd) {
    return { success: false, message: 'Python не найден в системе' }

}

  // Проверяем существование скрипта
  const fs = require('fs')
  if (!fs.existsSync(scriptPath)) {
    return { success: false, message: `Скрипт не найден: ${scriptPath}` }
  }

  const proc = spawn(pythonCmd, [scriptPath, ...args], {
    cwd: path.dirname(scriptPath),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', (data) => {
    const output = data.toString().trim()
    console.log(`[${name}] ${output}`)
    // Отправляем вывод в рендерер
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python:output', { name, type: 'stdout', data: output })
    }
  })

  proc.stderr.on('data', (data) => {
    const output = data.toString().trim()
    console.error(`[${name}:ERR] ${output}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python:output', { name, type: 'stderr', data: output })
    }
  })

  proc.on('close', (code) => {
    console.log(`[${name}] Завершён с кодом ${code}`)
    pythonProcesses[name] = null
    appState[`${name}Running`] = false

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python:stopped', { name, code })
    }

    // Уведомление
    showNotification(`${name} остановлен`, `Процесс завершён с кодом ${code}`)
  })

  pythonProcesses[name] = proc
  appState[`${name}Running`] = true

  // Обновляем состояние
  sendStateToRenderer()

  return { success: true, pid: proc.pid }
}

/**
 * Остановка Python-процесса
 */
function stopPythonProcess(name) {
  const proc = pythonProcesses[name]
  if (!proc) {
    return { success: false, message: `Процесс ${name} не запущен` }
  }

  proc.kill('SIGTERM')
  pythonProcesses[name] = null
  appState[`${name}Running`] = false
  sendStateToRenderer()

  return { success: true }
}

/**
 * Остановка всех Python-процессов
 */
function stopAllProcesses() {
  Object.keys(pythonProcesses).forEach((name) => {
    if (pythonProcesses[name]) {
      stopPythonProcess(name)
    }
  })
}

// ==================== Окно приложения ====================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Кастомный заголовок
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: getAppIcon(),
    show: false,
  })

  // Готовое к показу окно
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Загрузка Next.js
  mainWindow.loadURL(NEXT_URL)

  // DevTools в режиме разработки
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('close', (e) => {
    // Минимизация в трей вместо закрытия
    if (appState.connectionStatus === 'active') {
      e.preventDefault()
      mainWindow.hide()
      showNotification(
        'RemoteSupport работает',
        'Приложение свёрнуто в трей. Активная сессия продолжается.'
      )
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ==================== Системный трей ====================

function getAppIcon() {
  // Простая иконка (в реальном проекте — .ico/.png)
  return nativeImage.createEmpty()
}

function createTray() {
  const icon = getAppIcon()
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(createDefaultIconBuffer()) : icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть RemoteSupport', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: appState.relayServerRunning ? '⏹ Остановить реле-сервер' : '▶ Запустить реле-сервер',
      click: () => {
        if (appState.relayServerRunning) {
          stopPythonProcess('relayServer')
        } else {
          startPythonProcess('relayServer', PYTHON_PATHS.relayServer)
        }
        createTray() // Обновить меню
      },
    },
    { type: 'separator' },
    {
      label: 'Статус: ' + getStatusText(),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Завершить все процессы',
      click: () => stopAllProcesses(),
    },
    {
      label: 'Выход',
      click: () => {
        stopAllProcesses()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.setToolTip('RemoteSupport — Удалённая техподдержка')
  tray.on('double-click', () => mainWindow?.show())
}

function createDefaultIconBuffer() {
  // Создаём минимальную 16x16 иконку (зелёный кружок)
  const size = 16
  const png = require('electron').nativeImage
  const canvas = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const cx = x - size / 2
      const cy = y - size / 2
      const dist = Math.sqrt(cx * cx + cy * cy)

      if (dist < size / 2 - 1) {
        canvas[idx] = 16     // R
        canvas[idx + 1] = 185 // G
        canvas[idx + 2] = 129 // B
        canvas[idx + 3] = 255  // A
      } else {
        canvas[idx + 3] = 0 // Прозрачный
      }
    }
  }

  return png.createFromBuffer(canvas, { width: size, height: size }).toPNG()
}

function getStatusText() {
  const statusMap = {
    disconnected: 'Отключено',
    connecting: 'Подключение...',
    connected: 'Подключено',
    active: 'Сессия активна',
  }
  return statusMap[appState.connectionStatus] || 'Неизвестно'
}

// ==================== Уведомления ====================

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: getAppIcon() }).show()
  }
}

// ==================== Утилиты ====================

function sendStateToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:state', { ...appState })
  }
}

// ==================== IPC обработчики ====================

function setupIpcHandlers() {
  // --- Управление окном ---
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

  // --- Python-процессы ---
  ipcMain.handle('python:start', (_, { name, script, args }) => {
    return startPythonProcess(name, script || PYTHON_PATHS[name], args || [])
  })

  ipcMain.handle('python:stop', (_, { name }) => {
    return stopPythonProcess(name)
  })

  ipcMain.handle('python:stopAll', () => {
    stopAllProcesses()
    return { success: true }
  })

  // --- Состояние приложения ---
  ipcMain.handle('app:getState', () => {
    return { ...appState }
  })

  ipcMain.handle('app:setConnectionStatus', (_, { status }) => {
    appState.connectionStatus = status
    sendStateToRenderer()
    createTray() // Обновить меню трея
    return { success: true }
  })

  // --- Утилиты ---
  ipcMain.handle('shell:openExternal', (_, { url }) => {
    shell.openExternal(url)
  })

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('app:getPaths', () => {
    return {
      python: PYTHON_PATHS,
      app: app.getAppPath(),
      userData: app.getPath('userData'),
    }
  })

  // --- Информация о системе ---
  ipcMain.handle('system:info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      pythonCommand: getPythonCommand(),
    }
  })
}

// ==================== Жизненный цикл приложения ====================

app.whenReady().then(() => {
  createMainWindow()
  createTray()
  setupIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAllProcesses()
})

// Обработка сигналов
process.on('SIGINT', () => {
  stopAllProcesses()
  app.quit()
})

process.on('SIGTERM', () => {
  stopAllProcesses()
  app.quit()
})