const assert = require('node:assert/strict');
const { test } = require('node:test');
const { confirmPayment } = require('./payment.service');

test('processes a valid payment', () => {
  const result = confirmPayment({ customer: { id: 'cust_123' } });
  assert.equal(result, 'cust_123');
});
