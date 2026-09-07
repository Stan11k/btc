"use strict";

/**
 * BTC Spread Monitor — усі біржі
 *
 * Кожна біржа підключається напряму з браузера до свого публічного джерела
 * даних: Binance і Aster — через WebSocket (bookTicker, найменша затримка),
 * решта — через REST-опитування їхніх публічних тікер/orderbook ендпоінтів
 * (більшість бірж не дають простого WebSocket без токена/підписки, тому для
 * надійності по всьому списку використано єдиний REST-опитувач).
 *
 * Кожна біржа працює незалежно: якщо якийсь ендпоінт недоступний (CORS,
 * гео-блок, зміна API), ця біржа просто показує статус "офлайн" і не заважає
 * решті. USDT/USDC/USD прирівнюються один до одного (стейблкоїн-базис
 * ігнорується як несуттєвий для виявлення спреду). Bithumb квотується в KRW і
 * перераховується в USD за курсом, який можна поправити вручну в інтерфейсі.
 */

const CONFIG = {
  restPollMs: 1500,
  maxBackoffMs: 20000,
  staleAfterMs: 6000,
  logLimit: 60,
  hysteresis: 0.15, // % points below threshold before an alert can re-arm
};

// ---------- Helpers for defensive parsing of order-book-style payloads ----------

// Best bid = highest price among bid levels; best ask = lowest price among ask levels.
// Levels can be [[price, size], ...] or [{price, ...}, ...]-ish arrays; we only need price.
function bestFromLevels(levels, side) {
  if (!Array.isArray(levels) || levels.length === 0) return NaN;
  let best = side === "bid" ? -Infinity : Infinity;
  for (const lvl of levels) {
    const price = Array.isArray(lvl) ? parseFloat(lvl[0]) : parseFloat(lvl.price ?? lvl[0]);
    if (!Number.isFinite(price)) continue;
    if (side === "bid" && price > best) best = price;
    if (side === "ask" && price < best) best = price;
  }
  return Number.isFinite(best) ? best : NaN;
}

// ---------- Exchange registry ----------
// mode: "ws" (dedicated WebSocket handler below) or "rest" (generic poller)
// quote: display currency; fx: key into FX_RATES for non-USD quotes.

