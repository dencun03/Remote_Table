"""
Графический интерфейс аутентификации для системы удалённой техподдержки

Улучшения:
- Валидация входных данных на стороне клиента
- Обработка ошибок и состояний загрузки
- Разделение ролей пользователя и специалиста
- Улучшенный UX с индикаторами состояния
"""

import customtkinter as ctk
import tkinter.messagebox as messagebox
import database
import server
import threading
import queue
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Настройка темы CustomTkinter
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# Глобальное состояние приложения
current_user = None
current_user_data = None


class PlaceholderEntry(ctk.CTkEntry):
    """Пользовательский виджет ввода с placeholder и валидацией"""

    def __init__(self, *args, placeholder_text="", validation_func=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.placeholder_text = placeholder_text
        self.validation_func = validation_func
        self._placeholder_active = True

        self.bind("<FocusIn>", self._on_focus_in)
        self.bind("<FocusOut>", self._on_focus_out)

        self._set_placeholder()

    def _set_placeholder(self):
        if self._placeholder_active:
            self.configure(fg_color=("gray75", "gray30"))

    def _on_focus_in(self, event):
        if self._placeholder_active:
            self.delete(0, "end")
            self.configure(fg_color=("white", "gray20"))
            self._placeholder_active = False

    def _on_focus_out(self, event):
        if not self.get():
            self._placeholder_active = True
            self._set_placeholder()

    def get_value(self):
        """Получение значения с валидацией"""
        value = self.get().strip()
        if self.validation_func:
            return self.validation_func(value)
        return value


class StatusLabel(ctk.CTkLabel):
    """Индикатор состояния с анимацией"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._states = ["●", "○", "◌"]
        self._current = 0

    def pulse(self, text=None):
        """Анимация пульсации индикатора"""
        if text:
            self.configure(text=f"{self._states[self._current % 3]} {text}")
            self._current += 1


class AuthApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Удалённый доступ — Вход")
        self.root.geometry("500x500")
        self.root.resizable(False, False)

        # Центрирование окна
        self._center_window()

        # Очередь для коммуникации между потоками
        self.notification_queue = queue.Queue()
        self._check_queue()

        self.show_login()

    def _center_window(self):
        """Центрирование окна на экране"""
        self.root.update_idletasks()
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _check_queue(self):
        """Проверка очереди уведомлений от фоновых потоков"""
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
            self.root.after(100, self._check_queue)

    def clear_window(self):
        """Очистка окна с безопасным уничтожением виджетов"""
        for widget in self.root.winfo_children():
            try:
                widget.destroy()
            except Exception:
                pass

    def _validate_username(self, value):
        """Валидация имени пользователя"""
        if value and not value.replace('_', '').replace('-', '').isalnum():
            raise ValueError("Только буквы, цифры, _ и -")
        return value

    def _validate_password(self, value):
        """Валидация пароля"""
        if value and len(value) < 8:
            raise ValueError("Минимум 8 символов")
        return value

    def show_login(self):
        """Экран входа с улучшенным дизайном"""
        self.clear_window()

        # Заголовок
        title = ctk.CTkLabel(
            self.root,
            text="Вход в систему",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        title.pack(pady=(40, 10))

        subtitle = ctk.CTkLabel(
            self.root,
            text="Система удалённой технической поддержки",
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray70")
        )
        subtitle.pack(pady=(0, 30))

        # Поле логина
        login_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        login_frame.pack(pady=5)

        ctk.CTkLabel(login_frame, text="Логин:", anchor="w").pack(padx=50, anchor="w")
        self.login_entry = ctk.CTkEntry(
            login_frame,
            width=300,
            height=40,
            placeholder_text="Введите имя пользователя",
            font=ctk.CTkFont(size=14)
        )
        self.login_entry.pack(pady=(5, 15))

        # Поле пароля
        password_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        password_frame.pack(pady=5)

        ctk.CTkLabel(password_frame, text="Пароль:", anchor="w").pack(padx=50, anchor="w")
        self.password_entry = ctk.CTkEntry(
            password_frame,
            width=300,
            height=40,
            placeholder_text="Введите пароль",
            show="●",
            font=ctk.CTkFont(size=14)
        )
        self.password_entry.pack(pady=(5, 20))

        # Кнопки
        button_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        button_frame.pack(pady=10)

        login_btn = ctk.CTkButton(
            button_frame,
            text="Войти",
            command=self.login,
            height=45,
            font=ctk.CTkFont(size=16, weight="bold"),
            corner_radius=8
        )
        login_btn.pack(pady=5, padx=20, side="left")

        register_btn = ctk.CTkButton(
            button_frame,
            text="Регистрация",
            command=self.show_register,
            fg_color="gray",
            hover_color="gray70",
            height=40,
            corner_radius=8
        )
        register_btn.pack(pady=5, padx=20, side="left")

        # Индикатор состояния
        self.status_label = StatusLabel(
            self.root,
            text="",
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray70")
        )
        self.status_label.pack(pady=(10, 0))

        # Привязка Enter для входа
        self.root.bind('<Return>', lambda e: self.login())

    def show_register(self):
        """Экран регистрации"""
        self.clear_window()

        title = ctk.CTkLabel(
            self.root,
            text="Регистрация",
            font=ctk.CTkFont(size=28, weight="bold")
        )
        title.pack(pady=(40, 10))

        subtitle = ctk.CTkLabel(
            self.root,
            text="Создайте новую учётную запись",
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray70")
        )
        subtitle.pack(pady=(0, 30))

        # Поля ввода
        fields = [
            ("Имя пользователя:", "Придумайте логин (3-50 символов)"),
            ("Пароль:", "Минимум 8 символов"),
            ("Email (опционально):", "example@mail.ru"),
            ("ФИО (опционально):", "Иванов Иван Иванович")
        ]

        self.reg_entries = {}
        for label_text, placeholder in fields:
            frame = ctk.CTkFrame(self.root, fg_color="transparent")
            frame.pack(pady=3)

            ctk.CTkLabel(frame, text=label_text, anchor="w").pack(padx=50, anchor="w")

            show_char = "●" if "Пароль" in label_text else ""
            entry = ctk.CTkEntry(
                frame,
                width=300,
                height=35,
                placeholder_text=placeholder,
                show=show_char,
                font=ctk.CTkFont(size=13)
            )
            entry.pack(pady=(3, 8))
            self.reg_entries[label_text] = entry

        # Кнопки
        button_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        button_frame.pack(pady=15)

        reg_btn = ctk.CTkButton(
            button_frame,
            text="Зарегистрироваться",
            command=self.register,
            height=45,
            font=ctk.CTkFont(size=15, weight="bold"),
            corner_radius=8
        )
        reg_btn.pack(pady=5, padx=15, side="left")

        back_btn = ctk.CTkButton(
            button_frame,
            text="Назад",
            command=self.show_login,
            fg_color="gray",
            hover_color="gray70",
            height=40,
            corner_radius=8
        )
        back_btn.pack(pady=5, padx=15, side="left")

    def show_profile(self):
        """Экран профиля авторизованного пользователя"""
        global current_user, current_user_data

        self.clear_window()

        user_data = database.get_user_info(current_user)
        if not user_data:
            messagebox.showerror("Ошибка", "Не удалось загрузить данные пользователя")
            self.show_login()
            return

        current_user_data = user_data

        # Заголовок
        title = ctk.CTkLabel(
            self.root,
            text=f"Профиль: {current_user}",
            font=ctk.CTkFont(size=24, weight="bold")
        )
        title.pack(pady=(30, 10))

        # Информация о пользователе
        info_frame = ctk.CTkFrame(self.root, corner_radius=10)
        info_frame.pack(pady=10, padx=50, fill="x")

        role_text = "Специалист" if user_data.get('role') == 'specialist' else "Пользователь"
        role_color = "green" if user_data.get('role') == 'specialist' else "blue"

        ctk.CTkLabel(
            info_frame,
            text=f"Роль: {role_text}",
            font=ctk.CTkFont(size=14)
        ).pack(pady=5, padx=10, anchor="w")

        ctk.CTkLabel(
            info_frame,
            text=f"Зарегистрирован: {user_data['created_at'].strftime('%d.%m.%Y %H:%M')}",
            font=ctk.CTkFont(size=12),
            text_color=("gray60", "gray80")
        ).pack(pady=2, padx=10, anchor="w")

        if user_data.get('last_login'):
            ctk.CTkLabel(
                info_frame,
                text=f"Последний вход: {user_data['last_login'].strftime('%d.%m.%Y %H:%M')}",
                font=ctk.CTkFont(size=12),
                text_color=("gray60", "gray80")
            ).pack(pady=2, padx=10, anchor="w")

        # Секция смены пароля
        password_frame = ctk.CTkFrame(self.root, corner_radius=10)
        password_frame.pack(pady=10, padx=50, fill="x")

        ctk.CTkLabel(
            password_frame,
            text="Смена пароля",
            font=ctk.CTkFont(size=14, weight="bold")
        ).pack(pady=(10, 5), padx=10, anchor="w")

        ctk.CTkLabel(password_frame, text="Текущий пароль:", anchor="w").pack(padx=10, anchor="w")
        self.current_password_entry = ctk.CTkEntry(
            password_frame,
            width=280,
            height=30,
            placeholder_text="Введите текущий пароль",
            show="●"
        )
        self.current_password_entry.pack(pady=3, padx=10)

        ctk.CTkLabel(password_frame, text="Новый пароль:", anchor="w").pack(padx=10, anchor="w")
        self.new_password_entry = ctk.CTkEntry(
            password_frame,
            width=280,
            height=30,
            placeholder_text="Минимум 8 символов",
            show="●"
        )
        self.new_password_entry.pack(pady=3, padx=10)

        ctk.CTkButton(
            password_frame,
            text="Изменить пароль",
            command=self.change_password,
            height=35,
            corner_radius=6
        ).pack(pady=(8, 5), padx=10)

        # Кнопки действий
        button_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        button_frame.pack(pady=15)

        if user_data.get('role') == 'specialist':
            # Для специалиста - возможность запустить сервер
            start_btn = ctk.CTkButton(
                button_frame,
                text="Запустить режим ожидания",
                command=self.start_server,
                fg_color="green",
                hover_color="darkgreen",
                height=45,
                font=ctk.CTkFont(size=14, weight="bold"),
                corner_radius=8
            )
            start_btn.pack(pady=5, padx=10, side="left")

        # Кнопка выхода
        logout_btn = ctk.CTkButton(
            button_frame,
            text="Выход",
            command=self.logout,
            fg_color="gray",
            hover_color="gray70",
            height=40,
            corner_radius=8
        )
        logout_btn.pack(pady=5, padx=10, side="left")

    def login(self):
        """Обработка входа с валидацией"""
        username = self.login_entry.get().strip()
        password = self.password_entry.get()

        # Валидация
        if not username:
            self.login_entry.configure(border_color="red")
            messagebox.showwarning("Внимание", "Введите имя пользователя")
            return

        if not password:
            self.password_entry.configure(border_color="red")
            messagebox.showwarning("Внимание", "Введите пароль")
            return

        # Индикация процесса
        self.status_label.configure(text="◌ Проверка данных...")

        # Аутентификация
        if database.authenticate_user(username, password):
            global current_user
            current_user = username
            self.status_label.configure(text="✓ Успешно!")
            self.root.after(500, self.show_profile)
        else:
            self.status_label.configure(text="✗ Неверные данные")
            self.login_entry.configure(border_color="red")
            self.password_entry.configure(border_color="red")
            messagebox.showerror("Ошибка", "Неверный логин или пароль")

    def register(self):
        """Обработка регистрации с валидацией"""
        username = self.reg_entries["Имя пользователя:"].get().strip()
        password = self.reg_entries["Пароль:"].get()
        email = self.reg_entries["Email (опционально):"].get().strip() or None
        full_name = self.reg_entries["ФИО (опционально):"].get().strip() or None

        # Валидация
        if not username:
            messagebox.showwarning("Внимание", "Введите имя пользователя")
            return

        if len(username) < 3:
            messagebox.showwarning("Внимание", "Имя пользователя должно быть от 3 символов")
            return

        if len(password) < 8:
            messagebox.showwarning("Внимание", "Пароль должен быть минимум 8 символов")
            return

        if email and '@' not in email:
            messagebox.showwarning("Внимание", "Введите корректный email")
            return

        # Регистрация
        result = database.register_user(username, password, email, full_name)

        if result['success']:
            messagebox.showinfo("Успех", result['message'])
            self.show_login()
        else:
            messagebox.showerror("Ошибка", result['message'])

    def change_password(self):
        """Смена пароля с проверкой текущего"""
        current_password = self.current_password_entry.get()
        new_password = self.new_password_entry.get()

        if not current_password or not new_password:
            messagebox.showwarning("Внимание", "Заполните оба поля")
            return

        if len(new_password) < 8:
            messagebox.showerror("Ошибка", "Новый пароль должен быть минимум 8 символов")
            return

        result = database.update_user_password(current_user, current_password, new_password)

        if result['success']:
            messagebox.showinfo("Успех", result['message'])
            self.current_password_entry.delete(0, "end")
            self.new_password_entry.delete(0, "end")
        else:
            messagebox.showerror("Ошибка", result['message'])

    def logout(self):
        """Выход из системы"""
        global current_user, current_user_data
        current_user = None
        current_user_data = None
        self.show_login()

    def start_server(self):
        """Запуск сервера в отдельном потоке с обработкой ошибок"""
        def run_server():
            try:
                logger.info("Запуск сервера удалённого доступа...")
                server.main()
            except Exception as e:
                logger.error(f"Ошибка сервера: {e}")
                self.notification_queue.put({
                    'type': 'error',
                    'message': f'Ошибка сервера: {e}'
                })

        # Запуск в daemon-потоке
        server_thread = threading.Thread(target=run_server, daemon=True, name="ServerThread")
        server_thread.start()

        messagebox.showinfo(
            "Сервер запущен",
            "Режим ожидания активен.\n"
            "Ожидайте подключения клиентов."
        )


if __name__ == "__main__":
    # Инициализация базы данных
    if not database.init_db():
        print("Критическая ошибка: не удалось инициализировать базу данных")
        exit(1)

    # Запуск приложения
    root = ctk.CTk()
    app = AuthApp(root)

    # Обработка закрытия приложения
    def on_closing():
        if messagebox.askokcancel("Выход", "Вы уверены, что хотите выйти?"):
            database.close_db()
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()