import socket
import cv2
import numpy as np
import zlib
import json
import threading
import time
from PIL import Image

# Настройки подключения
RELAY_HOST = 'your-relay-server.com'  # Заменить на реальный домен/IP
RELAY_PORT = 6969
SERVER_ID = 'TECH-001'  # Уникальный ID сервера

screen_width, screen_height = 1280, 720  

CONNECTION_TIMEOUT = 60  


def connect_to_relay():
    """Подключается к реле-серверу и регистрируется"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    
    try:
        sock.connect((RELAY_HOST, RELAY_PORT))
        print(f"✅ Подключено к реле-серверу {RELAY_HOST}:{RELAY_PORT}")
        
        # Регистрация сервера
        register_msg = {
            "type": "register_server",
            "server_id": SERVER_ID
        }
        sock.send(json.dumps(register_msg).encode('utf-8'))
        
        return sock
        
    except Exception as e:
        print(f"❌ Не удалось подключиться к реле-серверу: {e}")
        sock.close()
        return None


def main():
    # Подключаемся к реле-серверу
    relay_conn = connect_to_relay()
    if not relay_conn:
        return

    print("Ожидание входящего подключения от клиента...")

    # Ожидание подключения
    try:
        while True:
            data = relay_conn.recv(1024).decode('utf-8')
            if not data:
                continue
            
            try:
                msg = json.loads(data)
                if msg.get('type') == 'incoming_connection':
                    client_id = msg.get('client_id')
                    print(f"Поступил запрос от клиента: {client_id}")
                    break
            except json.JSONDecodeError:
                continue
                
    except Exception as e:
        print(f"Ошибка при ожидании подключения: {e}")
        relay_conn.close()
        return

    print("Начинаем сессию с клиентом...")

    # Отправляем запрос на доступ
    print("Отправка запроса на доступ...")
    access_request = {
        "type": "request_access",
        "technician_id": SERVER_ID
    }
    relay_conn.send(json.dumps(access_request).encode('utf-8'))

    # Ожидаем ответа
    try:
        response_data = relay_conn.recv(1024).decode('utf-8')
        response = json.loads(response_data)
        if response.get('type') == 'access_response':
            if response.get('granted'):
                print("✅ Доступ разрешён пользователем. Начинаем сессию.")
            else:
                print("❌ Доступ отклонён пользователем.")
                relay_conn.close()
                return
        else:
            print("⚠️ Неизвестный ответ, продолжаем (безопасно?).")
    except Exception as e:
        print(f"Ошибка при получении ответа на доступ: {e}")
        relay_conn.close()
        return

    print("Ожидание разрешения экрана от клиента...")
    try:
        relay_conn.send(json.dumps({"type": "get_resolution"}).encode('utf-8'))
        data = relay_conn.recv(1024).decode('utf-8')
        res_msg = json.loads(data)

        if res_msg['type'] == 'resolution':
            client_screen_width = res_msg['width']
            client_screen_height = res_msg['height']
            print(f"Получено разрешение: {client_screen_width}x{client_screen_height}")
        else:
            client_screen_width, client_screen_height = 1920, 1080
            print("Не удалось получить разрешение, используем 1920x1080")
    except Exception as e:
        print(f"Ошибка получения разрешения: {e}, используем 1920x1080")
        client_screen_width, client_screen_height = 1920, 1080

    scale_x = client_screen_width / screen_width
    scale_y = client_screen_height / screen_height

    cv2.namedWindow('Remote Desktop', cv2.WINDOW_NORMAL)
    cv2.resizeWindow('Remote Desktop', screen_width, screen_height)

    is_dragging = False
    start_x, start_y = None, None

    def mouse_callback(event, x, y, flags, param):
        nonlocal is_dragging, start_x, start_y

        if event == cv2.EVENT_LBUTTONDOWN:
            relay_conn.send(json.dumps({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'click': 'left'
            }).encode('utf-8'))
            is_dragging = True
            start_x, start_y = x, y

        elif event == cv2.EVENT_MOUSEMOVE and flags == cv2.EVENT_FLAG_LBUTTON:
            if is_dragging and start_x is not None and start_y is not None:
                relay_conn.send(json.dumps({
                    'type': 'mouse',
                    'x': int(start_x * scale_x),
                    'y': int(start_y * scale_y),
                    'drag': True,
                    'x2': int(x * scale_x),
                    'y2': int(y * scale_y)
                }).encode('utf-8'))
                start_x, start_y = x, y

        elif event == cv2.EVENT_LBUTTONUP:
            if is_dragging:
                relay_conn.send(json.dumps({
                    'type': 'mouse',
                    'x': int(x * scale_x),
                    'y': int(y * scale_y)
                }).encode('utf-8'))
                is_dragging = False
                start_x, start_y = None, None

        elif event == cv2.EVENT_RBUTTONDOWN:
            relay_conn.send(json.dumps({
                'type': 'mouse',
                'x': int(x * scale_x),
                'y': int(y * scale_y),
                'click': 'right'
            }).encode('utf-8'))

    cv2.setMouseCallback('Remote Desktop', mouse_callback)

    try:
        while True:
            try:
                len_data = relay_conn.recv(4)
                if len(len_data) == 0:
                    print("Клиент отключился.")
                    break
                total_len = int.from_bytes(len_data, 'big')

                data = b''
                while len(data) < total_len:
                    packet = relay_conn.recv(total_len - len(data))
                    if not packet:
                        break
                    data += packet

                if len(data) == 0:
                    break

                frame_data = zlib.decompress(data)
                frame = cv2.imdecode(np.frombuffer(frame_data, np.uint8), cv2.IMREAD_COLOR)

                cv2.imshow('Remote Desktop', frame)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key != 255:
                    key_map = {
                        ord(' '): 'space',
                        8: 'backspace',
                        27: 'esc',
                        13: 'enter',
                        9: 'tab'
                    }
                    key_str = key_map.get(key, chr(key) if 32 <= key <= 126 else None)
                    if key_str:
                        relay_conn.send(json.dumps({
                            'type': 'key',
                            'key': key_str
                        }).encode('utf-8'))

            except ConnectionResetError:
                print("Клиент разорвал соединение.")
                break
            except Exception as e:
                print(f"Ошибка: {e}")
                break
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    finally:
        cv2.destroyAllWindows()
        relay_conn.close()


if __name__ == "__main__":
    main()