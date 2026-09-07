"use strict";

/**
 * Правильна ініціалізація NadoClient потребує viem (walletClient/
 * publicClient), не ethers. Тут: знайти правильний chainEnv, зібрати
 * клієнта через createNadoClient, і безпечно перевірити (validateOrderParams
 * — не виконує угоду) форму ордера. Нічого не рухає гроші.
 *
 * Запуск (з папки bot/, після `npm install @nadohq/client viem`):
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
  console.log("Валідні chainEnv (ENGINE_CLIENT_ENDPOINTS):", JSON.stringify(clientLib.ENGINE_CLIENT_ENDPOINTS, null, 2));

  let viem, accounts;
  try {
    viem = require("viem");
    accounts = require("viem/accounts");
  } catch (err) {
    console.error("Пакет 'viem' не встановлено. Виконайте: npm install viem");
    process.exit(1);
  }

  const pk = process.env.NADO_WALLET_PRIVATE_KEY;
  if (!pk) {
    console.error("NADO_WALLET_PRIVATE_KEY не задано в .env");
    process.exit(1);
  }
  const account = accounts.privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  console.log("Гаманець (viem account):", account.address);

  const chainEnvKeys = Object.keys(clientLib.ENGINE_CLIENT_ENDPOINTS || {});
  const chainEnv = chainEnvKeys.find((k) => /mainnet/i.test(k)) || chainEnvKeys[0];
  console.log("Обраний chainEnv:", chainEnv);

  // Nado працює на Ink (OP-stack L2). walletClient потрібен лише для підпису
  // (локально, без мережі) — реальний RPC для наших запитів (ціни/валідація
  // ордера) не використовується, але viem вимагає СИНТАКСИЧНО валідний URL
  // для конструктора транспорту.
  const walletClient = viem.createWalletClient({ account, transport: viem.http("https://rpc-gel.inkonchain.com") });

  let client;
  try {
    client = clientLib.createNadoClient({ chainEnv }, { walletClient, publicClient: undefined });
    console.log("createNadoClient спрацював.");
  } catch (err) {
    console.error("createNadoClient не спрацював:", err.message);
    return;
  }

  console.log("engineClient присутній?", !!client.context.engineClient);

  try {
    const priceInfo = await client.market.getLatestMarketPrice({ productId: 2 });
    console.log("getLatestMarketPrice(2):", JSON.stringify(priceInfo));
  } catch (err) {
    console.log("getLatestMarketPrice помилка:", err.message);
  }

  // Можливо, SDK потребує заздалегідь підвантажені метадані продукту
  // (крок ціни/розміру) для внутрішніх розрахунків — підвантажуємо явно.
  try {
    const markets = await client.market.getAllMarkets();
    const btc = Array.isArray(markets) ? markets.find((m) => m.productId === 2) : markets?.[2];
    console.log("\ngetAllMarkets() -> productId 2:", JSON.stringify(btc).slice(0, 600));
  } catch (err) {
    console.log("getAllMarkets помилка:", err.message);
  }

  const baseOrder = {
    subaccountOwner: account.address,
    expiration: Math.floor(Date.now() / 1000) + 60,
    nonce: Date.now(),
  };

  const variants = [
    { label: "людський формат (price/amount як є)", order: { ...baseOrder, price: "50000", amount: "0.001" } },
    {
      label: "масштабовано ×1e18 (priceX18/amount як BigInt-рядки)",
      order: { ...baseOrder, price: (50000n * 10n ** 18n).toString(), amount: (10n ** 15n).toString() },
    },
    {
      label: "поля названі priceX18/amountX18",
      order: {
        subaccountOwner: account.address,
        expiration: baseOrder.expiration,
        nonce: baseOrder.nonce,
        priceX18: (50000n * 10n ** 18n).toString(),
        amountX18: (10n ** 15n).toString(),
      },
    },
  ];

  for (const { label, order } of variants) {
    const candidateOrder = { productId: 2, order };
    console.log(`\n--- Варіант: ${label} ---`);
    console.log("order:", JSON.stringify(order));
    try {
      const result = await client.market.validateOrderParams(candidateOrder);
      console.log("УСПІХ, результат validateOrderParams:", JSON.stringify(result));
    } catch (err) {
      console.log("Помилка:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
