const ORDER_STATUS = Object.freeze({
  PENDING_APPROVAL: 'ממתינה לאישור',
  CUSTOMER_PENDING_APPROVAL: 'ממתינה לאישור לקוח',
  APPROVED_WAITING_PRODUCTION: 'אושרה – ממתין לייצור',
  PRODUCTION_QUEUE: 'בתור ייצור',
  IN_PRODUCTION: 'בייצור',
  DONE_WAITING_PICKUP: 'הושלם – ממתין לאיסוף',
  ON_THE_WAY: 'בדרך ללקוח',
  DELIVERY_PROBLEM: 'בעיה באספקה',
  DELIVERED_CONFIRMED: 'סופק – אושר',
  SENT: 'נשלחה',
  CANCELLED: 'בוטלה'
});

const ORDER_STATUS_ALIASES = Object.freeze({
  'אושרה': ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
  'מאושר': ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
  'מאושרת': ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
  'נמסרה': ORDER_STATUS.DELIVERED_CONFIRMED,
  'סופק': ORDER_STATUS.DELIVERED_CONFIRMED,
  'בוטל': ORDER_STATUS.CANCELLED
});

const VALID_ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING_APPROVAL]: [
    ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.CUSTOMER_PENDING_APPROVAL]: [
    ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.APPROVED_WAITING_PRODUCTION]: [
    ORDER_STATUS.PRODUCTION_QUEUE,
    ORDER_STATUS.IN_PRODUCTION,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.PRODUCTION_QUEUE]: [
    ORDER_STATUS.IN_PRODUCTION,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.IN_PRODUCTION]: [
    ORDER_STATUS.DONE_WAITING_PICKUP,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.DONE_WAITING_PICKUP]: [
    ORDER_STATUS.ON_THE_WAY,
    ORDER_STATUS.SENT
  ],
  [ORDER_STATUS.ON_THE_WAY]: [
    ORDER_STATUS.DELIVERED_CONFIRMED,
    ORDER_STATUS.DELIVERY_PROBLEM
  ],
  [ORDER_STATUS.DELIVERY_PROBLEM]: [
    ORDER_STATUS.ON_THE_WAY,
    ORDER_STATUS.CANCELLED
  ],
  [ORDER_STATUS.DELIVERED_CONFIRMED]: [],
  [ORDER_STATUS.SENT]: [
    ORDER_STATUS.DELIVERED_CONFIRMED
  ],
  [ORDER_STATUS.CANCELLED]: []
});

const ITEM_STATUS = Object.freeze({
  WAITING: 'ממתין',
  IN_PRODUCTION: 'בייצור',
  DONE: 'הושלם',
  DELIVERED: 'סופק',
  ON_HOLD: 'בהמתנה',
  CANCELLED: 'בוטל'
});

const VALID_ITEM_STATUSES = Object.freeze(Object.values(ITEM_STATUS));

function normalizeOrderStatus(status) {
  return ORDER_STATUS_ALIASES[status] || status;
}

function isValidOrderTransition(from, to) {
  const normalizedFrom = normalizeOrderStatus(from);
  const normalizedTo = normalizeOrderStatus(to);
  if (!VALID_ORDER_TRANSITIONS[normalizedFrom]) return true;
  return VALID_ORDER_TRANSITIONS[normalizedFrom].includes(normalizedTo);
}

function allowedOrderTransitions(status) {
  return VALID_ORDER_TRANSITIONS[normalizeOrderStatus(status)] || [];
}

function isValidItemStatus(status) {
  return VALID_ITEM_STATUSES.includes(status);
}

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_ALIASES,
  VALID_ORDER_TRANSITIONS,
  ITEM_STATUS,
  VALID_ITEM_STATUSES,
  normalizeOrderStatus,
  isValidOrderTransition,
  allowedOrderTransitions,
  isValidItemStatus
};
