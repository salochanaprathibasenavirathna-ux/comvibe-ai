const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("comvibeApp", {
  getGeminiKeyStatus: () => ipcRenderer.invoke("gemini-key:status"),
  saveGeminiKey: key => ipcRenderer.invoke("gemini-key:save", key),
  clearGeminiKey: () => ipcRenderer.invoke("gemini-key:clear")
});
