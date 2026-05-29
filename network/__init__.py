"""
Модуль сетевого взаимодействия

Содержит компоненты для работы с сетью:
- RelayServer - реле-сервер для маршрутизации соединений
"""

from network.relay_server import RelayServer, run_relay_server

__all__ = ['RelayServer', 'run_relay_server']