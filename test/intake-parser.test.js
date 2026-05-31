const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { parseOCRText, runOCR } = require('../intake');

test('OCR parser extracts a simple rebar row', () => {
  const parsed = parseOCRText('12 6000 4');
  assert.deepEqual(parsed.items, [{ diameter: 12, length: 6000, qty: 4 }]);
});

test('OCR parser extracts delivery date and normalizes phone', () => {
  const parsed = parseOCRText('050-123 4567\n10/06/2026');
  assert.equal(parsed.customerPhone, '0501234567');
  assert.equal(parsed.deliveryDate, '2026-06-10');
});

test('OCR request uses supported document detection feature', async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body) => {
    request = { url, body };
    return { data: { responses: [{}] } };
  };

  try {
    await runOCR(Buffer.from('image'), { apiKey: 'test-key' });
  } finally {
    axios.post = originalPost;
  }

  assert.match(request.url, /key=test-key$/);
  assert.deepEqual(request.body.requests[0].features, [
    { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
  ]);
});
