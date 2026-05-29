"""
Модуль инициализации ядра приложения

Этот файл экспортирует все основные компоненты ядра системы.
Импортируйте отсюда при работе с приложением.
"""

from core.config import (
    config,
    get_config,
    reload_config,
    AppConfig,
    DatabaseConfig,
    RelayServerConfig,
    ClientConfig,
    SpecialistConfig,
    SecurityConfig,
    LoggingConfig,
)

from core.logging_config import (
    setup_logging,
    get_logger,
    log_operation,
    log_error,
)

from core.database import (
    DatabaseManager,
    db,
    init_database,
    close_database,
)

# Список доступных компонентов ядра
__all__ = [
    # Конфигурация
    'config',
    'get_config',
    'reload_config',
    'AppConfig',
    'DatabaseConfig',
    'RelayServerConfig',
    'ClientConfig',
    'SpecialistConfig',
    'SecurityConfig',
    'LoggingConfig',
    # Логирование
    'setup_logging',
    'get_logger',
    'log_operation',
    'log_error',
    # База данных
    'DatabaseManager',
    'db',
    'init_database',
    'close_database',
]