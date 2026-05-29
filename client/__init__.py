"""
Модуль клиента

Содержит компоненты для работы клиента (пользователя):
- ClientApp - основное приложение клиента
- ClientConnection - управление подключением
- ScreenCapture - захват экрана
"""

from client.client_app import (
    ClientApp,
    ClientConnection,
    ScreenCapture,
    PermissionDialog,
    run_client
)

__all__ = ['ClientApp', 'ClientConnection', 'ScreenCapture', 'PermissionDialog', 'run_client']