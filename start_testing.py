"""
Быстрый запуск всех компонентов для тестирования

Использование:
    python start_testing.py

Откроет 3 терминала/процесса для каждого компонента системы.
"""

import subprocess
import sys
import os
import time
import platform

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def print_banner():
    banner = """
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║     СИСТЕМА УДАЛЁННОЙ ТЕХНИЧЕСКОЙ ПОДДЕРЖКИ                  ║
║                                                                ║
║     Быстрый запуск для тестирования                            ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    """
    print(banner)

def check_prerequisites():
    """Проверка готовности системы"""
    print("Проверка prerequisites...\n")

    errors = []

    # Проверка Python
    if sys.version_info.major < 3 or (sys.version_info.major == 3 and sys.version_info.minor < 8):
        errors.append("Требуется Python 3.8+")
    else:
        print(f"✓ Python {sys.version_info.major}.{sys.version_info.minor} - OK")

    # Проверка зависимостей
    try:
        import psycopg2
        print("✓ psycopg2 - OK")
    except ImportError:
        errors.append("psycopg2 не установлен (pip install psycopg2-binary)")

    try:
        import cv2
        print("✓ opencv - OK")
    except ImportError:
        errors.append("opencv не установлен (pip install opencv-python-headless)")

    try:
        import bcrypt
        print("✓ bcrypt - OK")
    except ImportError:
        errors.append("bcrypt не установлен (pip install bcrypt)")

    try:
        import customtkinter
        print("✓ customtkinter - OK")
    except ImportError:
        errors.append("customtkinter не установлен (pip install customtkinter)")

    try:
        import pyautogui
        print("✓ pyautogui - OK")
    except ImportError:
        errors.append("pyautogui не установлен (pip install pyautogui)")

    if errors:
        print("\n⚠️  Обнаружены проблемы:")
        for error in errors:
            print(f"  - {error}")
        print("\nУстановите зависимости:")
        print("  pip install -r requirements.txt")
        return False

    return True

def initialize_database():
    """Инициализация базы данных"""
    print("\nИнициализация базы данных...")

    try:
        import database
        if database.init_db():
            print("✓ База данных инициализирована")
            return True
        else:
            print("⚠️ Не удалось инициализировать базу данных")
            print("  Проверьте что PostgreSQL запущен")
            return False
    except Exception as e:
        print(f"⚠️ Ошибка инициализации БД: {e}")
        print("  Проверьте что PostgreSQL запущен и настройки в .env корректны")
        return False

def start_relay_server():
    """Запуск реле-сервера"""
    print("\n" + "="*60)
    print("ЗАПУСК РЕЛЕ-СЕРВЕРА")
    print("="*60)
    print("Роль: Маршрутизация соединений между клиентом и специалистом")
    print("Порт: 6969")
    print("-"*60)

    try:
        import relay_server
        relay_server.main()
    except KeyboardInterrupt:
        print("\nРеле-сервер остановлен")
    except Exception as e:
        print(f"Ошибка: {e}")

def start_specialist_server():
    """Запуск сервера специалиста"""
    print("\n" + "="*60)
    print("ЗАПУСК СЕРВЕРА СПЕЦИАЛИСТА")
    print("="*60)
    print("Роль: Ожидание подключения клиентов и управление")
    print("-"*60)

    try:
        import server
        server.main()
    except KeyboardInterrupt:
        print("\nСервер специалиста остановлен")
    except Exception as e:
        print(f"Ошибка: {e}")

def start_client():
    """Запуск клиента"""
    print("\n" + "="*60)
    print("ЗАПУСК КЛИЕНТА")
    print("="*60)
    print("Роль: Подключение к специалисту и демонстрация экрана")
    print("-"*60)

    try:
        import client
        client.main()
    except KeyboardInterrupt:
        print("\nКлиент остановлен")
    except Exception as e:
        print(f"Ошибка: {e}")

def main():
    clear_screen()
    print_banner()

    # Проверка prerequisites
    if not check_prerequisites():
        print("\nДля автоматической установки запустите:")
        print("  python setup_local.py")
        return

    # Инициализация БД
    if not initialize_database():
        response = input("\nПродолжить без БД? (y/n): ")
        if response.lower() != 'y':
            return

    print("\n" + "="*60)
    print("ВЫБЕРИТЕ РЕЖИМ ЗАПУСКА")
    print("="*60)
    print("""
1. Полный запуск (все 3 компонента)
   - Реле-сервер
   - Сервер специалиста
   - Клиент

2. Только реле-сервер
   (для развёртывания на VPS)

3. Только сервер специалиста
   (подключается к существующему реле)

4. Только клиент
   (подключается к существующему реле)

5. Запуск через GUI
   (auth_gui.py - регистрация и управление)

0. Выход
    """)

    choice = input("\nВаш выбор: ").strip()

    if choice == '1':
        print("\nЗапуск всех компонентов...")
        print("Используйте Ctrl+C для остановки каждого компонента")

        # Запуск в отдельных потоках
        import threading

        threads = [
            threading.Thread(target=start_relay_server, name="RelayServer"),
            threading.Thread(target=start_specialist_server, name="SpecialistServer"),
            threading.Thread(target=start_client, name="Client")
        ]

        for t in threads:
            t.daemon = True
            t.start()
            time.sleep(0.5)

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nОстановка всех компонентов...")

    elif choice == '2':
        start_relay_server()

    elif choice == '3':
        start_specialist_server()

    elif choice == '4':
        start_client()

    elif choice == '5':
        try:
            import auth_gui
            auth_gui.main()
        except Exception as e:
            print(f"Ошибка запуска GUI: {e}")

    elif choice == '0':
        print("Выход")
        return

    else:
        print("Неизвестный выбор")

if __name__ == "__main__":
    main()
