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

# === Установи: pip install keyboard pyperclip ===
import keyboard
import pyperclip

# Настройки
HOST = '192.168.56.1'  # IP сервера
PORT = 6969
screen_width, screen_height = 1280, 720  # Разрешение передачи
FPS = 30  # Целевая частота кадров

# Очередь для отправки кадров
frame_queue = queue.Queue(maxsize=2)

# Флаги
running = True
is_dragging = False  # Для отслеживания состояния перетаскивания


def send_frame(conn, frame):
    """Отправляет кадр через сокет"""
    if conn.fileno() == -1:
        return False
    try:
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        data = zlib.compress(buffer.tobytes(), level=6)
        conn.send(len(data).to_bytes(4, 'big'))
        conn.send(data)
        return True
    except Exception as e:
        print(f"Ошибка отправки кадра: {e}")
        return False


def capture_and_send(conn):
    """Захватывает экран и отправляет кадры"""
    last_time = time.time()
    while running:
        try:
            screenshot = pyautogui.screenshot()
            frame = np.array(screenshot)
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            frame = cv2.resize(frame, (screen_width, screen_height))

            if not frame_queue.full():
                with frame_queue.mutex:
                    frame_queue.queue.clear()
                frame_queue.put_nowait(frame)

            # Регулируем FPS
            elapsed = time.time() - last_time
            if elapsed < 1 / FPS:
                time.sleep((1 / FPS - elapsed) * 0.8)
            last_time = time.time()

        except queue.Full:
            continue
        except Exception as e:
            print(f"Ошибка захвата: {e}")
            break


def send_from_queue(conn):
    """Отправляет кадры из очереди"""
    while running:
        try:
            frame = frame_queue.get(timeout=1)
            if not send_frame(conn, frame):
                break
            frame_queue.task_done()
        except queue.Empty:
            continue
        except Exception as e:
            print(f"Ошибка в очереди отправки: {e}")
            break


def receive_commands(conn):
    """Принимает команды от сервера и выполняет их"""
    global running, is_dragging

    while running:
        try:
            data = conn.recv(1024).decode('utf-8')
            if not data:
                print("Сервер отключился.")
                running = False
                break

            cmd = json.loads(data)

            # === Запрос разрешения экрана ===
            if cmd.get('type') == 'get_resolution':
                width, height = pyautogui.size()
                res_msg = {
                    "type": "resolution",
                    "width": width,
                    "height": height
                }
                conn.send(json.dumps(res_msg).encode('utf-8'))
                print(f"[INFO] Отправлено разрешение: {width}x{height}")
                continue

            # === Обработка команды мыши ===
            if cmd['type'] == 'mouse':
                x, y = cmd['x'], cmd['y']
                pyautogui.moveTo(x, y)

                # ЛКМ / ПКМ клик
                if cmd.get('click') == 'left':
                    pyautogui.click()
                elif cmd.get('click') == 'right':
                    pyautogui.rightClick()

                # Перетаскивание
                if cmd.get('drag') and not is_dragging:
                    # Начало перетаскивания — зажимаем левую кнопку
                    pyautogui.mouseDown(button='left')
                    is_dragging = True
                elif is_dragging and not cmd.get('drag'):
                    # Конец перетаскивания — отпускаем
                    pyautogui.mouseUp(button='left')
                    is_dragging = False

            # === Обработка клавиатуры ===
            elif cmd['type'] == 'key':
                key = cmd['key']

                # Специальные клавиши
                if key == 'backspace':
                    pyautogui.press('backspace')
                elif key == 'space':
                    pyautogui.press('space')
                elif key == 'enter':
                    pyautogui.press('enter')
                elif key == 'esc':
                    pyautogui.press('esc')
                elif key == 'tab':
                    pyautogui.press('tab')
                elif key in ['shift', 'ctrl', 'alt']:
                    pyautogui.press(key)
                else:
                    # === Ввод текста (включая кириллицу) ===
                    try:
                        # Копируем символ в буфер и вставляем (работает в большинстве приложений)
                        pyperclip.copy(key)
                        pyautogui.hotkey('ctrl', 'v')
                    except Exception as e:
                        print(f"[KEYBOARD] Ошибка вставки, пробуем keyboard.write(): {e}")
                        try:
                            keyboard.write(key)
                        except Exception as e2:
                            print(f"[KEYBOARD] Не удалось ввести символ '{key}': {e2}")

        except json.JSONDecodeError as e:
            print(f"Ошибка парсинга JSON: {e}")
        except Exception as e:
            print(f"Ошибка приёма команды: {e}")
            running = False
            break


def main():
    global running
    pyautogui.FAILSAFE = False

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    print("Подключение к серверу...")
    while running:
        try:
            sock.connect((HOST, PORT))
            print("✅ Подключено к серверу.")
            break
        except ConnectionRefusedError:
            if not running:
                return
            print("❌ Сервер не отвечает, пробуем снова...")
            time.sleep(2)

    if not running:
        return

    # Запуск потоков
    threading.Thread(target=capture_and_send, args=(sock,), daemon=True).start()
    threading.Thread(target=send_from_queue, args=(sock,), daemon=True).start()
    threading.Thread(target=receive_commands, args=(sock,), daemon=True).start()

    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nКлиент остановлен пользователем.")
    finally:
        running = False
        sock.close()
        print("Клиент завершил работу.")
        sys.exit(0)


if __name__ == "__main__":
    main()