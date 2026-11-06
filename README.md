# Hyperloom Community

[Русский](#русский) | [English](#english)

## Русский

Десктопное приложение для Windows с бесконечным полотном, где каждое рабочее окно - карточка:
папки проектов, файлы, терминал и заметки.

### Что умеет

- **Папки** открываются отдельными карточками или деревом в одной карточке.
- **Файлы:** картинка показывается картинкой, текст до 2 МБ - редактором с подсветкой, Ctrl+S
  пишет на диск.
- **Терминал:** один на всё полотно, PowerShell.
- **Заметки** на полотне.
- **Раскладка** полотна сохраняется сама и лежит в `%APPDATA%/Hyperloom Community/`.

### Установка

Установщик лежит в [последнем релизе](https://github.com/vldmr-vslv/hyperloom-community/releases/latest):
файл `Hyperloom.Community.Setup.<версия>.exe`.

Установщик не подписан, поэтому Windows покажет окно SmartScreen "Система Windows защитила ваш
компьютер". Нажмите "Подробнее", затем "Выполнить в любом случае".

### Сборка из исходников

Нужен Node.js.

```
npm install
npm run dev      # запуск из исходников
npm run dist     # установщик в dist/
```

### Лицензия

[GPL-3.0](LICENSE).

## English

A Windows desktop app with an infinite canvas where every working window is a card: project
folders, files, a terminal and notes.

### Features

- **Folders** open as separate cards or as a tree inside one card.
- **Files:** images show as images, text up to 2 MB opens in a highlighting editor, Ctrl+S
  writes it to disk.
- **Terminal:** one per canvas, PowerShell.
- **Notes** on the canvas.
- **Layout** of the canvas is saved automatically to `%APPDATA%/Hyperloom Community/`.

### Install

The installer is in the [latest release](https://github.com/vldmr-vslv/hyperloom-community/releases/latest):
`Hyperloom.Community.Setup.<version>.exe`.

The installer is not signed, so Windows shows a SmartScreen window "Windows protected your PC".
Click "More info", then "Run anyway".

### Build from source

Requires Node.js.

```
npm install
npm run dev      # run from source
npm run dist     # installer in dist/
```

### License

[GPL-3.0](LICENSE).
