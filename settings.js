const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readSettings() {
  ensureDataDir();
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")); } catch {}
  return {
    botName: process.env.BOT_NAME || "ICEMAN BOT",
    geminiModel: saved.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    geminiApiKey: saved.geminiApiKey || process.env.GEMINI_API_KEY || "",
    mode: saved.mode === "private" ? "private" : "public",
    prefix: "."
  };
}

function writeSettings(next) {
  ensureDataDir();
  const current = readSettings();
  const allowed = {
    geminiModel: String(next.geminiModel || current.geminiModel).trim().slice(0, 100),
    geminiApiKey: next.geminiApiKey === undefined ? current.geminiApiKey : String(next.geminiApiKey).trim(),
    mode: next.mode === "private" ? "private" : "public"
  };
  if (allowed.geminiApiKey.length > 500) throw new Error("API key is too long.");
  const tmp = SETTINGS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(allowed, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_PATH);
  return readSettings();
}

function publicSettings() {
  const s = readSettings();
  return {
    botName: s.botName,
    geminiModel: s.geminiModel,
    hasGeminiKey: Boolean(s.geminiApiKey),
    mode: s.mode,
    prefix: s.prefix
  };
}

module.exports = { DATA_DIR, ensureDataDir, readSettings, writeSettings, publicSettings };
