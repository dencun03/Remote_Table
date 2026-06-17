@echo off
chcp 65001 >nul
title REMOTETABLE - Запуск
echo ============================================
echo   REMOTETABLE — Удалённая техподдержка
echo ============================================
echo.

cd /d "%~dp0"

echo [1/2] Проверка зависимостей...
where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Bun не установлен!
    echo.
    echo Установите Bun командой в PowerShell:
    echo   powershell -c "irm bun.sh/install.ps1 ^| iex"
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Установка зависимостей основного проекта...
    bun install
)

if not exist "mini-services\chat-service\node_modules" (
    echo Установка зависимостей чат-сервиса...
    cd mini-services\chat-service
    bun install
    cd ..\..
)

if not exist "db" (
    mkdir db
)

echo.
echo [2/2] Запуск серверов...
echo.
echo Веб-интерфейс:  http://localhost:3000
echo Чат-сервис:    порт 3004
echo.
echo Закройте это окно для остановки всех серверов.
echo ============================================

start "REMOTETABLE Web" cmd /k "cd /d "%~dp0" && bun run dev"
timeout /t 3 /nobreak >nul
start "REMOTABLE Chat" cmd /k "cd /d "%~dp0" && bun run chat"

echo.
echo Готово! Откройте http://localhost:3000 в браузере.
echo.
pause