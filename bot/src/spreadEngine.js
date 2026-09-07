"use strict";

/** mid-price двох котирувань, % різниці, і хто дешевший/дорожчий. */
function computeSpread(a, b) {
  const midA = (a.bid + a.ask) / 2;
  const midB = (b.bid + b.ask) / 2;
  const [cheap, cheapMid, pricy, pricyMid] =
    midA <= midB ? [a, midA, b, midB] : [b, midB, a, midA];
  const spreadPct = ((pricyMid - cheapMid) / cheapMid) * 100;
  // Виконуваний арбітраж: купити по ask дешевшої, продати по bid дорожчої.
  const arbPct = ((pricy.bid - cheap.ask) / cheap.ask) * 100;
  return { cheap, pricy, cheapMid, pricyMid, spreadPct, arbPct };
}

/** Комісії round-trip (відкрити + закрити) для обох ніг, у %, worst-case (taker/taker). */
function roundTripCostPct(feesCheap, feesPricy, { useMaker = false } = {}) {
  const c = useMaker ? feesCheap.maker : feesCheap.taker;
  const p = useMaker ? feesPricy.maker : feesPricy.taker;
  // 2 угоди на кожній нозі (відкриття + закриття) = 2 * fee для кожної біржі
  return (2 * c + 2 * p) * 100;
}

function shouldEnter(spreadPct, minSpreadPct) {
  return spreadPct >= minSpreadPct;
}

function shouldExit(spreadPct, closeSpreadPct) {
  return spreadPct <= closeSpreadPct;
}

module.exports = { computeSpread, roundTripCostPct, shouldEnter, shouldExit };
