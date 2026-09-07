"use strict";

const CONFIG = require("./config");
const logger = require("./logger");
const { notify } = require("./notify");
const { NadoAdapter } = require("./adapters/nado");
const { RisexAdapter } = require("./adapters/risex");
const { computeSpread, roundTripCostPct, shouldEnter, shouldExit } = require("./spreadEngine");
const { canOpenNewPosition } = require("./riskManager");
const positionStore = require("./positionStore");

const exchanges = [new NadoAdapter(), new RisexAdapter()];

// Безпечний запобіжник: якщо хоч один адаптер не підключено, торгівля
// примусово переводиться в режим лише спостереження, незалежно від .env.
const bothImplemented = exchanges.every((ex) => ex.implemented);
const liveTrading = CONFIG.liveTrading && bothImplemented;

if (CONFIG.liveTrading && !bothImplemented) {
  logger.warn(
    "LIVE_TRADING=true у .env, але не всі адаптери підключено (implemented=false) — " +
      "бот примусово працює в режимі dry-run (лише лог, реальних ордерів не буде)."
  );
}

logger.info(
  `Старт. Режим: ${liveTrading ? "LIVE (реальні ордери)" : "DRY-RUN (лише спостереження)"}. ` +
    `Символ: ${CONFIG.symbol}. Поріг входу: ${CONFIG.minSpreadPct}%. Поріг виходу: ${CONFIG.closeSpreadPct}%. ` +
    `Розмір ноги: $${CONFIG.positionSizeUsd}.`
);

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

  if (!liveTrading) {
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

  if (!liveTrading) {
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
