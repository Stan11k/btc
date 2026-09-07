"use strict";

const CONFIG = require("../src/config");
const logger = require("./logger");

/**
 * Прості, консервативні запобіжники. Кожна перевірка, що провалилась,
 * блокує вхід у нову угоду — жодних винятків "спробуємо ще раз тихенько".
 */
/** Стан терміну дії API-гаманця (напр. RISEx API Wallet має дату "Expires"). */
function checkApiWalletExpiry(expiresDate, warnDays = 3) {
  if (!expiresDate || Number.isNaN(expiresDate.getTime())) return { status: "unknown", daysLeft: null };
  const daysLeft = (expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 0) return { status: "expired", daysLeft };
  if (daysLeft <= warnDays) return { status: "expiring_soon", daysLeft };
  return { status: "ok", daysLeft };
}

function canOpenNewPosition(state) {
  if (state.dailyPnlUsd <= -Math.abs(CONFIG.maxDailyLossUsd)) {
    logger.error(
      `Денний ліміт збитку досягнуто (${state.dailyPnlUsd.toFixed(2)}$ ≤ -${CONFIG.maxDailyLossUsd}$). ` +
        "Нові угоди заблоковано до наступного дня. Перезапустіть вручну, якщо хочете зняти блок раніше."
    );
    return false;
  }
  if (state.openPosition) {
    return false; // MAX_OPEN_POSITIONS у цьому боті завжди 1 логічна пара позицій
  }
  return true;
}

module.exports = { canOpenNewPosition, checkApiWalletExpiry };
