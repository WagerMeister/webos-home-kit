# Kick

Клиент Kick с каталогом онлайн-каналов, поиском, избранным и записями. Ускоренное воспроизведение использует отдельное native-приложение и root-private service mirror.

- `source/app`, `source/service` — редактируемые исходники основного пакета и private helper.
- `source/native-player` — metadata, input shim и настройки native-плеера.
- `installed-app`, `installed-service` — готовые варианты файлов установленного пакета.
- `source/vendor/security` — закреплённые backports инструментов сборки с provenance.

[Сборка](../../docs/DEVELOPMENT.md#сборка-kick) · [Установка](../../docs/INSTALL.md#kick) · [Управление](../../docs/CONFIGURATION.md#воспроизведение)
