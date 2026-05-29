"""
Главный файл запуска системы удалённой техподдержки

Позволяет запустить любой компонент системы:
- Реле-сервер (маршрутизация соединений)
- Сервер специалиста (приложение для поддержки)
- Клиент (приложение пользователя)
- GUI (аутентификация и управление)

Использование:
    python main.py [компонент]

Примеры:
    python main.py relay       # Запуск реле-сервера
    python main.py specialist  # Запуск специалиста
    python main.py client      # Запуск клиента
    python main.py gui         # Запуск GUI аутентификации
    python main.py init        # Инициализация БД
    python main.py --help      # Справка
"""

import sys
import argparse
from pathlib import Path

# Добавление корневой директории в путь
sys.path.insert(0, str(Path(__file__).parent))


def print_banner():
    """Вывод баннера приложения"""
    banner = """
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║     СИСТЕМА УДАЛЁННОЙ ТЕХНИЧЕСКОЙ ПОДДЕРЖКИ                         ║
║     Remote Technical Support System                                 ║
║                                                                      ║
║     Версия 1.0.0                                                     ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    """
    print(banner)


def init_database():
    """Инициализация базы данных"""
    from core.database import init_database, db

    print("Инициализация базы данных...")
    if db.init_database():
        print("✓ База данных успешно инициализирована")
        return True
    else:
        print("✗ Ошибка инициализации базы данных")
        return False


def run_relay():
    """Запуск реле-сервера"""
    from network.relay_server import run_relay_server

    print("\nЗапуск реле-сервера...")
    print("Реле-сервер принимает соединения от клиентов и специалистов,")
    print("маршрутизирует данные между ними через NAT.\n")

    try:
        run_relay_server()
    except KeyboardInterrupt:
        print("\nРеле-сервер остановлен")


def run_specialist():
    """Запуск приложения специалиста"""
    from specialist.specialist_app import run_specialist

    print("\nЗапуск приложения специалиста...")
    print("Приложение специалиста позволяет:")
    print("  - Подключаться к удалённым клиентам")
    print("  - Видеть экран клиента")
    print("  - Управлять мышью и клавиатурой\n")

    try:
        run_specialist()
    except KeyboardInterrupt:
        print("\nПриложение специалиста остановлено")


def run_client():
    """Запуск клиентского приложения"""
    from client.client_app import run_client

    print("\nЗапуск клиентского приложения...")
    print("Клиентское приложение позволяет:")
    print("  - Подключаться к специалисту поддержки")
    print("  - Делиться управлением своим компьютером\n")

    try:
        run_client()
    except KeyboardInterrupt:
        print("\nКлиентское приложение остановлено")


def run_gui():
    """Запуск GUI приложения"""
    from gui.auth import run_auth

    print("\nЗапуск графического интерфейса...")

    try:
        run_auth()
    except KeyboardInterrupt:
        print("\nGUI остановлен")


def run_all():
    """Запуск всех компонентов (режим разработки)"""
    import threading

    from core.database import init_database

    # Инициализация БД
    print("Инициализация базы данных...")
    if not init_database():
        print("✗ Ошибка инициализации БД")
        return

    threads = []

    # Реле-сервер
    print("\nЗапуск реле-сервера...")
    relay_thread = threading.Thread(target=run_relay, daemon=True)
    relay_thread.start()
    threads.append(relay_thread)

    # Ожидание запуска реле
    import time
    time.sleep(1)

    # Специалист
    print("Запуск приложения специалиста...")
    specialist_thread = threading.Thread(target=run_specialist, daemon=True)
    specialist_thread.start()
    threads.append(specialist_thread)

    # Клиент
    print("Запуск клиентского приложения...")
    client_thread = threading.Thread(target=run_client, daemon=True)
    client_thread.start()
    threads.append(client_thread)

    print("""
╔════════════════════════════════════════════════════════════════════╗
║  Все компоненты запущены!                                          ║
║                                                                    ║
║  Для остановки нажмите Ctrl+C в каждом окне/терминале             ║
╚════════════════════════════════════════════════════════════════════╝
    """)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nОстановка всех компонентов...")


def main():
    """Главная функция"""
    parser = argparse.ArgumentParser(
        description="Система удалённой технической поддержки",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры использования:
  %(prog)s relay       Запуск реле-сервера
  %(prog)s specialist   Запуск приложения специалиста
  %(prog)s client       Запуск клиентского приложения
  %(prog)s gui          Запуск графического интерфейса
  %(prog)s init         Инициализация базы данных
  %(prog)s all          Запуск всех компонентов
        """
    )

    parser.add_argument(
        'component',
        nargs='?',
        default='menu',
        choices=['relay', 'specialist', 'client', 'gui', 'init', 'all', 'menu'],
        help='Компонент для запуска'
    )

    parser.add_argument(
        '-c', '--config',
        help='Путь к файлу конфигурации'
    )

    parser.add_argument(
        '-v', '--version',
        action='version',
        version='%(prog)s 1.0.0'
    )

    args = parser.parse_args()

    # Вывод баннера
    print_banner()

    # Обработка команды
    commands = {
        'relay': run_relay,
        'specialist': run_specialist,
        'client': run_client,
        'gui': run_gui,
        'init': init_database,
        'all': run_all,
    }

    if args.component == 'menu':
        # Интерактивное меню
        show_menu()
    else:
        # Запуск выбранного компонента
        commands[args.component]()


def show_menu():
    """Интерактивное меню выбора компонента"""
    print("""
Выберите действие:

  1. 🚀 Реле-сервер
     Маршрутизация соединений (обязателен для работы)

  2. 👨‍💻 Приложение специалиста
     Для сотрудников поддержки

  3. 👤 Клиентское приложение
     Для пользователей

  4. 🖥️ Графический интерфейс
     Аутентификация и управление

  5. 🗄️ Инициализировать базу данных
     Создать таблицы

  6. 🔄 Запустить всё
     Все компоненты вместе (режим разработки)

  0. ❌ Выход
    """)

    choice = input("\nВаш выбор: ").strip()

    menu_actions = {
        '1': run_relay,
        '2': run_specialist,
        '3': run_client,
        '4': run_gui,
        '5': init_database,
        '6': run_all,
        '0': lambda: sys.exit(0),
    }

    action = menu_actions.get(choice)
    if action:
        action()
    else:
        print("Неизвестная команда")
        show_menu()


if __name__ == "__main__":
    main()