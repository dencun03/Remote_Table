/**
 * RemoteSupport — Главный процесс Electron
 *
 * Управляет окном приложения, системным треем,
 * автозапуском Next.js, чат-сервиса и Python-компонентов.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell } = require('electron')
const path = require('path')
const { spawn, execSync } = require('child_process')
const http = require('http')
const net = require('net')

// ==================== Конфигурация ====================

const IS_DEV = !app.isPackaged

/**
 * Путь к корню проекта (там где package.json с Next.js)
 * От electron/main.js → вверх на 1 уровень
 */
const WEB_DIR = path.join(__dirname, '..', 'web')

const NEXT_URL = IS_DEV ? 'http://localhost:3000' : `file://${path.join(__dirname, '..', 'out', 'index.html')}`

/** Порты компонентов */
const PORTS = {
  relay: 6969,
  next: 3000,
  chat: 3004,
}

/** Пути к Python-скриптам */
const PYTHON_PATHS = {
  relayServer: path.join(__dirname, '..', 'network', 'relay_server.py'),
  clientApp: path.join(__dirname, '..', 'client', 'client_app.py'),
  specialistApp: path.join(__dirname, '..', 'specialist', 'specialist_app.py'),
}

// ==================== Состояние приложения ====================

let mainWindow = null
let tray = null
const childProcesses = {}

const appState = {
  nextReady: false,
  chatReady: false,
  relayServerRunning: false,
  clientRunning: false,
  specialistRunning: false,
  relayServerPort: PORTS.relay,
  connectionStatus: 'disconnected', // disconnected, connecting, connected, active
}

// ==================== Определение команд ====================

function getBunCommand() {
  try {
    execSync('bun --version', { encoding: 'utf-8', timeout: 3000 })
    return 'bun'
  } catch {
    return 'npx'
  }
}

function getPythonCommand() {
  try {
    execSync('python3 --version', { encoding: 'utf-8', timeout: 3000 })
    return 'python3'
  } catch {
    try {
      execSync('python --version', { encoding: 'utf-8', timeout: 3000 })
      return 'python'
    } catch {
      return null
    }
  }
}

// ==================== Работа с портами ====================

/**
 * Проверяет, свободен ли порт (создаёт TCP-сервер и пробует listen).
 * Надёжнее чем HTTP GET, т.к. работает даже если сервер не отвечает на HTTP.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Проверяет, что на порту реально работает HTTP-сервер.
 */
function checkPortHttp(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Находит PID процесса, занимающего порт (netstat).
 * Возвращает массив PID или пустой массив.
 */
function findPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      const pids = new Set()
      for (const line of out.trim().split('\n')) {
        const match = line.trim().match(/\s+(\d+)\s*$/)
        if (match) pids.add(parseInt(match[1]))
      }
      return [...pids].filter(pid => pid > 0 && pid !== process.pid)
    } else {
      const out = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      return out.trim().split('\n')
        .map(s => parseInt(s))
        .filter(n => n > 0 && n !== process.pid)
    }
  } catch {
    return []
  }
}

/**
 * Убивает конкретный PID без флага /T (не трогает дочерние процессы).
 * Исключает собственный PID Electron.
 */
function killPid(pid) {
  try {
    if (pid === process.pid) return false
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: 5000 })
    } else {
      process.kill(pid, 'SIGKILL')
    }
    return true
  } catch {
    return false
  }
}

/**
 * Принудительно освобождает порт: находит PID → убивает → ждёт.
 * Вызывается ВСЕГДА при старте, даже если порт кажется свободным.
 */
