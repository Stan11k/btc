"use strict";

/**
 * Безпечний діагностичний скрипт: НЕ виставляє жодних ордерів і не
 * підписує жодних транзакцій. Він лише завантажує @nadohq/client і друкує
 * реальну структуру об'єктів (які методи насправді існують), щоб замінити
 * вгадування точних назв методів на факти — так само, як ми "простукали"
 * REST API раніше.
 *
 * Запуск (з папки bot/, після `npm install @nadohq/client ethers`):
 *   node scripts/inspect-nado-sdk.js
 */

function listMembers(obj, label, depth = 0) {
  if (!obj || depth > 2) return;
  const proto = Object.getPrototypeOf(obj);
  const ownKeys = Object.keys(obj);
  const protoKeys = proto ? Object.getOwnPropertyNames(proto).filter((k) => k !== "constructor") : [];
  console.log(`${"  ".repeat(depth)}${label}:`);
  console.log(`${"  ".repeat(depth)}  власні поля: [${ownKeys.join(", ")}]`);
  console.log(`${"  ".repeat(depth)}  методи прототипу: [${protoKeys.join(", ")}]`);
  for (const key of ownKeys) {
    const val = obj[key];
    if (val && typeof val === "object" && depth < 2) {
      listMembers(val, `${label}.${key}`, depth + 1);
    }
  }
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

  console.log("Експорти @nadohq/client:", Object.keys(clientLib));

  const { NadoClient } = clientLib;
  if (!NadoClient) {
    console.error("У пакеті немає експорту 'NadoClient' — див. список експортів вище, знайдіть правильну назву.");
    return;
  }

  // Тестовий гаманець — НЕ обов'язково ваш реальний. Це лише для
  // ініціалізації клієнта й перегляду його структури, жодного запиту з
  // грошовими наслідками тут не виконується.
  const wallet = ethersLib.Wallet.createRandom();
  console.log("Використано одноразовий тестовий гаманець (не ваш):", wallet.address);

  // Пробуємо кілька найімовірніших варіантів конструктора — перший, що
  // спрацює без винятку, і покаже реальну структуру.
  const attempts = [
    () => new NadoClient({ signer: wallet, gatewayUrl: "https://gateway.prod.nado.xyz/v1" }),
    () => new NadoClient(wallet, { gatewayUrl: "https://gateway.prod.nado.xyz/v1" }),
    () => new NadoClient({ privateKey: wallet.privateKey }),
  ];

  let client = null;
  for (const [i, attempt] of attempts.entries()) {
    try {
      client = attempt();
      console.log(`Варіант конструктора #${i + 1} спрацював.`);
      break;
    } catch (err) {
      console.log(`Варіант конструктора #${i + 1} не спрацював: ${err.message}`);
    }
  }

  if (!client) {
    console.error("Жоден варіант конструктора NadoClient не спрацював. Скиньте повний вивід цього скрипта.");
    return;
  }

  listMembers(client, "nadoClient");
  if (client.context) {
    listMembers(client.context, "nadoClient.context");
    if (client.context.engineClient) {
      listMembers(client.context.engineClient, "nadoClient.context.engineClient");
      if (client.context.engineClient.payloadBuilder) {
        listMembers(client.context.engineClient.payloadBuilder, "nadoClient.context.engineClient.payloadBuilder");
      }
    }
  }
}

main().catch((err) => {
  console.error("Неочікувана помилка:", err);
});
