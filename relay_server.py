"""
Реле-сервер для системы удалённой технической поддержки

Улучшения:
- Thread-safe операции с блокировками
- Обработка ошибок и автоматическая очистка
- Логирование операций
- Таймауты и защита от зависаний
- Архитектура для масштабирования
"""

import socket
import threading
import json
import time
import logging
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import queue

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('relay_server.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class ConnectionType(Enum):
    """Тип подключения"""
    CLIENT = "client"
    SERVER = "server"


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
    """Потокобезопасный словарь"""

    def __init__(self):
        self._data: Dict[str, ConnectionInfo] = {}
        self._lock = threading.RLock()

    def add(self, key: str, value: ConnectionInfo):
        with self._lock:
            self._data[key] = value
            logger.info(f"[REGISTER] {value.connection_type.value} зарегистрирован: {key}")

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
    """Реле-сервер для маршрутизации соединений"""

    def __init__(self, host: str = '0.0.0.0', port: int = 6969, timeout: int = 300):
        self.host = host
        self.port = port
        self.timeout = timeout

        # Хранилища подключений
        self.clients = ThreadSafeDict()  # client_id -> ConnectionInfo
        self.servers = ThreadSafeDict()  # server_id -> ConnectionInfo
        self.connections: Dict[str, str] = {}  # client_id -> server_id

        # Блокировки для операций с соединениями
        self._connection_lock = threading.RLock()

        # Очередь для broadcast-сообщений
        self._broadcast_queue = queue.Queue()

        # Флаг работы
        self._running = False

        # Сокет сервера
        self.server_socket: Optional[socket.socket] = None

    def start(self):
        """Запуск реле-сервера"""
        self._running = True

        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind((self.host, self.port))
            self.server_socket.listen(10)
            self.server_socket.settimeout(1)  # Периодическая проверка флага

            logger.info(f"Реле-сервер запущен на {self.host}:{self.port}")

            # Запуск фоновых потоков
            threading.Thread(target=self._status_broadcaster, daemon=True, name="StatusBroadcaster").start()
            threading.Thread(target=self._connection_cleaner, daemon=True, name="ConnectionCleaner").start()

            # Основной цикл принятия подключений
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

                # Обработка в отдельном потоке
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
            # Установка таймаута для получения первого сообщения
            client_socket.settimeout(30)

            # Получение первого сообщения (регистрация)
            data = client_socket.recv(4096)
            if not data:
                logger.warning(f"Пустое подключение от {client_address}")
                return

            msg = json.loads(data.decode('utf-8'))
            msg_type = msg.get('type')

            if msg_type == 'register_client':
                # Это клиент
                client_id = msg.get('client_id')
                if not client_id:
                    client_id = f"client_{client_address[0]}_{client_address[1]}"

                conn_info = ConnectionInfo(
                    socket=client_socket,
                    address=client_address,
                    connection_type=ConnectionType.CLIENT,
                    connection_id=client_id
                )
                conn_info.registered_id = client_id

                self.clients.add(client_id, conn_info)
                self._send_status(client_socket)

            elif msg_type == 'register_server':
                # Это сервер (специалист)
                server_id = msg.get('server_id')
                if not server_id:
                    server_id = f"server_{client_address[0]}_{client_address[1]}"

                conn_info = ConnectionInfo(
                    socket=client_socket,
                    address=client_address,
                    connection_type=ConnectionType.SERVER,
                    connection_id=server_id
                )
                conn_info.registered_id = server_id

                self.servers.add(server_id, conn_info)
                self._broadcast_status()

            else:
                logger.warning(f"Неизвестный тип регистрации: {msg_type}")
                return

            # Сброс таймаута для длительного соединения
            client_socket.settimeout(self.timeout)

            # Цикл обработки сообщений
            self._message_loop(client_socket, conn_info)

        except json.JSONDecodeError:
            logger.error(f"Неверный JSON от {client_address}")
        except socket.timeout:
            logger.warning(f"Таймаут регистрации от {client_address}")
        except Exception as e:
            logger.error(f"Ошибка обработки подключения {client_address}: {e}")
        finally:
            self._cleanup_connection(conn_info)

    def _message_loop(self, client_socket: socket.socket, conn_info: ConnectionInfo):
        """Цикл обработки сообщений от клиента/сервера"""
        buffer = b''

        while self._running:
            try:
                # Получение данных
                data = client_socket.recv(8192)
                if not data:
                    break

                conn_info.last_activity = time.time()
                buffer += data

                # Обработка буфера
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        msg = json.loads(line.decode('utf-8'))
                        self._process_message(conn_info, msg)
                    except json.JSONDecodeError:
                        continue

            except socket.timeout:
                # Проверка активности
                if time.time() - conn_info.last_activity > self.timeout:
                    logger.info(f"Таймаут неактивного подключения: {conn_info.connection_id}")
                    break
            except Exception as e:
                logger.error(f"Ошибка в цикле сообщений: {e}")
                break

    def _process_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения"""
        msg_type = msg.get('type')

        if conn_info.connection_type == ConnectionType.CLIENT:
            self._process_client_message(conn_info, msg)

        elif conn_info.connection_type == ConnectionType.SERVER:
            self._process_server_message(conn_info, msg)

    def _process_client_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения от клиента"""
        msg_type = msg.get('type')

        if msg_type == 'connect_to_server':
            target_server = msg.get('server_id')
            self._establish_connection(conn_info, target_server)

        elif msg_type == 'data':
            # Пересылка данных серверу
            self._forward_to_server(conn_info.connection_id, msg)

        elif msg_type == 'ping':
            # Ответ на ping
            conn_info.socket.send(json.dumps({"type": "pong"}).encode('utf-8'))

    def _process_server_message(self, conn_info: ConnectionInfo, msg: dict):
        """Обработка сообщения от сервера (специалиста)"""
        msg_type = msg.get('type')

        if msg_type == 'data':
            # Найти связанного клиента и переслать данные
            self._forward_to_client(conn_info.connection_id, msg)

        elif msg_type == 'request_access':
            # Запрос доступа к клиенту (через relay)
            client_id = msg.get('client_id')
            if client_id:
                self._forward_to_client(client_id, {
                    "type": "relay_access_request",
                    "server_id": conn_info.connection_id
                })

        elif msg_type == 'ping':
            conn_info.socket.send(json.dumps({"type": "pong"}).encode('utf-8'))

    def _establish_connection(self, client_info: ConnectionInfo, server_id: str):
        """Установление соединения клиент-сервер"""
        with self._connection_lock:
            server_info = self.servers.get(server_id)

            if not server_info:
                client_info.socket.send(json.dumps({
                    "type": "error",
                    "message": "Сервер недоступен"
                }).encode('utf-8'))
                logger.warning(f"Сервер {server_id} не найден")
                return

            # Установка связи
            self.connections[client_info.connection_id] = server_id
            client_info.connected_to = server_id

            # Уведомление сервера о подключении клиента
            server_info.socket.send(json.dumps({
                "type": "incoming_connection",
                "client_id": client_info.connection_id
            }).encode('utf-8'))

            logger.info(f"Установлено соединение: {client_info.connection_id} -> {server_id}")

    def _forward_to_server(self, client_id: str, msg: dict):
        """Пересылка сообщения от клиента серверу"""
        with self._connection_lock:
            server_id = self.connections.get(client_id)
            if not server_id:
                return

            server_info = self.servers.get(server_id)
            if server_info:
                try:
                    data = json.dumps(msg).encode('utf-8') + b'\n'
                    server_info.socket.sendall(data)
                except Exception as e:
                    logger.error(f"Ошибка пересылки серверу {server_id}: {e}")

    def _forward_to_client(self, server_id: str, msg: dict):
        """Пересылка сообщения от сервера клиенту"""
        with self._connection_lock:
            # Найти клиента, связанного с этим сервером
            client_id = None
            for cid, sid in self.connections.items():
                if sid == server_id:
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
                    logger.error(f"Ошибка пересылки клиенту {client_id}: {e}")

    def _send_status(self, client_socket: socket.socket):
        """Отправка статуса клиенту"""
        try:
            status = {
                "type": "status",
                "servers": self.servers.keys_by_type(ConnectionType.SERVER)
            }
            client_socket.send(json.dumps(status).encode('utf-8'))
        except Exception as e:
            logger.error(f"Ошибка отправки статуса: {e}")

    def _broadcast_status(self):
        """Рассылка статуса всем клиентам"""
        status = {
            "type": "status",
            "servers": self.servers.keys_by_type(ConnectionType.SERVER)
        }
        status_data = json.dumps(status).encode('utf-8')

        for client_info in self.clients.get_all().values():
            try:
                client_info.socket.send(status_data)
            except Exception:
                pass

    def _status_broadcaster(self):
        """Фоновый поток рассылки статуса"""
        while self._running:
            time.sleep(10)  # Обновление каждые 10 секунд
            self._broadcast_status()

    def _connection_cleaner(self):
        """Фоновый поток очистки неактивных соединений"""
        while self._running:
            time.sleep(60)  # Проверка каждую минуту

            now = time.time()
            timeout_threshold = self.timeout * 2

            # Проверка клиентов
            for client_id in list(self.clients.keys_by_type(ConnectionType.CLIENT)):
                client = self.clients.get(client_id)
                if client and (now - client.last_activity) > timeout_threshold:
                    logger.info(f"Удаление неактивного клиента: {client_id}")
                    self._cleanup_connection(client)

            # Проверка серверов
            for server_id in list(self.servers.keys_by_type(ConnectionType.SERVER)):
                server = self.servers.get(server_id)
                if server and (now - server.last_activity) > timeout_threshold:
                    logger.info(f"Удаление неактивного сервера: {server_id}")
                    self._cleanup_connection(server)

    def _cleanup_connection(self, conn_info: Optional[ConnectionInfo]):
        """Очистка ресурсов подключения"""
        if not conn_info:
            return

        try:
            conn_info.socket.close()
        except Exception:
            pass

        # Удаление из хранилищ
        if conn_info.connection_type == ConnectionType.CLIENT:
            self.clients.remove(conn_info.connection_id)
        elif conn_info.connection_type == ConnectionType.SERVER:
            self.servers.remove(conn_info.connection_id)

        # Удаление связанных соединений
        with self._connection_lock:
            if conn_info.connection_id in self.connections:
                del self.connections[conn_info.connection_id]

        logger.info(f"Очистка завершена: {conn_info.connection_id}")

    def shutdown(self):
        """Завершение работы сервера"""
        logger.info("Завершение работы реле-сервера...")
        self._running = False

        # Закрытие всех подключений
        for client_info in self.clients.get_all().values():
            try:
                client_info.socket.close()
            except Exception:
                pass

        for server_info in self.servers.get_all().values():
            try:
                server_info.socket.close()
            except Exception:
                pass

        # Закрытие серверного сокета
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass

        logger.info("Реле-сервер остановлен")


def main():
    """Точка входа реле-сервера"""
    import os

    host = os.environ.get('RELAY_HOST', '0.0.0.0')
    port = int(os.environ.get('RELAY_PORT', '6969'))

    server = RelayServer(host=host, port=port, timeout=300)

    print(f"""
╔══════════════════════════════════════════════════╗
║        РЕЛЕ-СЕРВЕР УДАЛЁННОГО ДОСТУПА           ║
╠══════════════════════════════════════════════════╣
║  Хост: {host:<38}║
║  Порт: {port:<38}║
╚══════════════════════════════════════════════════╝
    """)

    try:
        server.start()
    except KeyboardInterrupt:
        print("\nПолучен сигнал остановки")
        server.shutdown()


if __name__ == "__main__":
    main()