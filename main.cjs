const { app, BrowserWindow, Menu, shell, safeStorage, ipcMain } = require("electron");
const { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } = require("node:fs");
const { readFile: readFileAsync, writeFile: writeFileAsync, unlink: unlinkAsync } = require("node:fs/promises");

let appWindow;
let localServer;
let serverOwned = false;
let appUrl;
const keyFile = () => path.join(app.getPath("userData"), "gemini-api-key.enc");
const accountsFile = () => path.join(app.getPath("userData"), "accounts.enc");
const accountSessionFile = () => path.join(app.getPath("userData"), "account-session.enc");
const accountDataFile = id => path.join(app.getPath("userData"), `account-${id}.enc`);
const accountSessions = new Map();
const loginAttempts = new Map();

function assertSecureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable. Sign in to Windows with a user account and try again.");
  }
}

function readEncryptedJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  assertSecureStorageAvailable();
  return JSON.parse(safeStorage.decryptString(readFileSync(file)));
}

function writeEncryptedJson(file, value) {
  assertSecureStorageAvailable();
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  const temporaryFile = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryFile, encrypted, { mode: 0o600 });
    renameSync(temporaryFile, file);
  } catch (error) {
    try { unlinkSync(temporaryFile); } catch {}
    throw error;
  }
}

function readAccounts() {
  const registry = readEncryptedJson(accountsFile(), { accounts: [] });
  if (!registry || !Array.isArray(registry.accounts)) throw new Error("The encrypted account registry is invalid.");
  return registry;
}

function saveAccounts(registry) {
  writeEncryptedJson(accountsFile(), registry);
}

function saveAccountSession(id) {
  writeEncryptedJson(accountSessionFile(), { accountId: id });
}

function clearAccountSession() {
  const file = accountSessionFile();
  if (existsSync(file)) unlinkSync(file);
}

function secureAccountDataPath(id) {
  if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) throw new Error("Invalid account identifier.");
  return accountDataFile(id);
}

function validateAccountData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Study data is invalid.");
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 25 * 1024 * 1024) throw new Error("Study data is too large to save.");
  return data;
}

function setIpcResult(event, callback) {
  try {
    assertTrustedSender(event);
    event.returnValue = { ok: true, ...callback() };
  } catch (error) {
    console.error("Secure account operation failed:", error);
    event.returnValue = { ok: false, error: error.message || "Secure account operation failed." };
  }
}

function withAuthenticatedAccount(event, callback) {
  assertTrustedSender(event);
  const id = accountSessions.get(event.sender.id);
  if (!id) throw new Error("Please sign in again.");
  return callback(id);
}

function normalizedName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pinHash(pin, salt) {
  return pbkdf2Sync(pin, salt, 310000, 32, "sha256").toString("hex");
}

function verifyLegacyPin(pin, account) {
  const text = `${account.legacySalt || account.salt}:${pin}`;
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  if (sha256 === (account.legacyHash || account.hash)) return true;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (account.legacyHash || account.hash) === `f${(hash >>> 0).toString(16)}`;
}

