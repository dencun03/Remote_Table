"""
Скрипт автоматической настройки для локального тестирования

Запустите: python setup_local.py
"""

import os
import sys
import subprocess
import platform

def print_step(step, message):
    print(f"\n{'='*60}")
    print(f"ШАГ {step}: {message}")
    print('='*60)

def check_python():
    """Проверка версии Python"""
    print_step(1, "Проверка Python")
    version = sys.version_info
    print(f"Python версия: {version.major}.{version.minor}.{version.micro}")

    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print("❌ Требуется Python 3.8 или выше!")
        return False
    print("✅ Python версия подходит")
    return True

def install_dependencies():
    """Установка зависимостей"""
    print_step(2, "Установка зависимостей Python")

    packages = [
        'psycopg2-binary',
        'bcrypt',
        'customtkinter',
        'pyautogui',
        'keyboard',
        'pyperclip',
        'opencv-python-headless',
        'numpy',
        'Pillow'
    ]

    print("Установка пакетов...")
    for pkg in packages:
        print(f"  - {pkg}")

    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install'] + packages)
        print("✅ Все зависимости установлены")
        return True
    except Exception as e:
        print(f"❌ Ошибка установки: {e}")
        return False

def check_postgresql():
    """Проверка PostgreSQL"""
    print_step(3, "Проверка PostgreSQL")

    system = platform.system()

    try:
        # Попытка подключения к PostgreSQL
        import psycopg2
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            user='postgres',
            password='postgres',
            dbname='postgres'
        )
        conn.close()
        print("✅ PostgreSQL подключен и работает")
        return True
    except psycopg2.OperationalError as e:
        print(f"⚠️  Не удалось подключиться к PostgreSQL: {e}")
        print("\nДля установки PostgreSQL:")
        if system == 'Windows':
            print("  Скачайте с https://www.postgresql.org/download/windows/")
            print("  Или используйте: winget install PostgreSQL.PostgreSQL")
        elif system == 'Linux':
            print("  sudo apt update && sudo apt install postgresql postgresql-contrib")
            print("  sudo systemctl start postgresql")
        elif system == 'Darwin':
            print("  brew install postgresql")
            print("  brew services start postgresql")
        return False
    except ImportError:
        print("❌ psycopg2 не установлен")
        return False

def setup_database():
    """Настройка базы данных"""
    print_step(4, "Настройка базы данных")

    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

        # Подключение к postgres для создания БД
        try:
            conn = psycopg2.connect(
                host='localhost',
                port=5432,
                user='postgres',
                password='postgres'
            )
        except:
            # Пробуем без пароля
            try:
                conn = psycopg2.connect(
                    host='localhost',
                    port=5432,
                    user='postgres'
                )
            except Exception as e:
                print(f"❌ Не удалось подключиться к PostgreSQL: {e}")
                print("Проверьте что PostgreSQL запущен и настройте пароль:")
                print("  sudo -u postgres psql")
                print("  ALTER USER postgres PASSWORD 'postgres';")
                return False

        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        # Проверка существования БД
        cur.execute("SELECT 1 FROM pg_database WHERE datname = 'remote_desktop'")
        exists = cur.fetchone()

        if not exists:
            cur.execute("CREATE DATABASE remote_desktop")
            print("✅ База данных 'remote_desktop' создана")
        else:
            print("✅ База данных 'remote_desktop' уже существует")

        cur.close()
        conn.close()

        # Инициализация таблиц
        print("Создание таблиц...")
        import database
        if database.init_db():
            print("✅ Таблицы созданы успешно")
            return True
        else:
            print("❌ Ошибка создания таблиц")
            return False

    except Exception as e:
        print(f"❌ Ошибка настройки БД: {e}")
        return False

def create_config():
    """Создание конфигурации"""
    print_step(5, "Создание конфигурации")

    config_content = '''# Конфигурация для локального тестирования
DB_HOST=localhost
DB_PORT=5432
DB_NAME=remote_desktop
DB_USER=postgres
DB_PASSWORD=postgres

RELAY_HOST=localhost
RELAY_PORT=6969
'''

    with open('.env', 'w') as f:
        f.write(config_content)

    print("✅ Файл .env создан")
    return True

def test_components():
    """Тестирование компонентов"""
    print_step(6, "Тестирование компонентов")

    try:
        # Тест базы данных
        import database
        if database.init_db():
            print("✅ База данных: OK")
        else:
            print("❌ База данных: ОШИБКА")
            return False

        # Тест импорта модулей
        try:
            import server
            print("✅ Server модуль: OK")
        except Exception as e:
            print(f"❌ Server модуль: {e}")

        try:
            import client
            print("✅ Client модуль: OK")
        except Exception as e:
            print(f"❌ Client модуль: {e}")

        try:
            import relay_server
            print("✅ Relay Server модуль: OK")
        except Exception as e:
            print(f"❌ Relay Server модуль: {e}")

        return True

    except Exception as e:
        print(f"❌ Ошибка тестирования: {e}")
        return False

def main():
    print("""
╔═══════════════════════════════════════════════════════════╗
║   НАСТРОЙКА ЛОКАЛЬНОГО СЕРВЕРА УДАЛЁННОГО ДОСТУПА     ║
║                                                           ║
║   Этот скрипт подготовит ваш компьютер для тестирования  ║
║   системы удалённой технической поддержки                   ║
╚═══════════════════════════════════════════════════════════╝
    """)

    # Последовательная установка
    results = []

    results.append(("Python", check_python()))
    results.append(("Зависимости", install_dependencies()))
    results.append(("PostgreSQL", check_postgresql()))
    results.append(("База данных", setup_database()))
    results.append(("Конфигурация", create_config()))
    results.append(("Тестирование", test_components()))

    # Итоговый отчёт
    print("\n" + "="*60)
    print("РЕЗУЛЬТАТЫ УСТАНОВКИ")
    print("="*60)

    all_ok = True
    for name, result in results:
        status = "✅" if result else "❌"
        print(f"  {status} {name}")
        if not result and name not in ["PostgreSQL"]:  # PostgreSQL может отсутствовать
            all_ok = False

    print("\n" + "="*60)
    if all_ok:
        print("""
🎉 Установка завершена успешно!

Следующие шаги для запуска:

1. ЗАПУСК РЕЛЕ-СЕРВЕРА (в отдельном терминале):
   python relay_server.py

2. ЗАПУСК СЕРВЕРА СПЕЦИАЛИСТА (в отдельном терминале):
   python server.py

3. ЗАПУСК КЛИЕНТА (в отдельном терминале):
   python client.py

4. ИЛИ запуск GUI аутентификации:
   python auth_gui.py
   (для регистрации пользователей и входа)

Для остановки нажмите Ctrl+C в каждом терминале.
        """)
    else:
        print("""
⚠️  Установка завершена с предупреждениями.

Проверьте сообщения выше и установите недостающие компоненты.
        """)

if __name__ == "__main__":
    main()
