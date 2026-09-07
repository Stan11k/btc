"use strict";

/**
 * Безпечний діагностичний скрипт: НЕ виставляє жодних ордерів і не
 * підписує жодних транзакцій. Він завантажує @nadohq/client, друкує повну
 * структуру об'єктів (обходячи весь ланцюжок прототипів, не лише один
 * рівень) і показує вихідний код (function.toString()) ключових методів
 * виконання ордерів — щоб побачити точні очікувані параметри замість
 * здогадок.
 *
 * Запуск (з папки bot/, після `npm install @nadohq/client ethers`):
 *   node scripts/inspect-nado-sdk.js
 */

function getAllMethodNames(obj) {
  const names = new Set();
  let proto = obj;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

function describe(obj, label) {
  if (!obj) {
    console.log(`${label}: (немає)`);
    return;
  }
  const ownKeys = Object.keys(obj);
  const methods = getAllMethodNames(obj);
  console.log(`\n${label}`);
  console.log(`  власні поля: [${ownKeys.join(", ")}]`);
  console.log(`  усі методи (весь ланцюжок прototypів): [${methods.join(", ")}]`);
}

function printSource(obj, methodName, label) {
  if (!obj || typeof obj[methodName] !== "function") {
    console.log(`${label}.${methodName}: метод не знайдено`);
    return;
  }
  console.log(`\n===== Вихідний код ${label}.${methodName} =====`);
  console.log(obj[methodName].toString().slice(0, 4000));
  console.log("===== кінець =====");
}

async function main() {
  let ethersLib, clientLib;
  try {
    ethersLib = require("ethers");
  } catch (err) {
    console.error("Пакет 'ethers' не встановлено. Виконайте: npm install ethers");
    process.exit(1);
  }
  try {
    clientLib = require("@nadohq/client");
  } catch (err) {
    console.error("Пакет '@nadohq/client' не встановлено. Виконайте: npm install @nadohq/client");
    process.exit(1);
  }

  const { NadoClient } = clientLib;
  const wallet = ethersLib.Wallet.createRandom(); // одноразовий, не ваш
  const client = new NadoClient({ signer: wallet, gatewayUrl: "https://gateway.prod.nado.xyz/v1" });

  describe(client, "nadoClient");
  describe(client.market, "nadoClient.market");
  describe(client.perp, "nadoClient.perp");
  describe(client.spot, "nadoClient.spot");
  describe(client.subaccount, "nadoClient.subaccount");
  describe(client.ws, "nadoClient.ws");
  describe(client.ws?.query, "nadoClient.ws.query");
  describe(client.ws?.execute, "nadoClient.ws.execute");
  describe(client.ws?.subscription, "nadoClient.ws.subscription");

  printSource(client.ws?.execute, "buildPlaceOrderMessage", "nadoClient.ws.execute");
  printSource(client.ws?.execute, "buildCancelOrdersMessage", "nadoClient.ws.execute");
  printSource(client.ws?.query, "buildQueryMessage", "nadoClient.ws.query");
  printSource(client.ws?.subscription, "buildSubscriptionMessage", "nadoClient.ws.subscription");
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
