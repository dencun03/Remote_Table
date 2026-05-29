import socket
import threading
import json
import time

# Глобальные переменные
clients = {}  # client_id -> socket
servers = {}  # server_id -> socket
connections = {}  # client_id -> server_id

HOST = '0.0.0.0'
PORT = 6969

print_lock = threading.Lock()

def log(message):
    with print_lock:
        print(f"[RELAY] {message}")
def broadcast_status():
    """Отправляет список активных серверов клиентам"""
    while True:
        time.sleep(5)  # Обновлять каждые 5 секунд
        status = {
            'type': 'status',
            'servers': list(servers.keys())
        }
        status_data = json.dumps(status).encode('utf-8')
        for client_socket in clients.values():
            try:
                client_socket.send(status_data)
            except:
                pass

def handle_client(client_socket, client_address):
    client_id = None
    try:
        while True:
            data = client_socket.recv(1024)
            if not data:
                break

            try:
                msg = json.loads(data.decode('utf-8'))
            except json.JSONDecodeError:
                continue

            msg_type = msg.get('type')

            if msg_type == 'register_client':
                client_id = msg.get('client_id')
                if client_id:
                    clients[client_id] = client_socket
                    log(f"Клиент зарегистрирован: {client_id}")
                    # Отправляем список серверов
                    status = {
                        'type': 'status',
                        'servers': list(servers.keys())
                    }
                    client_socket.send(json.dumps(status).encode('utf-8'))

            elif msg_type == 'connect_to_server':
                target_server = msg.get('server_id')
                if target_server in servers:
                    # Устанавливаем соединение
                    connections[client_id] = target_server
                    server_socket = servers[target_server]
                    # Уведомляем сервер
                    server_socket.send(json.dumps({
                        'type': 'incoming_connection',
                        'client_id': client_id
                    }).encode('utf-8'))
                    log(f"Клиент {client_id} подключается к серверу {target_server}")
                else:
                    client_socket.send(json.dumps({
                        'type': 'error',
                        'message': 'Сервер не найден'
                    }).encode('utf-8'))

            elif msg_type == 'data':
                target_server = connections.get(client_id)
                if target_server and target_server in servers:
                    servers[target_server].send(data)

    except Exception as e:
        log(f"Ошибка клиента {client_id}: {e}")
    finally:
        if client_id and client_id in clients:
            del clients[client_id]
        if client_id and client_id in connections:
            del connections[client_id]
        client_socket.close()

def handle_server(server_socket, server_address):
    server_id = None
    try:
        while True:
            data = server_socket.recv(1024)
            if not data:
                break

            try:
                msg = json.loads(data.decode('utf-8'))
            except json.JSONDecodeError:
                continue

            msg_type = msg.get('type')

            if msg_type == 'register_server':
                server_id = msg.get('server_id')
                if server_id:
                    servers[server_id] = server_socket
                    log(f"Сервер зарегистрирован: {server_id}")
                    # Уведомляем всех клиентов
                    status = {
                        'type': 'status',
                        'servers': list(servers.keys())
                    }
                    status_data = json.dumps(status).encode('utf-8')
                    for client_socket in clients.values():
                        try:
                            client_socket.send(status_data)
                        except:
                            pass

            elif msg_type == 'data':
                # Найти клиента, связанного с этим сервером
                client_id = None
                for cid, sid in connections.items():
                    if sid == server_id:
                        client_id = cid
                        break
                if client_id and client_id in clients:
                    clients[client_id].send(data)

    except Exception as e:
        log(f"Ошибка сервера {server_id}: {e}")
    finally:
        if server_id and server_id in servers:
            del servers[server_id]
        # Удалить все соединения с этим сервером
        for client_id in list(connections.keys()):
            if connections[client_id] == server_id:
                del connections[client_id]
        server_socket.close()

def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        server.bind((HOST, PORT))
    except OSError as e:
        log(f"Ошибка привязки порта: {e}")
        return
    
    server.listen(5)
    log(f"Реле-сервер запущен на порту {PORT}")
    
    # Запускаем поток рассылки статуса
    threading.Thread(target=broadcast_status, daemon=True).start()
    
    while True:
        try:
            client_socket, client_address = server.accept()
            log(f"Новое подключение от {client_address}")
            
            # Определяем тип подключения
            data = client_socket.recv(1024)
            if not data:
                client_socket.close()
                continue
                
            try:
                msg = json.loads(data.decode('utf-8'))
                msg_type = msg.get('type')
                
                if msg_type == 'register_client':
                    # Это клиент
                    threading.Thread(target=handle_client, args=(client_socket, client_address), daemon=True).start()
                    # Повторно отправляем сообщение в обработчик
                    client_socket.send(data)
                elif msg_type == 'register_server':
                    # Это сервер
                    threading.Thread(target=handle_server, args=(client_socket, client_address), daemon=True).start()
                    # Повторно отправляем сообщение в обработчик
                    client_socket.send(data)
                else:
                    log(f"Неизвестный тип подключения от {client_address}")
                    client_socket.close()
                    
            except json.JSONDecodeError:
                log(f"Неверный формат JSON от {client_address}")
                client_socket.close()
                
        except Exception as e:
            log(f"Ошибка приёма подключения: {e}")

if __name__ == "__main__":
    main()