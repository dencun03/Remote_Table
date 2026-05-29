"""
Приложение клиента (пользователя)

Позволяет пользователю подключаться к специалисту поддержки
для получения удалённой помощи.
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
import keyboard
import pyperclip
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
import uuid

from core.config import config, ClientConfig
from core.logging_config import get_logger, log_operation, log_error

logger = get_logger('client')


class ConnectionState(Enum):
    """Состояния подключения"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ACCESS_PENDING = "access_pending"
    ACTIVE = "active"
    ENDED = "ended"


@dataclass
class ClientStats:
    """Статистика клиента"""
    frames_sent: int = 0
    bytes_sent: int = 0
    errors: int = 0


class PermissionDialog:
    """Диалог запроса разрешения на удалённый доступ"""

    def __init__(self):
        self.root = None
        self.result = None

    def show(self, specialist_id: str, timeout: int = 30) -> bool:
        """Показ диалога и ожидание ответа"""
        import customtkinter as ctk

        self.result = None

        def on_allow():
            self.result = True
            self.root.destroy()

        def on_deny():
            self.result = False
            self.root.destroy()

        self.root = ctk.CTk()
        self.root.title("Запрос удалённого доступа")
        self.root.geometry("450x220")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)

        # Центрирование
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() // 2) - 225
        y = (self.root.winfo_screenheight() // 2) - 110
        self.root.geometry(f"450x220+{x}+{y}")

        # UI
        ctk.CTkLabel(
            self.root,
            text="⚠️ Запрос удалённого доступа",
            font=ctk.CTkFont(size=18, weight="bold")
        ).pack(pady=15)

        ctk.CTkLabel(
            self.root,
            text=f"Специалист #{specialist_id} запрашивает доступ\nк вашему компьютеру",
            font=ctk.CTkFont(size=14)
        ).pack(pady=10)

        btn_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        btn_frame.pack(pady=20)

        ctk.CTkButton(
            btn_frame, text="Разрешить",
            fg_color="#28a745", hover_color="#218838",
            command=on_allow, width=140, height=40
        ).pack(side="left", padx=10)

        ctk.CTkButton(
            btn_frame, text="Отклонить",
            fg_color="#dc3545", hover_color="#c82333",
            command=on_deny, width=140, height=40
        ).pack(side="left", padx=10)

        # Таймаут
        remaining = [timeout]
        def update_timer():
            if remaining[0] > 0:
                remaining[0] -= 1
                self.root.after(1000, update_timer)
            else:
                on_deny()

        self.root.after(1000, update_timer)
        self.root.protocol("WM_DELETE_WINDOW", on_deny)
        self.root.mainloop()

        return self.result if self.result is not None else False


class ClientConnection:
    """Управление подключением к реле-серверу"""

    def __init__(self, client_config: ClientConfig = None):
        self.config = client_config or config.client
        self.socket: Optional[socket.socket] = None
        self.client_id = self.config.client_id or f"USER-{uuid.getnode() % 100000:05d}"
        self.state = ConnectionState.DISCONNECTED

    def connect(self) -> bool:
        """Подключение к реле-серверу"""
        try:
            logger.info(f"Подключение к {self.config.relay_host}:{self.config.relay_port}...")

            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(self.config.connection_timeout)
            self.socket.connect((self.config.relay_host, self.config.relay_port))

            # Регистрация клиента
            register_msg = {
                "type": "register_client",
                "client_id": self.client_id,
                "timestamp": time.time()
            }
            self._send_json(register_msg)

            self.state = ConnectionState.CONNECTED
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

            for line in data.decode('utf-8').strip().split('\n'):
                if line:
                    return json.loads(line)
            return None

        except Exception:
            return None

    def request_access(self, specialist_id: str) -> bool:
        """Запрос доступа к специалисту"""
        logger.info(f"Запрос подключения к специалисту {specialist_id}...")

        self._send_json({
            "type": "connect_to_specialist",
            "specialist_id": specialist_id
        })

        # Ожидание подтверждения
        start_time = time.time()
        while time.time() - start_time < 30:
            msg = self.receive_message()
            if msg and msg.get('type') == 'incoming_connection':
                logger.info("Специалист подключается")
                return True
            time.sleep(0.1)

        return False

    def handle_access_request(self, specialist_id: str) -> bool:
        """Обработка входящего запроса доступа"""
        logger.info(f"Получен запрос доступа от специалиста {specialist_id}")

        # Показ диалога разрешения
        dialog = PermissionDialog()
        granted = dialog.show(specialist_id)

        # Отправка ответа
        self._send_json({
            "type": "access_response",
            "granted": granted
        })

        if granted:
            logger.info("Доступ разрешён")
            self.state = ConnectionState.ACCESS_PENDING
        else:
            logger.warning("Доступ отклонён")

        return granted

    def send_resolution(self):
        """Отправка разрешения экрана"""
        width, height = pyautogui.size()
        self._send_json({
            "type": "resolution",
            "width": width,
            "height": height
        })
        logger.info(f"Отправлено разрешение: {width}x{height}")

    def send_frame(self, frame: np.ndarray) -> bool:
        """Отправка кадра"""
        try:
            # Кодирование
            _, buffer = cv2.imencode(
                '.jpg',
                frame,
                [cv2.IMWRITE_JPEG_QUALITY, self.config.jpeg_quality]
            )
            compressed = zlib.compress(buffer.tobytes(), level=self.config.compression_level)

            # Отправка
            size_bytes = len(compressed).to_bytes(4, 'big')
            self.socket.sendall(size_bytes)
            self.socket.sendall(compressed)

            return True

        except Exception as e:
            logger.error(f"Ошибка отправки кадра: {e}")
            return False

    def receive_command(self) -> Optional[dict]:
        """Получение команды от специалиста"""
        try:
            data = self.socket.recv(4096)
            if not data:
                return None

            for line in data.decode('utf-8').strip().split('\n'):
                if line:
                    return json.loads(line)
            return None

        except Exception:
            return None

    def disconnect(self):
        """Отключение"""
        self.state = ConnectionState.DISCONNECTED

        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None

    def is_connected(self) -> bool:
        """Проверка подключения"""
        return self.socket is not None


class ScreenCapture:
    """Захват и отправка экрана"""

    def __init__(self, config: ClientConfig):
        self.config = config
        self.frame_queue = queue.Queue(maxsize=2)
        self._running = False
        self.is_dragging = False

    def start(self):
        """Запуск захвата"""
        self._running = True

    def stop(self):
        """Остановка захвата"""
        self._running = False

    def capture_loop(self):
        """Цикл захвата экрана"""
        last_time = time.time()
        frame_interval = 1.0 / self.config.fps

        while self._running:
            try:
                start = time.time()

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

                # Добавление в очередь
                try:
                    if self.frame_queue.full():
                        try:
                            self.frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                    self.frame_queue.put_nowait(frame)
                except queue.Full:
                    pass

                # Контроль FPS
                elapsed = time.time() - start
                if elapsed < frame_interval:
                    time.sleep(frame_interval - elapsed)

            except Exception as e:
                logger.error(f"Ошибка захвата: {e}")
                time.sleep(0.1)

    def get_frame(self) -> Optional[np.ndarray]:
        """Получение кадра"""
        try:
            return self.frame_queue.get_nowait()
        except queue.Empty:
            return None


class ClientApp:
    """
    Основной класс клиентского приложения

    Управляет захватом экрана, отправкой специалисту
    и выполнением команд.
    """

    def __init__(self, app_config: ClientConfig = None):
        self.config = app_config or config.client
        self.connection = ClientConnection(self.config)
        self.screen_capture = ScreenCapture(self.config)
        self.stats = ClientStats()
        self.is_running = False

    def start(self):
        """Запуск приложения клиента"""
        logger.info("="*60)
        logger.info("ЗАПУСК ПРИЛОЖЕНИЯ КЛИЕНТА")
        logger.info("="*60)

        self.is_running = True
        pyautogui.FAILSAFE = False

        # Подключение к реле
        if not self.connection.connect():
            logger.error("Не удалось подключиться к реле-серверу")
            return

        # Запрос подключения к специалисту
        if not self.connection.request_access(self.config.target_server_id):
            logger.warning("Специалист недоступен")
            self.connection.disconnect()
            return

        # Ожидание входящего запроса доступа
        start_time = time.time()
        while time.time() - start_time < 60:
            msg = self.connection.receive_message()
            if msg:
                if msg.get('type') == 'incoming_connection':
                    specialist_id = msg.get('specialist_id', 'unknown')
                    if not self.connection.handle_access_request(specialist_id):
                        logger.warning("Доступ отклонён")
                        self.connection.disconnect()
                        return
                    break
                elif msg.get('type') == 'relay_access_request':
                    specialist_id = msg.get('specialist_id', 'unknown')
                    if not self.connection.handle_access_request(specialist_id):
                        self.connection.disconnect()
                        return
                    break
            time.sleep(0.1)
        else:
            logger.warning("Таймаут ожидания специалиста")
            self.connection.disconnect()
            return

        # Запуск захвата экрана
        self.screen_capture.start()

        # Запуск потоков
        threading.Thread(target=self.screen_capture.capture_loop, daemon=True).start()
        threading.Thread(target=self._command_receiver, daemon=True).start()
        threading.Thread(target=self._frame_sender, daemon=True).start()

        # Ожидание завершения
        try:
            while self.is_running and self.connection.state == ConnectionState.ACCESS_PENDING:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Получен сигнал остановки")
        finally:
            self.screen_capture.stop()
            self.connection.disconnect()
            logger.info("Приложение клиента остановлено")

    def _command_receiver(self):
        """Поток приёма команд от специалиста"""
        while self.is_running:
            try:
                cmd = self.connection.receive_command()
                if not cmd:
                    break
                self._execute_command(cmd)
            except Exception as e:
                logger.error(f"Ошибка приёма команды: {e}")
                break

        self.is_running = False

    def _execute_command(self, cmd: dict):
        """Выполнение команды специалиста"""
        cmd_type = cmd.get('type')

        if cmd_type == 'mouse':
            x, y = cmd.get('x', 0), cmd.get('y', 0)
            pyautogui.moveTo(x, y, duration=0)

            if cmd.get('click') == 'left':
                pyautogui.click()
            elif cmd.get('click') == 'right':
                pyautogui.rightClick()

            # Перетаскивание
            if cmd.get('drag') and not self.screen_capture.is_dragging:
                pyautogui.mouseDown(button='left')
                self.screen_capture.is_dragging = True
            elif not cmd.get('drag') and self.screen_capture.is_dragging:
                pyautogui.mouseUp(button='left')
                self.screen_capture.is_dragging = False

        elif cmd_type == 'key':
            key = cmd.get('key', '')
            self._execute_key(key)

        elif cmd_type == 'get_resolution':
            self.connection.send_resolution()

        elif cmd_type == 'stop_session':
            logger.info("Специалист завершил сессию")
            self.is_running = False

    def _execute_key(self, key: str):
        """Выполнение нажатия клавиши"""
        special_keys = {'backspace', 'space', 'enter', 'esc', 'tab', 'delete'}

        if key.lower() in special_keys:
            pyautogui.press(key.lower())
        else:
            try:
                pyperclip.copy(key)
                pyautogui.hotkey('ctrl', 'v')
            except Exception:
                keyboard.write(key)

    def _frame_sender(self):
        """Поток отправки кадров"""
        while self.is_running:
            frame = self.screen_capture.get_frame()
            if frame is not None:
                if not self.connection.send_frame(frame):
                    self.stats.errors += 1
                    break
                self.stats.frames_sent += 1
            time.sleep(0.01)

    def stop(self):
        """Остановка приложения"""
        self.is_running = False


def run_client():
    """Запуск клиентского приложения"""
    app = ClientApp()

    try:
        app.start()
    except KeyboardInterrupt:
        print("\nПолучен сигнал остановки")
    finally:
        app.stop()


if __name__ == "__main__":
    run_client()