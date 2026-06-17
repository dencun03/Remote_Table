"""
Приложение специалиста (серверной части)

Позволяет специалисту поддержки подключаться к клиентам,
просматривать их экраны и управлять удалённым компьютером.
"""

import socket
import cv2
import numpy as np
import zlib
import json
import threading
import time
import queue
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
import uuid

from core.config import config, SpecialistConfig
from core.logging_config import get_logger, log_operation, log_error
from core.database import db

logger = get_logger('specialist')


class SessionState(Enum):
    """Состояния сессии"""
    WAITING = "waiting"
    CONNECTING = "connecting"
    ACCESS_PENDING = "access_pending"
    ACTIVE = "active"
    ENDED = "ended"


@dataclass
class SessionStats:
    """Статистика сессии"""
    start_time: float = 0
    frames_received: int = 0
    bytes_received: int = 0
    errors: int = 0


class SpecialistConnection:
    """Управление подключением к реле-серверу"""

    def __init__(self, specialist_config: SpecialistConfig = None):
        self.config = specialist_config or config.specialist
        self.socket: Optional[socket.socket] = None
        self.specialist_id = self.config.server_id or f"TECH-{uuid.getnode() % 100000:05d}"
        self.state = SessionState.WAITING

    def connect(self) -> bool:
        """Подключение к реле-серверу"""
        try:
            logger.info(f"Подключение к {self.config.relay_host}:{self.config.relay_port}...")

            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(30)
            self.socket.connect((self.config.relay_host, self.config.relay_port))

            # Регистрация специалиста
            register_msg = {
                "type": "register_specialist",
                "specialist_id": self.specialist_id,
                "timestamp": time.time()
            }
            self._send_json(register_msg)

            self.state = SessionState.CONNECTING
            logger.info("Подключено к реле-серверу")
            return True

        except Exception as e:
            log_error(e, "connect", logger)
            return False

    def _send_json(self, data: dict):
        """Отправка JSON данных"""
        if self.socket:
            message = json.dumps(data).encode('utf-8') + b'\n'
            self.socket.sendall(message)

    def receive_message(self, buffer_size: int = 8192) -> Optional[dict]:
        """Получение JSON сообщения"""
        try:
            data = self.socket.recv(buffer_size)
            if not data:
                return None

            # Обработка нескольких сообщений в буфере
            messages = []
            for line in data.decode('utf-8').strip().split('\n'):
                if line:
                    messages.append(json.loads(line))

            return messages[0] if messages else None

        except Exception:
            return None

    def wait_for_client(self) -> Optional[str]:
        """Ожидание подключения клиента"""
        logger.info("Ожидание подключения клиента...")

        while self.state == SessionState.CONNECTING:
            msg = self.receive_message()
            if not msg:
                time.sleep(0.1)
                continue

            if msg.get('type') == 'incoming_connection':
                client_id = msg.get('client_id')
                logger.info(f"Запрос на подключение от: {client_id}")
                self.state = SessionState.ACCESS_PENDING
                return client_id

        return None

    def request_access(self, timeout: int = 60) -> bool:
        """Запрос доступа к клиенту"""
        logger.info("Запрос доступа к клиенту...")

        self._send_json({
            "type": "request_access",
            "specialist_id": self.specialist_id
        })

        start_time = time.time()
        while time.time() - start_time < timeout:
            msg = self.receive_message()
            if msg and msg.get('type') == 'access_response':
                granted = msg.get('granted', False)
                if granted:
                    logger.info("Доступ разрешён клиентом")
                    self.state = SessionState.ACTIVE
                    return True
                else:
                    logger.warning("Доступ отклонён клиентом")
                    return False
            time.sleep(0.1)

        logger.warning("Таймаут ожидания ответа")
        return False

    def get_client_resolution(self) -> tuple:
        """Получение разрешения экрана клиента"""
        try:
            self._send_json({"type": "get_resolution"})

            start_time = time.time()
            while time.time() - start_time < 10:
                msg = self.receive_message()
                if msg and msg.get('type') == 'resolution':
                    width = msg.get('width', 1920)
                    height = msg.get('height', 1080)
                    return width, height
                time.sleep(0.1)

        except Exception as e:
            logger.error(f"Ошибка получения разрешения: {e}")

        return 1920, 1080

    def receive_frame(self) -> Optional[np.ndarray]:
        """Приём кадра от клиента"""
        try:
            size_data = self.socket.recv(4)
            if len(size_data) < 4:
                return None

            total_len = int.from_bytes(size_data, 'big')

            data = b''
            while len(data) < total_len:
                packet = self.socket.recv(min(total_len - len(data), self.config.receive_buffer_size))
                if not packet:
                    break
                data += packet

            if len(data) == 0:
                return None

            decompressed = zlib.decompress(data)
            frame = cv2.imdecode(np.frombuffer(decompressed, np.uint8), cv2.IMREAD_COLOR)
            return frame

        except Exception:
            return None

    def send_command(self, command: dict):
        """Отправка команды клиенту"""
        try:
            self._send_json(command)
        except Exception as e:
            logger.error(f"Ошибка отправки команды: {e}")

    def disconnect(self):
        """Отключение"""
        if self.state == SessionState.ACTIVE:
            self.send_command({'type': 'stop_session'})

        self.state = SessionState.ENDED

        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None

    def is_connected(self) -> bool:
        """Проверка подключения"""
        return self.socket is not None and self.state != SessionState.ENDED


