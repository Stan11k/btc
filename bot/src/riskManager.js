"use strict";

const CONFIG = require("../src/config");
const logger = require("./logger");

/**
 * Прості, консервативні запобіжники. Кожна перевірка, що провалилась,
 * блокує вхід у нову угоду — жодних винятків "спробуємо ще раз тихенько".
 */
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

module.exports = { canOpenNewPosition };
