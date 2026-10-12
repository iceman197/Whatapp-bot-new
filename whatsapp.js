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
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (connection === "open") { status = "connected"; lastError = ""; }
      if (connection === "connecting") status = "connecting";
      if (connection === "close") {
        status = "disconnected";
        const code = lastDisconnect?.error?.output?.statusCode;
        lastError = code === DisconnectReason.loggedOut ? "logged_out" : "connection_closed";
        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => startExistingSession().catch(() => {}), 5000);
        }
      }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        try { await handleMessage(sock, message); }
        catch (error) { console.error("Message handler error:", error.message); }
      }
    });
    if (numberForPairing && !state.creds.registered) {
      // Allow the socket to initialize before requesting a pairing code.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const code = await sock.requestPairingCode(numberForPairing);
      return { code: String(code).match(/.{1,4}/g)?.join("-") || code };
    }
    return { code: null };
  } finally {
    pairingBusy = false;
  }
}

async function startExistingSession() {
  if (sock || status === "connected" || status === "connecting") return;
  return startWhatsApp(null);
}

async function disconnectWhatsApp() {
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.end(undefined); } catch {}
    sock = null;
  }
  status = "disconnected";
  lastError = "";
  return getStatus();
}

module.exports = { startWhatsApp, startExistingSession, disconnectWhatsApp, getStatus };
