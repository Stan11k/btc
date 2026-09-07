"use strict";

const { BaseAdapter } = require("./base");
const CONFIG = require("../config");
const logger = require("../logger");

/**
 * Адаптер Variational (Omni) — RFQ-протокол з 0% maker/taker комісією.
 *
 * СТАТУС: НЕ ПІДКЛЮЧЕНО (implemented = false).
 *
 * Причина: на момент написання цього коду офіційний Python SDK Variational
 * (github.com/variational-research/variational-sdk-python) прямо вказує, що
 * самостійна видача API-ключів недоступна — доступ треба запитувати на
 * hello@variational.io. Без ключа й без точної специфікації методів
 * "отримати ціну" / "відкрити позицію" (їх немає навіть у README SDK —
 * тільки посилання на закриту Endpoint Reference) писати тут конкретні
 * виклики означало б вгадувати код, що рухає ваші гроші. Цього свідомо не
 * зроблено.
 *
 * ЩО ЗРОБИТИ, ЩОБ ПІДКЛЮЧИТИ:
 *   1. Отримати API-ключ (лист на hello@variational.io, або testnet-ключ на
 *      https://testnet.variational.io/app/settings — перевірте, чи working).
 *   2. `pip install variational` НЕ підходить напряму (це Python SDK, бот
 *      тут на Node.js) — або викликайте їхній REST API напряму (дізнайтесь
 *      базовий URL і формат запитів з Endpoint Reference після отримання
 *      доступу), або підніміть маленький Python-міст (окремий процес, що
 *      віддає ціни/приймає накази через локальний HTTP/файл), або перепишіть
 *      цей адаптер на виклики їхнього REST API напряму, якщо він є (не SDK).
 *   3. Заповніть нижче getBookTicker/openMarket/closePosition і поставте
 *      this.implemented = true.
 */
class VariationalAdapter extends BaseAdapter {
  constructor() {
    super("Variational", CONFIG.variational.fees);
    this.cfg = CONFIG.variational;
    this.implemented = false; // <-- поставте true, коли підключите реальні виклики нижче
  }

  async getBookTicker() {
    if (!this.implemented) {
      logger.warn(
        "Variational: адаптер ще не підключено (немає API-доступу) — біржа вважається офлайн."
      );
      return null;
    }
    // TODO: реальний виклик REST/SDK Variational, повернути { bid, ask, ts }
    throw new Error("Variational.getBookTicker(): TODO — підключіть реальний API");
  }

  async getOpenPosition() {
    if (!this.implemented) return null;
    // TODO
    throw new Error("Variational.getOpenPosition(): TODO");
  }

  async openMarket(_side, _sizeBtc) {
    if (!this.implemented) {
      throw new Error("Variational.openMarket(): адаптер не підключено, торгівля заблокована");
    }
    // TODO
    throw new Error("Variational.openMarket(): TODO — підключіть реальний API");
  }

  async closePosition() {
    if (!this.implemented) {
      throw new Error("Variational.closePosition(): адаптер не підключено");
    }
    // TODO
    throw new Error("Variational.closePosition(): TODO — підключіть реальний API");
  }
}

module.exports = { VariationalAdapter };
