"use strict";

const CONFIG = require("./config");
const logger = require("./logger");

/** Best-effort Telegram notification. No-op if not configured; never throws. */
async function notify(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    logger.warn("Не вдалося надіслати Telegram-сповіщення: " + err.message);
  }
}

module.exports = { notify };
