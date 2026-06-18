"""
client_1.py — Клиент удалённого управления (сторона пользователя)

Захватывает экран через pyautogui, отправляет кадры server_1.py,
принимает и выполняет команды мыши/клавиатуры.

Использование:
  python client_1.py <server_host> [server_port]

Пример:
  python client_1.py 192.168.1.100 6969
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

# === Установка: pip install keyboard pyperclip ===
import keyboard
import pyperclip

# === Конфигурация ===
HOST = sys.argv[1] if len(sys.argv) > 1 else '127.0.0.1'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 6969
SCREEN_W, SCREEN_H = 1280, 720  # Разрешение передачи
FPS = 30

# Очередь кадров
frame_queue = queue.Queue(maxsize=2)

# Флаги
running = True
is_dragging = False


def send_frame(conn, frame):
    """Отправка кадра через сокет."""
    try:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        data = zlib.compress(buffer.tobytes(), level=6)
        conn.sendall(len(data).to_bytes(4, 'big'))
        conn.sendall(data)
        return True
    except Exception as e:
        print(f"[ERROR] Ошибка отправки кадра: {e}", flush=True)
        return False


def capture_and_send(conn):
    """Захват экрана и отправка кадров."""
    global running
    last_time = time.time()

    while running:
        try:
            screenshot = pyautogui.screenshot()
            frame = np.array(screenshot)
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            frame = cv2.resize(frame, (SCREEN_W, SCREEN_H))

            if not frame_queue.full():
                with frame_queue.mutex:
                    frame_queue.queue.clear()
                frame_queue.put_nowait(frame)

            # Регулировка FPS
            elapsed = time.time() - last_time
            if elapsed < 1 / FPS:
                time.sleep((1 / FPS - elapsed) * 0.8)
            last_time = time.time()

        except Exception as e:
            print(f"[ERROR] Ошибка захвата: {e}", flush=True)
            break


def send_from_queue(conn):
    """Отправка кадров из очереди."""
    global running
    while running:
        try:
            frame = frame_queue.get(timeout=1)
            if not send_frame(conn, frame):
                running = False
                break
            frame_queue.task_done()
        except queue.Empty:
            continue
        except Exception as e:
            print(f"[ERROR] Ошибка в очереди: {e}", flush=True)
            break


def receive_commands(conn):
    """Приём и выполнение команд от сервера."""
    global running, is_dragging

    while running:
        try:
            data = conn.recv(4096).decode('utf-8')
            if not data:
                print("[INFO] Сервер отключился", flush=True)
                running = False
                break

            # Может прийти несколько команд в одном пакете
            for line in data.strip().split('\n'):
                if not line:
                    continue
                cmd = json.loads(line)
                _execute_command(cmd)

        except json.JSONDecodeError as e:
            print(f"[WARN] Ошибка JSON: {e}", flush=True)
        except Exception as e:
            print(f"[ERROR] Ошибка приёма: {e}", flush=True)
            running = False
            break


def _execute_command(cmd):
    """Выполнение одной команды."""
    global is_dragging

    # === Запрос разрешения экрана ===
    if cmd.get('type') == 'get_resolution':
        w, h = pyautogui.size()
        conn_msg = json.dumps({"type": "resolution", "width": w, "height": h}).encode('utf-8')
        # Отправляем через глобальный сокет — пробрасываем через аргумент
        # (вызывается из receive_commands где есть conn)
        _send_json(cmd['_conn'] if '_conn' in cmd else None, conn_msg)
        return

    # === Команда мыши ===
    if cmd['type'] == 'mouse':
        x, y = cmd['x'], cmd['y']
        pyautogui.moveTo(x, y, duration=0)

        if cmd.get('click') == 'left':
            pyautogui.click()
        elif cmd.get('click') == 'right':
            pyautogui.rightClick()

        # Перетаскивание
        if cmd.get('drag') and not is_dragging:
            pyautogui.mouseDown(button='left')
            is_dragging = True
        elif is_dragging and not cmd.get('drag'):
            pyautogui.mouseUp(button='left')
            is_dragging = False

    # === Команда клавиатуры ===
    elif cmd['type'] == 'key':
        key = cmd['key']
        special = {'backspace', 'space', 'enter', 'esc', 'tab', 'shift', 'ctrl', 'alt', 'delete'}

        if key.lower() in special:
            pyautogui.press(key.lower())
        else:
            # Ввод текста (включая кириллицу) через буфер обмена
            try:
                pyperclip.copy(key)
                pyautogui.hotkey('ctrl', 'v')
            except Exception:
                try:
                    keyboard.write(key)
                except Exception as e:
                    print(f"[KEYBOARD] Не удалось ввести '{key}': {e}", flush=True)


def _send_json(conn, msg):
    """Отправка JSON через сокет."""
    if conn is None:
        return
    try:
        conn.sendall(msg)
    except Exception as e:
        print(f"[ERROR] Ошибка отправки JSON: {e}", flush=True)


def main():
    global running
    pyautogui.FAILSAFE = False

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    print(f"[INFO] Подключение к {HOST}:{PORT}...", flush=True)
    retry_count = 0
    while running and retry_count < 30:
        try:
            sock.connect((HOST, PORT))
            print("[INFO] ✅ Подключено к серверу", flush=True)
            break
        except ConnectionRefusedError:
            if not running:
                return
            retry_count += 1
            print(f"[WARN] Сервер не отвечает, попытка {retry_count}/30...", flush=True)
            time.sleep(2)
    else:
        if running:
            print("[ERROR] Не удалось подключиться к серверу", flush=True)
        return

    if not running:
        return

    # Запуск потоков
    threading.Thread(target=capture_and_send, args=(sock,), daemon=True).start()
    threading.Thread(target=send_from_queue, args=(sock,), daemon=True).start()

    # Обработка команд (включая get_resolution)
    def receive_with_resolution():
        """Обёртка для передачи sock в _execute_command."""
        global running
        while running:
            try:
                data = sock.recv(4096).decode('utf-8')
                if not data:
                    print("[INFO] Сервер отключился", flush=True)
                    running = False
                    break

                for line in data.strip().split('\n'):
                    if not line:
                        continue
                    cmd = json.loads(line)

                    # Спецобработка get_resolution
                    if cmd.get('type') == 'get_resolution':
                        w, h = pyautogui.size()
                        _send_json(sock, json.dumps({
                            "type": "resolution",
                            "width": w,
                            "height": h,
                        }).encode('utf-8'))
                        print(f"[INFO] Отправлено разрешение: {w}x{h}", flush=True)
                    else:
                        _execute_command(cmd)

            except json.JSONDecodeError as e:
                print(f"[WARN] Ошибка JSON: {e}", flush=True)
            except Exception as e:
                print(f"[ERROR] Ошибка приёма: {e}", flush=True)
                running = False
                break

    threading.Thread(target=receive_with_resolution, daemon=True).start()

    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[INFO] Клиент остановлен", flush=True)
    finally:
        running = False
        try:
            sock.close()
        except:
            pass
        print("[INFO] Клиент завершил работу", flush=True)
        sys.exit(0)


if __name__ == "__main__":
    main()
