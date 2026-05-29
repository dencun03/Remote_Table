"""
Модуль базы данных для системы удалённой техподдержки

Улучшения:
- Использование bcrypt для безопасного хеширования паролей
- Защита от SQL-инъекций через параметризованные запросы
- Управление подключениями с автоматическим переподключением
- Логирование операций
"""

import bcrypt
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Dict, Any, Optional, Generator
import os
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация базы данных - рекомендуется вынести в переменные окружения
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", "5432")),
    "dbname": os.environ.get("DB_NAME", "remote_desktop"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", "LOXI")
}

# Глобальное хранилище подключения
_connection = None


def _get_password_hash(password: str) -> bytes:
    """Безопасное хеширование пароля с использованием bcrypt"""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode('utf-8'), salt)


def _verify_password(password: str, password_hash: bytes) -> bool:
    """Проверка пароля против bcrypt хеша"""
    if isinstance(password_hash, str):
        password_hash = password_hash.encode('utf-8')
    return bcrypt.checkpw(password.encode('utf-8'), password_hash)


@contextmanager
def get_connection() -> Generator:
    """
    Контекстный менеджер для безопасной работы с подключением к БД.
    Автоматически закрывает курсор и обрабатывает ошибки.

    Использование:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users")
            ...
    """
    global _connection
    conn = None
    try:
        if _connection is None or _connection.closed:
            logger.info("Создание нового подключения к БД...")
            conn = psycopg2.connect(**DB_CONFIG)
            _connection = conn
        else:
            conn = _connection

        yield conn

    except psycopg2.OperationalError as e:
        logger.error(f"Ошибка подключения к PostgreSQL: {e}")
        _connection = None
        raise
    except Exception as e:
        logger.error(f"Неожиданная ошибка при работе с БД: {e}")
        raise
    finally:
        pass  # Подключение управляется глобально


def init_db() -> bool:
    """
    Инициализация базы данных. Создаёт БД и таблицы если они не существуют.

    Returns:
        True если инициализация успешна, False в противном случае
    """
    logger.info("Начало инициализации базы данных...")

    try:
        # Подключение к системной БД postgres для создания новой БД
        sys_conn = psycopg2.connect(
            host=DB_CONFIG["host"],
            port=DB_CONFIG["port"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            dbname="postgres"
        )
        sys_conn.autocommit = True
        cur = sys_conn.cursor()

        # Проверка существования базы данных
        cur.execute(
            "SELECT 1 FROM pg_catalog.pg_database WHERE datname = %s",
            (DB_CONFIG["dbname"],)
        )
        exists = cur.fetchone()

        if not exists:
            cur.execute(f"CREATE DATABASE {DB_CONFIG['dbname']}")
            logger.info(f"База данных '{DB_CONFIG['dbname']}' создана")
        else:
            logger.info(f"База данных '{DB_CONFIG['dbname']}' уже существует")

        cur.close()
        sys_conn.close()

        # Создание таблиц в целевой БД
        with get_connection() as conn:
            cur = conn.cursor()

            # Таблица пользователей
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    email VARCHAR(100),
                    full_name VARCHAR(100),
                    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'specialist', 'admin')),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    last_login TIMESTAMP
                )
            """)

            # Таблица заявок на поддержку
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tickets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    specialist_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    category VARCHAR(50),
                    priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
                    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
                        'pending', 'in_progress', 'waiting_user', 'resolved', 'cancelled'
                    )),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    resolved_at TIMESTAMP
                )
            """)

            # Таблица логов сессий удалённого доступа
            cur.execute("""
                CREATE TABLE IF NOT EXISTS remote_sessions (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
                    client_id INTEGER REFERENCES users(id),
                    specialist_id INTEGER REFERENCES users(id),
                    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    ended_at TIMESTAMP,
                    client_ip VARCHAR(45),
                    events TEXT[] DEFAULT '{}'
                )
            """)

            # Таблица для хранения активных сессий ретранслятора
            cur.execute("""
                CREATE TABLE IF NOT EXISTS relay_sessions (
                    id SERIAL PRIMARY KEY,
                    session_key VARCHAR(64) UNIQUE NOT NULL,
                    client_id VARCHAR(50) NOT NULL,
                    server_id VARCHAR(50),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE
                )
            """)

            conn.commit()
            cur.close()

        logger.info("База данных успешно инициализирована")
        return True

    except Exception as e:
        logger.error(f"Ошибка инициализации БД: {e}")
        return False


