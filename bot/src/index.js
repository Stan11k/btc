"use strict";

const CONFIG = require("./config");
const logger = require("./logger");
const { notify } = require("./notify");
const { NadoAdapter } = require("./adapters/nado");
const { RisexAdapter } = require("./adapters/risex");
const { computeSpread, roundTripCostPct, shouldEnter, shouldExit } = require("./spreadEngine");
const { canOpenNewPosition, checkApiWalletExpiry } = require("./riskManager");
const positionStore = require("./positionStore");

const exchanges = [new NadoAdapter(), new RisexAdapter()];

// Безпечний запобіжник: якщо хоч один адаптер не підключено, торгівля
// примусово переводиться в режим лише спостереження, незалежно від .env.
const bothImplemented = exchanges.every((ex) => ex.implemented);

if (CONFIG.liveTrading && !bothImplemented) {
  logger.warn(
    "LIVE_TRADING=true у .env, але не всі адаптери підключено (implemented=false) — " +
      "бот примусово працює в режимі dry-run (лише лог, реальних ордерів не буде)."
  );
}

/** Базовий дозвіл на живу торгівлю: LIVE_TRADING=true і обидва адаптери підключені. */
function canTradeLive() {
  return CONFIG.liveTrading && bothImplemented;
}

let lastExpiryLogAt = 0;
/**
 * Чи дозволено ВІДКРИВАТИ нову позицію просто зараз. Крім canTradeLive(),
 * враховує термін дії API-гаманця RISEx — навмисно НЕ застосовується до
 * закриття позиції (handleExit): якщо гаманець прострочився, поки позиція
 * вже відкрита на біржах, бот все одно повинен спробувати її закрити
 * по-справжньому (а не тихо "dry-run"-лlog-увати, лишаючи реальний
 * незахеджований ризик висіти на біржах) — якщо ключ дійсно недійсний,
 * closePosition() сам кине помилку, і це буде голосно залоговано.
 */
function isEntryAllowed() {
  if (!canTradeLive()) return false;
  const expiry = checkApiWalletExpiry(CONFIG.risex.apiWalletExpires);
  const now = Date.now();
  if (expiry.status === "expired") {
    if (now - lastExpiryLogAt > 60 * 60 * 1000) {
      lastExpiryLogAt = now;
      logger.error(
        "RISEX_API_WALLET_EXPIRES минув — API-гаманець RISEx, ймовірно, більше не авторизований. " +
          "Нові угоди заблоковано (dry-run). Продовжіть термін дії на rise.trade → API Wallets і оновіть дату в .env."
      );
      notify("🚨 API-гаманець RISEx прострочено — нові угоди заблоковано. Продовжіть його дію на rise.trade.");
    }
    return false;
  }
  if (expiry.status === "expiring_soon" && now - lastExpiryLogAt > 60 * 60 * 1000) {
    lastExpiryLogAt = now;
    logger.warn(
      `API-гаманець RISEx спливає через ${expiry.daysLeft.toFixed(1)} дн. — продовжіть його на rise.trade → API Wallets ` +
        "і оновіть RISEX_API_WALLET_EXPIRES у .env, інакше нові угоди буде заблоковано."
    );
  }
  return true;
}

logger.info(
  `Старт. Режим: ${canTradeLive() ? "LIVE (реальні ордери)" : "DRY-RUN (лише спостереження)"}. ` +
    `Символ: ${CONFIG.symbol}. Поріг входу: ${CONFIG.minSpreadPct}%. Поріг виходу: ${CONFIG.closeSpreadPct}%. ` +
    `Розмір ноги: $${CONFIG.positionSizeUsd}.`
);
if (CONFIG.risex.apiWalletExpires) {
  const expiry = checkApiWalletExpiry(CONFIG.risex.apiWalletExpires);
  logger.info(
    `API-гаманець RISEx дійсний до ${CONFIG.risex.apiWalletExpires.toISOString().slice(0, 10)} ` +
      `(${expiry.daysLeft != null ? expiry.daysLeft.toFixed(1) : "?"} дн. лишилось).`
  );
}

const estCost = roundTripCostPct(exchanges[0].fees, exchanges[1].fees, { useMaker: false });
logger.info(
  `Оцінка вартості round-trip по комісіях (worst case, taker/taker): ~${estCost.toFixed(3)}%. ` +
    `Поточний поріг входу ${CONFIG.minSpreadPct}% має залишати запас понад цю вартість.`
);

async function tick() {
  const state = positionStore.load();

  const [tickerA, tickerB] = await Promise.all(
    exchanges.map((ex) =>
      ex.getBookTicker().catch((err) => {
        logger.warn(`${ex.name}: помилка отримання ціни — ${err.message}`);
        return null;
      })
    )
  );

  if (!tickerA || !tickerB) {
    // Одна з бірж офлайн/не підключена — нічого не робимо цей тік.
    return;
  }

  const namedA = { ...tickerA, name: exchanges[0].name, fees: exchanges[0].fees, adapter: exchanges[0] };
  const namedB = { ...tickerB, name: exchanges[1].name, fees: exchanges[1].fees, adapter: exchanges[1] };
  const { cheap, pricy, cheapMid, pricyMid, spreadPct, arbPct } = computeSpread(namedA, namedB);

  logger.info(
    `Спред: ${spreadPct.toFixed(3)}% (${pricy.name} $${pricyMid.toFixed(2)} vs ${cheap.name} $${cheapMid.toFixed(
      2
    )}) · арбітраж ${arbPct.toFixed(3)}%`
  );

  if (state.openPosition) {
    if (shouldExit(spreadPct, CONFIG.closeSpreadPct)) {
      await handleExit(state, cheap, pricy);
    }
    return;
  }

  if (!shouldEnter(spreadPct, CONFIG.minSpreadPct)) return;
  if (!canOpenNewPosition(state)) return;

  await handleEntry(state, cheap, pricy, spreadPct);
}