const EXCHANGES = [
  {
    id: "binance",
    name: "Binance",
    quote: "USDT",
    mode: "ws",
    ws: "wss://fstream.binance.com/ws/btcusdt@bookTicker",
    rest: "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=BTCUSDT",
    parseWs: (d) => ({ bid: parseFloat(d.b), ask: parseFloat(d.a) }),
    parseRest: (j) => ({ bid: parseFloat(j.bidPrice), ask: parseFloat(j.askPrice) }),
  },
  {
    id: "aster",
    name: "Aster",
    quote: "USDT",
    mode: "ws",
    ws: "wss://fstream.asterdex.com/ws/btcusdt@bookTicker",
    rest: "https://fapi.asterdex.com/fapi/v3/ticker/bookTicker?symbol=BTCUSDT",
    parseWs: (d) => ({ bid: parseFloat(d.b), ask: parseFloat(d.a) }),
    parseRest: (j) => ({ bid: parseFloat(j.bidPrice), ask: parseFloat(j.askPrice) }),
  },
  {
    id: "coinbase",
    name: "Coinbase",
    quote: "USD",
    mode: "rest",
    rest: "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
    parseRest: (j) => ({ bid: parseFloat(j.bid), ask: parseFloat(j.ask) }),
  },
  {
    id: "okx",
    name: "OKX",
    quote: "USDT",
    mode: "rest",
    rest: "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
    parseRest: (j) => ({ bid: parseFloat(j.data[0].bidPx), ask: parseFloat(j.data[0].askPx) }),
  },
  {
    id: "bybit",
    name: "Bybit",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
    parseRest: (j) => ({ bid: parseFloat(j.result.list[0].bid1Price), ask: parseFloat(j.result.list[0].ask1Price) }),
  },
  {
    id: "bitget",
    name: "Bitget",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT",
    parseRest: (j) => ({ bid: parseFloat(j.data[0].bidPr), ask: parseFloat(j.data[0].askPr) }),
  },
  {
    id: "gate",
    name: "Gate",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT",
    parseRest: (j) => ({ bid: parseFloat(j[0].highest_bid), ask: parseFloat(j[0].lowest_ask) }),
  },
  {
    id: "kucoin",
    name: "KuCoin",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT",
    parseRest: (j) => ({ bid: parseFloat(j.data.bestBid), ask: parseFloat(j.data.bestAsk) }),
  },
  {
    id: "mexc",
    name: "MEXC",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.mexc.com/api/v3/ticker/bookTicker?symbol=BTCUSDT",
    parseRest: (j) => ({ bid: parseFloat(j.bidPrice), ask: parseFloat(j.askPrice) }),
  },
  {
    id: "htx",
    name: "HTX",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.huobi.pro/market/detail/merged?symbol=btcusdt",
    parseRest: (j) => ({ bid: parseFloat(j.tick.bid[0]), ask: parseFloat(j.tick.ask[0]) }),
  },
  {
    id: "cryptocom",
    name: "Crypto.com",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=BTC_USDT",
    parseRest: (j) => ({ bid: parseFloat(j.result.data[0].b), ask: parseFloat(j.result.data[0].k) }),
  },
  {
    id: "bitfinex",
    name: "Bitfinex",
    quote: "USD",
    mode: "rest",
    rest: "https://api-pub.bitfinex.com/v2/ticker/tBTCUSD",
    parseRest: (arr) => ({ bid: parseFloat(arr[0]), ask: parseFloat(arr[2]) }),
  },
  {
    id: "bingx",
    name: "BingX",
    quote: "USDT",
    mode: "rest",
    rest: "https://open-api.bingx.com/openApi/spot/v1/ticker/bookTicker?symbol=BTC-USDT",
    parseRest: (j) => ({ bid: parseFloat(j.data.bidPrice), ask: parseFloat(j.data.askPrice) }),
  },
  {
    id: "kraken",
    name: "Kraken",
    quote: "USD",
    mode: "rest",
    rest: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    parseRest: (j) => {
      const key = Object.keys(j.result)[0];
      const t = j.result[key];
      return { bid: parseFloat(t.b[0]), ask: parseFloat(t.a[0]) };
    },
  },
  {
    id: "binancetr",
    name: "Binance TR",
    quote: "USDT",
    mode: "rest",
    rest: "https://www.trbinance.com/open/api/v2/depth?symbol=BTC_USDT&limit=5",
    parseRest: (j) => ({ bid: bestFromLevels(j.data.bids, "bid"), ask: bestFromLevels(j.data.asks, "ask") }),
  },
  {
    id: "lbank",
    name: "LBank",
    quote: "USDT",
    mode: "rest",
    rest: "https://api.lbkex.com/v2/depth.do?symbol=btc_usdt&size=5&merge=0",
    parseRest: (j) => ({ bid: bestFromLevels(j.data.bids, "bid"), ask: bestFromLevels(j.data.asks, "ask") }),
  },
  {
    id: "bitstamp",
    name: "Bitstamp",
    quote: "USD",
    mode: "rest",
    rest: "https://www.bitstamp.net/api/v2/ticker/btcusd/",
    parseRest: (j) => ({ bid: parseFloat(j.bid), ask: parseFloat(j.ask) }),
  },
  {
    id: "bithumb",
    name: "Bithumb",
    quote: "KRW",
    fx: "KRW",
    mode: "rest",
    rest: "https://api.bithumb.com/public/ticker/BTC_KRW",
    parseRest: (j) => ({ bid: parseFloat(j.data.buy_price), ask: parseFloat(j.data.sell_price) }),
  },
  {
    id: "xt",
    name: "XT.COM",
    quote: "USDT",
    mode: "rest",
    rest: "https://sapi.xt.com/v4/public/ticker/book?symbol=btc_usdt",
    parseRest: (j) => ({ bid: parseFloat(j.result[0].bp), ask: parseFloat(j.result[0].ap) }),
  },
  {
    id: "backpack",
    name: "Backpack",
    quote: "USDC",
    mode: "rest",
    rest: "https://api.backpack.exchange/api/v1/depth?symbol=BTC_USDC",
    parseRest: (j) => ({ bid: bestFromLevels(j.bids, "bid"), ask: bestFromLevels(j.asks, "ask") }),
  },
];

