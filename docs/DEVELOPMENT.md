# Разработка и сопровождение

## Проверка проекта

```sh
python3 tools/verify_project.py
python3 tools/check_no_credentials.py
python3 tools/check_public_policy.py
node components/hearth/test-config.cjs
node components/vpn/tests/test-controller.cjs
node components/vpn/tests/test-selection.cjs
node components/vpn/tests/test-tailscale.cjs
node components/vpn/tests/test-ui.cjs
```

Проверка целостности сверяет карту размещения и SHA256 ресурсов. Проверка состава исходников работает по Git index. Результаты проверок сохраняйте вне дерева исходников.

## Сборка Kick

В `components/kick/source`:

```sh
npm ci --ignore-scripts
npm test
npm run package
```

Основной пакет содержит app+service. Native-плеер собирается отдельным пакетом после подготовки prerequisites из [INSTALL.md](INSTALL.md). Build-зависимости LG CLI не входят в TV runtime. Перед использованием инструментария проверяйте актуальные advisory через npm audit; изменения lockfile сопровождайте проверкой упаковки, а не массовым обновлением зависимостей установленного приложения.

## Изменения компонентов

Редактируемый Kick app/service хранится в `source`; `installed-app`/`installed-service` — отдельные упакованные варианты. При изменении исходников пересоберите соответствующий пакет и private mirror согласованно. Не используйте готовые варианты как второй независимый исходник для ручных правок.

Изменения Hearth выполняются в overlay. `defaults.js` задаёт только первый запуск, а `settings/hearth.example.json` служит preset. Обновления не должны принудительно заменять существующий город, список приложений или оформление пользователя. Модель прогноза и выбор сцены отделены от DOM.

У VK и Kick отдельные app ID, временные каталоги и input bridges. Не объединяйте их session state или lifecycle. Изменение startup/audio hooks проверяйте отдельно от медиаплееров; потеря связи с UI не должна блокировать штатные кнопки.

## Движки VPN

UI, control.js и manager.js составляют общий управляющий контур. Транспортная реализация находится в `components/vpn/root/providers`. Новый движок подключается через [контракт адаптера](../components/vpn/ADAPTERS.md); он не должен менять Home, audio guards или код медиаплееров. Реестр, локальные профили и меню выбора движка — точки выбора реализации. `tools/device_sync.py` связывает исходники с управляемыми файлами устройства по SHA256 карты; его compare-режим не меняет устройство.

## Источники и целостность

Закреплённые upstream указаны в `inventory/upstreams.json`, provenance библиотек — рядом с зависимостями. После изменения ресурсов обновите SHA256 карты и общего списка:

```sh
python3 tools/update_manifest.py
```

В runtime нельзя переносить рабочий config, SSH-ключи, cookies, signed media URLs, состояние VPN-клиента и browser profiles из исходников. Локальные файлы конфигурации и сборки исключаются через `.gitignore`. [Лицензии и атрибуция](../THIRD_PARTY.md) сохраняются при обновлении сторонних файлов.
