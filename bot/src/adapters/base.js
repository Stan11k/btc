"use strict";

/**
 * Контракт, якому має відповідати кожен адаптер біржі. Реальні адаптери
 * (variational.js, risex.js) реалізують ці самі методи — двигун спреду й
 * головний цикл (index.js) працюють тільки через цей інтерфейс і не знають
 * нічого специфічного про конкретну біржу.
 *
 *   name: string                     — назва для логів
 *   implemented: boolean             — false, доки реальні виклики API не
 *                                      підключені. Поки implemented=false,
 *                                      бот НІКОЛИ не виставлятиме реальних
 *                                      ордерів через цей адаптер, навіть
 *                                      якщо LIVE_TRADING=true.
 *   fees: { maker, taker }           — частки (0.0003 = 0.03%)
 *
 *   async getBookTicker()
 *     → { bid: number, ask: number, ts: number } | null (null = офлайн)
 *
 *   async getOpenPosition()
 *     → { side: "long"|"short", sizeBtc: number, entryPrice: number } | null
 *
 *   async openMarket(side, sizeBtc)
 *     side: "long" | "short"
 *     → { orderId: string, avgPrice: number }
 *     Кидає виняток при помилці — виклик, що це спричинив, має обробити її
 *     явно (особливо коли друга нога арбітражу не відкрилась після першої).
 *
 *   async closePosition()
 *     → { orderId: string, avgPrice: number }
 */

class BaseAdapter {
  constructor(name, fees) {
    this.name = name;
    this.fees = fees;
    this.implemented = false;
  }

  async getBookTicker() {
    throw new Error(`${this.name}: getBookTicker() не реалізовано`);
  }

  async getOpenPosition() {
    throw new Error(`${this.name}: getOpenPosition() не реалізовано`);
  }

  async openMarket(_side, _sizeBtc) {
    throw new Error(`${this.name}: openMarket() не реалізовано`);
  }

  async closePosition() {
    throw new Error(`${this.name}: closePosition() не реалізовано`);
  }
}

module.exports = { BaseAdapter };
