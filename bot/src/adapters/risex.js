"use strict";

const { BaseAdapter } = require("./base");
const CONFIG = require("../config");
const logger = require("../logger");

/**
 * Адаптер RISEx (rise.trade) — ончейн перп-DEX на RISE Chain.
 *
 * Базовий REST API знайдено емпірично (07.09.2026) через вкладку Network
 * браузера на www.rise.trade (жодної офіційної публічної документації не
 * вдалось знайти — сайти docs.risechain.com / api.risex.net або
 * недоступні, або взагалі про іншу платформу з подібною назвою):
 *
 *   GET https://api.rise.trade/api/v1/markets
 *   → { data: { markets: [ { market_id, base_asset_symbol: "BTC/USDC",
 *                             mark_price, index_price, last_price, ... } ] } }
 *
 * Запит публічний, без авторизації (CORS дозволено для www.rise.trade).
 * BTC — market_id "1" (base_asset_symbol "BTC/USDC").
 *
 * ОБМЕЖЕННЯ: ця відповідь не містить окремих bid/ask — тільки mark_price/
 * index_price/last_price. Поки що використовуємо mark_price як і bid, і ask
 * (тобто власний спред RISEx вважаємо нульовим) — це трохи завищує
 * розрахунковий "арбітражний" прибуток, бо ігнорує реальний спред книги
 * ордерів RISEx. Якщо потрібна вища точність — знайдіть у Network (вкладка
 * WS або окремий запит на кшталт /orderbook, /depth, /ticker) реальний
 * bid/ask і підставте замість mark_price нижче.
 *
 * Комісії (0.03% taker / 0.01% maker) — публічно підтверджені раніше з
 * маркетингових матеріалів RISEx, тарифи для конкретного акаунта можуть
 * відрізнятись.
 *
 * СТАТУС: читання ціни (getBookTicker) працює на реальному API.
 * Виставлення/закриття ордерів (openMarket/closePosition) — ще ЗАГЛУШКИ:
 * авторизація й формат запиту на угоди (ймовірно, підпис гаманцем — на
 * скріні акаунта є "API Wallets", де можна авторизувати гаманець-підписант,
 * що не може виводити кошти) не перевірялись. Знайдіть у Network запит, що
 * відправляється при реальному розміщенні ордера на сайті (треба буде
 * увійти в акаунт і, можливо, зробити тестову угоду на мінімальному
 * розмірі), і заповніть методи нижче за його зразком.
 */
class RisexAdapter extends BaseAdapter {
  constructor() {
    super("RISEx", CONFIG.risex.fees);
    this.cfg = CONFIG.risex;
    // Читання ціни підтверджено робочим — safe: openMarket/closePosition
    // нижче все одно безумовно кидають "TODO" незалежно від цього прапорця.
    this.implemented = true;
    this.marketId = null;
  }

  async _resolveMarketId() {
    if (this.marketId != null) return this.marketId;
    const markets = await this._fetchMarkets();
    const btc = markets.find((m) => m.base_asset_symbol === "BTC/USDC");
    if (!btc) throw new Error('base_asset_symbol "BTC/USDC" відсутній у /api/v1/markets');
    this.marketId = btc.market_id;
    logger.info(`RISEx: BTC/USDC = market_id ${this.marketId} (mark price $${parseFloat(btc.mark_price).toFixed(2)}).`);
    return this.marketId;
  }

  async _fetchMarkets() {
    const res = await fetch(`${this.cfg.baseUrl || "https://api.rise.trade"}/api/v1/markets`, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error(`markets: сервер повернув не-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`markets: HTTP ${res.status}: ${text.slice(0, 300)}`);
    return json?.data?.markets || [];
  }

  async getBookTicker() {
    if (!this.implemented) {
      logger.warn("RISEx: адаптер ще не підключено — біржа вважається офлайн.");
      return null;
    }
    const marketId = await this._resolveMarketId();
    const markets = await this._fetchMarkets();
    const entry = markets.find((m) => m.market_id === marketId);
    if (!entry) throw new Error(`market_id ${marketId} відсутній у /api/v1/markets`);
    const mid = parseFloat(entry.mark_price);
    if (!Number.isFinite(mid)) {
      throw new Error(`Не вдалося розпарсити mark_price: ${JSON.stringify(entry).slice(0, 300)}`);
    }
    // Немає окремого bid/ask у цьому ендпоінті — використовуємо mark_price
    // для обох (див. ОБМЕЖЕННЯ у коментарі класу вище).
    return { bid: mid, ask: mid, ts: Date.now() };
  }

  async getOpenPosition() {
    if (!this.implemented) return null;
    // TODO: знайти ендпоінт позицій акаунта (потребує авторизації)
    throw new Error("RISEx.getOpenPosition(): TODO");
  }

  async openMarket(_side, _sizeBtc) {
    if (!this.implemented) {
      throw new Error("RISEx.openMarket(): адаптер не підключено, торгівля заблокована");
    }
    // TODO: знайти реальний запит розміщення ордера через Network (авторизація
    // приватним ключем API-гаманця з rise.trade → Settings → API Wallets).
    throw new Error("RISEx.openMarket(): TODO — підключіть і перевірте реальний виклик API");
  }

  async closePosition() {
    if (!this.implemented) {
      throw new Error("RISEx.closePosition(): адаптер не підключено");
    }
    // TODO
    throw new Error("RISEx.closePosition(): TODO — підключіть і перевірте реальний виклик API");
  }
}

module.exports = { RisexAdapter };
