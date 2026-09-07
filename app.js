"use strict";

/**
 * BTC Spread Monitor — Binance vs Aster
 *
 * Connects directly from the browser to each exchange's public market-data
 * WebSocket (bookTicker stream: best bid/ask), so there is no proxy server
 * and no extra hop adding delay. If a WebSocket connection cannot be
 * established (network blocks it, exchange geo-restriction, etc.) each feed
 * falls back to fast REST polling on its own.
 */

const CONFIG = {
  symbol: "btcusdt",
  binance: {
    ws: "wss://fstream.binance.com/ws/btcusdt@bookTicker",
    rest: "https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=BTCUSDT",
  },
  aster: {
    ws: "wss://fstream.asterdex.com/ws/btcusdt@bookTicker",
    rest: "https://fapi.asterdex.com/fapi/v3/ticker/bookTicker?symbol=BTCUSDT",
  },
  restPollMs: 1000,
  maxBackoffMs: 15000,
  staleAfterMs: 5000,
  logLimit: 50,
  hysteresis: 0.15, // % points below threshold before an alert can re-arm
};

/** Shared state for one exchange feed. */
function createFeedState(name) {
  return {
    name,
    bid: null,
    ask: null,
    mid: null,
    lastUpdate: 0,
    connState: "connecting", // connecting | live | down
    ws: null,
    reconnectDelay: 500,
    pollTimer: null,
    usingRest: false,
  };
}

const binanceState = createFeedState("binance");
const asterState = createFeedState("aster");

const els = {
  statusBinance: document.getElementById("statusBinance"),
  statusAster: document.getElementById("statusAster"),
  binanceMid: document.getElementById("binanceMid"),
  binanceBid: document.getElementById("binanceBid"),
  binanceAsk: document.getElementById("binanceAsk"),
  binanceAge: document.getElementById("binanceAge"),
  asterMid: document.getElementById("asterMid"),
  asterBid: document.getElementById("asterBid"),
  asterAsk: document.getElementById("asterAsk"),
  asterAge: document.getElementById("asterAge"),
  spreadCard: document.getElementById("spreadCard"),
  spreadValue: document.getElementById("spreadValue"),
  spreadDirection: document.getElementById("spreadDirection"),
  arbValue: document.getElementById("arbValue"),
  thresholdInput: document.getElementById("thresholdInput"),
  soundToggle: document.getElementById("soundToggle"),
  notifToggle: document.getElementById("notifToggle"),
  testAlertBtn: document.getElementById("testAlertBtn"),
  logBody: document.getElementById("logBody"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  alertOverlay: document.getElementById("alertOverlay"),
};

let armed = true; // false while spread is already above threshold, to avoid log/sound spam

// ---------- WebSocket feed handling ----------

function connectFeed(state, cfg, statusEl) {
  if (state.ws) {
    try { state.ws.close(); } catch (_) { /* ignore */ }
  }
  clearTimeout(state.pollTimer);
  state.usingRest = false;
  setStatus(statusEl, "connecting");

  let ws;
  try {
    ws = new WebSocket(cfg.ws);
  } catch (err) {
    fallbackToRest(state, cfg, statusEl);
    return;
  }
  state.ws = ws;

  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
    }
  }, 8000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    state.reconnectDelay = 500;
    setStatus(statusEl, "live");
  };

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      const bid = parseFloat(data.b);
      const ask = parseFloat(data.a);
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        applyTick(state, bid, ask, statusEl);
      }
    } catch (_) { /* ignore malformed frame */ }
  };

  ws.onerror = () => { /* onclose will follow and handle reconnect */ };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    if (state.ws !== ws) return; // superseded by a newer connection
    setStatus(statusEl, "down");
    // start REST polling immediately so data keeps flowing while we retry WS
    startRestPolling(state, cfg, statusEl);
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(delay * 1.7, CONFIG.maxBackoffMs);
    setTimeout(() => connectFeed(state, cfg, statusEl), delay);
  };
}

function startRestPolling(state, cfg, statusEl) {
  if (state.usingRest) return;
  state.usingRest = true;
  const poll = async () => {
    if (!state.usingRest) return;
    try {
      const res = await fetch(cfg.rest, { cache: "no-store" });
      const data = await res.json();
      const bid = parseFloat(data.bidPrice);
      const ask = parseFloat(data.askPrice);
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        applyTick(state, bid, ask, statusEl);
        if (state.connState !== "live") setStatus(statusEl, "live");
      }
    } catch (_) {
      setStatus(statusEl, "down");
    }
    state.pollTimer = setTimeout(poll, CONFIG.restPollMs);
  };
  poll();
}

function fallbackToRest(state, cfg, statusEl) {
  setStatus(statusEl, "down");
  startRestPolling(state, cfg, statusEl);
  setTimeout(() => connectFeed(state, cfg, statusEl), state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 1.7, CONFIG.maxBackoffMs);
}

function applyTick(state, bid, ask, statusEl) {
  // Once a live WebSocket tick arrives, stop any REST fallback polling.
  if (state.usingRest && state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.usingRest = false;
    clearTimeout(state.pollTimer);
  }
  state.bid = bid;
  state.ask = ask;
  state.mid = (bid + ask) / 2;
  state.lastUpdate = Date.now();
  if (state.connState !== "live") setStatus(statusEl, "live");
}

