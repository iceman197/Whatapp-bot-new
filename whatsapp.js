
const path = require("node:path");
const pino = require("pino");

const makeWASocket =
  require("@whiskeysockets/baileys").default;

const {
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const { DATA_DIR } = require("./settings");
const { handleMessage } = require("./commands");

let sock = null;
let status = "disconnected";
let pairingBusy = false;
let lastError = "";
let reconnectTimer = null;
let reconnectAllowed = true;
let connectionGeneration = 0;

function getStatus() {
  return {
    status,
    pairingBusy,
    lastError: lastError
      ? "Connection needs attention."
      : ""
  };
}

function normalizePairingNumber(number) {
  if (typeof number !== "string" &&
      typeof number !== "number") {
    throw new Error("Enter a valid WhatsApp phone number.");
  }

  const digits = String(number).replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) {
    throw new Error(
      "Enter a valid international number with country code."
    );
  }

  return digits;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function startWhatsApp(numberForPairing) {
  if (pairingBusy) {
    throw new Error(
      "A pairing request is already in progress."
    );
  }

  if (status === "connected") {
    throw new Error(
      "WhatsApp is already connected. Disconnect first to pair another account."
    );
  }

  pairingBusy = true;
  reconnectAllowed = true;
  clearReconnectTimer();

  const generation = ++connectionGeneration;
  let newSocket = null;

  try {
    const authDir = path.join(
      DATA_DIR,
      "auth_info_baileys"
    );

    const { state, saveCreds } =
      await useMultiFileAuthState(authDir);

    newSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });

    sock = newSocket;
    status = "connecting";
    lastError = "";

    newSocket.ev.on("creds.update", saveCreds);

    newSocket.ev.on(
      "connection.update",
      ({ connection, lastDisconnect }) => {
        if (generation !== connectionGeneration) {
          return;
        }

        if (connection === "connecting") {
          status = "connecting";
        }

        if (connection === "open") {
          status = "connected";
          lastError = "";
          clearReconnectTimer();
        }

        if (connection === "close") {
          status = "disconnected";

          const code =
            lastDisconnect?.error?.output?.statusCode;

          const loggedOut =
            code === DisconnectReason.loggedOut;

          lastError = loggedOut
            ? "logged_out"
            : "connection_closed";

          if (sock === newSocket) {
            sock = null;
          }

          try {
            newSocket.end(undefined);
          } catch {}

          if (loggedOut) {
            reconnectAllowed = false;
            lastError = "logged_out";
            return;
          }

          if (reconnectAllowed && !reconnectTimer) {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;

              startExistingSession().catch((error) => {
                console.error(
                  "WhatsApp reconnect error:",
                  error.message
                );
              });
            }, 5000);
          }
        }
      }
    );

    newSocket.ev.on(
      "messages.upsert",
      async ({ messages, type }) => {
        if (type !== "notify") return;
        if (generation !== connectionGeneration) return;

        for (const message of messages) {
          try {
            await handleMessage(newSocket, message);
          } catch (error) {
            console.error(
              "Message handler error:",
              error.message
            );
          }
        }
      }
    );

    if (numberForPairing && !state.creds.registered) {
      const number = normalizePairingNumber(
        numberForPairing
      );

      // Wait briefly for the connection to initialize.
      await new Promise((resolve) =>
        setTimeout(resolve, 2000)
      );

      if (generation !== connectionGeneration) {
        throw new Error(
          "Pairing request was cancelled."
        );
      }

      const code =
        await newSocket.requestPairingCode(number);

      return {
        code:
          String(code).match(/.{1,4}/g)?.join("-") ||
          String(code)
      };
    }

    if (numberForPairing && state.creds.registered) {
      throw new Error(
        "A WhatsApp account is already registered. Disconnect and reset the saved session before pairing a different account."
      );
    }

    return { code: null };
  } catch (error) {
    lastError = "pairing_failed";

    if (sock === newSocket) {
      sock = null;
    }

    if (newSocket) {
      try {
        newSocket.end(undefined);
      } catch {}
    }

    status = "disconnected";
    throw error;
  } finally {
    pairingBusy = false;
  }
}

async function startExistingSession() {
  if (
    sock ||
    status === "connected" ||
    status === "connecting" ||
    pairingBusy
  ) {
    return;
  }

  reconnectAllowed = true;
  return startWhatsApp(null);
}

async function disconnectWhatsApp() {
  reconnectAllowed = false;
  clearReconnectTimer();

  // Invalidate callbacks from the old socket.
  connectionGeneration++;

  const oldSocket = sock;
  sock = null;
  status = "disconnected";
  lastError = "";

  if (oldSocket) {
    try {
      await oldSocket.logout();
    } catch {}

    try {
      oldSocket.end(undefined);
    } catch {}
  }

  return getStatus();
}

module.exports = {
  startWhatsApp,
  startExistingSession,
  disconnectWhatsApp,
  getStatus
};
  