async function freePort(port, maxWaitMs = 10000) {
  const pids = findPidsOnPort(port)
  if (pids.length > 0) {
    console.log(`[Startup] Порт ${port} занят, освобождаем...`)
    for (const pid of pids) {
      const killed = killPid(pid)
      console.log(`[Startup] ${killed ? 'Убит процесс' : 'Не удалось убить'} ${pid} на порту ${port}`)
    }
  }

  // В любом случае ждём пока порт реально освободится (TIME_WAIT на Windows)
  console.log(`[Startup] Ожидание порта ${port}...`)
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (await isPortFree(port)) {
      // Дополнительно ждём 500мс чтобы OS точно освободила сокет
      await new Promise(r => setTimeout(r, 500))
      if (await isPortFree(port)) {
        console.log(`[Startup] Порт ${port} свободен`)
        return true
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  console.warn(`[Startup] Таймаут ожидания порта ${port}`)
  return false
}

// ==================== Автозапуск Next.js и чат-сервиса ====================

async function startWebServices() {
  const bunCmd = getBunCommand()

  // ВСЕГДА освобождаем порты при старте (убиваем orphan-процессы)
  const nextOk = await freePort(PORTS.next)
  const chatOk = await freePort(PORTS.chat)

  // Проверяем — вдруг уже кто-то успел запуститься (внешний процесс)
  const nextAlreadyRunning = await checkPortHttp(PORTS.next)
  const chatAlreadyRunning = await checkPortHttp(PORTS.chat)

  if (nextAlreadyRunning && chatAlreadyRunning) {
    console.log('[Startup] Next.js и чат-сервис уже запущены')
    appState.nextReady = true
    appState.chatReady = true
    return
  }

  // Запуск Next.js
  if (!nextAlreadyRunning) {
    if (!nextOk) {
      console.error(`[Startup] Порт ${PORTS.next} не удалось освободить, пропускаем Next.js`)
    } else {
      console.log(`[Startup] Запуск Next.js через ${bunCmd}...`)
      try {
        const nextProc = spawn(bunCmd, ['run', 'dev'], {
          cwd: WEB_DIR,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        })

        nextProc.stdout.on('data', (data) => {
          const output = data.toString().trim()
          console.log(`[Next.js] ${output}`)
          if (output.includes('Ready')) {
            appState.nextReady = true
          }
        })

        nextProc.stderr.on('data', (data) => {
          console.error(`[Next.js:ERR] ${data.toString().trim()}`)
        })

        nextProc.on('close', (code) => {
          console.log(`[Next.js] Завершён с кодом ${code}`)
          appState.nextReady = false
        })

        childProcesses.nextjs = nextProc
      } catch (err) {
        console.error(`[Startup] Ошибка запуска Next.js:`, err)
      }
    }
  } else {
    appState.nextReady = true
  }

  // Запуск чат-сервиса
  if (!chatAlreadyRunning) {
    if (!chatOk) {
      console.error(`[Startup] Порт ${PORTS.chat} не удалось освободить, пропускаем чат-сервис`)
    } else {
      console.log(`[Startup] Запуск чат-сервиса через ${bunCmd}...`)
      try {
        const chatProc = spawn(bunCmd, ['--hot', 'mini-services/chat-service/index.ts'], {
          cwd: WEB_DIR,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        })

        chatProc.stdout.on('data', (data) => {
          const output = data.toString().trim()
          console.log(`[Chat] ${output}`)
          if (output.includes('listening') || output.includes('Socket.IO')) {
            appState.chatReady = true
          }
        })

        chatProc.stderr.on('data', (data) => {
          console.error(`[Chat:ERR] ${data.toString().trim()}`)
        })

        chatProc.on('close', (code) => {
          console.log(`[Chat] Завершён с кодом ${code}`)
          appState.chatReady = false
        })

        childProcesses.chat = chatProc
      } catch (err) {
        console.error(`[Startup] Ошибка запуска чат-сервиса:`, err)
      }
    }
  } else {
    appState.chatReady = true
  }

  // Ждём готовности Next.js (макс 60 секунд)
  console.log('[Startup] Ожидание готовности Next.js...')
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await checkPortHttp(PORTS.next)) {
      appState.nextReady = true
      console.log('[Startup] Next.js готов!')
      break
    }
  }

  if (!appState.nextReady) {
    console.error('[Startup] Таймаут ожидания Next.js')
  }
}

// ==================== Управление Python-процессами ====================

function startPythonProcess(name, scriptPath, args = []) {
  if (childProcesses[name]) {
    return { success: false, message: `Процесс ${name} уже запущен` }
  }

  const pythonCmd = getPythonCommand()
  if (!pythonCmd) {
    return { success: false, message: 'Python не найден в системе' }
  }

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
    delete childProcesses[name]
    appState[`${name}Running`] = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python:stopped', { name, code })
    }
    showNotification(`${name} остановлен`, `Процесс завершён с кодом ${code}`)
  })

  childProcesses[name] = proc
  appState[`${name}Running`] = true
  sendStateToRenderer()
  return { success: true, pid: proc.pid }
}