// ---------- Shared per-exchange state ----------

function createState(cfg) {
  return {
    id: cfg.id,
    name: cfg.name,
    quote: cfg.quote,
    fx: cfg.fx || null,
    bidNative: null,
    askNative: null,
    bid: null, // USD-normalized
    ask: null, // USD-normalized
    mid: null, // USD-normalized
    lastUpdate: 0,
    status: "connecting", // connecting | live | down
    ws: null,
    reconnectDelay: 500,
    pollTimer: null,
    usingRest: false,
    row: null, // cached DOM refs, filled at boot
  };
}

const state = {};
EXCHANGES.forEach((cfg) => { state[cfg.id] = createState(cfg); });

function fxRate(key) {
  if (key === "KRW") {
    const v = parseFloat(els.krwRateInput.value);
    return Number.isFinite(v) && v > 0 ? v : 1400;
  }
  return 1;
}

function applyTick(cfg, bidNative, askNative) {
  const s = state[cfg.id];
  const rate = cfg.fx ? fxRate(cfg.fx) : 1;
  s.bidNative = bidNative;
  s.askNative = askNative;
  s.bid = bidNative / rate;
  s.ask = askNative / rate;
  s.mid = (s.bid + s.ask) / 2;
  s.lastUpdate = Date.now();
  if (s.status !== "live") s.status = "live";
}

// ---------- WebSocket handling (Binance, Aster) ----------

function connectWs(cfg) {
  const s = state[cfg.id];
  if (s.ws) {
    try { s.ws.close(); } catch (_) { /* ignore */ }
  }
  clearTimeout(s.pollTimer);
  s.usingRest = false;
  s.status = "connecting";

  let ws;
  try {
    ws = new WebSocket(cfg.ws);
  } catch (_) {
    fallbackToRest(cfg);
    return;
  }
  s.ws = ws;

  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close();
  }, 8000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    s.reconnectDelay = 500;
    s.status = "live";
  };

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      const { bid, ask } = cfg.parseWs(data);
      if (Number.isFinite(bid) && Number.isFinite(ask)) applyTick(cfg, bid, ask);
    } catch (_) { /* ignore malformed frame */ }
  };

  ws.onerror = () => { /* onclose follows and handles reconnect */ };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    if (s.ws !== ws) return; // superseded by a newer connection
    s.status = "down";
    startRestPolling(cfg); // keep data flowing while WS retries
    const delay = s.reconnectDelay;
    s.reconnectDelay = Math.min(delay * 1.7, CONFIG.maxBackoffMs);
    setTimeout(() => connectWs(cfg), delay);
  };
}

function fallbackToRest(cfg) {
  const s = state[cfg.id];
  s.status = "down";
  startRestPolling(cfg);
  setTimeout(() => connectWs(cfg), s.reconnectDelay);
  s.reconnectDelay = Math.min(s.reconnectDelay * 1.7, CONFIG.maxBackoffMs);
}

// ---------- Generic REST polling (everyone else, and WS fallback) ----------

function startRestPolling(cfg) {
  const s = state[cfg.id];
  if (s.usingRest) return;
  s.usingRest = true;
  let delay = CONFIG.restPollMs;

  const poll = async () => {
    if (!s.usingRest) return;
    try {
      const res = await fetch(cfg.rest, { cache: "no-store" });
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      const parse = cfg.parseRest || cfg.parseWs;
      const { bid, ask } = parse(json);
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        applyTick(cfg, bid, ask);
        delay = CONFIG.restPollMs;
      } else {
        throw new Error("bad payload");
      }
    } catch (_) {
      s.status = "down";
      delay = Math.min(delay * 1.5, CONFIG.maxBackoffMs);
    }
    s.pollTimer = setTimeout(poll, delay);
  };
  poll();
}

