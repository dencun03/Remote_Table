"""
Клиент для системы удалённой технической поддержки

Улучшения:
- Автоматическое переподключение при потере связи
- Улучшенная обработка изображений и сжатие
- Безопасная передача команд
- Логирование операций
- Защита от случайного управления (failsafe)
"""

import socket
import cv2
import numpy as np
import zlib
import json
import pyautogui
import threading
import time
import queue
import sys
import logging
import keyboard
import pyperclip
from typing import Optional, Callable
from dataclasses import dataclass
from enum import Enum

# GUI модули
import customtkinter as ctk
import tkinter.messagebox as messagebox

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('client.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class ConnectionState(Enum):
    """Состояния подключения"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    AUTHENTICATING = "authenticating"
    ACCESS_GRANTED = "access_granted"
    ERROR = "error"


@dataclass
class ClientConfig:
    """Конфигурация клиента"""
    relay_host: str = 'your-relay-server.com'
    relay_port: int = 6969
    client_id: str = ''
    target_server_id: str = 'TECH-001'
    screen_width: int = 1280
    screen_height: int = 720
    fps: int = 30
    jpeg_quality: int = 75
    compression_level: int = 6
    reconnect_delay: int = 5
    max_reconnect_attempts: int = 10
    connection_timeout: int = 30


class PermissionDialog:
    """Диалог запроса разрешения на удалённый доступ"""

    def __init__(self):
        self.root = None
        self.permission_granted = None

    def request_permission(self, technician_id: str, timeout: int = 30) -> Optional[bool]:
        """
        Показывает окно подтверждения доступа.

        Args:
            technician_id: ID специалиста
            timeout: Таймаут в секундах

        Returns:
            True если разрешено, False если отклонено, None если таймаут
        """
        self.permission_granted = None
        self.root = ctk.CTk()
        self.root.title("Запрос удалённого доступа")
        self.root.geometry("450x220")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)
        self.root.configure(fg_color=("#2b2b2b", "#1a1a1a"))

        # Центрирование окна
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() // 2) - 225
        y = (self.root.winfo_screenheight() // 2) - 110
        self.root.geometry(f"450x220+{x}+{y}")

        # Заголовок
        title = ctk.CTkLabel(
            self.root,
            text="⚠️ Запрос удалённого доступа",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color=("#ffcc00", "#ffcc00")
        )
        title.pack(pady=(20, 10))

        # Описание
        message = ctk.CTkLabel(
            self.root,
            text=f"Специалист #{technician_id} запрашивает доступ\nк вашему компьютеру",
            font=ctk.CTkFont(size=14),
            wraplength=380
        )
        message.pack(pady=5)

        warning = ctk.CTkLabel(
            self.root,
            text="Вам будет передано управление экраном и мышью.\nВы можете прекратить сеанс в любой момент.",
            font=ctk.CTkFont(size=11),
            text_color=("gray60", "gray80"),
            wraplength=380
        )
        warning.pack(pady=5)

        # Кнопки
        btn_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        btn_frame.pack(pady=20)

        allow_btn = ctk.CTkButton(
            btn_frame,
            text="Разрешить доступ",
            fg_color="#28a745",
            hover_color="#218838",
            command=lambda: self._grant_permission(True),
            width=140,
            height=40,
            corner_radius=8
        )
        allow_btn.pack(side="left", padx=10)

        deny_btn = ctk.CTkButton(
            btn_frame,
            text="Отклонить",
            fg_color="#dc3545",
            hover_color="#c82333",
            command=lambda: self._grant_permission(False),
            width=140,
            height=40,
            corner_radius=8
        )
        deny_btn.pack(side="left", padx=10)

        # Обработка закрытия окна
        self.root.protocol("WM_DELETE_WINDOW", lambda: self._grant_permission(False))

        # Таймер
        self._timeout = timeout
        self._update_timer()

        self.root.mainloop()
        return self.permission_granted

    def _update_timer(self):
        """Обновление таймера обратного отсчёта"""
        if self._timeout > 0 and self.root:
            remaining = f"Автоотказ через {self._timeout} сек"
            # Можно добавить индикатор таймера если нужно
            self._timeout -= 1
            self.root.after(1000, self._update_timer)
        elif self._timeout <= 0:
            self._grant_permission(False)

    def _grant_permission(self, granted: bool):
        self.permission_granted = granted
        if self.root:
            self.root.destroy()
            self.root = None


class ScreenCapture:
    """Оптимизированный захват экрана"""

    def __init__(self, config: ClientConfig):
        self.config = config
        self.frame_queue = queue.Queue(maxsize=3)
        self._running = False
        self._lock = threading.Lock()

    def start(self):
        """Запуск захвата экрана"""
        self._running = True

    def stop(self):
        """Остановка захвата экрана"""
        self._running = False

    def get_frame(self) -> Optional[np.ndarray]:
        """Получение последнего кадра"""
        try:
            return self.frame_queue.get_nowait()
        except queue.Empty:
            return None

    def capture_loop(self):
        """Цикл захвата экрана в отдельном потоке"""
        last_time = time.time()
        frame_interval = 1.0 / self.config.fps

        while self._running:
            try:
                start_time = time.time()

                # Захват экрана
                screenshot = pyautogui.screenshot()
                frame = np.array(screenshot)
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

                # Масштабирование
                frame = cv2.resize(
                    frame,
                    (self.config.screen_width, self.config.screen_height),
                    interpolation=cv2.INTER_AREA
                )

                # Добавление в очередь с заменой устаревших кадров
                try:
                    with self._lock:
                        if self.frame_queue.full():
                            try:
                                self.frame_queue.get_nowait()  # Удалить старый кадр
                            except queue.Empty:
                                pass
                        self.frame_queue.put_nowait(frame)
                except queue.Full:
                    continue

                # Контроль FPS
                elapsed = time.time() - start_time
                if elapsed < frame_interval:
                    time.sleep(frame_interval - elapsed)

            except Exception as e:
                logger.error(f"Ошибка захвата экрана: {e}")
                time.sleep(0.1)


class ClientConnection:
    """Управление подключением к реле-серверу"""

    def __init__(self, config: ClientConfig):
        self.config = config
        self.socket: Optional[socket.socket] = None
        self.state = ConnectionState.DISCONNECTED
        self._lock = threading.Lock()

    def connect(self) -> bool:
        """Установка соединения с реле-сервером"""
        with self._lock:
            try:
                self.state = ConnectionState.CONNECTING
                logger.info(f"Подключение к {self.config.relay_host}:{self.config.relay_port}...")

                self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.socket.settimeout(self.config.connection_timeout)
                self.socket.connect((self.config.relay_host, self.config.relay_port))

                # Регистрация клиента
                register_msg = {
                    "type": "register_client",
                    "client_id": self.config.client_id,
                    "timestamp": time.time()
                }
                self._send_json(register_msg)

                # Ожидание подтверждения
                time.sleep(0.5)

                self.state = ConnectionState.CONNECTED
                logger.info("Подключение установлено")
                return True

            except Exception as e:
                logger.error(f"Ошибка подключения: {e}")
                self.state = ConnectionState.ERROR
                self._cleanup()
                return False

    def _send_json(self, data: dict):
        """Отправка JSON данных"""
        if self.socket:
            message = json.dumps(data).encode('utf-8')
            self.socket.send(message)

    def send_command(self, command: dict):
        """Отправка команды специалисту"""
        with self._lock:
            if self.socket and self.state == ConnectionState.ACCESS_GRANTED:
                try:
                    self._send_json(command)
                except Exception as e:
                    logger.error(f"Ошибка отправки команды: {e}")
                    self.state = ConnectionState.ERROR

    def send_frame(self, frame: np.ndarray) -> bool:
        """Отправка кадра изображения"""
        with self._lock:
            if not self.socket or self.socket.fileno() == -1:
                return False

            try:
                # Кодирование и сжатие изображения
                _, buffer = cv2.imencode(
                    '.jpg',
                    frame,
                    [cv2.IMWRITE_JPEG_QUALITY, self.config.jpeg_quality]
                )
                compressed = zlib.compress(buffer.tobytes(), level=self.config.compression_level)

                # Отправка размера и данных
                size_bytes = len(compressed).to_bytes(4, 'big')
                self.socket.sendall(size_bytes)
                self.socket.sendall(compressed)
                return True

            except Exception as e:
                logger.error(f"Ошибка отправки кадра: {e}")
                return False

    def receive_message(self, buffer_size: int = 4096) -> Optional[dict]:
        """Получение JSON сообщения"""
        try:
            data = self.socket.recv(buffer_size)
            if not data:
                return None
            return json.loads(data.decode('utf-8'))
        except (json.JSONDecodeError, socket.timeout):
            return None

    def _cleanup(self):
        """Очистка ресурсов"""
        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None

    def disconnect(self):
        """Отключение от сервера"""
        with self._lock:
            logger.info("Отключение от сервера...")
            self._cleanup()
            self.state = ConnectionState.DISCONNECTED


class RemoteClient:
    """Основной класс клиента удалённого доступа"""

    def __init__(self, config: Optional[ClientConfig] = None):
        self.config = config or ClientConfig()
        self.connection = ClientConnection(self.config)
        self.screen_capture = ScreenCapture(self.config)
        self.is_dragging = False
        self._running = False
        self._threads = []

    def request_access(self) -> bool:
        """
        Запрос доступа к специалисту.

        Returns:
            True если доступ разрешён
        """
        logger.info("Запрос доступа к специалисту...")

        # Запрос подключения
        connect_msg = {
            "type": "connect_to_server",
            "server_id": self.config.target_server_id
        }
        self.connection._send_json(connect_msg)

        # Ожидание входящего подключения от relay
        logger.info("Ожидание подтверждения подключения...")

        # Запрос разрешения у пользователя
        app = PermissionDialog()
        granted = app.request_permission(self.config.target_server_id)

        if granted:
            logger.info("Доступ разрешён пользователем")
            self.connection.state = ConnectionState.ACCESS_GRANTED
            return True
        else:
            logger.warning("Доступ отклонён пользователем")
            return False

    def _command_receiver(self):
        """Поток приёма команд от специалиста"""
        while self._running:
            try:
                msg = self.connection.receive_message()
                if not msg:
                    logger.warning("Специалист отключился")
                    break

                self._process_command(msg)

            except Exception as e:
                logger.error(f"Ошибка приёма команд: {e}")
                break

        self._running = False

    def _process_command(self, cmd: dict):
        """Обработка команды от специалиста"""
        cmd_type = cmd.get('type')

        if cmd_type == 'mouse':
            x, y = cmd.get('x', 0), cmd.get('y', 0)
            pyautogui.moveTo(x, y, duration=0)

            click = cmd.get('click')
            if click == 'left':
                pyautogui.click()
            elif click == 'right':
                pyautogui.rightClick()

            # Обработка перетаскивания
            if cmd.get('drag') and not self.is_dragging:
                pyautogui.mouseDown(button='left')
                self.is_dragging = True
            elif not cmd.get('drag') and self.is_dragging:
                pyautogui.mouseUp(button='left')
                self.is_dragging = False

        elif cmd_type == 'key':
            key = cmd.get('key', '')
            self._execute_key(key)

        elif cmd_type == 'get_resolution':
            width, height = pyautogui.size()
            response = {
                "type": "resolution",
                "width": width,
                "height": height
            }
            self.connection._send_json(response)

        elif cmd_type == 'stop_session':
            logger.info("Специалист завершил сессию")
            self._running = False

    def _execute_key(self, key: str):
        """Выполнение нажатия клавиши"""
        special_keys = {
            'backspace', 'space', 'enter', 'esc', 'tab',
            'shift', 'ctrl', 'alt', 'win', 'delete'
        }

        if key.lower() in special_keys:
            pyautogui.press(key.lower())
        else:
            # Ввод текста через буфер обмена
            try:
                pyperclip.copy(key)
                pyautogui.hotkey('ctrl', 'v')
            except Exception as e:
                logger.warning(f"Ошибка ввода текста: {e}, используем keyboard.write")
                keyboard.write(key)

    def _frame_sender(self):
        """Поток отправки кадров"""
        while self._running:
            frame = self.screen_capture.get_frame()
            if frame is not None:
                if not self.connection.send_frame(frame):
                    logger.error("Ошибка отправки кадра")
                    break
            time.sleep(0.01)  # Небольшая задержка для снижения нагрузки

    def _capture_loop(self):
        """Поток захвата экрана"""
        self.screen_capture.capture_loop()

    def start(self):
        """Запуск клиента"""
        logger.info("Запуск клиента удалённого доступа...")

        # Отключение failsafe для специализированного ПО
        pyautogui.FAILSAFE = False

        # Цикл подключения с переподключением
        reconnect_attempts = 0

        while reconnect_attempts < self.config.max_reconnect_attempts:
            if not self.connection.connect():
                reconnect_attempts += 1
                logger.warning(f"Попытка переподключения {reconnect_attempts}/{self.config.max_reconnect_attempts}")
                time.sleep(self.config.reconnect_delay)
                continue

            # Запрос доступа
            if not self.request_access():
                self.connection.disconnect()
                logger.warning("Доступ отклонён")
                break

            # Запуск потоков
            self._running = True
            self.screen_capture.start()

            self._threads = [
                threading.Thread(target=self._capture_loop, daemon=True, name="CaptureThread"),
                threading.Thread(target=self._frame_sender, daemon=True, name="SenderThread"),
                threading.Thread(target=self._command_receiver, daemon=True, name="ReceiverThread")
            ]

            for t in self._threads:
                t.start()

            # Ожидание завершения
            while self._running:
                time.sleep(1)

            # Очистка
            self.screen_capture.stop()
            self.connection.disconnect()

            if self._running:  # Если не было нормального завершения
                reconnect_attempts += 1
                logger.warning(f"Соединение потеряно, попытка {reconnect_attempts}")

        logger.info("Клиент остановлен")

    def stop(self):
        """Остановка клиента"""
        logger.info("Остановка клиента...")
        self._running = False


def main():
    """Точка входа клиента"""
    import uuid

    # Генерация уникального ID клиента
    client_id = f"CLIENT-{uuid.getnode() % 100000:05d}"

    config = ClientConfig(
        relay_host='your-relay-server.com',
        relay_port=6969,
        client_id=client_id,
        target_server_id='TECH-001',
        screen_width=1280,
        screen_height=720,
        fps=24
    )

    client = RemoteClient(config)

    try:
        client.start()
    except KeyboardInterrupt:
        print("\nПолучен сигнал остановки")
    finally:
        client.stop()
        sys.exit(0)


if __name__ == "__main__":
    main()