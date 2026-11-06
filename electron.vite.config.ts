import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Редакторы на Electron (VS Code и его родня) выставляют ELECTRON_RUN_AS_NODE=1
// в окружении встроенного терминала. Electron-vite порождает наш Electron с
// унаследованным окружением, и с этой переменной он запускается как обычный Node:
// окна нет, ошибки нет, приложение молча живёт процессом без интерфейса.
delete process.env.ELECTRON_RUN_AS_NODE;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
  },
});