def register_user(username: str, password: str, email: Optional[str] = None,
                  full_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Регистрация нового пользователя с валидацией.

    Args:
        username: Уникальное имя пользователя (3-50 символов)
        password: Пароль (минимум 8 символов)
        email: Email пользователя (опционально)
        full_name: Полное имя пользователя (опционально)

    Returns:
        Словарь с ключом 'success' (bool) и 'message' (str)
    """
    # Валидация данных
    username = username.strip()

    if len(username) < 3 or len(username) > 50:
        return {"success": False, "message": "Имя пользователя должно быть от 3 до 50 символов"}

    if len(password) < 8:
        return {"success": False, "message": "Пароль должен быть минимум 8 символов"}

    if not username.replace('_', '').replace('-', '').isalnum():
        return {"success": False, "message": "Имя пользователя может содержать только буквы, цифры, _ и -"}

    try:
        with get_connection() as conn:
            cur = conn.cursor()

            # Проверка уникальности имени пользователя
            cur.execute("SELECT id FROM users WHERE username = %s", (username,))
            if cur.fetchone():
                cur.close()
                return {"success": False, "message": "Пользователь с таким именем уже существует"}

            # Хеширование пароля и создание пользователя
            password_hash = _get_password_hash(password)

            cur.execute("""
                INSERT INTO users (username, password_hash, email, full_name, role)
                VALUES (%s, %s, %s, %s, 'user')
                RETURNING id, created_at
            """, (username, password_hash.decode('utf-8'), email, full_name))

            result = cur.fetchone()
            conn.commit()
            cur.close()

            logger.info(f"Зарегистрирован новый пользователь: {username}")
            return {
                "success": True,
                "message": f"Пользователь '{username}' успешно зарегистрирован",
                "user_id": result[0]
            }

    except Exception as e:
        logger.error(f"Ошибка регистрации пользователя {username}: {e}")
        return {"success": False, "message": "Внутренняя ошибка сервера"}


def authenticate_user(username: str, password: str) -> bool:
    """
    Аутентификация пользователя с использованием bcrypt.

    Args:
        username: Имя пользователя
        password: Пароль в открытом виде

    Returns:
        True если аутентификация успешна, False в противном случае
    """
    if not username or not password:
        return False

    try:
        with get_connection() as conn:
            cur = conn.cursor()

            cur.execute(
                "SELECT password_hash, is_active FROM users WHERE username = %s",
                (username,)
            )
            row = cur.fetchone()
            cur.close()

            if not row:
                logger.warning(f"Попытка входа несуществующего пользователя: {username}")
                return False

            password_hash, is_active = row

            if not is_active:
                logger.warning(f"Попытка входа заблокированного пользователя: {username}")
                return False

            # Обновление времени последнего входа
            cur = conn.cursor()
            cur.execute(
                "UPDATE users SET last_login = NOW() WHERE username = %s",
                (username,)
            )
            conn.commit()
            cur.close()

            return _verify_password(password, password_hash)

    except Exception as e:
        logger.error(f"Ошибка аутентификации пользователя {username}: {e}")
        return False


def get_user_info(username: str) -> Optional[Dict[str, Any]]:
    """
    Получение информации о пользователе.

    Args:
        username: Имя пользователя

    Returns:
        Словарь с данными пользователя или None если не найден
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("""
                SELECT id, username, email, full_name, role, is_active,
                       created_at, last_login
                FROM users WHERE username = %s
            """, (username,))

            row = cur.fetchone()
            cur.close()

            return dict(row) if row else None

    except Exception as e:
        logger.error(f"Ошибка получения данных пользователя {username}: {e}")
        return None


def update_user_password(username: str, current_password: str, new_password: str) -> Dict[str, Any]:
    """
    Изменение пароля пользователя с проверкой текущего пароля.

    Args:
        username: Имя пользователя
        current_password: Текущий пароль
        new_password: Новый пароль

    Returns:
        Словарь с результатом операции
    """
    # Валидация нового пароля
    if len(new_password) < 8:
        return {"success": False, "message": "Новый пароль должен быть минимум 8 символов"}

    # Проверка текущего пароля
    if not authenticate_user(username, current_password):
        return {"success": False, "message": "Неверный текущий пароль"}

    try:
        with get_connection() as conn:
            cur = conn.cursor()

            password_hash = _get_password_hash(new_password)

            cur.execute(
                "UPDATE users SET password_hash = %s WHERE username = %s",
                (password_hash.decode('utf-8'), username)
            )

            conn.commit()
            success = cur.rowcount > 0
            cur.close()

            if success:
                logger.info(f"Пароль пользователя {username} изменён")
                return {"success": True, "message": "Пароль успешно изменён"}
            else:
                return {"success": False, "message": "Пользователь не найден"}

    except Exception as e:
        logger.error(f"Ошибка смены пароля для {username}: {e}")
        return {"success": False, "message": "Внутренняя ошибка сервера"}


def create_ticket(user_id: int, title: str, description: str,
                  category: Optional[str] = None, priority: int = 2) -> Optional[int]:
    """
    Создание новой заявки на поддержку.

    Args:
        user_id: ID пользователя
        title: Заголовок заявки
        description: Описание проблемы
        category: Категория проблемы
        priority: Приоритет (1-высокий, 5-низкий)

    Returns:
        ID созданной заявки или None при ошибке
    """
    if not 1 <= priority <= 5:
        priority = 2

    try:
        with get_connection() as conn:
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO tickets (user_id, title, description, category, priority)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (user_id, title, description, category, priority))

            ticket_id = cur.fetchone()[0]
            conn.commit()
            cur.close()

            logger.info(f"Создана заявка #{ticket_id}: {title}")
            return ticket_id

    except Exception as e:
        logger.error(f"Ошибка создания заявки: {e}")
        return None


