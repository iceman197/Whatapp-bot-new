const fs = require("node:fs/promises");
const path = require("node:path");
const pino = require("pino");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { DATA_DIR } = require("./settings");
const { handleMessage } = require("./commands");

let sock = null;
let status = "disconnected";
let pairingBusy = false;
let lastError = "";

function getStatus() {
  return { status, pairingBusy, lastError: lastError ? "Connection needs attention." : "" };
}

async function startWhatsApp(numberForPairing) {
  if (pairingBusy) throw new Error("A pairing request is already in progress.");
  pairingBusy = true;
  lastError = "";
  try {
    const authDir = path.join(DATA_DIR, "auth_info_baileys");
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const activeSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });
    sock = activeSock;
    status = "connecting";
    activeSock.ev.on("creds.update", saveCreds);
    activeSock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      // Ignore events from a socket that was replaced during account switching.
      if (sock !== activeSock) return;
      if (connection === "open") { status = "connected"; lastError = ""; }
      if (connection === "connecting") status = "connecting";
      if (connection === "close") {
        status = "disconnected";
        sock = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        lastError = code === DisconnectReason.loggedOut ? "logged_out" : "connection_closed";
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => startExistingSession().catch(() => {}), 5000);
        }
      }
    });
    activeSock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (sock !== activeSock || type !== "notify") return;
      for (const message of messages) {
        try { await handleMessage(activeSock, message); }
        catch (error) { console.error("Message handler error:", error.message); }
      }
    });
    if (numberForPairing && !state.creds.registered) {
      // Give the socket time to initialize before requesting the code.
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (sock !== activeSock) throw new Error("WhatsApp session changed before the pairing code was ready.");
      const code = await activeSock.requestPairingCode(numberForPairing);
      return { code: String(code).match(/.{1,4}/g)?.join("-") || code };
    }
    if (numberForPairing && state.creds.registered) {
      throw new Error("The old WhatsApp session is still registered. Disconnect and clear the old session, then try again.");
    }
    return { code: null };
  } finally {
    pairingBusy = false;
  }
}

// Explicitly replace the current local session before pairing a different number.
// This makes the dashboard's account-switch option actually create a fresh auth state.
async function switchAccountForPairing(number) {
  if (pairingBusy) throw new Error("A pairing request is already in progress.");
  pairingBusy = true;
  try {
    const oldSock = sock;
    sock = null; // Old socket events are ignored from this point onward.
    status = "disconnected";
    lastError = "";
    if (oldSock) {
      try { oldSock.end(undefined); } catch {}
    }
    const authDir = path.join(DATA_DIR, "auth_info_baileys");
    await fs.rm(authDir, { recursive: true, force: true });
  } finally {
    pairingBusy = false;
  }
  return startWhatsApp(number);
}

async function startExistingSession() {
  if (sock || status === "connected" || status === "connecting" || pairingBusy) return;
  return startWhatsApp(null);
}

async function disconnectWhatsApp() {
  const oldSock = sock;
  sock = null;
  if (oldSock) {
    try { await oldSock.logout(); } catch {}
    try { oldSock.end(undefined); } catch {}
  }
  status = "disconnected";
  lastError = "";
  return getStatus();
}

module.exports = { startWhatsApp, startExistingSession, switchAccountForPairing, disconnectWhatsApp, getStatus };
