"""
Реле-сервер для системы удалённой техподдержки

Обеспечивает маршрутизацию соединений между клиентами и специалистами,
находящимися за NAT или файрволом.
"""

import socket
import threading
import json
import time
import queue
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

from core.config import config, RelayServerConfig
from core.logging_config import get_logger, log_operation, log_error

logger = get_logger('relay_server')


class ConnectionType(Enum):
    """Тип подключения"""
    CLIENT = "client"
    SPECIALIST = "specialist"


@dataclass
class ConnectionInfo:
    """Информация о подключении"""
    socket: socket.socket
    address: tuple
    connection_type: ConnectionType
    connection_id: str
    registered_id: Optional[str] = None
    connected_to: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)


class ThreadSafeDict:
    """Потокобезопасный словарь для хранения подключений"""

    def __init__(self):
        self._data: Dict[str, ConnectionInfo] = {}
        self._lock = threading.RLock()

    def add(self, key: str, value: ConnectionInfo):
        with self._lock:
            self._data[key] = value
            logger.info(
                f"{value.connection_type.value.capitalize()} "
                f"зарегистрирован: {key}"
            )

    def get(self, key: str) -> Optional[ConnectionInfo]:
        with self._lock:
            return self._data.get(key)

    def remove(self, key: str) -> Optional[ConnectionInfo]:
        with self._lock:
            return self._data.pop(key, None)

    def get_all(self) -> Dict[str, ConnectionInfo]:
        with self._lock:
            return dict(self._data)

    def keys_by_type(self, connection_type: ConnectionType) -> list:
        with self._lock:
            return [
                k for k, v in self._data.items()
                if v.connection_type == connection_type
            ]

    def update_activity(self, key: str):
        with self._lock:
            if key in self._data:
                self._data[key].last_activity = time.time()


