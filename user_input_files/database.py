import hashlib
import psycopg2
from psycopg2.extras import RealDictCursor
import time
from typing import Dict, Any, Optional

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "remote_desktop",
    "user": "postgres",
    "password": "LOXI" 
}

_conn = None


def hash_password(password: str) -> str:
    """Хеширование пароля через SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()


def get_connection():
    """Создаёт или возвращает существующее соединение"""
    global _conn
    if _conn is None or _conn.closed != 0:
        try:
            _conn = psycopg2.connect(**DB_CONFIG)
        except psycopg2.OperationalError as e:
            print(f"Не удалось подключиться к PostgreSQL: {e}")
            raise
    return _conn


def init_db():
    """Инициализация базы данных (вызывается при старте)"""
    try:
        conn = psycopg2.connect(
            host=DB_CONFIG["host"],
            port=DB_CONFIG["port"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"]
        )
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'remote_desktop'")
        exists = cur.fetchone()

        if not exists:
            cur.execute("CREATE DATABASE remote_desktop")
            print("База данных 'remote_desktop' создана")

        cur.close()
        conn.close()

        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(50) PRIMARY KEY,
                password_hash VARCHAR(64) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()
        cur.close()
        print("Таблица users готова")

    except Exception as e:
        print(f"Ошибка инициализации БД: {e}")
        raise


def register_user(username: str, password: str) -> bool:
    """Регистрация нового пользователя"""
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
        if cur.fetchone():
            cur.close()
            return False 

        cur.execute(
            "INSERT INTO users (username, password_hash) VALUES (%s, %s)",
            (username, hash_password(password))
        )
        conn.commit()
        cur.close()
        return True
    except Exception as e:
        print(f"Ошибка регистрации: {e}")
        return False


def authenticate_user(username: str, password: str) -> bool:
    """Проверка логина и пароля"""
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute(
            "SELECT password_hash FROM users WHERE username = %s",
            (username,)
        )
        row = cur.fetchone()
        cur.close()

        if row:
            stored_hash = row[0]
            return stored_hash == hash_password(password)
        return False
    except Exception as e:
        print(f"Ошибка аутентификации: {e}")
        return False


def get_user_info(username: str) -> Optional[Dict[Any, Any]]:
    """Получить информацию о пользователе"""
    try:
        conn = get_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("SELECT * FROM users WHERE username = %s", (username,))
        row = cur.fetchone()
        cur.close()

        return dict(row) if row else None
    except Exception as e:
        print(f"Ошибка получения данных пользователя: {e}")
        return None


def update_user_password(username: str, new_password: str) -> bool:
    """Изменить пароль пользователя"""
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute(
            "UPDATE users SET password_hash = %s WHERE username = %s",
            (hash_password(new_password), username)
        )
        conn.commit()
        success = cur.rowcount > 0
        cur.close()
        return success
    except Exception as e:
        print(f"Ошибка смены пароля: {e}")
        return False


def close_db():
    """Закрытие соединения с БД"""
    global _conn
    if _conn and _conn.closed == 0:
        _conn.close()