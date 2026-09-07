"use strict";

const { BaseAdapter } = require("./base");
const CONFIG = require("../config");
const logger = require("../logger");

/**
 * Адаптер Nado Protocol (docs.nado.xyz) — DEX для spot/perp з офчейн
 * секвенсором і ончейн розрахунками (архітектура й термінологія API майже
 * ідентичні Vertex Protocol: gateway/engine-client/indexer, priceX18,
 * EIP-712 ордери з sender/nonce/expiration — тож нижче використано ці самі
 * назви).
 *
 * Підтверджено з офіційної документації (docs.nado.xyz) і GitHub
 * (nadohq/nado-typescript-sdk):
 *   - npm-пакет: @nadohq/client (плюс потрібен ethers для гаманця-підписанта)
 *   - Gateway REST (mainnet): https://gateway.prod.nado.xyz/v1
 *     запити: POST {gateway}/query   виконання: POST {gateway}/execute
 *   - Комісії perp (Entry Tier, 0 обсягу): taker 0.035%, maker 0.01%
 *     (зростає обсяг → комісія падає; уточніть свій тариф запитом fee-rates)
 *   - Ордер підписується гаманцем (EIP-712, domain name "Nado", version
 *     "0.0.1", verifying contract — окремий на кожен product_id)
 *   - Розміщення ордера через SDK:
 *       const payload = await nadoClient.context.engineClient.payloadBuilder
 *         .buildPlaceOrderPayload({ ... });
 *       await nadoClient.context.engineClient.execute("place_order", payload.payload);
 *
 * СТАТУС: implemented = false. Причина: я НЕ зміг виконати жодного реального
 * запиту до gateway.prod.nado.xyz з середовища, де писався цей код (мережева
 * політика пісочниці блокує вихідні з'єднання до цього хосту), тож не можу
 * підтвердити точні назви полів у відповідях (наприклад, як саме в масиві
 * "all_products" записано символ BTC-перпа, чи так і буде "BTC-PERP", і які
 * саме поля містить відповідь запиту "all_bbo"). Код нижче написано за
 * задокументованою структурою API й повинен бути дуже близьким до робочого —
 * але перш ніж ставити implemented = true, ЗАПУСТІТЬ getBookTicker() один
 * раз, роздрукуйте сирі відповіді (console.log вже додано нижче) і звірте
 * назви полів із тим, що реально повертає API.
 *
 * ЩО ЗРОБИТИ, ЩОБ ПІДКЛЮЧИТИ:
 *   1. npm install @nadohq/client ethers   (у папці bot/)
 *   2. Створіть окремий гаманець спеціально для бота, профінансуйте лише
 *      сумою ризику, покладіть приватний ключ у .env → NADO_WALLET_PRIVATE_KEY
 *      (НІКОЛИ не в git, ніколи не в чат).
 *   3. Перевірте на https://nadohq.github.io/nado-typescript-sdk/ точну
 *      сигнатуру конструктора NadoClient (нижче — найбільш імовірний варіант
 *      за документацією, але не 100% підтверджений) і виправте за потреби.
 *   4. Запустіть у dry-run, звірте ціни з тим, що бачите на app.nado.xyz.
 *   5. Поставте this.implemented = true.
 */
class NadoAdapter extends BaseAdapter {
  constructor() {
    super("Nado", CONFIG.nado.fees);
    this.cfg = CONFIG.nado;
    // Тимчасово true — лише щоб протестувати читання цін (getBookTicker) з
    // реального API і звірити формат відповідей. Це БЕЗПЕЧНО саме собою:
    // openMarket/closePosition нижче все одно безумовно кидають помилку
    // "TODO", і головний цикл ніколи не виставить реальний ордер, поки
    // LIVE_TRADING=false у .env (він і лишається false — це окремий вимикач).
    this.implemented = true;
    this.productId = null; // кешується після першого успішного getBookTicker()
    this._client = null;
  }

  /** Лінива ініціалізація SDK-клієнта, щоб бот стартував, навіть якщо @nadohq/client не встановлено. */
  _client_() {
    if (this._client) return this._client;
    const { ethers } = require("ethers"); // кине зрозумілу помилку, якщо не встановлено
    const { NadoClient } = require("@nadohq/client");
    const wallet = new ethers.Wallet(this.cfg.walletPrivateKey);
    // TODO: звірте параметри конструктора з nadohq.github.io/nado-typescript-sdk/
    this._client = new NadoClient({
      signer: wallet,
      gatewayUrl: this.cfg.baseUrl || "https://gateway.prod.nado.xyz/v1",
    });
    return this._client;
  }

