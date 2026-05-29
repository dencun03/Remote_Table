"""
Модуль специалиста поддержки

Содержит компоненты для работы специалиста:
- SpecialistApp - основное приложение специалиста
- SpecialistConnection - управление подключением
"""

from specialist.specialist_app import SpecialistApp, SpecialistConnection, run_specialist

__all__ = ['SpecialistApp', 'SpecialistConnection', 'run_specialist']