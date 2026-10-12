const express = require("express");
const helmet = require("helmet");
const path = require("node:path");
const crypto = require("node:crypto");
const { requireAdmin, normalizeNumber } = require("./security");
const { ensureDataDir, publicSettings, readSettings, writeSettings } = require("./settings");
const { startExistingSession, switchAccountForPairing, disconnectWhatsApp, getStatus } = require("./whatsapp");

if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 24) {
  console.error("ADMIN_TOKEN must be set to a random secret of at least 24 characters.");
  process.exit(1);
}
ensureDataDir();
const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html" }));

const attempts = new Map();
function adminRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = attempts.get(key) || { count: 0, start: now };
  if (now - current.start > 60_000) { current.count = 0; current.start = now; }
  current.count++;
  attempts.set(key, current);
  if (current.count > 30) return res.status(429).json({ ok: false, error: "Too many requests. Wait one minute." });
  next();
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "ICEMAN BOT", status: getStatus().status }));
app.get("/api/admin/status", adminRateLimit, requireAdmin, (req, res) => {
  res.json({ ok: true, whatsapp: getStatus(), settings: publicSettings() });
});

app.post("/api/admin/pair", adminRateLimit, requireAdmin, async (req, res) => {
  const number = normalizeNumber(req.body?.phoneNumber);
  if (!/^\d{8,15}$/.test(number)) return res.status(400).json({ ok: false, error: "Enter a valid international number including country code, digits only." });
  // The authenticated admin may pair any valid international number.
  // switchAccountForPairing intentionally replaces the currently stored session.
  try {
    const result = await switchAccountForPairing(number);
    res.json({ ok: true, pairingCode: result.code, whatsapp: getStatus() });
  } catch (error) {
    console.error("Pairing request failed:", error.message);
    res.status(500).json({ ok: false, error: "Could not request a pairing code. Check server logs and try again." });
  }
});

app.post("/api/admin/disconnect", adminRateLimit, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, whatsapp: await disconnectWhatsApp() }); }
  catch { res.status(500).json({ ok: false, error: "Disconnect failed." }); }
});

app.post("/api/admin/settings", adminRateLimit, requireAdmin, (req, res) => {
  const body = req.body || {};
  const next = {};
  if (typeof body.geminiModel === "string") next.geminiModel = body.geminiModel.trim();
  if (typeof body.geminiApiKey === "string" && body.geminiApiKey.trim()) next.geminiApiKey = body.geminiApiKey.trim();
  if (body.clearGeminiKey === true) next.geminiApiKey = "";
  if (body.mode === "public" || body.mode === "private") next.mode = body.mode;
  try {
    const saved = writeSettings(next);
    res.json({ ok: true, settings: { botName: saved.botName, geminiModel: saved.geminiModel, hasGeminiKey: Boolean(saved.geminiApiKey), mode: saved.mode, prefix: "." } });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// Existing credentials reconnect on startup. Never log session credentials or pairing codes.
startExistingSession().catch(error => console.error("Initial WhatsApp session could not start:", error.message));

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log(`ICEMAN BOT listening on port ${port}`));