function startRestOnly(cfg) {
  const s = state[cfg.id];
  s.status = "connecting";
  startRestPolling(cfg);
}

// ---------- DOM refs ----------

const els = {
  liveCounter: document.getElementById("liveCounter"),
  liveCounterText: document.getElementById("liveCounterText"),
  spreadCard: document.getElementById("spreadCard"),
  spreadValue: document.getElementById("spreadValue"),
  spreadDirection: document.getElementById("spreadDirection"),
  arbValue: document.getElementById("arbValue"),
  thresholdInput: document.getElementById("thresholdInput"),
  krwRateInput: document.getElementById("krwRateInput"),
  soundToggle: document.getElementById("soundToggle"),
  notifToggle: document.getElementById("notifToggle"),
  testAlertBtn: document.getElementById("testAlertBtn"),
  exchangeBody: document.getElementById("exchangeBody"),
  logBody: document.getElementById("logBody"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  alertOverlay: document.getElementById("alertOverlay"),
};

let armed = true; // false while spread is already above threshold, to avoid log/sound spam

// ---------- Table rendering ----------

function buildExchangeRows() {
  EXCHANGES.forEach((cfg) => {
    const s = state[cfg.id];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="ex-status"><span class="row-dot connecting"></span></td>
      <td>${cfg.name}</td>
      <td>${cfg.quote}${cfg.fx ? " → USD" : ""}</td>
      <td class="mid">—</td>
      <td class="bid">—</td>
      <td class="ask">—</td>
      <td class="age">—</td>
    `;
    els.exchangeBody.appendChild(tr);
    s.row = {
      tr,
      dot: tr.querySelector(".row-dot"),
      mid: tr.querySelector(".mid"),
      bid: tr.querySelector(".bid"),
      ask: tr.querySelector(".ask"),
      age: tr.querySelector(".age"),
    };
  });
}

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAge(ms) {
  if (!ms) return "—";
  const s = (Date.now() - ms) / 1000;
  if (s < 1) return "щойно";
  if (s < 60) return s.toFixed(1) + "с";
  return Math.floor(s / 60) + "хв";
}

function renderTable() {
  let liveCount = 0;
  let cheapestId = null;
  let priciestId = null;

  EXCHANGES.forEach((cfg) => {
    const s = state[cfg.id];
    if (!s.row) return;
    const stale = s.lastUpdate && Date.now() - s.lastUpdate > CONFIG.staleAfterMs;
    const effectiveStatus = stale && s.status === "live" ? "connecting" : s.status;

    s.row.dot.className = "row-dot " + effectiveStatus;
    s.row.mid.textContent = fmtPrice(s.mid);
    s.row.bid.textContent = fmtPrice(s.bidNative);
    s.row.ask.textContent = fmtPrice(s.askNative);
    s.row.age.textContent = fmtAge(s.lastUpdate);
    s.row.age.classList.toggle("stale", !!stale);
    s.row.tr.classList.remove("cheapest", "priciest");

    if (effectiveStatus === "live" && s.mid != null) {
      liveCount++;
      if (cheapestId == null || s.mid < state[cheapestId].mid) cheapestId = cfg.id;
      if (priciestId == null || s.mid > state[priciestId].mid) priciestId = cfg.id;
    }
  });

  if (cheapestId) state[cheapestId].row.tr.classList.add("cheapest");
  if (priciestId && priciestId !== cheapestId) state[priciestId].row.tr.classList.add("priciest");

  els.liveCounterText.textContent = `${liveCount}/${EXCHANGES.length} живі`;
  els.liveCounter.classList.remove("live", "down", "connecting");
  els.liveCounter.classList.add(liveCount === 0 ? "down" : liveCount < EXCHANGES.length ? "connecting" : "live");

  return { cheapestId, priciestId };
}

function updateSpread(cheapestId, priciestId) {
  if (!cheapestId || !priciestId || cheapestId === priciestId) return;
  const cheap = state[cheapestId];
  const pricy = state[priciestId];

  const midSpreadPct = ((pricy.mid - cheap.mid) / cheap.mid) * 100; // always >= 0 by construction
  // Executable arbitrage for this pair: buy on the cheap exchange's ask, sell on the pricy exchange's bid
  const arb = ((pricy.bid - cheap.ask) / cheap.ask) * 100;

  els.spreadValue.textContent = midSpreadPct.toFixed(3) + "%";
  els.arbValue.textContent = arb.toFixed(3) + "%";
  els.spreadDirection.textContent = `${pricy.name} дорожчий за ${cheap.name} на ${midSpreadPct.toFixed(3)}%`;

  const threshold = getThreshold();
  els.spreadCard.classList.remove("ok", "warn", "alert");
  if (midSpreadPct >= threshold) {
    els.spreadCard.classList.add("alert");
  } else if (midSpreadPct >= threshold * 0.6) {
    els.spreadCard.classList.add("warn");
  } else {
    els.spreadCard.classList.add("ok");
  }

  evaluateAlert(midSpreadPct, threshold, cheap, pricy);
}

function getThreshold() {
  const v = parseFloat(els.thresholdInput.value);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

function render() {
  const { cheapestId, priciestId } = renderTable();
  updateSpread(cheapestId, priciestId);
  requestAnimationFrame(render);
}

// ---------- Alerting ----------

function evaluateAlert(spreadPct, threshold, cheap, pricy) {
  if (spreadPct >= threshold) {
    if (armed) {
      armed = false;
      triggerAlert(spreadPct, cheap, pricy);
    }
  } else if (spreadPct <= Math.max(threshold - CONFIG.hysteresis, 0)) {
    armed = true;
  }
}

function triggerAlert(spreadPct, cheap, pricy) {
  logEvent(spreadPct, cheap, pricy);
  flashOverlay();
  if (els.soundToggle.checked) playBeep();
  if (els.notifToggle.checked) sendNotification(spreadPct, cheap, pricy);
}

function logEvent(spreadPct, cheap, pricy) {
  const emptyRow = els.logBody.querySelector(".log-empty");
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement("tr");
  tr.className = "new-row";
  const time = new Date().toLocaleTimeString("uk-UA");
  tr.innerHTML = `
    <td>${time}</td>
    <td>${spreadPct.toFixed(3)}%</td>
    <td>${cheap.name}</td>
    <td>${pricy.name}</td>
    <td>${fmtPrice(cheap.mid)}</td>
    <td>${fmtPrice(pricy.mid)}</td>
  `;
  els.logBody.insertBefore(tr, els.logBody.firstChild);

  while (els.logBody.children.length > CONFIG.logLimit) {
    els.logBody.removeChild(els.logBody.lastChild);
  }
}

function flashOverlay() {
  els.alertOverlay.hidden = false;
  setTimeout(() => { els.alertOverlay.hidden = true; }, 2500);
}

let audioCtx = null;
function playBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch (_) { /* audio not available */ }
}

function sendNotification(spreadPct, cheap, pricy) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("BTC спред ≥ порогу", {
    body: `${pricy.name} дорожчий за ${cheap.name} на ${spreadPct.toFixed(2)}%`,
    tag: "btc-spread-alert",
  });
}

// ---------- UI wiring ----------

els.notifToggle.addEventListener("change", () => {
  if (els.notifToggle.checked && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm !== "granted") els.notifToggle.checked = false;
    });
  }
});

els.testAlertBtn.addEventListener("click", () => {
  const cheap = { name: "Binance", mid: 60000 };
  const pricy = { name: "Aster", mid: 61200, bid: 61190 };
  cheap.ask = 60010;
  triggerAlert(((pricy.mid - cheap.mid) / cheap.mid) * 100, cheap, pricy);
});

els.clearLogBtn.addEventListener("click", () => {
  els.logBody.innerHTML = '<tr class="log-empty"><td colspan="6">Поки що подій немає</td></tr>';
});

// ---------- Boot ----------

buildExchangeRows();
EXCHANGES.forEach((cfg) => {
  if (cfg.mode === "ws") connectWs(cfg);
  else startRestOnly(cfg);
});
requestAnimationFrame(render);
