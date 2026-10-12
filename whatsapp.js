
app.post(
  "/api/admin/pair",
  adminRateLimit,
  requireAdmin,
  async (req, res) => {
    const rawNumber = req.body?.phoneNumber;

    if (
      typeof rawNumber !== "string" &&
      typeof rawNumber !== "number"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Enter an international phone number."
      });
    }

    const number = normalizeNumber(String(rawNumber));

    if (!/^\d{8,15}$/.test(number)) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter 8 to 15 digits, including the country code."
      });
    }

    try {
      const result = await startWhatsApp(number, {
        replaceSession:
          req.body?.replaceSession === true
      });

      if (!result?.code) {
        return res.status(503).json({
          ok: false,
          error: "WhatsApp did not return a pairing code."
        });
      }

      return res.json({
        ok: true,
        pairingCode: result.code,
        whatsapp: getStatus()
      });
    } catch (error) {
      if (
        error.message === "CONFIRM_ACCOUNT_REPLACEMENT"
      ) {
        return res.status(409).json({
          ok: false,
          requiresConfirmation: true,
          error:
            "A different WhatsApp account is saved. Confirm that you want to replace that account before continuing."
        });
      }

      console.error(
        "Pairing request failed:",
        error.message
      );

      return res.status(500).json({
        ok: false,
        error: error.message ===
          "This number is already registered. Keep using the existing session."
          ? error.message
          : "Could not request a pairing code. Check the server logs."
      });
    }
  }
);
      