function registerSecureAccountHandlers() {
  ipcMain.on("accounts:status", event => setIpcResult(event, () => {
    const accounts = readAccounts().accounts;
    let accountId = accountSessions.get(event.sender.id);
    if (!accountId) {
      const session = readEncryptedJson(accountSessionFile(), null);
      const account = session && accounts.find(item => item.id === session.accountId);
      if (account) {
        accountId = account.id;
        accountSessions.set(event.sender.id, accountId);
      } else if (session) {
        clearAccountSession();
      }
    }
    const account = accountId && accounts.find(item => item.id === accountId);
    return {
      hasAccounts: accounts.length > 0,
      account: account ? { id: account.id, name: account.name } : null
    };
  }));

  ipcMain.on("accounts:import-legacy", (event, legacy) => setIpcResult(event, () => {
    const registryFile = accountsFile();
    if (existsSync(registryFile)) return { imported: false };
    assertSecureStorageAvailable();
    if (!legacy || !Array.isArray(legacy.accounts) || legacy.accounts.length > 100) {
      throw new Error("Legacy account data is invalid.");
    }

    const accounts = [];
    for (const item of legacy.accounts) {
      if (!item || typeof item.id !== "string" || !/^[a-f0-9]{16}$/.test(item.id) ||
          typeof item.salt !== "string" || typeof item.hash !== "string") {
        throw new Error("Legacy account data is invalid.");
      }
      const name = normalizedName(item.name);
      if (!name || name.length > 30 || accounts.some(account => account.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("Legacy account names are invalid or duplicated.");
      }
      validateAccountData(item.data || {});
      accounts.push({ id: item.id, name, legacySalt: item.salt, legacyHash: item.hash });
      writeEncryptedJson(secureAccountDataPath(item.id), item.data || {});
    }

    let unassignedData = legacy.unassignedData || null;
    if (unassignedData !== null && (typeof unassignedData !== "object" || Array.isArray(unassignedData))) {
      throw new Error("Legacy study data is invalid.");
    }
    if (unassignedData) validateAccountData(unassignedData);
    saveAccounts({ accounts, unassignedData });
    return { imported: true };
  }));

  ipcMain.on("accounts:register", (event, input) => setIpcResult(event, () => {
    const name = normalizedName(input?.name);
    const pin = input?.pin;
    if (!name || name.length > 30) throw new Error("Enter a name of 1–30 characters.");
    if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw new Error("PIN must contain 4–8 digits.");

    const registry = readAccounts();
    if (registry.accounts.some(account => account.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("An account with this name already exists.");
    }
    const id = randomBytes(8).toString("hex");
    const salt = randomBytes(16).toString("hex");
    writeEncryptedJson(secureAccountDataPath(id), registry.unassignedData || {});
    registry.accounts.push({ id, name, salt, hash: pinHash(pin, salt), algorithm: "pbkdf2-sha256" });
    delete registry.unassignedData;
    saveAccounts(registry);
    saveAccountSession(id);
    accountSessions.set(event.sender.id, id);
    return { account: { id, name } };
  }));

  ipcMain.on("accounts:login", (event, input) => setIpcResult(event, () => {
    const attempt = loginAttempts.get(event.sender.id) || { failures: 0, until: 0 };
    if (Date.now() < attempt.until) throw new Error("Too many attempts. Try again in 30 seconds.");
    const name = normalizedName(input?.name);
    const pin = input?.pin;
    const registry = readAccounts();
    const account = registry.accounts.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (account?.lockoutUntil > Date.now()) throw new Error("Too many attempts. Try again in 30 seconds.");
    let valid = false;
    if (account && typeof pin === "string" && pin.length <= 8) {
      if (account.algorithm === "pbkdf2-sha256") {
        const actual = Buffer.from(pinHash(pin, account.salt), "hex");
        const expected = Buffer.from(account.hash, "hex");
        valid = actual.length === expected.length && timingSafeEqual(actual, expected);
      } else if (account.legacySalt && account.legacyHash) {
        valid = verifyLegacyPin(pin, account);
        if (valid) {
          const salt = randomBytes(16).toString("hex");
          Object.assign(account, { salt, hash: pinHash(pin, salt), algorithm: "pbkdf2-sha256" });
          delete account.legacySalt;
          delete account.legacyHash;
          saveAccounts(registry);
        }
      }
    }
    if (!valid) {
      if (account) {
        account.failedAttempts = (account.failedAttempts || 0) + 1;
        if (account.failedAttempts >= 5) {
          account.failedAttempts = 0;
          account.lockoutUntil = Date.now() + 30000;
        }
        saveAccounts(registry);
      } else {
        attempt.failures += 1;
        if (attempt.failures >= 5) {
          attempt.failures = 0;
          attempt.until = Date.now() + 30000;
        }
        loginAttempts.set(event.sender.id, attempt);
      }
      throw new Error("The name or PIN is incorrect.");
    }
    loginAttempts.delete(event.sender.id);
    if (account.failedAttempts || account.lockoutUntil) {
      delete account.failedAttempts;
      delete account.lockoutUntil;
      saveAccounts(registry);
    }
    saveAccountSession(account.id);
    accountSessions.set(event.sender.id, account.id);
    return { account: { id: account.id, name: account.name } };
  }));

  ipcMain.on("accounts:logout", event => setIpcResult(event, () => {
    assertTrustedSender(event);
    clearAccountSession();
    accountSessions.delete(event.sender.id);
    loginAttempts.delete(event.sender.id);
    return {};
  }));

  ipcMain.on("accounts:load-data", event => setIpcResult(event, () => withAuthenticatedAccount(event, id => {
    const file = secureAccountDataPath(id);
    if (!existsSync(file)) throw new Error("The encrypted study data file is missing.");
    return { data: readEncryptedJson(file, {}) };
  })));

  ipcMain.on("accounts:save-data", (event, data) => setIpcResult(event, () => withAuthenticatedAccount(event, id => {
    writeEncryptedJson(secureAccountDataPath(id), validateAccountData(data));
    return {};
  })));
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || (event.sender?.getURL ? event.sender.getURL() : "");
  if (!appWindow || event.sender !== appWindow.webContents || !appUrl || !senderUrl ||
      event.senderFrame !== event.sender.mainFrame || new URL(senderUrl).origin !== new URL(appUrl).origin) {
    throw new Error("Untrusted app window.");
  }
}

async function loadSavedGeminiKey() {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable; the Gemini API key cannot be loaded safely.");
    }
    const encryptedKey = await readFileAsync(keyFile());
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encryptedKey);
    process.env.COMVIBE_USER_API_KEY = result;
    process.env.GEMINI_API_KEY = result;
    if (shouldReEncrypt) {
      await writeFileAsync(keyFile(), await safeStorage.encryptStringAsync(result), { mode: 0o600 });
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
    await writeFileAsync(keyFile(), await safeStorage.encryptStringAsync(key), { mode: 0o600 });
    process.env.COMVIBE_USER_API_KEY = key;
    process.env.GEMINI_API_KEY = key;
    return true;
  });

  ipcMain.handle("gemini-key:clear", async event => {
    assertTrustedSender(event);
    try {
      await unlinkAsync(keyFile());
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
      devTools: !app.isPackaged,
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
  appWindow.on("closed", () => {
    if (appWindow) {
      accountSessions.delete(appWindow.webContents.id);
      loginAttempts.delete(appWindow.webContents.id);
    }
    appWindow = null;
  });
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  try {
    registerKeyHandlers();
    registerSecureAccountHandlers();
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
