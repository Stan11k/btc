"use strict";

/**
 * Крок 1: подивитись, як правильно створювати клієнта (createNadoClient),
 * бо звичайний `new NadoClient(...)` не ініціалізує engineClient.
 * Нічого не підписується і не виконується — тільки читання вихідного коду.
 *
 * Запуск (з папки bot/):
 *   node scripts/inspect-nado-order.js
 */

function loadEnv() {
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

async function main() {
  const clientLib = require("@nadohq/client");

  console.log("===== Вихідний код createNadoClient =====");
  console.log(clientLib.createNadoClient.toString().slice(0, 3000));
  console.log("===== кінець =====\n");

  console.log("===== Вихідний код createClientContext =====");
  console.log(clientLib.createClientContext.toString().slice(0, 3000));
  console.log("===== кінець =====");
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
