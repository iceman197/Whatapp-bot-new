# ICEMAN BOT — GitHub + Render

A Node.js starter implementation using Baileys phone-number pairing, a private owner dashboard, basic commands, and optional Gemini replies.

## Important notes

- Baileys connects through WhatsApp Web, not the official WhatsApp Business Platform. It is a community library and may be affected by WhatsApp changes. Use responsibly and follow WhatsApp terms.
- Pairing is restricted to `OWNER_NUMBER` (default `233550381372`) and all dashboard actions require `ADMIN_TOKEN`.
- Never commit `.env`, `data/auth_info_baileys`, `data/settings.json`, API keys, or session files.
- Render needs persistent disk storage at `/var/data`; otherwise WhatsApp credentials can disappear after redeploy/restart.
- This is a starter implementation, not the entire 500+ command roadmap. It implements `.help`, `.ping`, `.status`, `.mode`, `.setmodel`, and `.ai`.
- No live WhatsApp pairing, Gemini API request, GitHub upload, or Render deployment has been performed in this environment.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_TOKEN` to a long random value (at least 24 characters) and keep it private.
4. Install dependencies with `npm install`.
5. Start with `npm start`.
6. Open `http://localhost:3000`.

## Deploy to Render

1. Upload the project files to a private or public GitHub repository. Do not upload `.env` or `data` contents.
2. In Render, create a Web Service from the repository. The included `render.yaml` is a starting blueprint.
3. Set `ADMIN_TOKEN` in Render's Environment settings to a strong secret. Keep it private.
4. Ensure the persistent disk is mounted at `/var/data` and `DATA_DIR=/var/data`.
5. Wait for the build and deployment logs. Check `/api/health`.
6. Open the site and enter the same private admin token. Use the owner number in international digits-only format to request the pairing code.
7. In WhatsApp on the owner phone, open Linked devices → Link a device → Link with phone number instead, then enter the code.
8. Add a Gemini API key in the owner dashboard only if you want `.ai` replies. The key is stored server-side in the persistent data directory.

## Security

- Use HTTPS in production.
- The admin token is sent in an Authorization header; never put it in the URL or source code.
- Only the configured owner number may request pairing. Owner commands are checked server-side using normalized sender numbers.
- If you suspect the admin token has leaked, rotate it in Render immediately.
