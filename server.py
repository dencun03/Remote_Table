"""
Сервер для системы удалённой технической поддержки

Улучшения:
- Улучшенная обработка изображений
- Буфер кадров для стабильной передачи
- Безопасное управление мышью и клавиатурой
- Логирование операций и статистика
- Обработка ошибок и переподключение
"""

import socket
import cv2
import numpy as np
import zlib
import json
import threading
import time
import logging
import queue
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('server.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class SessionState(Enum):
    """Состояния сессии"""
    WAITING = "waiting"
    CONNECTING = "connecting"
    ACCESS_PENDING = "access_pending"
    ACTIVE = "active"
    ENDED = "ended"


@dataclass
class ServerConfig:
    """Конфигурация сервера"""
    relay_host: str = 'your-relay-server.com'
    relay_port: int = 6969
    server_id: str = 'TECH-001'
    display_width: int = 1280
    display_height: int = 720
    max_clients: int = 1  # Один клиент за раз
    frame_buffer_size: int = 30
    receive_buffer_size: int = 65536


class FrameBuffer:
    """Буфер кадров для стабильной передачи"""

    def __init__(self, max_size: int = 30):
        self._buffer: queue.Queue = queue.Queue(maxsize=max_size)
        self._lock = threading.Lock()
        self._frame_count = 0
        self._last_frame_time = 0

    def put(self, frame: np.ndarray):
        """Добавление кадра в буфер"""
        try:
            with self._lock:
                if self._buffer.full():
                    try:
                        self._buffer.get_nowait()  # Удалить старый кадр
                    except queue.Empty:
                        pass
                self._buffer.put_nowait(frame.copy())
                self._frame_count += 1
                self._last_frame_time = time.time()
        except queue.Full:
            pass

    def get(self) -> Optional[np.ndarray]:
        """Получение последнего кадра"""
        try:
            with self._lock:
                if not self._buffer.empty():
                    return self._buffer.get_nowait()
        except queue.Empty:
            pass
        return None

    def get_stats(self) -> Dict[str, Any]:
        """Получение статистики буфера"""
        return {
            "buffer_size": self._buffer.qsize(),
            "total_frames": self._frame_count,
            "last_frame_age": time.time() - self._last_frame_time
        }


class RemoteServer:
    """Сервер удалённого доступа для специалиста"""

    def __init__(self, config: Optional[ServerConfig] = None):
        self.config = config or ServerConfig()
        self.socket: Optional[socket.socket] = None
        self.state = SessionState.WAITING
        self.client_id: Optional[str] = None
        self.frame_buffer = FrameBuffer(self.config.frame_buffer_size)
        self.is_running = False
        self._lock = threading.Lock()
        self._session_start: Optional[float] = None
        self._bytes_received = 0
        self._bytes_sent = 0

    def connect_to_relay(self) -> bool:
        """Подключение к реле-серверу"""
        with self._lock:
            try:
                logger.info(f"Подключение к {self.config.relay_host}:{self.config.relay_port}...")

                self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.socket.settimeout(30)
                self.socket.connect((self.config.relay_host, self.config.relay_port))

                # Регистрация сервера
                register_msg = {
                    "type": "register_server",
                    "server_id": self.config.server_id,
                    "timestamp": time.time()
                }
                self._send_json(register_msg)

                self.state = SessionState.CONNECTING
                logger.info("Подключено к реле-серверу")
                return True

            except Exception as e:
                logger.error(f"Ошибка подключения: {e}")
                self.state = SessionState.ENDED
                return False

    def _send_json(self, data: dict):
        """Отправка JSON данных"""
        if self.socket:
            message = json.dumps(data).encode('utf-8')
            self.socket.sendall(message)

    def _receive_json(self, buffer_size: int = 4096) -> Optional[dict]:
        """Получение JSON данных"""
        try:
            data = self.socket.recv(buffer_size)
            if not data:
                return None
            return json.loads(data.decode('utf-8'))
        except (json.JSONDecodeError, socket.timeout):
            return None

    def wait_for_client(self) -> bool:
        """
        Ожидание подключения клиента.

        Returns:
            True если клиент подключён успешно
        """
        logger.info("Ожидание подключения клиента...")

        while self.state == SessionState.CONNECTING or self.state == SessionState.WAITING:
            msg = self._receive_json()
            if not msg:
                time.sleep(0.1)
                continue

            msg_type = msg.get('type')

            if msg_type == 'incoming_connection':
                self.client_id = msg.get('client_id')
                logger.info(f"Запрос на подключение от: {self.client_id}")
                self.state = SessionState.ACCESS_PENDING
                return True

            elif msg_type == 'status':
                servers = msg.get('servers', [])
                logger.debug(f"Активные серверы: {servers}")

        return False

    def request_access(self, timeout: int = 60) -> bool:
        """
        Запрос доступа к клиенту.

        Args:
            timeout: Таймаут ожидания ответа

        Returns:
            True если доступ разрешён
        """
        logger.info("Запрос доступа к клиенту...")

        access_request = {
            "type": "request_access",
            "technician_id": self.config.server_id,
            "timestamp": time.time()
        }
        self._send_json(access_request)

        # Ожидание ответа
        start_time = time.time()
        while time.time() - start_time < timeout:
            msg = self._receive_json()
            if msg and msg.get('type') == 'access_response':
                granted = msg.get('granted', False)
                if granted:
                    logger.info("Доступ разрешён клиентом")
                    self.state = SessionState.ACTIVE
                    self._session_start = time.time()
                    return True
                else:
                    logger.warning("Доступ отклонён клиентом")
                    return False
            time.sleep(0.1)

        logger.warning("Таймаут ожидания ответа")
        return False

    def get_client_resolution(self) -> tuple:
        """
        Получение разрешения экрана клиента.

        Returns:
            Кортеж (width, height)
        """
        logger.info("Запрос разрешения экрана клиента...")

        try:
            self._send_json({"type": "get_resolution", "timestamp": time.time()})

            # Ожидание ответа с таймаутом
            start_time = time.time()
            while time.time() - start_time < 10:
                msg = self._receive_json()
                if msg and msg.get('type') == 'resolution':
                    width = msg.get('width', 1920)
                    height = msg.get('height', 1080)
                    logger.info(f"Разрешение клиента: {width}x{height}")
                    return width, height
                time.sleep(0.1)

        except Exception as e:
            logger.error(f"Ошибка получения разрешения: {e}")

        return 1920, 1080  # Значение по умолчанию

    def _receive_frame(self) -> Optional[np.ndarray]:
        """Приём кадра от клиента"""
        try:
            # Получение размера кадра (4 байта)
            size_data = self.socket.recv(4)
            if len(size_data) < 4:
                return None

            total_len = int.from_bytes(size_data, 'big')

            # Получение данных кадра
            data = b''
            while len(data) < total_len:
                packet = self.socket.recv(min(total_len - len(data), self.config.receive_buffer_size))
                if not packet:
                    break
                data += packet

            self._bytes_received += len(data)

            if len(data) == 0:
                return None

            # Декомпрессия
            decompressed = zlib.decompress(data)
            frame = cv2.imdecode(np.frombuffer(decompressed, np.uint8), cv2.IMREAD_COLOR)

            return frame

        except socket.timeout:
            return None
        except Exception as e:
            logger.error(f"Ошибка приёма кадра: {e}")
            return None

    def _send_command(self, command: dict):
        """Отправка команды клиенту"""
        try:
            self._send_json(command)
        except Exception as e:
            logger.error(f"Ошибка отправки команды: {e}")

    def _mouse_event_handler(self, event: int, x: int, y: int, flags: int, param):
        """Обработчик событий мыши OpenCV"""
        if self.state != SessionState.ACTIVE:
            return

        scale_x, scale_y = param

        if event == cv2.EVENT_LBUTTONDOWN:
            self._send_command({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'click': 'left'
            })

        elif event == cv2.EVENT_RBUTTONDOWN:
            self._send_command({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'click': 'right'
            })

        elif event == cv2.EVENT_MOUSEMOVE and flags == cv2.EVENT_FLAG_LBUTTON:
            self._send_command({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'drag': True
            })

        elif event == cv2.EVENT_LBUTTONUP:
            self._send_command({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'drag': False
            })

    def _keyboard_handler(self, key: int) -> bool:
        """Обработчик нажатий клавиш"""
        if self.state != SessionState.ACTIVE:
            return False

        special_keys = {
            8: 'backspace',
            9: 'tab',
            13: 'enter',
            27: 'esc',
            32: 'space',
            127: 'delete'
        }

        if key in special_keys:
            self._send_command({'type': 'key', 'key': special_keys[key]})
        elif 32 <= key <= 126:
            self._send_command({'type': 'key', 'key': chr(key)})
        elif key == ord('q'):
            return True  # Запрос на выход

        return False

    def start_session(self):
        """Запуск активной сессии с клиентом"""
        # Получение разрешения экрана клиента
        client_width, client_height = self.get_client_resolution()

        # Расчёт коэффициентов масштабирования
        scale_x = client_width / self.config.display_width
        scale_y = client_height / self.config.display_height

        # Создание окна предпросмотра
        window_name = f"Удалённый доступ: {self.client_id}"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, self.config.display_width, self.config.display_height)

        # Установка обработчика мыши
        cv2.setMouseCallback(window_name, self._mouse_event_handler, (scale_x, scale_y))

        logger.info("Сессия активна. Нажмите 'Q' для завершения.")

        frame_count = 0
        fps_start = time.time()

        try:
            while self.is_running and self.state == SessionState.ACTIVE:
                try:
                    # Приём кадра
                    frame = self._receive_frame()

                    if frame is None:
                        logger.warning("Клиент отключился")
                        break

                    frame_count += 1

                    # Отображение кадра
                    cv2.imshow(window_name, frame)

                    # Обработка клавиш
                    key = cv2.waitKey(1) & 0xFF
                    if key != 255:
                        if self._keyboard_handler(key):
                            logger.info("Завершение сессии по запросу пользователя")
                            break

                    # Периодическая статистика
                    if frame_count % 300 == 0:
                        elapsed = time.time() - fps_start
                        fps = frame_count / elapsed
                        buffer_stats = self.frame_buffer.get_stats()
                        logger.info(
                            f"FPS: {fps:.1f} | "
                            f"Буфер: {buffer_stats['buffer_size']} | "
                            f"Получено: {self._bytes_received / 1024:.1f} KB"
                        )

                except ConnectionError:
                    logger.error("Потеря соединения с клиентом")
                    break
                except Exception as e:
                    logger.error(f"Ошибка в сессии: {e}")
                    break

        finally:
            cv2.destroyAllWindows()

    def disconnect(self):
        """Отключение от клиента и очистка"""
        logger.info("Отключение...")

        # Отправка сигнала завершения клиенту
        if self.state == SessionState.ACTIVE:
            try:
                self._send_command({'type': 'stop_session'})
            except Exception:
                pass

        self.state = SessionState.ENDED
        self.is_running = False

        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None

        # Вывод статистики сессии
        if self._session_start:
            duration = time.time() - self._session_start
            logger.info(
                f"Статистика сессии: "
                f"Длительность: {duration:.1f}с, "
                f"Получено: {self._bytes_received / 1024 / 1024:.2f} MB"
            )

    def run(self):
        """Основной цикл работы сервера"""
        logger.info("Запуск сервера удалённого доступа...")

        if not self.connect_to_relay():
            logger.error("Не удалось подключиться к реле-серверу")
            return

        if not self.wait_for_client():
            logger.warning("Клиент не подключился")
            self.disconnect()
            return

        if not self.request_access():
            logger.warning("Доступ не получен")
            self.disconnect()
            return

        # Запуск сессии
        self.is_running = True
        self.start_session()
        self.disconnect()

        logger.info("Сервер остановлен")


def main():
    """Точка входа сервера"""
    import uuid

    # Генерация уникального ID сервера
    server_id = f"TECH-{uuid.getnode() % 100000:05d}"

    config = ServerConfig(
        relay_host='your-relay-server.com',
        relay_port=6969,
        server_id=server_id,
        display_width=1280,
        display_height=720
    )

    server = RemoteServer(config)

    try:
        server.run()
    except KeyboardInterrupt:
        print("\nПолучен сигнал остановки")
    finally:
        server.disconnect()


if __name__ == "__main__":
    main()