async function handleEntry(state, cheap, pricy, spreadPct) {
  const sizeBtc = CONFIG.positionSizeUsd / ((cheap.bid + cheap.ask) / 2);
  const msg =
    `СИГНАЛ ВХОДУ: спред ${spreadPct.toFixed(2)}% ≥ порогу ${CONFIG.minSpreadPct}%. ` +
    `Лонг ${sizeBtc.toFixed(5)} BTC на ${cheap.name} (ask $${cheap.ask.toFixed(2)}), ` +
    `шорт на ${pricy.name} (bid $${pricy.bid.toFixed(2)}).`;

  if (!isEntryAllowed()) {
    logger.trade(`[DRY-RUN] ${msg}`);
    await notify(`[DRY-RUN] ${msg}`);
    return;
  }

  logger.trade(msg);
  await notify(msg);

  let longResult;
  try {
    longResult = await cheap.adapter.openMarket("long", sizeBtc);
  } catch (err) {
    logger.error(`Не вдалося відкрити лонг на ${cheap.name}: ${err.message}. Вхід скасовано.`);
    await notify(`ПОМИЛКА входу: не вдалося відкрити лонг на ${cheap.name}: ${err.message}`);
    return;
  }

  let shortResult;
  try {
    shortResult = await pricy.adapter.openMarket("short", sizeBtc);
  } catch (err) {
    // КРИТИЧНО: лонг уже відкрито, а шорт — ні. Позиція без хеджу.
    logger.error(
      `КРИТИЧНО: лонг на ${cheap.name} відкрито, але шорт на ${pricy.name} не вдався: ${err.message}. ` +
        "Позиція БЕЗ ХЕДЖУ! Закрийте лонг вручну негайно або перевірте акаунт."
    );
    await notify(
      `🚨 КРИТИЧНО: лонг на ${cheap.name} відкрито (${longResult.avgPrice}), шорт на ${pricy.name} НЕ вдався. ` +
        "Позиція без хеджу — перевірте акаунт негайно!"
    );
    return;
  }

  state.openPosition = {
    longExchange: cheap.name,
    shortExchange: pricy.name,
    sizeBtc,
    longEntry: longResult.avgPrice,
    shortEntry: shortResult.avgPrice,
    openedAt: Date.now(),
  };
  positionStore.save(state);
  logger.trade(`Позицію відкрито: ${JSON.stringify(state.openPosition)}`);
  await notify(`Позицію відкрито: лонг ${cheap.name} @${longResult.avgPrice}, шорт ${pricy.name} @${shortResult.avgPrice}`);
}

async function handleExit(state, cheap, pricy) {
  const pos = state.openPosition;
  const longEx = exchanges.find((e) => e.name === pos.longExchange);
  const shortEx = exchanges.find((e) => e.name === pos.shortExchange);

  const msg = `СИГНАЛ ВИХОДУ: спред стиснувся до порогу ${CONFIG.closeSpreadPct}%. Закриваю обидві ноги.`;

  if (!canTradeLive()) {
    logger.trade(`[DRY-RUN] ${msg}`);
    await notify(`[DRY-RUN] ${msg}`);
    return;
  }

  logger.trade(msg);

  let longClose, shortClose;
  try {
    longClose = await longEx.closePosition();
  } catch (err) {
    logger.error(`Не вдалося закрити лонг на ${longEx.name}: ${err.message}`);
    await notify(`🚨 Не вдалося закрити лонг на ${longEx.name}: ${err.message} — закрийте вручну!`);
  }
  try {
    shortClose = await shortEx.closePosition();
  } catch (err) {
    logger.error(`Не вдалося закрити шорт на ${shortEx.name}: ${err.message}`);
    await notify(`🚨 Не вдалося закрити шорт на ${shortEx.name}: ${err.message} — закрийте вручну!`);
  }

  if (longClose && shortClose) {
    const longPnl = (longClose.avgPrice - pos.longEntry) * pos.sizeBtc;
    const shortPnl = (pos.shortEntry - shortClose.avgPrice) * pos.sizeBtc;
    const pnl = longPnl + shortPnl;
    state.dailyPnlUsd += pnl;
    state.openPosition = null;
    positionStore.save(state);
    logger.trade(`Позицію закрито. PnL ≈ $${pnl.toFixed(2)} (без урахування funding).`);
    await notify(`Позицію закрито. PnL ≈ $${pnl.toFixed(2)}`);
  }
}

async function loop() {
  try {
    await tick();
  } catch (err) {
    logger.error("Неочікувана помилка в основному циклі: " + err.stack);
  }
  setTimeout(loop, CONFIG.pollMs);
}

loop();

process.on("SIGINT", () => {
  logger.info("Зупинка бота (SIGINT).");
  process.exit(0);
});
