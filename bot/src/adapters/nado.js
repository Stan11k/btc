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
 * Підтверджено на реальному API (07.09.2026, gateway.prod.nado.xyz):
 *   - npm-пакет: @nadohq/client (плюс потрібен ethers для гаманця-підписанта)
 *   - Gateway REST (mainnet): https://gateway.prod.nado.xyz/v1
 *     запити: POST {gateway}/query   виконання: POST {gateway}/execute
 *   - Валідні типи query: status, contracts, nonces, linked_signer,
 *     subaccount_info, all_products, edge_all_products, market_price,
 *     market_prices, order, orders, validate_order, fee_rates, ...
 *     ("all_bbo" з документації насправді НЕ існує — 422 з підказкою вище)
 *   - all_products не містить символу (тільки product_id+oracle_price_x18) —
 *     BTC-PERP визначається за product_id=2 (див. _resolveProductId)
 *   - market_price {type:"market_price", product_id} → { product_id,
 *     bid_x18, ask_x18 }, масштаб 1e18 — ЦЕ ПІДТВЕРДЖЕНО РЕАЛЬНИМ ЗАПИТОМ
 *   - Комісії perp (Entry Tier, 0 обсягу): taker 0.035%, maker 0.01%
 *     (зростає обсяг → комісія падає; уточніть свій тариф запитом fee-rates)
 *   - Ордер підписується гаманцем (EIP-712, domain name "Nado", version
 *     "0.0.1", verifying contract — окремий на кожен product_id)
 *   - Розміщення ордера через SDK (ЩЕ НЕ ПЕРЕВІРЕНО реальним запитом):
 *       const payload = await nadoClient.context.engineClient.payloadBuilder
 *         .buildPlaceOrderPayload({ ... });
 *       await nadoClient.context.engineClient.execute("place_order", payload.payload);
 *
 * СТАТУС: читання ціни (getBookTicker) ПІДТВЕРДЖЕНО робоче на реальному API.
 * Виставлення/закриття ордерів (openMarket/closePosition) — ще ЗАГЛУШКИ:
 * вони безумовно кидають помилку "TODO" незалежно від this.implemented,
 * тож flip implemented=true нижче лишається безпечним сам собою (LIVE_TRADING
 * теж має бути true в .env, і обидва адаптери — implemented, щоб бот узагалі
 * спробував реальний ордер).
 *
 * ЩО ЗРОБИТИ, ЩОБ ДОДАТИ РЕАЛЬНУ ТОРГІВЛЮ:
 *   1. npm install @nadohq/client ethers   (у папці bot/)
 *   2. Перевірте на https://nadohq.github.io/nado-typescript-sdk/ точну
 *      сигнатуру конструктора NadoClient і buildPlaceOrderPayload.
 *   3. Заповніть openMarket/closePosition, перевірте на маленькому розмірі.
 */
class NadoAdapter extends BaseAdapter {
  constructor() {
    super("Nado", CONFIG.nado.fees);
    this.cfg = CONFIG.nado;
    // Читання ціни підтверджено робочим (07.09.2026) — safe: openMarket/
    // closePosition нижче все одно безумовно кидають "TODO" незалежно від
    // цього прапорця, поки їх не доопрацюють.
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
    // "all_bbo" не існує — сервер сам підказав список валідних типів запиту
    // (status/contracts/nonces/linked_signer/subaccount_info/all_products/
    // edge_all_products/market_price/market_prices/order/orders/
    // validate_order/fee_rates/...). Найближчий відповідник bid/ask —
    // "market_price" з конкретним product_id.
    const res = await fetch(`${this.cfg.baseUrl || "https://gateway.prod.nado.xyz/v1"}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "market_price", product_id: productId }),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error(`market_price: сервер повернув не-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      throw new Error(`market_price: HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    // Підтверджено на реальному API (07.09.2026): market_price повертає
    // { product_id, bid_x18, ask_x18 }, масштаб 1e18, напр.
    // {"product_id":2,"bid_x18":"78785000000000000000000","ask_x18":"78786000000000000000000"}
    const entry = json?.data ?? json;
    const bid = parseFloat(entry.bid_x18) / 1e18;
    const ask = parseFloat(entry.ask_x18) / 1e18;
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
      logger.info(`Nado market_price — не вдалось розпарсити (сира відповідь): ${JSON.stringify(entry).slice(0, 500)}`);
      throw new Error("Не вдалося розпарсити bid_x18/ask_x18 з market_price — див. сиру відповідь вище");
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
