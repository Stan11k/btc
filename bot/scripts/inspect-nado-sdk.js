"use strict";

/**
 * Безпечний діагностичний скрипт: НЕ виставляє жодних ордерів і не
 * підписує жодних транзакцій. Друкує вихідний код ключових методів
 * (Function.toString()) — щоб побачити точні очікувані параметри замість
 * здогадок.
 *
 * Запуск (з папки bot/, після `npm install @nadohq/client ethers`):
 *   node scripts/inspect-nado-sdk.js
 */

function printSource(obj, methodName, label) {
  if (!obj || typeof obj[methodName] !== "function") {
    console.log(`${label}.${methodName}: метод не знайдено`);
    return;
  }
  console.log(`\n===== Вихідний код ${label}.${methodName} =====`);
  console.log(obj[methodName].toString().slice(0, 3000));
  console.log("===== кінець =====");
}

function describe(obj, label) {
  if (!obj) {
    console.log(`${label}: (немає)`);
    return;
  }
  const names = new Set();
  let proto = obj;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== "constructor") names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  console.log(`\n${label}: [${[...names].join(", ")}]`);
}

async function main() {
  const ethersLib = require("ethers");
  const clientLib = require("@nadohq/client");
  const { NadoClient } = clientLib;
  const wallet = ethersLib.Wallet.createRandom(); // одноразовий, не ваш
  const client = new NadoClient({ signer: wallet, gatewayUrl: "https://gateway.prod.nado.xyz/v1" });

  printSource(client.market, "placeOrder", "nadoClient.market");
  printSource(client.market, "placeOrders", "nadoClient.market");
  printSource(client.market, "cancelOrders", "nadoClient.market");
  printSource(client.market, "validateOrderParams", "nadoClient.market");
  printSource(client.market, "getLatestMarketPrice", "nadoClient.market");
  printSource(client.market, "getMaxOrderSize", "nadoClient.market");
  printSource(client.subaccount, "getIsolatedPositions", "nadoClient.subaccount");
  printSource(client.subaccount, "getSubaccountSummary", "nadoClient.subaccount");

  // engineClient — можливий геттер, невидимий у простому переліку полів,
  // але доступний напряму через властивість:
  const engineClient = client.market.context && client.market.context.engineClient;
  describe(engineClient, "nadoClient.market.context.engineClient");
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
