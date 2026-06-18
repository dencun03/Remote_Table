import socket
import cv2
import numpy as np
import zlib
import json
import threading
import time
from PIL import Image

# Настройки подключения
PORT = 6969
screen_width, screen_height = 1280, 720  # Разрешение окна на сервере

# Таймаут ожидания клиента (в секундах)
CONNECTION_TIMEOUT = 60  # 1 минута


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind(('0.0.0.0', PORT))
    except OSError as e:
        print(f"Ошибка привязки порта: {e}")
        return

    sock.listen(1)
    print("Ожидание клиента... (запустите client.py на удаленном ПК)")
    print(f"Сервер автоматически выключится через {CONNECTION_TIMEOUT} секунд без подключения.")

    # Таймаут на accept()
    sock.settimeout(CONNECTION_TIMEOUT)

    try:
        conn, addr = sock.accept()
        print(f"Клиент подключен: {addr}")

        # Сбрасываем таймаут после подключения
        conn.settimeout(None)

        # === Получаем реальное разрешение экрана клиента ===
        print("Ожидание разрешения экрана от клиента...")
        try:
            # Запрашиваем разрешение
            conn.send(json.dumps({"type": "get_resolution"}).encode('utf-8'))
            data = conn.recv(1024).decode('utf-8')
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

        # Масштабирование координат
        scale_x = client_screen_width / screen_width
        scale_y = client_screen_height / screen_height

        # === Окно OpenCV ===
        cv2.namedWindow('Remote Desktop', cv2.WINDOW_NORMAL)
        cv2.resizeWindow('Remote Desktop', screen_width, screen_height)

        # Переменные для отслеживания перетаскивания
        is_dragging = False
        start_x, start_y = None, None

        def mouse_callback(event, x, y, flags, param):
            nonlocal is_dragging, start_x, start_y

            if event == cv2.EVENT_LBUTTONDOWN:
                # Начало клика
                conn.send(json.dumps({
                    'type': 'mouse',
                    'x': int(x * scale_x),
                    'y': int(y * scale_y),
                    'click': 'left'
                }).encode('utf-8'))
                # Начинаем отслеживать перетаскивание
                is_dragging = True
                start_x, start_y = x, y

            elif event == cv2.EVENT_MOUSEMOVE and flags == cv2.EVENT_FLAG_LBUTTON:
                # Движение с зажатой ЛКМ → перетаскивание
                if is_dragging and start_x is not None and start_y is not None:
                    conn.send(json.dumps({
                        'type': 'mouse',
                        'x': int(start_x * scale_x),
                        'y': int(start_y * scale_y),
                        'drag': True,
                        'x2': int(x * scale_x),
                        'y2': int(y * scale_y)
                    }).encode('utf-8'))
                    # Обновляем "стартовую" точку для плавного drag
                    start_x, start_y = x, y

            elif event == cv2.EVENT_LBUTTONUP:
                # Кнопка отпущена
                if is_dragging:
                    # Отправляем финальную точку БЕЗ drag, чтобы клиент отпустил мышь
                    conn.send(json.dumps({
                        'type': 'mouse',
                        'x': int(x * scale_x),
                        'y': int(y * scale_y)
                    }).encode('utf-8'))
                    is_dragging = False
                    start_x, start_y = None, None

            elif event == cv2.EVENT_RBUTTONDOWN:
                conn.send(json.dumps({
                    'type': 'mouse',
                    'x': int(x * scale_x),
                    'y': int(y * scale_y),
                    'click': 'right'
                }).encode('utf-8'))

        cv2.setMouseCallback('Remote Desktop', mouse_callback)

        # === Основной цикл приёма кадров ===
        while True:
            try:
                # Получаем длину пакета
                len_data = conn.recv(4)
                if len(len_data) == 0:
                    print("Клиент отключился.")
                    break
                total_len = int.from_bytes(len_data, 'big')

                # Получаем сам кадр
                data = b''
                while len(data) < total_len:
                    packet = conn.recv(total_len - len(data))
                    if not packet:
                        break
                    data += packet

                if len(data) == 0:
                    break

                # Декомпрессия и отображение
                frame_data = zlib.decompress(data)
                frame = cv2.imdecode(np.frombuffer(frame_data, np.uint8), cv2.IMREAD_COLOR)

                cv2.imshow('Remote Desktop', frame)

                # Обработка клавиш
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key != 255:  # Нажата клавиша
                    key_map = {
                        ord(' '): 'space',
                        8: 'backspace',
                        27: 'esc',
                        13: 'enter',
                        9: 'tab'
                    }
                    key_str = key_map.get(key, chr(key) if 32 <= key <= 126 else None)
                    if key_str:
                        conn.send(json.dumps({
                            'type': 'key',
                            'key': key_str
                        }).encode('utf-8'))

            except ConnectionResetError:
                print("Клиент разорвал соединение.")
                break
            except Exception as e:
                print(f"Ошибка: {e}")
                break

    except socket.timeout:
        print(f"\nТаймаут ожидания клиента: {CONNECTION_TIMEOUT} секунд прошло без подключения.")
        print("Сервер автоматически выключен.")
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    finally:
        cv2.destroyAllWindows()
        sock.close()


if __name__ == "__main__":
    main()