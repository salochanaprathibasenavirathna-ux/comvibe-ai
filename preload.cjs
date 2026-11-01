const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("comvibeApp", {
  getGeminiKeyStatus: () => ipcRenderer.invoke("gemini-key:status"),
  saveGeminiKey: key => ipcRenderer.invoke("gemini-key:save", key),
  clearGeminiKey: () => ipcRenderer.invoke("gemini-key:clear"),
  secureAccounts: {
    status: () => ipcRenderer.sendSync("accounts:status"),
    importLegacy: data => ipcRenderer.sendSync("accounts:import-legacy", data),
    register: (name, pin) => ipcRenderer.sendSync("accounts:register", { name, pin }),
    login: (name, pin) => ipcRenderer.sendSync("accounts:login", { name, pin }),
    logout: () => ipcRenderer.sendSync("accounts:logout"),
    loadData: () => ipcRenderer.sendSync("accounts:load-data"),
    saveData: data => ipcRenderer.sendSync("accounts:save-data", data)
  }
});
