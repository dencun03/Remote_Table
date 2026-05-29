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

import keyboard
import pyperclip

# GUI модули
import customtkinter as ctk
import tkinter.messagebox as messagebox

class PermissionApp:
    def __init__(self):
        self.root = None
        self.permission_granted = None

    def request_permission(self, technician_id):
        """Показывает окно подтверждения доступа"""
        self.permission_granted = None
        self.root = ctk.CTk()
        self.root.title("Запрос удалённого доступа")
        self.root.geometry("400x200")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)

        ctk.CTkLabel(self.root, text=f"Специалист {technician_id} запрашивает доступ к вашему компьютеру", 
                    font=ctk.CTkFont(size=14, weight="bold"), wraplength=350).pack(pady=20)

        ctk.CTkLabel(self.root, text="Вы можете передать управление экраном и мышью.", 
                    wraplength=350).pack(pady=5)

        btn_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        btn_frame.pack(pady=20)

        ctk.CTkButton(btn_frame, text="Разрешить", fg_color="green", hover_color="darkgreen", 
                     command=lambda: self.grant_permission(True)).pack(side="left", padx=10)
        ctk.CTkButton(btn_frame, text="Отклонить", fg_color="red", hover_color="darkred", 
                     command=lambda: self.grant_permission(False)).pack(side="left", padx=10)

        self.root.protocol("WM_DELETE_WINDOW", lambda: self.grant_permission(False))
        self.root.after(30000, lambda: self.grant_permission(False))  # Таймаут 30 сек

        self.root.mainloop()
        return self.permission_granted

    def grant_permission(self, granted):
        self.permission_granted = granted
        if self.root:
            self.root.destroy()

# Настройки подключения
RELAY_HOST = 'your-relay-server.com'  # Заменить на реальный домен/IP
RELAY_PORT = 6969
CLIENT_ID = 'CLIENT-001'  # Уникальный ID клиента
TARGET_SERVER_ID = 'TECH-001'  # ID сервера (специалиста)

screen_width, screen_height = 1280, 720  
FPS = 30  

frame_queue = queue.Queue(maxsize=2)
running = True
is_dragging = False  


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

            try:
                cmd = json.loads(data)
            except json.JSONDecodeError:
                continue

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
            
            # Новый тип: запрос доступа
            if cmd.get('type') == 'request_access':
                technician_id = cmd.get('technician_id', 'неизвестен')
                app = PermissionApp()
                granted = app.request_permission(technician_id)
                
                response = {
                    'type': 'access_response',
                    'granted': granted
                }
                conn.send(json.dumps(response).encode('utf-8'))
                
                if not granted:
                    print("[ACCESS] Доступ отклонён пользователем.")
                    running = False
                    break
                else:
                    print("[ACCESS] Доступ разрешён. Начинаем передачу экрана.")
                continue

            if cmd['type'] == 'mouse':
                x, y = cmd['x'], cmd['y']
                pyautogui.moveTo(x, y)

                if cmd.get('click') == 'left':
                    pyautogui.click()
                elif cmd.get('click') == 'right':
                    pyautogui.rightClick()

                if cmd.get('drag') and not is_dragging:
                    pyautogui.mouseDown(button='left')
                    is_dragging = True
                elif is_dragging and not cmd.get('drag'):
                    pyautogui.mouseUp(button='left')
                    is_dragging = False

            elif cmd['type'] == 'key':
                key = cmd['key']

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
                    try:
                        pyperclip.copy(key)
                        pyautogui.hotkey('ctrl', 'v')
                    except Exception as e:
                        print(f"[KEYBOARD] Ошибка вставки, пробуем keyboard.write(): {e}")
                        try:
                            keyboard.write(key)
                        except Exception as e2:
                            print(f"[KEYBOARD] Не удалось ввести символ '{key}': {e2}")

        except Exception as e:
            print(f"Ошибка приёма команды: {e}")
            running = False
            break


def connect_to_relay():
    """Подключается к реле-серверу и регистрируется"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    
    try:
        sock.connect((RELAY_HOST, RELAY_PORT))
        print(f"✅ Подключено к реле-серверу {RELAY_HOST}:{RELAY_PORT}")
        
        # Регистрация клиента
        register_msg = {
            "type": "register_client",
            "client_id": CLIENT_ID
        }
        sock.send(json.dumps(register_msg).encode('utf-8'))
        
        # Ожидание статуса
        time.sleep(1)
        
        # Запрос подключения к серверу
        connect_msg = {
            "type": "connect_to_server",
            "server_id": TARGET_SERVER_ID
        }
        sock.send(json.dumps(connect_msg).encode('utf-8'))
        
        return sock
        
    except Exception as e:
        print(f"❌ Не удалось подключиться к реле-серверу: {e}")
        sock.close()
        return None


def main():
    global running
    pyautogui.FAILSAFE = False

    print("Запуск клиента...")
    
    # Подключаемся к реле-серверу
    relay_conn = connect_to_relay()
    if not relay_conn:
        return

    print("Ожидание подтверждения подключения от сервера...")

    # Ожидание запроса доступа
    try:
        data = relay_conn.recv(1024).decode('utf-8')
        if data:
            cmd = json.loads(data)
            if cmd.get('type') == 'request_access':
                # Передаём управление в receive_commands
                pass
    except:
        pass

    # Запуск потоков
    threading.Thread(target=capture_and_send, args=(relay_conn,), daemon=True).start()
    threading.Thread(target=send_from_queue, args=(relay_conn,), daemon=True).start()
    threading.Thread(target=receive_commands, args=(relay_conn,), daemon=True).start()

    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nКлиент остановлен пользователем.")
    finally:
        running = False
        relay_conn.close()
        print("Клиент завершил работу.")
        sys.exit(0)


if __name__ == "__main__":
    main()