# Hearth

Главный экран на базе Hearth с разделением пользовательских и системных приложений. `overlay` содержит launcher, native entrypoints, audio handoff, dashboard и локальные модели календаря/прогноза/сцен. `service` — forecast helper и CA bundle для HTTPS-запросов MET Norway.

`dashboard/scenes` содержит четыре сезона×четыре фазы освещения. Данные города читаются из предпочтений пользователя; исходники не задают город или часовой пояс. `defaults.js` инициализирует только новый профиль. UI подключения подключается из соседнего компонента.

[Установка](../../docs/INSTALL.md#hearth) · [Настройка](../../docs/CONFIGURATION.md#hearth-и-виджеты)
