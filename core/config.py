"""
Конфигурация приложения системы удалённой техподдержки

Все настройки приложения вынесены в отдельный файл для удобства управления.
Конфигурация может быть переопределена через переменные окружения.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path


@dataclass
class DatabaseConfig:
    """Конфигурация подключения к базе данных PostgreSQL"""
    host: str = "localhost"
    port: int = 5432
    name: str = "remote_desktop"
    user: str = "postgres"
    password: str = "postgres"

    # Таймауты и пулы соединений
    connection_timeout: int = 30
    max_connections: int = 20
    min_connections: int = 5

    @classmethod
    def from_env(cls) -> 'DatabaseConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            name=os.environ.get("DB_NAME", "remote_desktop"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", "postgres"),
        )


@dataclass
class RelayServerConfig:
    """Конфигурация реле-сервера"""
    host: str = "0.0.0.0"
    port: int = 6969
    max_clients: int = 100
    connection_timeout: int = 300  # 5 минут
    broadcast_interval: int = 10  # секунд
    cleanup_interval: int = 60  # секунд

    @classmethod
    def from_env(cls) -> 'RelayServerConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            host=os.environ.get("RELAY_HOST", "0.0.0.0"),
            port=int(os.environ.get("RELAY_PORT", "6969")),
        )


@dataclass
class ClientConfig:
    """Конфигурация клиента (пользовательское приложение)"""
    relay_host: str = "localhost"
    relay_port: int = 6969
    client_id: str = ""  # Генерируется автоматически
    target_server_id: str = "TECH-001"

    # Настройки захвата экрана
    screen_width: int = 1280
    screen_height: int = 720
    fps: int = 24
    jpeg_quality: int = 75
    compression_level: int = 6

    # Настройки переподключения
    reconnect_delay: int = 5
    max_reconnect_attempts: int = 10
    connection_timeout: int = 30

    @classmethod
    def from_env(cls) -> 'ClientConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            relay_host=os.environ.get("RELAY_HOST", "localhost"),
            relay_port=int(os.environ.get("RELAY_PORT", "6969")),
            target_server_id=os.environ.get("SERVER_ID", "TECH-001"),
        )


@dataclass
class SpecialistConfig:
    """Конфигурация сервера специалиста"""
    relay_host: str = "localhost"
    relay_port: int = 6969
    server_id: str = ""  # Генерируется автоматически

    # Настройки отображения
    display_width: int = 1280
    display_height: int = 720

    # Буфер кадров
    frame_buffer_size: int = 30
    receive_buffer_size: int = 65536

    @classmethod
    def from_env(cls) -> 'SpecialistConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            relay_host=os.environ.get("RELAY_HOST", "localhost"),
            relay_port=int(os.environ.get("RELAY_PORT", "6969")),
        )


@dataclass
class SecurityConfig:
    """Конфигурация безопасности"""
    # Секретный ключ для сессий
    secret_key: str = "change-me-in-production-use-env-var"

    # Настройки паролей
    password_min_length: int = 8
    password_hash_rounds: int = 12

    # Ограничения速率
    max_login_attempts: int = 5
    lockout_duration: int = 300  # 5 минут

    @classmethod
    def from_env(cls) -> 'SecurityConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            secret_key=os.environ.get("SECRET_KEY", "change-me-in-production"),
            password_hash_rounds=int(os.environ.get("PASSWORD_ROUNDS", "12")),
        )


@dataclass
class LoggingConfig:
    """Конфигурация логирования"""
    level: str = "INFO"
    format: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    file_dir: str = "logs"
    max_file_size: int = 10 * 1024 * 1024  # 10 MB
    backup_count: int = 5

    @classmethod
    def from_env(cls) -> 'LoggingConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            level=os.environ.get("LOG_LEVEL", "INFO"),
            file_dir=os.environ.get("LOG_DIR", "logs"),
        )


@dataclass
class AppConfig:
    """
    Главная конфигурация приложения

    Объединяет все настройки в одном месте.
    """
    # Подконфигурации
    database: DatabaseConfig = field(default_factory=DatabaseConfig.from_env)
    relay: RelayServerConfig = field(default_factory=RelayServerConfig.from_env)
    client: ClientConfig = field(default_factory=ClientConfig.from_env)
    specialist: SpecialistConfig = field(default_factory=SpecialistConfig.from_env)
    security: SecurityConfig = field(default_factory=SecurityConfig.from_env)
    logging: LoggingConfig = field(default_factory=LoggingConfig.from_env)

    # Общие настройки приложения
    app_name: str = "Remote Support System"
    version: str = "1.0.0"
    debug: bool = False

    # Пути к файлам
    base_dir: Path = field(default_factory=lambda: Path(__file__).parent.parent)
    data_dir: Path = field(default_factory=lambda: Path(__file__).parent.parent / "data")

    @classmethod
    def from_env(cls) -> 'AppConfig':
        """Создание конфигурации из переменных окружения"""
        return cls(
            debug=os.environ.get("DEBUG", "false").lower() == "true",
            database=DatabaseConfig.from_env(),
            relay=RelayServerConfig.from_env(),
            client=ClientConfig.from_env(),
            specialist=SpecialistConfig.from_env(),
            security=SecurityConfig.from_env(),
            logging=LoggingConfig.from_env(),
        )

    def ensure_directories(self):
        """Создание необходимых директорий"""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        Path(self.logging.file_dir).mkdir(parents=True, exist_ok=True)


# Глобальный экземпляр конфигурации
config = AppConfig.from_env()


def get_config() -> AppConfig:
    """Получение текущей конфигурации"""
    return config


def reload_config():
    """Перезагрузка конфигурации из переменных окружения"""
    global config
    config = AppConfig.from_env()
    return config