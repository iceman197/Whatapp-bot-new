const crypto = require("node:crypto");

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const header = req.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || expected.length < 24) {
    return res.status(503).json({ ok: false, error: "Server admin token is not configured securely." });
  }
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ ok: false, error: "Unauthorized. Enter the private admin token." });
  }
  next();
}

function normalizeNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function isOwner(number) {
  const owner = normalizeNumber(process.env.OWNER_NUMBER || "233550381372");
  return !!owner && normalizeNumber(number) === owner;
}

module.exports = { requireAdmin, normalizeNumber, isOwner, safeEqual };
