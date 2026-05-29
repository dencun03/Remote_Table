"""
Диалог аутентификации пользователя

Обеспечивает регистрацию и вход пользователей в систему.
"""

import customtkinter as ctk
import tkinter.messagebox as messagebox
import threading
import queue

from core.database import db, init_database
from core.config import config
from core.logging_config import get_logger

logger = get_logger('gui.auth')


class AuthDialog:
    """
    Диалог аутентификации с поддержкой входа и регистрации.
    """

    def __init__(self):
        self.root = None
        self.current_view = "login"
        self.notification_queue = queue.Queue()

        # Поля ввода
        self.login_entry = None
        self.password_entry = None
        self.reg_entries = {}

        # Данные текущего пользователя
        self.current_user = None
        self.current_user_data = None

    def show(self):
        """Запуск диалога"""
        # Инициализация темы
        ctk.set_appearance_mode("Dark")
        ctk.set_default_color_theme("blue")

        # Создание окна
        self.root = ctk.CTk()
        self.root.title("Удалённый доступ — Вход")
        self.root.geometry("500x550")
        self.root.resizable(False, False)

        # Центрирование
        self._center_window()

        # Проверка очереди уведомлений
        self._check_notifications()

        # Показ экрана входа
        self.show_login()

        # Запуск главного цикла
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _center_window(self):
        """Центрирование окна на экране"""
        self.root.update_idletasks()
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _check_notifications(self):
        """Проверка очереди уведомлений"""
        try:
            while True:
                msg = self.notification_queue.get_nowait()
                if msg['type'] == 'success':
                    messagebox.showinfo("Успех", msg['message'])
                elif msg['type'] == 'error':
                    messagebox.showerror("Ошибка", msg['message'])
                elif msg['type'] == 'info':
                    messagebox.showinfo("Информация", msg['message'])
        except queue.Empty:
            pass
        finally:
            self.root.after(100, self._check_notifications)

    def _clear_window(self):
        """Очистка окна"""
        for widget in self.root.winfo_children():
            try:
                widget.destroy()
            except Exception:
                pass

    def show_login(self):
        """Экран входа"""
        self._clear_window()
        self.current_view = "login"

        # Заголовок
        ctk.CTkLabel(
            self.root,
            text="Вход в систему",
            font=ctk.CTkFont(size=28, weight="bold")
        ).pack(pady=(40, 10))

        ctk.CTkLabel(
            self.root,
            text="Система удалённой технической поддержки",
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray70")
        ).pack(pady=(0, 30))

        # Поля ввода
        login_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        login_frame.pack(pady=5)

        ctk.CTkLabel(login_frame, text="Имя пользователя:", anchor="w").pack(padx=50, anchor="w")
        self.login_entry = ctk.CTkEntry(
            login_frame,
            width=300, height=40,
            placeholder_text="Введите имя пользователя",
            font=ctk.CTkFont(size=14)
        )
        self.login_entry.pack(pady=(5, 15))

        password_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        password_frame.pack(pady=5)

        ctk.CTkLabel(password_frame, text="Пароль:", anchor="w").pack(padx=50, anchor="w")
        self.password_entry = ctk.CTkEntry(
            password_frame,
            width=300, height=40,
            placeholder_text="Введите пароль",
            show="●",
            font=ctk.CTkFont(size=14)
        )
        self.password_entry.pack(pady=(5, 20))

        # Кнопки
        btn_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        btn_frame.pack(pady=10)

        ctk.CTkButton(
            btn_frame, text="Войти",
            command=self._on_login,
            height=45,
            font=ctk.CTkFont(size=16, weight="bold"),
            corner_radius=8
        ).pack(pady=5, padx=15, side="left")

        ctk.CTkButton(
            btn_frame, text="Регистрация",
            command=self.show_register,
            fg_color="gray", hover_color="gray70",
            height=40, corner_radius=8
        ).pack(pady=5, padx=15, side="left")

        # Привязка Enter
        self.root.bind('<Return>', lambda e: self._on_login())

    def show_register(self):
        """Экран регистрации"""
        self._clear_window()
        self.current_view = "register"

        ctk.CTkLabel(
            self.root,
            text="Регистрация",
            font=ctk.CTkFont(size=28, weight="bold")
        ).pack(pady=(40, 10))

        ctk.CTkLabel(
            self.root,
            text="Создайте новую учётную запись",
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray70")
        ).pack(pady=(0, 30))

        # Поля
        fields = [
            ("Имя пользователя:", "3-50 символов"),
            ("Пароль:", "Минимум 8 символов"),
            ("Email (опционально):", "example@mail.ru"),
        ]

        self.reg_entries = {}
        for label_text, placeholder in fields:
            show_char = "●" if "Пароль" in label_text else ""

            frame = ctk.CTkFrame(self.root, fg_color="transparent")
            frame.pack(pady=3)

            ctk.CTkLabel(frame, text=label_text, anchor="w").pack(padx=50, anchor="w")

            entry = ctk.CTkEntry(
                frame,
                width=300, height=35,
                placeholder_text=placeholder,
                show=show_char
            )
            entry.pack(pady=(3, 8))
            self.reg_entries[label_text] = entry

        # Кнопки
        btn_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        btn_frame.pack(pady=15)

        ctk.CTkButton(
            btn_frame, text="Зарегистрироваться",
            command=self._on_register,
            height=45,
            font=ctk.CTkFont(size=15, weight="bold"),
            corner_radius=8
        ).pack(pady=5, padx=15, side="left")

        ctk.CTkButton(
            btn_frame, text="Назад",
            command=self.show_login,
            fg_color="gray", hover_color="gray70",
            height=40, corner_radius=8
        ).pack(pady=5, padx=15, side="left")

    def show_profile(self):
        """Экран профиля"""
        self._clear_window()
        self.current_view = "profile"

        user_data = db.get_user(self.current_user)
        if not user_data:
            messagebox.showerror("Ошибка", "Не удалось загрузить данные")
            self.show_login()
            return

        self.current_user_data = user_data

        # Заголовок
        ctk.CTkLabel(
            self.root,
            text=f"Профиль: {self.current_user}",
            font=ctk.CTkFont(size=24, weight="bold")
        ).pack(pady=(30, 10))

        # Информация
        info_frame = ctk.CTkFrame(self.root, corner_radius=10)
        info_frame.pack(pady=10, padx=50, fill="x")

        role = user_data.get('role', 'user')
        role_text = "Специалист" if role == 'specialist' else "Пользователь"

        ctk.CTkLabel(
            info_frame,
            text=f"Роль: {role_text}",
            font=ctk.CTkFont(size=14)
        ).pack(pady=5, padx=10, anchor="w")

        created = user_data.get('created_at')
        if created:
            ctk.CTkLabel(
                info_frame,
                text=f"Зарегистрирован: {created.strftime('%d.%m.%Y %H:%M')}",
                font=ctk.CTkFont(size=12),
                text_color=("gray60", "gray80")
            ).pack(pady=2, padx=10, anchor="w")

        # Кнопки действий
        action_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        action_frame.pack(pady=15)

        if role == 'specialist':
            ctk.CTkButton(
                action_frame,
                text="Запустить режим специалиста",
                command=self._launch_specialist,
                fg_color="green", hover_color="darkgreen",
                height=45,
                font=ctk.CTkFont(size=14, weight="bold"),
                corner_radius=8
            ).pack(pady=5, padx=10, side="left")

        ctk.CTkButton(
            action_frame,
            text="Выход",
            command=self._on_logout,
            fg_color="gray", hover_color="gray70",
            height=40, corner_radius=8
        ).pack(pady=5, padx=10, side="left")

    def _on_login(self):
        """Обработка входа"""
        username = self.login_entry.get().strip()
        password = self.password_entry.get()

        if not username or not password:
            messagebox.showwarning("Внимание", "Введите имя пользователя и пароль")
            return

        # Аутентификация
        if db.authenticate_user(username, password):
            self.current_user = username
            messagebox.showinfo("Успех", f"Добро пожаловать, {username}!")
            self.show_profile()
        else:
            messagebox.showerror("Ошибка", "Неверный логин или пароль")

    def _on_register(self):
        """Обработка регистрации"""
        username = self.reg_entries["Имя пользователя:"].get().strip()
        password = self.reg_entries["Пароль:"].get()
        email = self.reg_entries["Email (опционально):"].get().strip() or None

        # Валидация
        if not username:
            messagebox.showwarning("Внимание", "Введите имя пользователя")
            return

        if len(username) < 3:
            messagebox.showwarning("Внимание", "Имя пользователя от 3 символов")
            return

        if len(password) < 8:
            messagebox.showwarning("Внимание", "Пароль минимум 8 символов")
            return

        if email and '@' not in email:
            messagebox.showwarning("Внимание", "Введите корректный email")
            return

        # Регистрация
        result = db.create_user(username, password, email)

        if result['success']:
            messagebox.showinfo("Успех", result['message'])
            self.show_login()
        else:
            messagebox.showerror("Ошибка", result['message'])

    def _launch_specialist(self):
        """Запуск приложения специалиста"""
        def run():
            from specialist.specialist_app import run_specialist
            run_specialist()

        threading.Thread(target=run, daemon=True).start()
        messagebox.showinfo(
            "Запуск",
            "Приложение специалиста запущено.\n"
            "Ожидайте подключения клиентов."
        )

    def _on_logout(self):
        """Выход из системы"""
        self.current_user = None
        self.current_user_data = None
        self.show_login()

    def _on_close(self):
        """Закрытие окна"""
        if messagebox.askokcancel("Выход", "Вы уверены?"):
            self.root.destroy()


def run_auth():
    """Запуск диалога аутентификации"""
    # Инициализация БД
    if not init_database():
        print("Ошибка инициализации базы данных")
        return

    dialog = AuthDialog()
    dialog.show()


if __name__ == "__main__":
    run_auth()