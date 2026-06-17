#!/bin/bash
cd "$(dirname "$0")"

echo "============================================"
echo "  REMOTETABLE — Удалённая техподдержка"
echo "============================================"
echo ""

# Проверка bun
if ! command -v bun &> /dev/null; then
    echo "ОШИБКА: Bun не установлен!"
    echo ""
    echo "Установите командой:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    echo ""
    exit 1
fi

# Установка зависимостей
echo "[1/2] Проверка зависимостей..."
if [ ! -d "node_modules" ]; then
    echo "Установка зависимостей основного проекта..."
    bun install
fi

if [ ! -d "mini-services/chat-service/node_modules" ]; then
    echo "Установка зависимостей чат-сервиса..."
    cd mini-services/chat-service && bun install && cd ../..
fi

mkdir -p db

echo ""
echo "[2/2] Запуск серверов..."
echo ""
echo "Веб-интерфейс:  http://localhost:3000"
echo "Чат-сервис:    порт 3004"
echo ""
echo "Нажмите Ctrl+C для остановки всех серверов."
echo "============================================"

# Запуск в фоне
bun run dev &
DEV_PID=$!

sleep 3

bun run chat &
CHAT_PID=$!

echo ""
echo "Готово! Откройте http://localhost:3000 в браузере."
echo ""

# Очистка при выходе
trap "kill $DEV_PID $CHAT_PID 2>/dev/null; echo 'Серверы остановлены.'" EXIT

# Ожидание
wait