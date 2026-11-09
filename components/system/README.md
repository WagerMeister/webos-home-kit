# System integration

Интеграция запуска ТВ, кнопки Home и аудио-lifecycle.

`startup.sh` и `startup-trace` отвечают за собственные root hooks и корректное завершение. `homeapp/guard.sh` задаёт Home routing. `audio` отслеживает foreground и переходы в Hearth. `hooks` подключает key-only SSH и аудио-контур.

Порядок и права установки определяет общая [инструкция](../../docs/INSTALL.md#home-аудио-и-автозапуск). Компонент не управляет громкостью как пользовательской настройкой.
