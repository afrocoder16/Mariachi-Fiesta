const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.SQUARE_ENVIRONMENT = 'sandbox';
process.env.SQUARE_APPLICATION_ID = 'sandbox-test-app';
process.env.SQUARE_ACCESS_TOKEN = 'sandbox-test-token';
process.env.SQUARE_LOCATION_ID = 'TEST_LOCATION';

const catalog = {
  objects: [
    {
      type: 'ITEM',
      id: 'ITEM_TACO',
      item_data: {
        name: 'Taco Plate',
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: 'VARIATION_TACO',
            item_variation_data: {
              name: 'Regular',
              price_money: { amount: 1000, currency: 'USD' },
            },
          },
        ],
      },
    },
  ],
};

const squareOrder = {
  id: 'ORDER_123',
  location_id: 'TEST_LOCATION',
  version: 1,
  total_money: { amount: 1087, currency: 'USD' },
  total_tax_money: { amount: 87, currency: 'USD' },
  total_discount_money: { amount: 0, currency: 'USD' },
};

const contact = {
  givenName: 'Test',
  familyName: 'Customer',
  email: 'test@example.com',
  addressLines: ['123 Main Street'],
  city: 'Marshall',
  state: 'MN',
  countryCode: 'US',
  postalCode: '56258',
};

const baseRequest = {
  orderIdempotencyKey: 'checkout-order-key',
  cart: [{ variationId: 'VARIATION_TACO', quantity: 1 }],
  billingContact: contact,
  expectedAmount: 1087,
  expectedCurrency: 'USD',
};

function squareResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installSquareMock(calls) {
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/catalog/list')) return squareResponse(200, catalog);
    if (String(url).endsWith('/orders')) return squareResponse(200, { order: squareOrder });
    if (String(url).endsWith('/payments')) {
      return squareResponse(200, {
        payment: {
          id: 'PAYMENT_123',
          status: 'COMPLETED',
          order_id: squareOrder.id,
          amount_money: squareOrder.total_money,
          receipt_url: 'https://square.example/receipt',
        },
      });
    }
    throw new Error(`Unexpected Square URL: ${url}`);
  };
}

const { createCheckoutRequest, createPaymentRequest } = require('../square-config');

test('rejects a changed Square order total before payment', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, expectedAmount: 1000 }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'PRICE_CHANGED');
      assert.equal(error.data.checkout.amount, 1087);
      return true;
    }
  );
  assert.equal(calls.some((call) => call.url.endsWith('/payments')), false);
});

test('creates a pickup order with customer details and links the payment', async () => {
  const calls = [];
  installSquareMock(calls);

  const result = await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'card-source-token',
  });

  const orderCall = calls.find((call) => call.url.endsWith('/orders'));
  const paymentCall = calls.find((call) => call.url.endsWith('/payments'));
  const orderBody = JSON.parse(orderCall.options.body);
  const paymentBody = JSON.parse(paymentCall.options.body);

  assert.deepEqual(orderBody.order.line_items, [{ catalog_object_id: 'VARIATION_TACO', quantity: '1' }]);
  assert.equal(orderBody.order.fulfillments[0].type, 'PICKUP');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.recipient.display_name, 'Test Customer');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.recipient.email_address, 'test@example.com');
  assert.equal(orderBody.idempotency_key, 'checkout-order-key-order');
  assert.equal(paymentBody.idempotency_key, 'checkout-payment-key-payment');
  assert.equal(paymentBody.order_id, 'ORDER_123');
  assert.equal(paymentBody.buyer_email_address, 'test@example.com');
  assert.deepEqual(paymentBody.amount_money, { amount: 1087, currency: 'USD' });
  assert.equal(result.orderId, 'ORDER_123');

  await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'card-source-token',
  });
  const orderKeys = calls
    .filter((call) => call.url.endsWith('/orders'))
    .map((call) => JSON.parse(call.options.body).idempotency_key);
  const paymentKeys = calls
    .filter((call) => call.url.endsWith('/payments'))
    .map((call) => JSON.parse(call.options.body).idempotency_key);
  assert.deepEqual(orderKeys, ['checkout-order-key-order', 'checkout-order-key-order']);
  assert.deepEqual(paymentKeys, ['checkout-payment-key-payment', 'checkout-payment-key-payment']);
});

function requestServer(port, pathname, ip = '203.0.113.25') {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: '127.0.0.1', port, path: pathname, headers: { 'x-real-ip': ip } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      }
    );
    request.on('error', reject);
  });
}

test('rate limits menu requests and does not expose the diagnostic route', async () => {
  const calls = [];
  installSquareMock(calls);
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await requestServer(port, '/api/menu');
      assert.equal(response.status, 200);
    }
    const limited = await requestServer(port, '/api/menu');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['ratelimit-limit'], '10');
    assert.ok(Number(limited.headers['retry-after']) >= 1);

    for (const pathname of ['/api/checkout', '/api/payments']) {
      for (let index = 0; index < 10; index += 1) {
        const response = await requestServer(port, pathname, `203.0.113.${pathname === '/api/checkout' ? 27 : 28}`);
        assert.equal(response.status, 404);
      }
      const routeLimited = await requestServer(port, pathname, `203.0.113.${pathname === '/api/checkout' ? 27 : 28}`);
      assert.equal(routeLimited.status, 429);
    }

    const diagnostic = await requestServer(port, '/api/square-status', '203.0.113.26');
    assert.equal(diagnostic.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