class SpecialistApp:
    """
    Основной класс приложения специалиста

    Управляет жизненным циклом сессии удалённого доступа.
    """

    def __init__(self, app_config: SpecialistConfig = None):
        self.config = app_config or config.specialist
        self.connection = SpecialistConnection(self.config)
        self.stats = SessionStats()
        self.is_running = False
        self.current_client_id: Optional[str] = None

    def start(self):
        """Запуск приложения специалиста"""
        logger.info("="*60)
        logger.info("ЗАПУСК ПРИЛОЖЕНИЯ СПЕЦИАЛИСТА")
        logger.info("="*60)

        self.is_running = True

        # Подключение к реле-серверу
        if not self.connection.connect():
            logger.error("Не удалось подключиться к реле-серверу")
            return

        # Ожидание клиента
        self.current_client_id = self.connection.wait_for_client()
        if not self.current_client_id:
            logger.warning("Клиент не подключился")
            self.connection.disconnect()
            return

        # Запрос доступа
        if not self.connection.request_access():
            logger.warning("Доступ не получен")
            self.connection.disconnect()
            return

        # Запуск активной сессии
        self._run_session()

        # Завершение
        self.connection.disconnect()
        logger.info("Приложение специалиста остановлено")

    def _run_session(self):
        """Основной цикл сессии"""
        client_width, client_height = self.connection.get_client_resolution()
        scale_x = client_width / self.config.display_width
        scale_y = client_height / self.config.display_height

        # Настройка окна
        window_title = f"Удалённый доступ: {self.current_client_id}"
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, self.config.display_width, self.config.display_height)

        # Обработчик мыши
        def mouse_callback(event, x, y, flags, param):
            scale = param
            if self.connection.state != SessionState.ACTIVE:
                return

            if event == cv2.EVENT_LBUTTONDOWN:
                self.connection.send_command({
                    'type': 'mouse',
                    'x': int(x * scale[0]),
                    'y': int(y * scale[1]),
                    'click': 'left'
                })
            elif event == cv2.EVENT_RBUTTONDOWN:
                self.connection.send_command({
                    'type': 'mouse',
                    'x': int(x * scale[0]),
                    'y': int(y * scale[1]),
                    'click': 'right'
                })
            elif event == cv2.EVENT_MOUSEMOVE and flags == cv2.EVENT_FLAG_LBUTTON:
                self.connection.send_command({
                    'type': 'mouse',
                    'x': int(x * scale[0]),
                    'y': int(y * scale[1]),
                    'drag': True
                })
            elif event == cv2.EVENT_LBUTTONUP:
                self.connection.send_command({
                    'type': 'mouse',
                    'x': int(x * scale[0]),
                    'y': int(y * scale[1]),
                    'drag': False
                })

        cv2.setMouseCallback(window_title, mouse_callback, (scale_x, scale_y))

        self.stats.start_time = time.time()
        logger.info(f"Сессия активна. Разрешение клиента: {client_width}x{client_height}")

        try:
            while self.is_running and self.connection.state == SessionState.ACTIVE:
                # Приём кадра
                frame = self.connection.receive_frame()

                if frame is None:
                    logger.warning("Клиент отключился")
                    break

                self.stats.frames_received += 1

                # Отображение
                cv2.imshow(window_title, frame)

                # Обработка клавиш
                key = cv2.waitKey(1) & 0xFF

                if key == ord('q'):
                    logger.info("Завершение сессии")
                    break
                elif key != 255:
                    self._handle_key(key)

                # Периодическая статистика
                if self.stats.frames_received % 300 == 0:
                    self._log_stats()

        finally:
            cv2.destroyAllWindows()
            self._log_stats()

    def _handle_key(self, key: int):
        """Обработка нажатий клавиш"""
        special_keys = {
            8: 'backspace',
            9: 'tab',
            13: 'enter',
            27: 'esc',
            32: 'space',
        }

        if key in special_keys:
            self.connection.send_command({'type': 'key', 'key': special_keys[key]})
        elif 32 <= key <= 126:
            self.connection.send_command({'type': 'key', 'key': chr(key)})

    def _log_stats(self):
        """Логирование статистики сессии"""
        duration = time.time() - self.stats.start_time
        fps = self.stats.frames_received / max(duration, 1)

        logger.info(
            f"Статистика сессии: "
            f"длительность={duration:.0f}с, "
            f"fps={fps:.1f}, "
            f"кадров={self.stats.frames_received}"
        )

    def stop(self):
        """Остановка приложения"""
        self.is_running = False


def run_specialist():
    """Запуск приложения специалиста"""
    app = SpecialistApp()

    try:
        app.start()
    except KeyboardInterrupt:
        print("\nПолучен сигнал остановки")
    finally:
        app.stop()


if __name__ == "__main__":
    run_specialist()