  /**
   * У відповіді "all_products" немає текстового символу (ні "symbol", ні
   * "ticker") — лише product_id і oracle_price_x18. Визначили product_id
   * BTC-PERP емпірично, звіривши масштаб ціни (oracle_price_x18 / 1e18)
   * з реальною ціною BTC у момент тесту (07.09.2026, ~$78 828):
   *   product_id 2 → 78827.95  (BTC)   product_id 4 → 2473.58 (ETH)
   *   product_id 8 → 103.45 (SOL)      product_id 10 → 1.386 (XRP) ...
   * Тобто BTC-PERP = product_id 2. Про всяк випадок звіряємо це щоразу
   * (ціна має бути в правдоподібному діапазоні для BTC), щоб одразу
   * помітити, якщо Nado колись перенумерує продукти.
   */
  async _resolveProductId() {
    if (this.productId != null) return this.productId;
    const KNOWN_BTC_PRODUCT_ID = 2;
    const res = await fetch(`${this.cfg.baseUrl || "https://gateway.prod.nado.xyz/v1"}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "all_products" }),
    });
    const json = await res.json();
    const products = json?.data?.perp_products || json?.perp_products || [];
    const btc = products.find((p) => p.product_id === KNOWN_BTC_PRODUCT_ID);
    if (!btc) throw new Error(`product_id ${KNOWN_BTC_PRODUCT_ID} відсутній у all_products`);
    const oraclePrice = parseFloat(btc.oracle_price_x18) / 1e18;
    if (!(oraclePrice > 10000 && oraclePrice < 5000000)) {
      throw new Error(
        `product_id ${KNOWN_BTC_PRODUCT_ID} має неправдоподібну для BTC ціну ($${oraclePrice.toFixed(2)}) — ` +
          "мапінг product_id, схоже, змінився, перевірте all_products вручну."
      );
    }
    logger.info(`Nado: BTC-PERP = product_id ${KNOWN_BTC_PRODUCT_ID} (oracle price $${oraclePrice.toFixed(2)}).`);
    this.productId = KNOWN_BTC_PRODUCT_ID;
    return this.productId;
  }

  async getBookTicker() {
    if (!this.implemented) {
      logger.warn("Nado: адаптер ще не підключено (не перевірено на реальному API) — біржа вважається офлайн.");
      return null;
    }
    const productId = await this._resolveProductId();
    const res = await fetch(`${this.cfg.baseUrl || "https://gateway.prod.nado.xyz/v1"}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "all_bbo" }),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error(`all_bbo: сервер повернув не-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    // Поля _x18 в API Nado завжди фіксовані з масштабом 1e18 (як oracle_price_x18
    // вище) — тому пробуємо і "звичайні", і "_x18" варіанти назв полів.
    const list = json?.data?.bbos || json?.bbos || json?.data || [];
    const entry = Array.isArray(list) ? list.find((e) => e.product_id === productId) : null;
    if (!entry) {
      logger.info(`Nado all_bbo (сира відповідь, для звірки полів): ${JSON.stringify(json).slice(0, 2000)}`);
      throw new Error("BTC-PERP (product_id 2) відсутній у відповіді all_bbo — див. сиру відповідь вище");
    }
    const rawBid = entry.bid_x18 ?? entry.bid_price ?? entry.bid;
    const rawAsk = entry.ask_x18 ?? entry.ask_price ?? entry.ask;
    const scale = entry.bid_x18 !== undefined ? 1e18 : 1;
    const bid = parseFloat(rawBid) / scale;
    const ask = parseFloat(rawAsk) / scale;
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
      logger.info(`Nado all_bbo entry для product_id ${productId} (для звірки полів): ${JSON.stringify(entry)}`);
      throw new Error("Не вдалося розпарсити bid/ask з all_bbo — див. сиру відповідь вище");
    }
    return { bid, ask, ts: Date.now() };
  }

  async getOpenPosition() {
    if (!this.implemented) return null;
    // TODO: query "subaccount_info" / "positions" — див. docs.nado.xyz/developer-resources/api/gateway/queries
    throw new Error("Nado.getOpenPosition(): TODO");
  }

  async openMarket(_side, _sizeBtc) {
    if (!this.implemented) {
      throw new Error("Nado.openMarket(): адаптер не підключено, торгівля заблокована");
    }
    // TODO: приклад за документацією (потребує перевірки exact API):
    //   const client = this._client_();
    //   const productId = await this._resolveProductId();
    //   const payload = await client.context.engineClient.payloadBuilder.buildPlaceOrderPayload({
    //     productId,
    //     side: _side === "long" ? "buy" : "sell",
    //     amount: _sizeBtc,
    //     // market-order-подібна поведінка зазвичай через агресивну лімітну ціну + IOC:
    //   });
    //   const result = await client.context.engineClient.execute("place_order", payload.payload);
    //   return { orderId: result.data.digest, avgPrice: /* з result */ };
    throw new Error("Nado.openMarket(): TODO — підключіть і перевірте реальний виклик SDK");
  }

  async closePosition() {
    if (!this.implemented) {
      throw new Error("Nado.closePosition(): адаптер не підключено");
    }
    // TODO: відкрити протилежний ордер на розмір поточної позиції (query позиції → openMarket у зворотний бік)
    throw new Error("Nado.closePosition(): TODO — підключіть і перевірте реальний виклик SDK");
  }
}

module.exports = { NadoAdapter };
