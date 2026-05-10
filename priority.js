// Priority ERP integration module
// Docs: REST/ODATA API per your Priority version
// Set env vars: PRIORITY_BASE_URL, PRIORITY_USER, PRIORITY_PASS, PRIORITY_COMPANY
const axios = require('axios');

const BASE    = process.env.PRIORITY_BASE_URL;
const COMPANY = process.env.PRIORITY_COMPANY || 'DEMO';

function client() {
  return axios.create({
    baseURL: `${BASE}/odata/Priority/${COMPANY}/`,
    auth: { username: process.env.PRIORITY_USER, password: process.env.PRIORITY_PASS },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 15000,
  });
}

// ── Check if Priority is configured ──────────────────────────────
function isConfigured() {
  return !!(process.env.PRIORITY_BASE_URL && process.env.PRIORITY_USER && process.env.PRIORITY_PASS);
}

// ── Customer sync ─────────────────────────────────────────────────
async function findOrCreateCustomer(customer) {
  if (!isConfigured()) return { mocked: true, CUSTNAME: customer.priorityId || customer.phone };
  const api = client();
  // Try to find by phone
  if (customer.phone) {
    const res = await api.get(`CUSTOMERS?$filter=PHONE eq '${customer.phone}'&$select=CUSTNAME,CUSTDES`);
    if (res.data.value?.length > 0) return res.data.value[0];
  }
  // Create new customer
  const body = {
    CUSTDES:   customer.name,
    PHONE:     customer.phone || '',
    ADDRESS:   customer.address || '',
    CONTACTNAME: customer.contactName || '',
    CONTACTPHONE: customer.contactPhone || '',
  };
  const created = await api.post('CUSTOMERS', body);
  return created.data;
}

// ── Order sync ────────────────────────────────────────────────────
async function createOrder(order, customer, items) {
  if (!isConfigured()) {
    console.log('[Priority] Mock: createOrder', order.order_num);
    return { ORDNAME: `P-${order.order_num}`, mocked: true };
  }
  const api = client();

  const custRes = await findOrCreateCustomer(customer);
  const custName = custRes.CUSTNAME;

  // Get price list for customer
  let unitPrice = 0;
  try {
    const pl = await api.get(`PRICELISTS?$filter=CUST eq '${custName}'&$top=1`);
    unitPrice = pl.data.value?.[0]?.PRICE ?? 0;
  } catch {}

  // Build order lines
  const ORDLINES = items.map((item, i) => ({
    KLINE:    i + 1,
    PART:     `REBAR-${item.diameter}`,
    PDES:     `ברזל Ø${item.diameter} - ${item.shape_name || ''}`,
    TQUANT:   item.billing_weight || item.total_weight || 0,
    PRICE:    unitPrice,
    QPRICE:   (item.billing_weight || item.total_weight || 0) * unitPrice,
  }));

  const body = {
    CUSTNAME: custName,
    CURDATE:  new Date().toISOString().split('T')[0].replace(/-/g, ''),
    DUEDATE:  (order.delivery_date || '').replace(/-/g, ''),
    REMARK:   order.general_notes || '',
    ORDLINES_SUBFORM: ORDLINES,
  };

  const res = await api.post('ORDERS', body);
  return res.data;
}

// ── Delivery note ─────────────────────────────────────────────────
async function createDeliveryNote(priorityOrderId) {
  if (!isConfigured()) return { mocked: true };
  const api = client();
  const res = await api.post(`ORDERS('${priorityOrderId}')/LOGPART_SUBFORM`, {});
  return res.data;
}

// ── Update order status ───────────────────────────────────────────
async function updateOrderStatus(priorityOrderId, status) {
  if (!isConfigured()) return { mocked: true };
  const api = client();
  const statusMap = {
    'בייצור':           'OPEN',
    'הושלם – ממתין לאיסוף': 'OPEN',
    'בדרך ללקוח':       'OPEN',
    'סופק – אושר':      'CLOSED',
  };
  const stat = statusMap[status] || 'OPEN';
  const res = await api.patch(`ORDERS('${priorityOrderId}')`, { STATDES: stat });
  return res.data;
}

// ── Fetch customer price list ─────────────────────────────────────
async function getCustomerPrice(priorityCustomerId) {
  if (!isConfigured()) return null;
  const api = client();
  try {
    const res = await api.get(`PRICELISTS?$filter=CUST eq '${priorityCustomerId}'&$top=1`);
    return res.data.value?.[0] ?? null;
  } catch { return null; }
}

module.exports = { isConfigured, findOrCreateCustomer, createOrder, createDeliveryNote, updateOrderStatus, getCustomerPrice };
