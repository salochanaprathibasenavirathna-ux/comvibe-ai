const { app, BrowserWindow, Menu, shell, safeStorage, ipcMain } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { readFile, writeFile, unlink } = require("node:fs/promises");

let appWindow;
let localServer;
let serverOwned = false;
let appUrl;
const keyFile = () => path.join(app.getPath("userData"), "gemini-api-key.enc");

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || (event.sender?.getURL ? event.sender.getURL() : "");
  if (!appUrl || !senderUrl || new URL(senderUrl).origin !== new URL(appUrl).origin) {
    throw new Error("Untrusted app window.");
  }
}

async function loadSavedGeminiKey() {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable; the Gemini API key cannot be loaded safely.");
    }
    const encryptedKey = await readFile(keyFile());
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encryptedKey);
    process.env.COMVIBE_USER_API_KEY = result;
    process.env.GEMINI_API_KEY = result;
    if (shouldReEncrypt) {
      await writeFile(keyFile(), await safeStorage.encryptStringAsync(result), { mode: 0o600 });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function registerKeyHandlers() {
  ipcMain.handle("gemini-key:status", async (event) => {
    assertTrustedSender(event);
    const key = (process.env.COMVIBE_USER_API_KEY || process.env.GEMINI_API_KEY || "").trim();
    return {
      configured: Boolean(key && key !== "your_api_key_here"),
      hasKey: Boolean(key && key !== "your_api_key_here")
    };
  });

  ipcMain.handle("gemini-key:save", async (event, value) => {
    assertTrustedSender(event);
    if (typeof value !== "string" || value.trim().length < 10 || value.trim().length > 500) {
      throw new Error("Valid Gemini API key එකක් ඇතුළත් කරන්න.");
    }
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      throw new Error("මෙම පරිගණකයේ ආරක්ෂිත key storage ලබාගත නොහැක.");
    }
    const key = value.trim();
    await writeFile(keyFile(), await safeStorage.encryptStringAsync(key), { mode: 0o600 });
    process.env.COMVIBE_USER_API_KEY = key;
    process.env.GEMINI_API_KEY = key;
    return true;
  });

  ipcMain.handle("gemini-key:clear", async event => {
    assertTrustedSender(event);
    try {
      await unlink(keyFile());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    delete process.env.COMVIBE_USER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    return true;
  });
}

function checkExistingServer(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1800 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(response.statusCode === 200 && JSON.parse(body).apiVersion === 11);
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", error => error.code === "ECONNREFUSED" || error.message === "timeout" ? resolve(false) : reject(error));
  });
}

async function startLocalServices() {
  const { startServer } = await import("./server.js");
  for (let port = 4173; port <= 4182; port += 1) {
    try {
      localServer = await startServer({ host: "127.0.0.1", port });
      serverOwned = true;
      appUrl = `http://127.0.0.1:${port}/`;
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      if (await checkExistingServer(port)) {
        appUrl = `http://127.0.0.1:${port}/`;
        console.log(`Using the existing compatible Comvibe AI service on port ${port}.`);
        return;
      }
    }
  }
  throw new Error("Could not find an available local app port (4173–4182). Close another local service and try again.");
}

function createWindow() {
  appWindow = new BrowserWindow({
    title: "Comvibe AI",
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f5f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  appWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== appUrl && !url.startsWith(`${appUrl}#`)) {
      event.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });
  appWindow.loadURL(appUrl);
  appWindow.on("closed", () => { appWindow = null; });
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  try {
    registerKeyHandlers();
    await loadSavedGeminiKey();
    await startLocalServices();
    createWindow();
  } catch (error) {
    console.error("Could not start Comvibe AI desktop app:", error);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (serverOwned && localServer) localServer.close();
});

app.on("window-all-closed", () => {
  app.quit();
});
