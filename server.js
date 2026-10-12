
const express = require("express");
const helmet = require("helmet");
const path = require("node:path");
const fs = require("node:fs");

const {
  requireAdmin,
  normalizeNumber
} = require("./security");

const {
  ensureDataDir,
  publicSettings,
  writeSettings
} = require("./settings");

const {
  startWhatsApp,
  startExistingSession,
  disconnectWhatsApp,
  getStatus
} = require("./whatsapp");

// Require a secure admin token.
if (
  !process.env.ADMIN_TOKEN ||
  process.env.ADMIN_TOKEN.length < 24
) {
  console.error(
    "ADMIN_TOKEN must be set to a secret of at least 24 characters."
  );
  process.exit(1);
}

ensureDataDir();

const app = express();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));

// Locate the public website folder.
const possiblePublicDirs = [
  path.join(__dirname, "public"),
  path.join(__dirname, "..", "public")
];

const publicDir = possiblePublicDirs.find(
  dir => fs.existsSync(path.join(dir, "index.html"))
);

if (publicDir) {
  app.use(express.static(publicDir));
} else {
  console.error(
    "Homepage not found. Put index.html inside the public folder."
  );
}

// Basic rate limiting for admin requests.
const attempts = new Map();

function adminRateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();

  const current = attempts.get(key) || {
    count: 0,
    start: now
  };

  if (now - current.start > 60000) {
    current.count = 0;
    current.start = now;
  }

  current.count++;
  attempts.set(key, current);

  if (current.count > 30) {
    return res.status(429).json({
      ok: false,
      error: "Too many requests. Wait one minute."
    });
  }

  next();
}

// Homepage route.
app.get("/", (req, res) => {
  if (!publicDir) {
    return res.status(500).send(
      "Homepage not found. Check the public folder and index.html."
    );
  }

  res.sendFile(path.join(publicDir, "index.html"));
});

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ICEMAN BOT",
    status: getStatus().status
  });
});

// Admin status.
app.get(
  "/api/admin/status",
  adminRateLimit,
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      whatsapp: getStatus(),
      settings: publicSettings()
    });
  }
);

// WhatsApp pairing.
app.post(
  "/api/admin/pair",
  adminRateLimit,
  requireAdmin,
  async (req, res) => {
    const number = normalizeNumber(req.body?.phoneNumber);

    if (!/^\d{8,15}$/.test(number)) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid international number with country code."
      });
    }

    if (
      number !== normalizeNumber(process.env.OWNER_NUMBER || "")
    ) {
      return res.status(403).json({
        ok: false,
        error: "Pairing is restricted to the configured owner number."
      });
    }

    try {
      const result = await startWhatsApp(number);

      res.json({
        ok: true,
        pairingCode: result.code,
        whatsapp: getStatus()
      });
    } catch (error) {
      console.error("Pairing request failed:", error.message);

      res.status(500).json({
        ok: false,
        error: "Could not request a pairing code. Check server logs."
      });
    }
  }
);

// Disconnect WhatsApp.
app.post(
  "/api/admin/disconnect",
  adminRateLimit,
  requireAdmin,
  async (req, res) => {
    try {
      res.json({
        ok: true,
        whatsapp: await disconnectWhatsApp()
      });
    } catch {
      res.status(500).json({
        ok: false,
        error: "Disconnect failed."
      });
    }
  }
);

// Update bot settings.
app.post(
  "/api/admin/settings",
  adminRateLimit,
  requireAdmin,
  (req, res) => {
    const body = req.body || {};
    const next = {};

    if (typeof body.geminiModel === "string") {
      next.geminiModel = body.geminiModel.trim();
    }

    if (
      typeof body.geminiApiKey === "string" &&
      body.geminiApiKey.trim()
    ) {
      next.geminiApiKey = body.geminiApiKey.trim();
    }

    if (body.clearGeminiKey === true) {
      next.geminiApiKey = "";
    }

    if (body.mode === "public" || body.mode === "private") {
      next.mode = body.mode;
    }

    try {
      const saved = writeSettings(next);

      res.json({
        ok: true,
        settings: {
          botName: saved.botName,
          geminiModel: saved.geminiModel,
          hasGeminiKey: Boolean(saved.geminiApiKey),
          mode: saved.mode,
          prefix: "."
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

// Restore an existing WhatsApp session if available.
startExistingSession().catch(error => {
  console.error(
    "Initial WhatsApp session could not start:",
    error.message
  );
});

// Start the server.
const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`ICEMAN BOT listening on port ${port}`);
});
    
