'use strict';

/**
 * שיוך מכונה לפי קוטר — BUG-06
 * A: קטרים עד 12mm (XINJE)
 * B: קטרים 14–20mm (XINJE)
 * D: קטרים מעל 20mm (עתידי)
 *
 * כאשר מכונת C תוגדר — להוסיף כאן לפי הגדרת המפעל.
 */
function autoAssignMachine(diameter) {
  const d = Number(diameter);
  if (d <= 12) return 'A';
  if (d <= 20) return 'B';
  return 'D';
}

module.exports = { autoAssignMachine };
