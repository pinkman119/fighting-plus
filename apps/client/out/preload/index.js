"use strict";
const electron = require("electron");
const SERVER_ARG = "--fp-server-url=";
const VERSION_ARG = "--fp-app-version=";
const argValue = (prefix) => process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
const serverUrl = argValue(SERVER_ARG) || "http://localhost:3118";
const appVersion = argValue(VERSION_ARG) || "1.0.4";
electron.contextBridge.exposeInMainWorld("fp", {
  isDesktop: true,
  appVersion,
  serverUrl,
  window: {
    minimize: () => electron.ipcRenderer.send("fp:window:minimize"),
    toggleMaximize: () => electron.ipcRenderer.send("fp:window:toggle-maximize"),
    close: () => electron.ipcRenderer.send("fp:window:close"),
    isMaximized: () => electron.ipcRenderer.invoke("fp:window:is-maximized"),
    onMaximized: (callback) => {
      electron.ipcRenderer.on("fp:window:maximized", (_event, maximized) => callback(maximized));
    }
  },
  config: {
    getServerUrl: () => electron.ipcRenderer.invoke("fp:config:get-server-url"),
    setServerUrl: (url) => electron.ipcRenderer.invoke("fp:config:set-server-url", url),
    reload: () => electron.ipcRenderer.send("fp:config:reload")
  }
});
