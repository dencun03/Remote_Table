"""
Конфигурация логирования для системы удалённой техподдержки

Обеспечивает централизованное логирование во всех модулях приложения
с ротацией файлов и разными уровнями детализации.
"""

import logging
import logging.handlers
import sys
from pathlib import Path
from typing import Optional
from functools import wraps
import traceback

from core.config import config


class ColoredFormatter(logging.Formatter):
    """
    Форматер с цветным выводом в консоль
    Используется для улучшения читаемости логов в терминале
    """

    # ANSI коды цветов
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m', # Magenta
        'RESET': '\033[0m',      # Reset
    }

    def format(self, record):
        # Добавляем цвет только для консольного вывода
        if hasattr(record, 'colored') and record.colored:
            levelname = record.levelname
            if levelname in self.COLORS:
                record.levelname = (
                    f"{self.COLORS[levelname]}{levelname}{self.COLORS['RESET']}"
                )
        return super().format(record)


class ContextFilter(logging.Filter):
    """
    Фильтр для добавления контекстной информации в логи
    """

    def __init__(self, context_provider=None):
        super().__init__()
        self.context_provider = context_provider or (lambda: {})

    def filter(self, record):
        context = self.context_provider()
        for key, value in context.items():
            setattr(record, key, value)
        return True


# Глобальный логгер
_logger: Optional[logging.Logger] = None
_loggers = {}


def setup_logging(
    name: str = None,
    level: str = None,
    log_file: str = None,
    console: bool = True
) -> logging.Logger:
    """
    Настройка логирования для приложения или конкретного модуля.

    Args:
        name: Имя логгера (обычно __name__ модуля)
        level: Уровень логирования (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Путь к файлу логов (опционально)
        console: Выводить ли в консоль

    Returns:
        Настроенный логгер
    """
    global _logger

    # Получение или создание логгера
    if name:
        logger = logging.getLogger(name)
    else:
        if _logger is None:
            _logger = logging.getLogger('remote_support')
        logger = _logger

    # Уровень логирования
    log_level = getattr(logging, level or config.logging.level.upper(), logging.INFO)
    logger.setLevel(log_level)

    # Очистка существующих обработчиков
    logger.handlers.clear()

    # Создание директории для логов
    log_dir = Path(config.logging.file_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    # Форматтеры
    file_formatter = logging.Formatter(config.logging.format)
    console_formatter = ColoredFormatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%H:%M:%S'
    )

    # Обработчик для файла с ротацией
    if log_file:
        file_handler = logging.handlers.RotatingFileHandler(
            log_dir / log_file,
            maxBytes=config.logging.max_file_size,
            backupCount=config.logging.backup_count,
            encoding='utf-8'
        )
        file_handler.setLevel(log_level)
        file_handler.setFormatter(file_formatter)
        logger.addHandler(file_handler)

    # Консольный обработчик
    if console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)
        console_handler.setFormatter(console_formatter)
        # Отмечаем для цветного форматирования
        console_handler.addFilter(lambda record: setattr(record, 'colored', True) or True)
        logger.addHandler(console_handler)

    return logger


def get_logger(name: str = None) -> logging.Logger:
    """
    Получение логгера для модуля.

    Args:
        name: Имя модуля (__name__)

    Returns:
        Логгер с настроенным форматированием
    """
    global _loggers

    if name is None:
        name = 'remote_support'

    if name not in _loggers:
        _loggers[name] = setup_logging(name)

    return _loggers[name]


def log_operation(
    operation: str,
    status: str = "success",
    details: dict = None,
    logger: logging.Logger = None
):
    """
    Логирование операции с структурированными данными.

    Args:
        operation: Название операции
        status: Статус (success, failed, started, completed)
        details: Дополнительные параметры
        logger: Логгер для записи
    """
    if logger is None:
        logger = get_logger('operations')

    status_emoji = {
        'success': '✅',
        'failed': '❌',
        'started': '▶️',
        'completed': '🏁',
        'warning': '⚠️',
    }

    emoji = status_emoji.get(status, '📌')
    message = f"{emoji} {operation}"

    if details:
        detail_str = " | ".join(f"{k}={v}" for k, v in details.items())
        message += f" | {detail_str}"

    if status == 'failed':
        logger.error(message)
    elif status == 'warning':
        logger.warning(message)
    else:
        logger.info(message)


def log_error(
    error: Exception,
    context: str = None,
    logger: logging.Logger = None,
    include_traceback: bool = False
):
    """
    Логирование ошибки с контекстом.

    Args:
        error: Исключение
        context: Контекст ошибки (название операции)
        logger: Логгер
        include_traceback: Включать ли traceback
    """
    if logger is None:
        logger = get_logger('errors')

    context_str = f"[{context}] " if context else ""
    message = f"❌ {context_str}{type(error).__name__}: {str(error)}"

    logger.error(message)

    if include_traceback:
        logger.debug(f"Traceback:\n{traceback.format_exc()}")


def log_performance(func):
    """
    Декоратор для логирования времени выполнения функции.
    Использование: @log_performance
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        import time

        logger = get_logger('performance')
        start_time = time.time()

        try:
            result = func(*args, **kwargs)
            elapsed = time.time() - start_time

            if elapsed > 1.0:  # Только медленные операции
                logger.info(f"⏱️ {func.__name__}: {elapsed:.3f}s")

            return result

        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(f"⏱️ {func.__name__} failed after {elapsed:.3f}s: {e}")
            raise

    return wrapper


def log_connection(func):
    """
    Декоратор для логирования сетевых подключений.
    Использование: @log_connection
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        logger = get_logger('connection')

        func_name = func.__name__
        logger.debug(f"→ {func_name}: connecting...")

        try:
            result = func(*args, **kwargs)
            logger.debug(f"✓ {func_name}: connected")
            return result

        except Exception as e:
            logger.error(f"✗ {func_name}: connection failed - {e}")
            raise

    return wrapper


# Автоматическая настройка при импорте
if _logger is None:
    setup_logging(
        name='remote_support',
        log_file='app.log',
        console=True
    )