import customtkinter as ctk
import tkinter.messagebox as messagebox
import database
import server
import threading


ctk.set_appearance_mode("Dark") 
ctk.set_default_color_theme("blue")  

global current_user
current_user = None


class AuthApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Удалённый доступ — Вход")
        self.root.geometry("500x400")
        self.root.resizable(False, False)

        self.show_login()

    def clear_window(self):
        """Очистка окна"""
        for widget in self.root.winfo_children():
            widget.destroy()

    def show_login(self):
        """Экран входа"""
        self.clear_window()

        title = ctk.CTkLabel(self.root, text="Вход в систему", font=ctk.CTkFont(size=24, weight="bold"))
        title.pack(pady=(40, 20))

        ctk.CTkLabel(self.root, text="Логин:", anchor="w").pack(pady=(10, 0), padx=50, anchor="w")
        self.login_entry = ctk.CTkEntry(self.root, width=300, height=35, placeholder_text="Введите логин")
        self.login_entry.pack(pady=5)

        ctk.CTkLabel(self.root, text="Пароль:", anchor="w").pack(pady=(10, 0), padx=50, anchor="w")
        self.password_entry = ctk.CTkEntry(self.root, width=300, height=35, placeholder_text="Введите пароль", show="*")
        self.password_entry.pack(pady=5)

        ctk.CTkButton(self.root, text="Войти", command=self.login, height=40, font=("Arial", 14)).pack(pady=20)
        ctk.CTkButton(self.root, text="Регистрация", command=self.show_register, fg_color="gray", hover_color="gray75",
                      height=35).pack(pady=5)

    def show_register(self):
        """Экран регистрации"""
        self.clear_window()

        title = ctk.CTkLabel(self.root, text="Регистрация", font=ctk.CTkFont(size=24, weight="bold"))
        title.pack(pady=(40, 20))

        ctk.CTkLabel(self.root, text="Логин:", anchor="w").pack(pady=(10, 0), padx=50, anchor="w")
        self.reg_login_entry = ctk.CTkEntry(self.root, width=300, height=35, placeholder_text="Придумайте логин")
        self.reg_login_entry.pack(pady=5)

        ctk.CTkLabel(self.root, text="Пароль:", anchor="w").pack(pady=(10, 0), padx=50, anchor="w")
        self.reg_password_entry = ctk.CTkEntry(self.root, width=300, height=35, placeholder_text="Придумайте пароль", show="*")
        self.reg_password_entry.pack(pady=5)

        ctk.CTkButton(self.root, text="Зарегистрироваться", command=self.register, height=40, font=("Arial", 14)).pack(pady=20)
        ctk.CTkButton(self.root, text="Назад", command=self.show_login, fg_color="gray", hover_color="gray75",
                      height=35).pack(pady=5)

    def show_profile(self):
        """Экран профиля"""
        self.clear_window()

        user_info = database.get_user_info(current_user)

        title = ctk.CTkLabel(self.root, text=f"Профиль: {current_user}", font=ctk.CTkFont(size=20, weight="bold"))
        title.pack(pady=(30, 10))

        ctk.CTkLabel(self.root, text=f"Зарегистрирован: {user_info['created_at']}").pack(pady=5)

        ctk.CTkLabel(self.root, text="Новый пароль:", anchor="w").pack(pady=(20, 0), padx=80, anchor="w")
        self.new_password_entry = ctk.CTkEntry(self.root, width=300, height=35, placeholder_text="Введите новый пароль", show="*")
        self.new_password_entry.pack(pady=5)

        ctk.CTkButton(self.root, text="Сменить пароль", command=self.change_password, height=40).pack(pady=20)
        ctk.CTkButton(self.root, text="Выход", command=self.logout, fg_color="gray", hover_color="gray75", width=150).pack(pady=10)
        ctk.CTkButton(self.root, text="▶️ Запустить удалённый доступ", command=self.start_server,
                      fg_color="green", hover_color="darkgreen", height=40).pack(pady=10)

    def login(self):

        username = self.login_entry.get().strip()
        password = self.password_entry.get().strip()

        if not username or not password:
            messagebox.showerror("Ошибка", "Введите логин и пароль")
            return

        if database.authenticate_user(username, password):
            global current_user
            current_user = username
            messagebox.showinfo("Успех", f"Добро пожаловать, {username}!")
            self.show_profile()
        else:
            messagebox.showerror("Ошибка", "Неверный логин или пароль")

    def register(self):
        username = self.reg_login_entry.get().strip()
        password = self.reg_password_entry.get().strip()

        if not username or not password:
            messagebox.showerror("Ошибка", "Введите логин и пароль")
            return

        if len(password) < 4:
            messagebox.showerror("Ошибка", "Пароль должен быть не менее 4 символов")
            return

        if database.register_user(username, password):
            messagebox.showinfo("Успех", "Регистрация успешна! Теперь войдите.")
            self.show_login()
        else:
            messagebox.showerror("Ошибка", "Пользователь с таким именем уже существует")

    def change_password(self):
        new_password = self.new_password_entry.get().strip()
        if len(new_password) < 4:
            messagebox.showerror("Ошибка", "Пароль должен быть не менее 4 символов")
            return

        if database.update_user_password(current_user, new_password):
            messagebox.showinfo("Успех", "Пароль изменён")
            self.new_password_entry.delete(0, "end")
        else:
            messagebox.showerror("Ошибка", "Не удалось изменить пароль")

    def logout(self):

        current_user = None
        self.show_login()

    def start_server(self):
        """Запуск сервера в отдельном потоке"""
        def run_server():
            try:
                server.main()
            except Exception as e:
                print(f"Ошибка сервера: {e}")

        threading.Thread(target=run_server, daemon=True).start()
        messagebox.showinfo("Сервер", "Сервер запущен в фоне. Ожидайте подключения клиента.")

if __name__ == "__main__":
    try:
        database.init_db()
    except Exception as e:
        print(f"Критическая ошибка БД: {e}")
        exit(1)

    root = ctk.CTk()
    app = AuthApp(root)
    root.mainloop()