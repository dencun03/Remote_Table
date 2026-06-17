# Remote Support System — Electron

Современное кроссплатформенное приложение для системы удалённой технической поддержки.

## Возможности

### Клиентское приложение
- Подключение к специалисту поддержки
- Создание и отслеживание заявок
- Безопасный запрос доступа к экрану
- Настройки подключения

### Панель специалиста
- Просмотр списка заявок
- Удалённое подключение к клиенту
- Просмотр и управление экраном
- Чат с клиентом
- Быстрые действия (Ctrl+Alt+Del, Диспетчер задач и т.д.)
- Статистика сессии

## Установка

### Требования
- Node.js 18+
- npm или yarn
- Python 3.8+ (для backend)
- PostgreSQL (для базы данных)

### Шаг 1: Установка зависимостей Electron

```bash
cd electron
npm install
```

### Шаг 2: Настройка Python backend

```bash
cd ..
pip install -r requirements.txt
python main.py init  # Инициализация БД
```

### Шаг 3: Запуск

```bash
# Режим клиента
cd electron
npm start

# Режим специалиста
cd electron
npm start -- --specialist
```

## Структура проекта

```
electron/
├── package.json          # Зависимости и скрипты
├── src/
│   ├── main.js           # Главный процесс Electron
│   ├── preload.js       # API для рендерера
│   └── renderer/
│       ├── client.html   # Интерфейс клиента
│       └── specialist.html # Интерфейс специалиста
└── assets/
    └── icons/            # Иконки приложения
```

## Режимы запуска

```bash
npm start              # Клиент (по умолчанию)
npm start -- --specialist  # Панель специалиста
npm run dev             # Режим разработки (с DevTools)
```

## Сборка приложения

```bash
# Windows
npm run build:win

# Linux
npm run build:linux

# macOS
npm run build:mac
```

## Интеграция с Python backend

Приложение Electron выступает как frontend и взаимодействует с Python backend через:

1. **IPC (Inter-Process Communication)** — основной канал
2. **REST API** — для HTTP запросов к backend
3. **WebSocket** — для real-time коммуникации

### API endpoints backend

```
POST /api/auth/login     # Вход
POST /api/auth/register  # Регистрация
GET  /api/tickets        # Список заявок
POST /api/tickets        # Создание заявки
GET  /api/sessions       # Активные сессии
POST /api/sessions       # Начать сессию
```

## Дизайн

Интерфейс создан с использованием:
- CSS3 с кастомными переменными
- Современная цветовая схема (Dark theme)
- Адаптивный дизайн
- Плавные анимации

## Безопасность

- Контекстная изоляция между процессами
- Предварительная загрузка API
- Безопасная передача данных
- Запрос разрешения на доступ к экрану

## Разработка

### Добавление функциональности

1. Добавьте IPC обработчик в `main.js`:
```javascript
ipcMain.handle('my-action', async (event, args) => {
    // Ваша логика
    return { success: true };
});
```

2. Используйте в рендерере:
```javascript
const result = await window.electronAPI.myAction(args);
```

## Лицензия

MIT