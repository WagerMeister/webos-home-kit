# Зависимости установки

Базовые пакеты Hearth и Homebrew Channel доступны по закреплённым ссылкам в [upstreams.json](../inventory/upstreams.json). Для Tailscale URL ARM-архива и SHA256 содержатся в [tailscale-provenance.json](tailscale-provenance.json).

Native-плеерам Kick/VK нужен executable `chrome` из установленного браузера совместимого LG webOS. Получите его со своего устройства и добавьте в соответствующий локальный native-каталог, перечисленный в [local-requirements.json](../inventory/local-requirements.json). Runtime подключает ресурсы установленного browser image read-only. Библиотеки движка LG не заменяются и не распространяются в проекте.

Пакеты основного app+service и native-плеера регистрируются отдельно. [Порядок установки](../docs/INSTALL.md) описывает создание private runtime и применение overlays.
