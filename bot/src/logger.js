"use strict";

const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, "bot.log");

function stamp() {
  return new Date().toISOString();
}

function write(level, msg) {
  const line = `[${stamp()}] [${level}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + "\n");
  } catch (_) {
    /* ignore disk errors, console output still happened */
  }
}

module.exports = {
  info: (msg) => write("INFO", msg),
  warn: (msg) => write("WARN", msg),
  error: (msg) => write("ERROR", msg),
  trade: (msg) => write("TRADE", msg),
};
