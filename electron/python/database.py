"""
Модуль работы с базой данных

Предоставляет унифицированный интерфейс для работы с PostgreSQL:
- Управление пользователями
- Управление заявками на поддержку
- Логирование сессий
"""

import bcrypt
import psycopg2
from psycopg2.extras import RealDictCursor, DictCursor
from contextlib import contextmanager
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid

from core.config import config, DatabaseConfig
from core.logging_config import get_logger, log_operation, log_error

logger = get_logger('database')


class DatabaseManager:
    """
    Менеджер базы данных с поддержкой пула соединений
    """

    def __init__(self, db_config: DatabaseConfig = None):
        self.config = db_config or config.database
        self._connection = None

    @property
    def connection_params(self) -> dict:
        """Параметры подключения к БД"""
        return {
            'host': self.config.host,
            'port': self.config.port,
            'dbname': self.config.name,
            'user': self.config.user,
            'password': self.config.password,
            'connect_timeout': self.config.connection_timeout,
        }

    @contextmanager
    def get_connection(self):
        """
        Контекстный менеджер для работы с подключением к БД.
        Автоматически закрывает курсор и обрабатывает ошибки.
        """
        conn = None
        try:
            conn = psycopg2.connect(**self.connection_params)
            yield conn
        except psycopg2.OperationalError as e:
            logger.error(f"Ошибка подключения к БД: {e}")
            raise
        finally:
            if conn:
                conn.close()

    def init_database(self) -> bool:
        """
        Инициализация структуры базы данных.
        Создаёт все необходимые таблицы.

        Returns:
            True при успешной инициализации
        """
        try:
            # Подключение к системной БД для создания новой
            sys_params = self.connection_params.copy()
            sys_params['dbname'] = 'postgres'

            conn = psycopg2.connect(**sys_params)
            conn.autocommit = True
            cur = conn.cursor()

            # Проверка существования БД
            cur.execute(
                "SELECT 1 FROM pg_catalog.pg_database WHERE datname = %s",
                (self.config.name,)
            )
            if not cur.fetchone():
                cur.execute(f"CREATE DATABASE {self.config.name}")
                logger.info(f"База данных '{self.config.name}' создана")

            cur.close()
            conn.close()

            # Создание таблиц
            with self.get_connection() as conn:
                cur = conn.cursor()

                # Таблица пользователей
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id SERIAL PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        email VARCHAR(100) UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'specialist', 'admin')),
                        is_active BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP DEFAULT NOW(),
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
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        resolved_at TIMESTAMP
                    )
                """)

                # Таблица сессий удалённого доступа
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sessions (
                        id SERIAL PRIMARY KEY,
                        ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
                        client_user_id INTEGER REFERENCES users(id),
                        specialist_user_id INTEGER REFERENCES users(id),
                        client_ip VARCHAR(45),
                        started_at TIMESTAMP DEFAULT NOW(),
                        ended_at TIMESTAMP,
                        duration_seconds INTEGER,
                        actions_log TEXT[]
                    )
                """)

                # Таблица логов действий
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS action_logs (
                        id SERIAL PRIMARY KEY,
                        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
                        user_id INTEGER REFERENCES users(id),
                        action_type VARCHAR(50),
                        details JSONB,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)

                conn.commit()
                cur.close()

            logger.info("База данных успешно инициализирована")
            return True

        except Exception as e:
            log_error(e, "init_database", logger)
            return False

    # ==================== Пользователи ====================

    def create_user(
        self,
        username: str,
        password: str,
        email: str = None,
        role: str = 'user'
    ) -> Dict[str, Any]:
        """
        Создание нового пользователя.

        Args:
            username: Имя пользователя
            password: Пароль (будет хеширован)
            email: Email (опционально)
            role: Роль ('user', 'specialist', 'admin')

        Returns:
            Словарь с результатом операции
        """
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                # Проверка уникальности
                cur.execute("SELECT id FROM users WHERE username = %s", (username,))
                if cur.fetchone():
                    return {'success': False, 'message': 'Пользователь уже существует'}

                if email:
                    cur.execute("SELECT id FROM users WHERE email = %s", (email,))
                    if cur.fetchone():
                        return {'success': False, 'message': 'Email уже используется'}

                # Хеширование пароля
                password_hash = self._hash_password(password)

                # Создание пользователя
                cur.execute("""
                    INSERT INTO users (username, password_hash, email, role)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, created_at
                """, (username, password_hash, email, role))

                result = cur.fetchone()
                conn.commit()
                cur.close()

                log_operation(f"Создан пользователь {username}", status="success", logger=logger)

                return {
                    'success': True,
                    'message': f'Пользователь {username} создан',
                    'user_id': result[0]
                }

        except Exception as e:
            log_error(e, "create_user", logger)
            return {'success': False, 'message': 'Ошибка создания пользователя'}

    def authenticate_user(self, username: str, password: str) -> bool:
        """
        Аутентификация пользователя.

        Args:
            username: Имя пользователя
            password: Пароль

        Returns:
            True если аутентификация успешна
        """
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                cur.execute(
                    "SELECT password_hash, is_active FROM users WHERE username = %s",
                    (username,)
                )
                row = cur.fetchone()
                cur.close()

                if not row:
                    return False

                password_hash, is_active = row

                if not is_active:
                    return False

                # Обновление времени входа
                cur = conn.cursor()
                cur.execute(
                    "UPDATE users SET last_login = NOW() WHERE username = %s",
                    (username,)
                )
                conn.commit()
                cur.close()

                return self._verify_password(password, password_hash)

        except Exception as e:
            log_error(e, "authenticate_user", logger)
            return False

    def get_user(self, username: str = None, user_id: int = None) -> Optional[Dict[str, Any]]:
        """
        Получение данных пользователя.

        Args:
            username: Имя пользователя
            user_id: ID пользователя

        Returns:
            Словарь с данными пользователя или None
        """
        try:
            with self.get_connection() as conn:
                cur = conn.cursor(cursor_factory=RealDictCursor)

                if username:
                    cur.execute(
                        """SELECT id, username, email, role, is_active, created_at, last_login
                           FROM users WHERE username = %s""",
                        (username,)
                    )
                elif user_id:
                    cur.execute(
                        """SELECT id, username, email, role, is_active, created_at, last_login
                           FROM users WHERE id = %s""",
                        (user_id,)
                    )
                else:
                    return None

                row = cur.fetchone()
                cur.close()

                return dict(row) if row else None

        except Exception as e:
            log_error(e, "get_user", logger)
            return None

    def update_user_password(
        self,
        user_id: int,
        new_password: str
    ) -> bool:
        """Обновление пароля пользователя"""
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()
                password_hash = self._hash_password(new_password)

                cur.execute(
                    "UPDATE users SET password_hash = %s WHERE id = %s",
                    (password_hash, user_id)
                )
                conn.commit()
                success = cur.rowcount > 0
                cur.close()

                if success:
                    log_operation(f"Обновлён пароль пользователя #{user_id}", logger=logger)

                return success

        except Exception as e:
            log_error(e, "update_user_password", logger)
            return False

    # ==================== Заявки ====================

    def create_ticket(
        self,
        user_id: int,
        title: str,
        description: str,
        category: str = None,
        priority: int = 2
    ) -> Optional[int]:
        """
        Создание новой заявки на поддержку.

        Args:
            user_id: ID пользователя
            title: Заголовок
            description: Описание проблемы
            category: Категория
            priority: Приоритет (1-5)

        Returns:
            ID созданной заявки
        """
        try:
            with self.get_connection() as conn:
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
            log_error(e, "create_ticket", logger)
            return None

    def get_pending_tickets(self, specialist_id: int = None) -> List[Dict[str, Any]]:
        """
        Получение списка ожидающих заявок.

        Args:
            specialist_id: ID специалиста для фильтрации

        Returns:
            Список заявок
        """
        try:
            with self.get_connection() as conn:
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
            log_error(e, "get_pending_tickets", logger)
            return []

    def assign_ticket(self, ticket_id: int, specialist_id: int) -> bool:
        """Назначение заявки специалисту"""
        try:
            with self.get_connection() as conn:
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
            log_error(e, "assign_ticket", logger)
            return False

    def resolve_ticket(self, ticket_id: int) -> bool:
        """Отметка заявки как решённой"""
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                cur.execute("""
                    UPDATE tickets
                    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
                    WHERE id = %s
                """, (ticket_id,))

                conn.commit()
                success = cur.rowcount > 0
                cur.close()

                if success:
                    logger.info(f"Заявка #{ticket_id} решена")

                return success

        except Exception as e:
            log_error(e, "resolve_ticket", logger)
            return False

    # ==================== Сессии ====================

    def create_session(
        self,
        ticket_id: int = None,
        client_user_id: int = None,
        specialist_user_id: int = None,
        client_ip: str = None
    ) -> Optional[int]:
        """Создание записи о сессии"""
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                cur.execute("""
                    INSERT INTO sessions (ticket_id, client_user_id, specialist_user_id, client_ip)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                """, (ticket_id, client_user_id, specialist_user_id, client_ip))

                session_id = cur.fetchone()[0]
                conn.commit()
                cur.close()

                logger.info(f"Создана сессия #{session_id}")
                return session_id

        except Exception as e:
            log_error(e, "create_session", logger)
            return None

    def end_session(self, session_id: int) -> bool:
        """Завершение сессии"""
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                cur.execute("""
                    UPDATE sessions
                    SET ended_at = NOW(),
                        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
                    WHERE id = %s
                """, (session_id,))

                conn.commit()
                success = cur.rowcount > 0
                cur.close()

                if success:
                    logger.info(f"Сессия #{session_id} завершена")

                return success

        except Exception as e:
            log_error(e, "end_session", logger)
            return False

    def log_action(
        self,
        session_id: int,
        user_id: int,
        action_type: str,
        details: dict = None
    ) -> bool:
        """Логирование действия в сессии"""
        try:
            with self.get_connection() as conn:
                cur = conn.cursor()

                import json
                cur.execute("""
                    INSERT INTO action_logs (session_id, user_id, action_type, details)
                    VALUES (%s, %s, %s, %s)
                """, (session_id, user_id, action_type, json.dumps(details) if details else None))

                conn.commit()
                cur.close()
                return True

        except Exception as e:
            log_error(e, "log_action", logger)
            return False

    # ==================== Вспомогательные методы ====================

    def _hash_password(self, password: str) -> str:
        """Хеширование пароля с bcrypt"""
        salt = bcrypt.gensalt(rounds=config.security.password_hash_rounds)
        return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

    def _verify_password(self, password: str, password_hash: str) -> bool:
        """Проверка пароля"""
        if isinstance(password_hash, str):
            password_hash = password_hash.encode('utf-8')
        return bcrypt.checkpw(password.encode('utf-8'), password_hash)

    def close(self):
        """Закрытие соединения"""
        if self._connection and not self._connection.closed:
            self._connection.close()
            logger.info("Соединение с БД закрыто")


# Глобальный экземпляр менеджера БД
db = DatabaseManager()


def init_database() -> bool:
    """Инициализация базы данных"""
    return db.init_database()


def close_database():
    """Закрытие базы данных"""
    db.close()