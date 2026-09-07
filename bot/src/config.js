"use strict";

const fs = require("fs");
const path = require("path");

// Мінімальний .env-завантажувач без зовнішніх залежностей.
function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

function bool(v, def) {
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1";
}

function num(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const CONFIG = {
  liveTrading: bool(process.env.LIVE_TRADING, false),
  symbol: process.env.SYMBOL || "BTC-PERP",
  minSpreadPct: num(process.env.MIN_SPREAD_PCT, 0.25),
  closeSpreadPct: num(process.env.CLOSE_SPREAD_PCT, 0.05),
  positionSizeUsd: num(process.env.POSITION_SIZE_USD, 100),
  maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 1),
  maxDailyLossUsd: num(process.env.MAX_DAILY_LOSS_USD, 50),
  pollMs: num(process.env.POLL_MS, 1000),

  nado: {
    baseUrl: process.env.NADO_BASE_URL || "",
    walletPrivateKey: process.env.NADO_WALLET_PRIVATE_KEY || "",
    fees: { maker: 0.0001, taker: 0.00035 }, // Entry Tier (0 обсягу): 0.01% maker / 0.035% taker
  },

  risex: {
    baseUrl: process.env.RISEX_BASE_URL || "",
    walletPrivateKey: process.env.RISEX_WALLET_PRIVATE_KEY || "",
    apiWalletExpires: process.env.RISEX_API_WALLET_EXPIRES
      ? new Date(process.env.RISEX_API_WALLET_EXPIRES + "T00:00:00Z")
      : null,
    fees: { maker: 0.0001, taker: 0.0003 }, // 0.01% maker / 0.03% taker
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },
};

module.exports = CONFIG;
