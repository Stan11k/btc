"use strict";

/**
 * Безпечна перевірка форми ордера через validateOrderParams — цей виклик
 * ЛИШЕ ПЕРЕВІРЯЄ параметри на сервері (мін. розмір, крок ціни тощо) і НЕ
 * виконує угоду, гроші не рухаються. Використовує ВАШ реальний гаманець із
 * .env (потрібен лише для підпису запиту перевірки, не для реальної угоди).
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
  const { ethers } = require("ethers");
  const { NadoClient } = require("@nadohq/client");

  const pk = process.env.NADO_WALLET_PRIVATE_KEY;
  if (!pk) {
    console.error("NADO_WALLET_PRIVATE_KEY не задано в .env");
    process.exit(1);
  }
  const wallet = new ethers.Wallet(pk);
  console.log("Гаманець:", wallet.address);

  const client = new NadoClient({ signer: wallet, gatewayUrl: "https://gateway.prod.nado.xyz/v1" });

  // Дізнаємось поточну ціну BTC (product_id 2), щоб узяти правдоподібну ціну ліміт-ордера.
  const priceInfo = await client.market.getLatestMarketPrice({ productId: 2 });
  console.log("getLatestMarketPrice(2):", JSON.stringify(priceInfo));

  // Найменш ризикована тестова заявка: мізерний розмір, ціна помітно нижча
  // за ринок (щоб точно НЕ виконалась, навіть якби ми випадково викликали
  // щось, що реально відправляє ордер — а ми викликаємо лише validate).
  const candidateOrder = {
    productId: 2,
    order: {
      price: "50000",
      amount: "0.001",
      expiration: Math.floor(Date.now() / 1000) + 60,
    },
  };

  console.log("\nПробую validateOrderParams з:", JSON.stringify(candidateOrder));
  try {
    const result = await client.market.validateOrderParams(candidateOrder);
    console.log("Результат validateOrderParams:", JSON.stringify(result));
  } catch (err) {
    console.log("Помилка validateOrderParams (це нормально — вона підкаже правильний формат):");
    console.log(err.message || err);
    if (err.response) console.log("err.response:", JSON.stringify(err.response));
  }
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