function stopPythonProcess(name) {
  const proc = childProcesses[name]
  if (!proc) return { success: false, message: `Процесс ${name} не запущен` }
  proc.kill('SIGTERM')
  delete childProcesses[name]
  appState[`${name}Running`] = false
  sendStateToRenderer()
  return { success: true }
}

function stopAllProcesses() {
  Object.keys(childProcesses).forEach((name) => {
    const proc = childProcesses[name]
    if (proc) {
      try { proc.kill('SIGTERM') } catch {}
      delete childProcesses[name]
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
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: getAppIcon(),
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Загрузка Next.js
  mainWindow.loadURL(NEXT_URL)

  // Показать DevTools в режиме разработки
  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('close', (e) => {
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
        createTray()
      },
    },
    { type: 'separator' },
    {
      label: `Статус: ${getStatusText()}`,
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
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const cx = x - size / 2
      const cy = y - size / 2
      const dist = Math.sqrt(cx * cx + cy * cy)
      if (dist < size / 2 - 1) {
        canvas[idx] = 16
        canvas[idx + 1] = 185
        canvas[idx + 2] = 129
        canvas[idx + 3] = 255
      } else {
        canvas[idx + 3] = 0
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size }).toPNG()
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

  ipcMain.handle('python:start', (_, { name, script, args }) => {
    return startPythonProcess(name, script || PYTHON_PATHS[name], args || [])
  })
  ipcMain.handle('python:stop', (_, { name }) => stopPythonProcess(name))
  ipcMain.handle('python:stopAll', () => { stopAllProcesses(); return { success: true } })

  ipcMain.handle('app:getState', () => ({ ...appState }))
  ipcMain.handle('app:setConnectionStatus', (_, { status }) => {
    appState.connectionStatus = status
    sendStateToRenderer()
    createTray()
    return { success: true }
  })

  ipcMain.handle('shell:openExternal', (_, { url }) => shell.openExternal(url))
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getPaths', () => ({
    python: PYTHON_PATHS,
    web: WEB_DIR,
    app: app.getAppPath(),
    userData: app.getPath('userData'),
  }))
  ipcMain.handle('system:info', () => ({
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    pythonCommand: getPythonCommand(),
  }))
}

// ==================== Splash-окно загрузки ====================

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <html>
    <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0f1a;font-family:system-ui;color:#e2e8f0;">
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#10b981;margin-bottom:8px;">RemoteSupport</div>
        <div style="font-size:14px;color:#94a3b8;">Запуск серверов...</div>
        <div style="margin-top:20px;width:200px;height:4px;background:#1e293b;border-radius:4px;overflow:hidden;margin-left:auto;margin-right:auto;">
          <div style="width:40%;height:100%;background:#10b981;border-radius:4px;animation:load 1.5s ease-in-out infinite;">
            <style>@keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}</style>
          </div>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:16px;" id="status">Инициализация...</div>
        <script>
          const el = document.getElementById('status');
          setTimeout(() => el.textContent = 'Проверка портов...', 500);
          setTimeout(() => el.textContent = 'Запуск Next.js...', 1500);
          setTimeout(() => el.textContent = 'Запуск чат-сервиса...', 3000);
          setTimeout(() => el.textContent = 'Открытие приложения...', 5000);
        </script>
      </div>
    </body>
    </html>
  `)}`)

  return splash
}

// ==================== Жизненный цикл приложения ====================

app.whenReady().then(async () => {
  // Показать splash-экран
  const splash = createSplashWindow()

  // Запустить веб-сервисы
  try {
    await startWebServices()
  } catch (err) {
    console.error('[Startup] Критическая ошибка при запуске:', err)
  }

  // Закрыть splash
  if (splash && !splash.isDestroyed()) {
    splash.close()
  }

  // Создать основное окно (даже если Next.js не стартанул — покажем ошибку в окне)
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

process.on('SIGINT', () => { stopAllProcesses(); app.quit() })
process.on('SIGTERM', () => { stopAllProcesses(); app.quit() })