const { isOwner } = require("./security");
const { readSettings, writeSettings } = require("./settings");

const OWNER_HELP = [
  "👑 *ICEMAN BOT — OWNER MENU*",
  ".mode public | .mode private",
  ".status — show connection and bot mode",
  ".setmodel MODEL_NAME — set Gemini model",
  ".help — show available commands"
].join("\n");

async function askGemini(prompt) {
  const settings = readSettings();
  if (!settings.geminiApiKey) return "Gemini is not configured yet. The owner can add the API key in the private dashboard.";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt.slice(0, 8000) }] }] }),
      signal: AbortSignal.timeout(25000)
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Gemini request failed:", response.status, detail.slice(0, 300));
    return "AI service is temporarily unavailable. Please try again later.";
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "I couldn't generate a reply this time.";
}

async function handleMessage(sock, message) {
  if (!message.message || message.key.fromMe) return;
  const jid = message.key.remoteJid || "";
  if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

  const sender = message.key.participant || jid.split("@")[0];
  const owner = isOwner(sender);
  const settings = readSettings();
  const body = message.message.conversation ||
    message.message.extendedTextMessage?.text ||
    message.message.imageMessage?.caption ||
    message.message.videoMessage?.caption || "";
  const text = body.trim();
  if (!text) return;

  if (text.startsWith(".")) {
    const [command, ...rest] = text.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ");
    if (["help", "menu"].includes((command || "").toLowerCase())) {
      const response = owner ? OWNER_HELP : "🤖 *ICEMAN BOT*\nCommands: .help, .ping, .ai your question";
      return sock.sendMessage(jid, { text: response }, { quoted: message });
    }
    if (command === "ping") return sock.sendMessage(jid, { text: "🏓 ICEMAN BOT is online." }, { quoted: message });
    if (["status", "mode", "setmodel"].includes((command || "").toLowerCase()) && !owner) {
      return sock.sendMessage(jid, { text: "⛔ This command is restricted to the bot owner." }, { quoted: message });
    }
    if (command === "status" && owner) {
      return sock.sendMessage(jid, { text: `🤖 ICEMAN BOT\nMode: ${settings.mode}\nGemini: ${settings.geminiApiKey ? "configured" : "not configured"}\nModel: ${settings.geminiModel}` }, { quoted: message });
    }
    if (command === "mode" && owner) {
      if (!["public", "private"].includes(arg)) return sock.sendMessage(jid, { text: "Use .mode public or .mode private" }, { quoted: message });
      writeSettings({ mode: arg });
      return sock.sendMessage(jid, { text: `✅ Bot mode set to ${arg}.` }, { quoted: message });
    }
    if (command === "setmodel" && owner) {
      if (!arg || arg.length > 100) return sock.sendMessage(jid, { text: "Usage: .setmodel gemini-2.5-flash" }, { quoted: message });
      writeSettings({ geminiModel: arg });
      return sock.sendMessage(jid, { text: `✅ Gemini model set to ${arg}.` }, { quoted: message });
    }
    if (command === "ai") {
      if (settings.mode === "private" && !owner) return sock.sendMessage(jid, { text: "🔒 ICEMAN BOT is currently in private mode." }, { quoted: message });
      const question = arg || "Say hello.";
      const answer = await askGemini(question);
      return sock.sendMessage(jid, { text: answer.slice(0, 4000) }, { quoted: message });
    }
    return sock.sendMessage(jid, { text: "Unknown command. Send .help to see commands." }, { quoted: message });
  }

  if (settings.mode === "private" && !owner) return;
  // Do not automatically send unsolicited AI replies to every plain message.
}

module.exports = { handleMessage };
