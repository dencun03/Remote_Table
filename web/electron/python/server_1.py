"""
server_1.py — Сервер удалённого управления (сторона специалиста)

Принимает TCP-соединение от client_1.py на порту 6969,
получает кадры экрана и раздаёт их браузеру через MJPEG-стрим.

HTTP endpoints (порт 8080):
  GET  /stream  — MJPEG-видеопоток для <img src="...">
  GET  /status  — JSON: { connected, resolution }
  POST /mouse   — JSON: { type:'mouse', x, y, click?, drag? }
  POST /key     — JSON: { type:'key', key }

Использование:
  python server_1.py [client_port] [http_port]
"""

import socket
import cv2
import numpy as np
import zlib
import json
import threading
import time
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

# === Конфигурация ===
CLIENT_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 6969
HTTP_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
DISPLAY_W, DISPLAY_H = 1280, 720
CONNECTION_TIMEOUT = 120  # секунды ожидания клиента

# === Разделяемое состояние ===
latest_frame_jpeg = None
frame_lock = threading.Lock()
client_conn = None
client_conn_lock = threading.Lock()
client_resolution = {"width": 1920, "height": 1080}
running = True


# ==================== HTTP-сервер для браузера ====================

class ControlHTTPHandler(BaseHTTPRequestHandler):
    """Обработчик HTTP-запросов от браузера специалиста."""

    def log_message(self, *args):
        pass  # Подавляем логи HTTP

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/stream':
            self._handle_mjpeg()
        elif self.path == '/status':
            self._handle_status()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path in ('/mouse', '/key'):
            self._handle_command()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_mjpeg(self):
        """MJPEG-стрим — бесконечная отправка JPEG-кадров."""
        self.send_response(200)
        self.send_header('Content-type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control', 'no-cache, private')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        while running:
            with frame_lock:
                frame = latest_frame_jpeg
            if frame is None:
                time.sleep(0.03)
                continue
            try:
                self.wfile.write(b'--frame\r\n')
                self.send_header('Content-type', 'image/jpeg')
                self.send_header('Content-length', str(len(frame)))
                self.end_headers()
                self.wfile.write(frame)
                self.wfile.write(b'\r\n')
            except (BrokenPipeError, ConnectionResetError):
                break
            time.sleep(1 / 30)  # ~30 FPS

    def _handle_status(self):
        """Статус соединения для опроса из браузера."""
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        with client_conn_lock:
            connected = client_conn is not None
        self.wfile.write(json.dumps({
            'connected': connected,
            'resolution': client_resolution,
        }).encode())

    def _handle_command(self):
        """Приём команды мыши/клавиатуры от браузера → пересылка клиенту."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        try:
            cmd = json.loads(body)
            with client_conn_lock:
                if client_conn is not None:
                    client_conn.sendall(json.dumps(cmd).encode('utf-8'))
                    self.wfile.write(json.dumps({'success': True}).encode())
                else:
                    self.wfile.write(json.dumps({
                        'success': False,
                        'error': 'Клиент не подключён',
                    }).encode())
        except Exception as e:
            self.wfile.write(json.dumps({
                'success': False,
                'error': str(e),
            }).encode())


def start_http_server():
    """Запуск HTTP-сервера в фоновом потоке."""
    server = HTTPServer(('127.0.0.1', HTTP_PORT), ControlHTTPHandler)
    print(f"[HTTP] Сервер управления: http://localhost:{HTTP_PORT}", flush=True)
    print(f"[HTTP] MJPEG-стрим: http://localhost:{HTTP_PORT}/stream", flush=True)
    server.serve_forever()


# ==================== TCP-сервер для клиента ====================

def receive_frames(conn, addr):
    """Приём кадров от client_1.py."""
    global client_conn, client_resolution

    with client_conn_lock:
        client_conn = conn

    print(f"[TCP] Клиент подключён: {addr}", flush=True)

    # Запрос разрешения экрана
    try:
        conn.sendall(json.dumps({"type": "get_resolution"}).encode('utf-8'))
        data = conn.recv(1024).decode('utf-8')
        res_msg = json.loads(data)
        if res_msg.get('type') == 'resolution':
            client_resolution = {
                'width': res_msg['width'],
                'height': res_msg['height'],
            }
            print(f"[TCP] Разрешение клиента: {client_resolution['width']}x{client_resolution['height']}", flush=True)
    except Exception as e:
        print(f"[TCP] Ошибка получения разрешения: {e}", flush=True)

    # Цикл приёма кадров
    while running:
        try:
            len_data = conn.recv(4)
            if len(len_data) < 4:
                break
            total_len = int.from_bytes(len_data, 'big')

            data = b''
            while len(data) < total_len:
                packet = conn.recv(min(total_len - len(data), 65536))
                if not packet:
                    break
                data += packet

            if len(data) == 0:
                break

            # Декомпрессия
            frame_data = zlib.decompress(data)
            frame = cv2.imdecode(np.frombuffer(frame_data, np.uint8), cv2.IMREAD_COLOR)

            if frame is not None:
                # Конвертация в JPEG для MJPEG-стрима
                _, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with frame_lock:
                    latest_frame_jpeg = jpeg.tobytes()

        except ConnectionResetError:
            print("[TCP] Клиент разорвал соединение", flush=True)
            break
        except Exception as e:
            print(f"[TCP] Ошибка: {e}", flush=True)
            break

    with client_conn_lock:
        client_conn = None
    print("[TCP] Клиент отключился", flush=True)


def main():
    # Запуск HTTP-сервера
    threading.Thread(target=start_http_server, daemon=True).start()

    # TCP-сокет для клиента
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        sock.bind(('0.0.0.0', CLIENT_PORT))
    except OSError as e:
        print(f"[ERROR] Не удалось привязать порт {CLIENT_PORT}: {e}", flush=True)
        return

    sock.listen(1)
    sock.settimeout(CONNECTION_TIMEOUT)
    print(f"[TCP] Ожидание клиента на порту {CLIENT_PORT}...", flush=True)
    print(f"[TCP] Таймаут: {CONNECTION_TIMEOUT} сек", flush=True)

    try:
        conn, addr = sock.accept()
        conn.settimeout(None)
        receive_frames(conn, addr)
    except socket.timeout:
        print(f"[TCP] Таймаут: клиент не подключился за {CONNECTION_TIMEOUT} сек", flush=True)
    except KeyboardInterrupt:
        print("\n[TCP] Остановлен пользователем", flush=True)
    finally:
        sock.close()
        running = False


if __name__ == "__main__":
    main()
