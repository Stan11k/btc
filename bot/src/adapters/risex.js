"use strict";

const { BaseAdapter } = require("./base");
const CONFIG = require("../config");
const logger = require("../logger");

/**
 * Адаптер RISEx (rise.trade) — повністю ончейн ордербук-перпи на RISE Chain.
 * Комісії: 0.03% taker / 0.01% maker (публічно підтверджено).
 *
 * СТАТУС: НЕ ПІДКЛЮЧЕНО (implemented = false).
 *
 * Причина: точний REST/WS API (базовий URL, формат заголовків автентифікації,
 * ендпоінти "тікер"/"виставити ордер"/"закрити позицію") не вдалось
 * перевірити з цього середовища — офіційний docs.risechain.com і схожі
 * джерела були недоступні через мережеву політику пісочниці, у якій писався
 * цей код. Відомо, що сторонні агрегатори (напр. tread.fi) підключають RISEx
 * через API-ключ, і що RISEx має "sub-accounts" з делегованим виконанням —
 * тобто ймовірно НЕ обов'язково передавати боту приватний ключ основного
 * гаманця. Але вгадувати тут exact-формат запиту, що рухає гроші, — погана
 * ідея, тож методи нижче — заглушки з чіткими TODO.
 *
 * ЩО ЗРОБИТИ, ЩОБ ПІДКЛЮЧИТИ:
 *   1. Зайдіть у свій акаунт на rise.trade → Settings/API, створіть API-ключ
 *      з правом ТІЛЬКИ на торгівлю (без права виводу коштів), якщо така
 *      опція є. Якщо RISEx вимагає підпис транзакцій гаманцем — створіть
 *      ОКРЕМИЙ гаманець спеціально для бота (не основний), профінансуйте
 *      лише сумою, якою готові ризикувати, і використайте sub-account /
 *      делегований підписант, якщо платформа це підтримує.
 *   2. Скопіюйте приклад коду ("Quickstart"/"Get API Key"), який rise.trade
 *      показує одразу після створення ключа — там завжди є робочий приклад
 *      запиту з правильним base URL і заголовками. Вставте його логіку в
 *      методи нижче замість TODO.
 *   3. Поставте this.implemented = true.
 */
class RisexAdapter extends BaseAdapter {
  constructor() {
    super("RISEx", CONFIG.risex.fees);
    this.cfg = CONFIG.risex;
    this.implemented = false; // <-- поставте true, коли підключите реальні виклики нижче
  }

  async getBookTicker() {
    if (!this.implemented) {
      logger.warn("RISEx: адаптер ще не підключено — біржа вважається офлайн.");
      return null;
    }
    // TODO: реальний виклик REST API RISEx, повернути { bid, ask, ts }
    // Приклад заготовки, коли дізнаєтесь base URL:
    //   const res = await fetch(`${this.cfg.baseUrl}/api/v1/ticker?symbol=${CONFIG.symbol}`, {
    //     headers: { "X-API-KEY": this.cfg.apiKey },
    //   });
    //   const json = await res.json();
    //   return { bid: parseFloat(json.bid), ask: parseFloat(json.ask), ts: Date.now() };
    throw new Error("RISEx.getBookTicker(): TODO — підключіть реальний API");
  }

  async getOpenPosition() {
    if (!this.implemented) return null;
    // TODO
    throw new Error("RISEx.getOpenPosition(): TODO");
  }

  async openMarket(_side, _sizeBtc) {
    if (!this.implemented) {
      throw new Error("RISEx.openMarket(): адаптер не підключено, торгівля заблокована");
    }
    // TODO
    throw new Error("RISEx.openMarket(): TODO — підключіть реальний API");
  }

  async closePosition() {
    if (!this.implemented) {
      throw new Error("RISEx.closePosition(): адаптер не підключено");
    }
    // TODO
    throw new Error("RISEx.closePosition(): TODO — підключіть реальний API");
  }
}

module.exports = { RisexAdapter };