class RelayServer:
    """
    Реле-сервер для маршрутизации соединений

    Принимает подключения от клиентов и специалистов,
    устанавливает связь между ними и пересылает данные.
    """

    def __init__(self, server_config: RelayServerConfig = None):
        self.config = server_config or config.relay

        # Хранилища подключений
        self.clients = ThreadSafeDict()
        self.specialists = ThreadSafeDict()
        self.connections: Dict[str, str] = {}

        # Блокировки
        self._connection_lock = threading.RLock()

        # Состояние
        self._running = False
        self.server_socket: Optional[socket.socket] = None

    def start(self):
        """Запуск реле-сервера"""
        self._running = True

        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind((self.config.host, self.config.port))
            self.server_socket.listen(self.config.max_clients)
            self.server_socket.settimeout(1)

            logger.info(f"Реле-сервер запущен на {self.config.host}:{self.config.port}")
            log_operation(
                "Реле-сервер запущен",
                details={
                    'host': self.config.host,
                    'port': self.config.port
                },
                logger=logger
            )

            # Фоновые потоки
            threading.Thread(
                target=self._status_broadcaster,
                daemon=True,
                name="StatusBroadcaster"
            ).start()

            threading.Thread(
                target=self._connection_cleaner,
                daemon=True,
                name="ConnectionCleaner"
            ).start()

            # Основной цикл
            self._accept_loop()

        except OSError as e:
            logger.error(f"Ошибка привязки порта: {e}")
        except Exception as e:
            logger.error(f"Критическая ошибка: {e}")
        finally:
            self.shutdown()

    def _accept_loop(self):
        """Цикл принятия входящих подключений"""
        while self._running:
            try:
                try:
                    client_socket, client_address = self.server_socket.accept()
                except socket.timeout:
                    continue

                logger.info(f"Новое подключение от {client_address}")

                thread = threading.Thread(
                    target=self._handle_connection,
                    args=(client_socket, client_address),
                    daemon=True
                )
                thread.start()

            except Exception as e:
                if self._running:
                    logger.error(f"Ошибка приёма подключения: {e}")

    def _handle_connection(self, client_socket: socket.socket, client_address: tuple):
        """Обработка нового подключения"""
        conn_info: Optional[ConnectionInfo] = None

        try:
            client_socket.settimeout(30)

            # Получение регистрационного сообщения
            data = client_socket.recv(4096)
            if not data:
                return

            msg = json.loads(data.decode('utf-8'))
            msg_type = msg.get('type')

            if msg_type == 'register_client':
                client_id = msg.get('client_id', f"client_{client_address[0]}_{client_address[1]}")

                conn_info = ConnectionInfo(
                    socket=client_socket,
                    address=client_address,
                    connection_type=ConnectionType.CLIENT,
                    connection_id=client_id
                )
                conn_info.registered_id = client_id

                self.clients.add(client_id, conn_info)
                self._send_status(client_socket)

            elif msg_type == 'register_specialist':
                specialist_id = msg.get('specialist_id', f"specialist_{client_address[0]}_{client_address[1]}")

                conn_info = ConnectionInfo(
                    socket=client_socket,
                    address=client_address,
                    connection_type=ConnectionType.SPECIALIST,
                    connection_id=specialist_id
                )
                conn_info.registered_id = specialist_id

                self.specialists.add(specialist_id, conn_info)
                self._broadcast_status()

            else:
                logger.warning(f"Неизвестный тип регистрации: {msg_type}")
                return

            client_socket.settimeout(self.config.connection_timeout)

            # Цикл обработки сообщений
            self._message_loop(client_socket, conn_info)

        except json.JSONDecodeError:
            logger.error(f"Неверный JSON от {client_address}")
        except socket.timeout:
            logger.warning(f"Таймаут от {client_address}")
        except Exception as e:
            logger.error(f"Ошибка обработки подключения: {e}")
        finally:
            self._cleanup_connection(conn_info)

    def _message_loop(self, client_socket: socket.socket, conn_info: ConnectionInfo):
        """Цикл обработки сообщений"""
        buffer = b''

        while self._running:
            try:
                data = client_socket.recv(8192)
                if not data:
                    break

                conn_info.last_activity = time.time()
                buffer += data

                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        msg = json.loads(line.decode('utf-8'))
                        self._process_message(conn_info, msg)
                    except json.JSONDecodeError:
                        continue

            except socket.timeout:
                if time.time() - conn_info.last_activity > self.config.connection_timeout:
                    break
            except Exception as e:
                logger.error(f"Ошибка в цикле сообщений: {e}")
                break

    def _process_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения"""
        msg_type = msg.get('type')

        if conn_info.connection_type == ConnectionType.CLIENT:
            self._process_client_message(conn_info, msg)
        elif conn_info.connection_type == ConnectionType.SPECIALIST:
            self._process_specialist_message(conn_info, msg)

    def _process_client_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения от клиента"""
        msg_type = msg.get('type')

        if msg_type == 'connect_to_specialist':
            target_specialist = msg.get('specialist_id')
            self._establish_connection(conn_info, target_specialist)

        elif msg_type == 'data':
            self._forward_to_specialist(conn_info.connection_id, msg)

        elif msg_type == 'ping':
            conn_info.socket.send(json.dumps({"type": "pong"}).encode('utf-8') + b'\n')

    def _process_specialist_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения от специалиста"""
        msg_type = msg.get('type')

        if msg_type == 'data':
            self._forward_to_client(conn_info.connection_id, msg)

        elif msg_type == 'request_access':
            client_id = msg.get('client_id')
            if client_id:
                self._forward_to_client(client_id, {
                    "type": "relay_access_request",
                    "specialist_id": conn_info.connection_id
                })

        elif msg_type == 'ping':
            conn_info.socket.send(json.dumps({"type": "pong"}).encode('utf-8') + b'\n')

    def _establish_connection(self, client_info: ConnectionInfo, specialist_id: str):
        """Установление соединения клиент-специалист"""
        with self._connection_lock:
            specialist_info = self.specialists.get(specialist_id)

            if not specialist_info:
                client_info.socket.send(json.dumps({
                    "type": "error",
                    "message": "Специалист недоступен"
                }).encode('utf-8') + b'\n')
                return

            self.connections[client_info.connection_id] = specialist_id
            client_info.connected_to = specialist_id

            specialist_info.socket.send(json.dumps({
                "type": "incoming_connection",
                "client_id": client_info.connection_id
            }).encode('utf-8') + b'\n')

            logger.info(f"Установлено соединение: {client_info.connection_id} -> {specialist_id}")

    def _forward_to_specialist(self, client_id: str, msg: dict):
        """Пересылка данных от клиента специалисту"""
        with self._connection_lock:
            specialist_id = self.connections.get(client_id)
            if not specialist_id:
                return

            specialist_info = self.specialists.get(specialist_id)
            if specialist_info:
                try:
                    data = json.dumps(msg).encode('utf-8') + b'\n'
                    specialist_info.socket.sendall(data)
                except Exception as e:
                    logger.error(f"Ошибка пересылки: {e}")

    def _forward_to_client(self, specialist_id: str, msg: dict):
        """Пересылка данных от специалиста клиенту"""
        with self._connection_lock:
            client_id = None
            for cid, sid in self.connections.items():
                if sid == specialist_id:
                    client_id = cid
                    break

            if not client_id:
                return

            client_info = self.clients.get(client_id)
            if client_info:
                try:
                    data = json.dumps(msg).encode('utf-8') + b'\n'
                    client_info.socket.sendall(data)
                except Exception as e:
                    logger.error(f"Ошибка пересылки: {e}")

    def _send_status(self, client_socket: socket.socket):
        """Отправка статуса клиенту"""
        try:
            status = {
                "type": "status",
                "specialists": self.specialists.keys_by_type(ConnectionType.SPECIALIST)
            }
            client_socket.send(json.dumps(status).encode('utf-8') + b'\n')
        except Exception as e:
            logger.error(f"Ошибка отправки статуса: {e}")

    def _broadcast_status(self):
        """Рассылка статуса всем клиентам"""
        status = {
            "type": "status",
            "specialists": self.specialists.keys_by_type(ConnectionType.SPECIALIST)
        }
        status_data = json.dumps(status).encode('utf-8') + b'\n'

        for client_info in self.clients.get_all().values():
            try:
                client_info.socket.send(status_data)
            except Exception:
                pass

    def _status_broadcaster(self):
        """Фоновый поток рассылки статуса"""
        while self._running:
            time.sleep(self.config.broadcast_interval)
            self._broadcast_status()

    def _connection_cleaner(self):
        """Фоновый поток очистки неактивных соединений"""
        while self._running:
            time.sleep(self.config.cleanup_interval)

            now = time.time()
            timeout = self.config.connection_timeout * 2

            for client_id in list(self.clients.keys_by_type(ConnectionType.CLIENT)):
                client = self.clients.get(client_id)
                if client and (now - client.last_activity) > timeout:
                    logger.info(f"Удаление неактивного клиента: {client_id}")
                    self._cleanup_connection(client)

            for specialist_id in list(self.specialists.keys_by_type(ConnectionType.SPECIALIST)):
                specialist = self.specialists.get(specialist_id)
                if specialist and (now - specialist.last_activity) > timeout:
                    logger.info(f"Удаление неактивного специалиста: {specialist_id}")
                    self._cleanup_connection(specialist)

    def _cleanup_connection(self, conn_info: Optional[ConnectionInfo]):
        """Очистка ресурсов подключения"""
        if not conn_info:
            return

        try:
            conn_info.socket.close()
        except Exception:
            pass

        if conn_info.connection_type == ConnectionType.CLIENT:
            self.clients.remove(conn_info.connection_id)
        elif conn_info.connection_type == ConnectionType.SPECIALIST:
            self.specialists.remove(conn_info.connection_id)

        with self._connection_lock:
            if conn_info.connection_id in self.connections:
                del self.connections[conn_info.connection_id]

    def shutdown(self):
        """Завершение работы сервера"""
        logger.info("Завершение работы реле-сервера...")
        self._running = False

        for client_info in self.clients.get_all().values():
            try:
                client_info.socket.close()
            except Exception:
                pass

        for specialist_info in self.specialists.get_all().values():
            try:
                specialist_info.socket.close()
            except Exception:
                pass

        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass

        logger.info("Реле-сервер остановлен")


def run_relay_server():
    """Запуск реле-сервера как самостоятельного приложения"""
    server = RelayServer()
    try:
        server.start()
    except KeyboardInterrupt:
        print("\nРеле-сервер остановлен")


if __name__ == "__main__":
    run_relay_server()