function setStatus(statusEl, status) {
  const stateObj = statusEl === els.statusBinance ? binanceState : asterState;
  stateObj.connState = status;
  statusEl.classList.remove("connecting", "live", "down");
  statusEl.classList.add(status);
}

// ---------- Rendering ----------

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

function render() {
  els.binanceMid.textContent = fmtPrice(binanceState.mid);
  els.binanceBid.textContent = fmtPrice(binanceState.bid);
  els.binanceAsk.textContent = fmtPrice(binanceState.ask);
  els.binanceAge.textContent = fmtAge(binanceState.lastUpdate);

  els.asterMid.textContent = fmtPrice(asterState.mid);
  els.asterBid.textContent = fmtPrice(asterState.bid);
  els.asterAsk.textContent = fmtPrice(asterState.ask);
  els.asterAge.textContent = fmtAge(asterState.lastUpdate);

  markStale(els.binanceAge, binanceState.lastUpdate);
  markStale(els.asterAge, asterState.lastUpdate);

  updateSpread();
  requestAnimationFrame(render);
}

function markStale(ageEl, lastUpdate) {
  const stale = lastUpdate && Date.now() - lastUpdate > CONFIG.staleAfterMs;
  ageEl.style.color = stale ? "var(--red)" : "";
}

function updateSpread() {
  const b = binanceState;
  const a = asterState;
  if (b.mid == null || a.mid == null) return;

  const midSpreadPct = ((a.mid - b.mid) / b.mid) * 100;
  const absMidSpread = Math.abs(midSpreadPct);

  // Executable arbitrage spread: best of (buy Binance / sell Aster) and (buy Aster / sell Binance)
  const buyBinanceSellAster = ((a.bid - b.ask) / b.ask) * 100;
  const buyAsterSellBinance = ((b.bid - a.ask) / a.ask) * 100;
  const bestArb = Math.max(buyBinanceSellAster, buyAsterSellBinance);

  els.spreadValue.textContent = midSpreadPct.toFixed(3) + "%";
  els.arbValue.textContent = bestArb.toFixed(3) + "%";
  els.spreadDirection.textContent =
    midSpreadPct > 0
      ? `Aster дорожчий на ${absMidSpread.toFixed(3)}%`
      : midSpreadPct < 0
      ? `Binance дорожчий на ${absMidSpread.toFixed(3)}%`
      : "рівні ціни";

  const threshold = getThreshold();
  els.spreadCard.classList.remove("ok", "warn", "alert");
  if (absMidSpread >= threshold) {
    els.spreadCard.classList.add("alert");
  } else if (absMidSpread >= threshold * 0.6) {
    els.spreadCard.classList.add("warn");
  } else {
    els.spreadCard.classList.add("ok");
  }

  evaluateAlert(absMidSpread, threshold, midSpreadPct, b.mid, a.mid);
}

function getThreshold() {
  const v = parseFloat(els.thresholdInput.value);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

// ---------- Alerting ----------

function evaluateAlert(absSpread, threshold, signedSpread, binanceMid, asterMid) {
  if (absSpread >= threshold) {
    if (armed) {
      armed = false;
      triggerAlert(signedSpread, binanceMid, asterMid);
    }
  } else if (absSpread <= Math.max(threshold - CONFIG.hysteresis, 0)) {
    armed = true;
  }
}

function triggerAlert(signedSpread, binanceMid, asterMid) {
  logEvent(signedSpread, binanceMid, asterMid);
  flashOverlay();
  if (els.soundToggle.checked) playBeep();
  if (els.notifToggle.checked) sendNotification(signedSpread);
}

function logEvent(signedSpread, binanceMid, asterMid) {
  const emptyRow = els.logBody.querySelector(".log-empty");
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement("tr");
  tr.className = "new-row";
  const time = new Date().toLocaleTimeString("uk-UA");
  const dearer = signedSpread > 0 ? "Aster" : "Binance";
  tr.innerHTML = `
    <td>${time}</td>
    <td>${Math.abs(signedSpread).toFixed(3)}%</td>
    <td>${dearer}</td>
    <td>${fmtPrice(binanceMid)}</td>
    <td>${fmtPrice(asterMid)}</td>
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

function sendNotification(signedSpread) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const dearer = signedSpread > 0 ? "Aster" : "Binance";
  new Notification("BTC спред ≥ порогу", {
    body: `${dearer} дорожчий на ${Math.abs(signedSpread).toFixed(2)}% (Binance vs Aster)`,
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
  const b = binanceState.mid || 60000;
  const a = asterState.mid || b * 1.02;
  triggerAlert(((a - b) / b) * 100, b, a);
});

els.clearLogBtn.addEventListener("click", () => {
  els.logBody.innerHTML = '<tr class="log-empty"><td colspan="5">Поки що подій немає</td></tr>';
});

// ---------- Boot ----------

connectFeed(binanceState, CONFIG.binance, els.statusBinance);
connectFeed(asterState, CONFIG.aster, els.statusAster);
requestAnimationFrame(render);
