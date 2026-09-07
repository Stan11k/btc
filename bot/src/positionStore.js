"use strict";

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const stateFile = path.join(dataDir, "state.json");

function load() {
  if (!fs.existsSync(stateFile)) {
    return { openPosition: null, dailyPnlUsd: 0, dailyPnlDate: todayStr() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (raw.dailyPnlDate !== todayStr()) {
      raw.dailyPnlUsd = 0;
      raw.dailyPnlDate = todayStr();
    }
    return raw;
  } catch (_) {
    return { openPosition: null, dailyPnlUsd: 0, dailyPnlDate: todayStr() };
  }
}

function save(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { load, save };