def get_pending_tickets(specialist_id: Optional[int] = None) -> list:
    """
    Получение списка ожидающих заявок.

    Args:
        specialist_id: ID специалиста для фильтрации назначенных заявок

    Returns:
        Список словарей с данными заявок
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            if specialist_id:
                cur.execute("""
                    SELECT t.*, u.username as user_name
                    FROM tickets t
                    JOIN users u ON t.user_id = u.id
                    WHERE t.status = 'pending' AND t.specialist_id = %s
                    ORDER BY t.priority ASC, t.created_at ASC
                """, (specialist_id,))
            else:
                cur.execute("""
                    SELECT t.*, u.username as user_name
                    FROM tickets t
                    JOIN users u ON t.user_id = u.id
                    WHERE t.status = 'pending' AND t.specialist_id IS NULL
                    ORDER BY t.priority ASC, t.created_at ASC
                """)

            tickets = [dict(row) for row in cur.fetchall()]
            cur.close()

            return tickets

    except Exception as e:
        logger.error(f"Ошибка получения заявок: {e}")
        return []


def assign_ticket(ticket_id: int, specialist_id: int) -> bool:
    """Назначение заявки специалисту"""
    try:
        with get_connection() as conn:
            cur = conn.cursor()

            cur.execute("""
                UPDATE tickets
                SET specialist_id = %s, status = 'in_progress', updated_at = NOW()
                WHERE id = %s AND status = 'pending'
            """, (specialist_id, ticket_id))

            conn.commit()
            success = cur.rowcount > 0
            cur.close()

            if success:
                logger.info(f"Заявка #{ticket_id} назначена специалисту #{specialist_id}")

            return success

    except Exception as e:
        logger.error(f"Ошибка назначения заявки #{ticket_id}: {e}")
        return False


def close_db():
    """Закрытие соединения с БД при завершении работы приложения"""
    global _connection
    if _connection and _connection.closed == 0:
        _connection.close()
        logger.info("Соединение с БД закрыто")
        _connection = None