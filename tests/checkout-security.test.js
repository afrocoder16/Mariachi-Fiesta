const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

process.env.SQUARE_ENVIRONMENT = 'sandbox';
process.env.SQUARE_APPLICATION_ID = 'sandbox-test-app';
process.env.SQUARE_ACCESS_TOKEN = 'sandbox-test-token';
process.env.SQUARE_LOCATION_ID = 'TEST_LOCATION';
process.env.PORT = '0';

const catalog = {
  objects: [
    {
      type: 'MODIFIER_LIST',
      id: 'TORTILLA_LIST',
      modifier_list_data: {
        name: 'Tortilla Choice',
        min_selected_modifiers: 1,
        max_selected_modifiers: 1,
        modifiers: [
          {
            type: 'MODIFIER',
            id: 'MODIFIER_CORN',
            modifier_data: { name: 'Corn Tortillas', price_money: { amount: 0, currency: 'USD' } },
          },
          {
            type: 'MODIFIER',
            id: 'MODIFIER_FLOUR',
            modifier_data: { name: 'Flour Tortillas', price_money: { amount: 50, currency: 'USD' } },
          },
        ],
      },
    },
    {
      type: 'ITEM',
      id: 'ITEM_TACO',
      item_data: {
        name: 'Taco Plate',
        modifier_list_info: [
          {
            modifier_list_id: 'TORTILLA_LIST',
            enabled: true,
            min_selected_modifiers: 1,
            max_selected_modifiers: 1,
            modifier_overrides: [{ modifier_id: 'MODIFIER_CORN', on_by_default: true }],
          },
        ],
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
  state: 'OPEN',
  fulfillments: [{ uid: 'FULFILLMENT_123', type: 'PICKUP', state: 'PROPOSED' }],
  total_money: { amount: 1087, currency: 'USD' },
  total_tax_money: { amount: 87, currency: 'USD' },
  total_discount_money: { amount: 0, currency: 'USD' },
  taxes: [{ uid: 'tax-1', name: 'Standard Tax', type: 'INCLUSIVE', applied_money: { amount: 87, currency: 'USD' } }],
};

const contact = {
  givenName: 'Test',
  familyName: 'Customer',
  email: 'test@example.com',
  phone: '(507) 555-0123',
  addressLines: ['123 Main Street'],
  city: 'Marshall',
  state: 'MN',
  countryCode: 'US',
  postalCode: '56258',
};

const baseRequest = {
  orderIdempotencyKey: 'checkout-order-key',
  cart: [{ variationId: 'VARIATION_TACO', quantity: 1, modifiers: [{ modifierId: 'MODIFIER_CORN', quantity: 1 }] }],
  billingContact: contact,
  customerNote: 'Please include extra napkins.',
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

function installSquareMock(calls, overrides = {}) {
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/catalog/list')) return squareResponse(200, catalog);
    if (String(url).endsWith('/orders/calculate')) {
      const calculatedOrder = { ...squareOrder };
      delete calculatedOrder.id;
      return squareResponse(200, { order: calculatedOrder });
    }
    if (String(url).includes('/orders/ORDER_123') && options.method === 'PUT') {
      const update = JSON.parse(options.body);
      const nextOrder = {
        ...squareOrder,
        version: update.order.fulfillments ? 2 : 3,
        state: update.order.state || squareOrder.state,
        fulfillments: update.order.fulfillments || squareOrder.fulfillments,
      };
      return squareResponse(200, { order: nextOrder });
    }
    if (String(url).endsWith('/orders')) return squareResponse(200, { order: squareOrder });
    if (String(url).endsWith('/payments')) {
      if (overrides.paymentError) return squareResponse(overrides.paymentError.status, overrides.paymentError.body);
      return squareResponse(200, {
        payment: {
          id: 'PAYMENT_123',
          status: 'COMPLETED',
          order_id: squareOrder.id,
          location_id: 'TEST_LOCATION',
          amount_money: squareOrder.total_money,
          tip_money: { amount: 163, currency: 'USD' },
          total_money: { amount: 1250, currency: 'USD' },
          receipt_url: 'https://square.example/receipt',
          ...overrides.payment,
        },
      });
    }
    throw new Error(`Unexpected Square URL: ${url}`);
  };
}

const { createCheckoutRequest, createPaymentRequest, validateCustomerNote, validateTipAmount } = require('../square-config');

test('matches Square smart-tip choices for small and regular totals', () => {
  assert.equal(validateTipAmount(100, { amount: 550, currency: 'USD' }), 100);
  assert.equal(validateTipAmount(163, { amount: 1087, currency: 'USD' }), 163);
  assert.throws(() => validateTipAmount(82, { amount: 550, currency: 'USD' }), /tip option/);
  assert.throws(() => validateTipAmount(164, { amount: 1087, currency: 'USD' }), /tip option/);
});

test('normalizes pickup notes and enforces Square\'s 500-character limit', () => {
  assert.equal(validateCustomerNote('  Please   ring the bell.\r\nThank you!  '), 'Please ring the bell.\nThank you!');
  assert.equal(validateCustomerNote(''), '');
  assert.throws(() => validateCustomerNote({ note: 'not plain text' }), /plain text/);
  assert.throws(() => validateCustomerNote('x'.repeat(501)), /500 characters/);
});

test('rejects a changed Square order total before payment', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, expectedAmount: 1000 }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'PRICE_CHANGED');
      assert.equal(error.data.checkout.amount, 1087);
      assert.equal(error.data.checkout.tax, 87);
      assert.equal(error.data.checkout.taxIncluded, true);
      assert.equal(error.data.checkout.tipOptions.length, 4);
      assert.equal(error.data.checkout.tipOptions.find((option) => option.isDefault).amount, 163);
      return true;
    }
  );
  assert.equal(calls.some((call) => call.url.endsWith('/payments')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
});

test('creates a pickup order with contact details and links the payment', async () => {
  const calls = [];
  installSquareMock(calls);

  const result = await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'cnon:card-source-token',
    tipAmount: 163,
  });

  const orderCall = calls.find((call) => call.url.endsWith('/orders'));
  const paymentCall = calls.find((call) => call.url.endsWith('/payments'));
  const orderBody = JSON.parse(orderCall.options.body);
  const paymentBody = JSON.parse(paymentCall.options.body);

  assert.deepEqual(orderBody.order.line_items, [{
    catalog_object_id: 'VARIATION_TACO',
    quantity: '1',
    modifiers: [{ catalog_object_id: 'MODIFIER_CORN', quantity: '1' }],
  }]);
  assert.equal(orderBody.order.fulfillments[0].type, 'PICKUP');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.recipient.display_name, 'Test Customer');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.recipient.email_address, 'test@example.com');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.recipient.phone_number, '+15075550123');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.note, 'Please include extra napkins.');
  assert.equal(orderBody.idempotency_key, 'checkout-order-key-order');
  assert.equal(paymentBody.idempotency_key, 'checkout-payment-key-payment');
  assert.equal(paymentBody.order_id, 'ORDER_123');
  assert.equal(paymentBody.buyer_email_address, 'test@example.com');
  assert.deepEqual(paymentBody.amount_money, { amount: 1087, currency: 'USD' });
  assert.deepEqual(paymentBody.tip_money, { amount: 163, currency: 'USD' });
  assert.equal('customer_id' in paymentBody, false);
  assert.equal(calls.some((call) => call.url.includes('/customers')), false);
  assert.equal(result.orderId, 'ORDER_123');
  assert.equal(result.amount, 1250);
  assert.equal(result.tipAmount, 163);

  await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'cnon:card-source-token',
    tipAmount: 163,
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

test('calculates checkout quotes without creating persistent Square data', async () => {
  const calls = [];
  installSquareMock(calls);

  const checkout = await createCheckoutRequest(baseRequest);

  assert.equal(checkout.amount, 1087);
  assert.equal(calls.some((call) => call.url.endsWith('/orders/calculate')), true);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
  assert.equal(calls.some((call) => call.url.includes('/customers')), false);
});

test('rejects malformed payment tokens before creating Square data', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createPaymentRequest({
      ...baseRequest,
      paymentIdempotencyKey: 'malformed-payment-key',
      sourceId: 'not-a-square-token',
      tipAmount: 163,
    }),
    (error) => error.status === 400 && /payment token/.test(error.message)
  );

  assert.equal(calls.length, 0);
});

test('cancels an unpaid order after Square rejects payment and never writes customers', async () => {
  const calls = [];
  installSquareMock(calls, {
    paymentError: {
      status: 400,
      body: { errors: [{ code: 'INVALID_CARD_DATA', detail: 'Invalid card data.' }] },
    },
  });

  await assert.rejects(
    createPaymentRequest({
      ...baseRequest,
      paymentIdempotencyKey: 'rejected-payment-key',
      sourceId: 'cnon:card-source-token',
      tipAmount: 163,
    }),
    (error) => error.status === 400 && error.code === 'PAYMENT_RETRY_ALLOWED'
  );

  assert.equal(calls.some((call) => call.url.includes('/customers')), false);
  const cancellations = calls.filter((call) => call.url.includes('/orders/ORDER_123') && call.options.method === 'PUT');
  assert.equal(cancellations.length, 2);
  assert.equal(JSON.parse(cancellations[0].options.body).order.fulfillments[0].state, 'CANCELED');
  assert.equal(JSON.parse(cancellations[1].options.body).order.state, 'CANCELED');
});

test('does not report success for an incomplete or mismatched Square payment', async () => {
  const calls = [];
  installSquareMock(calls, { payment: { status: 'APPROVED' } });

  await assert.rejects(
    createPaymentRequest({
      ...baseRequest,
      paymentIdempotencyKey: 'incomplete-payment-key',
      sourceId: 'cnon:card-source-token',
      tipAmount: 163,
    }),
    (error) => error.status === 502 && /completed payment/.test(error.message)
  );
});

test('rejects missing required modifiers and unapproved tip amounts before charging', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, cart: [{ variationId: 'VARIATION_TACO', quantity: 1 }] }),
    (error) => error.status === 400 && /Tortilla Choice/.test(error.message)
  );

  await assert.rejects(
    createPaymentRequest({
      ...baseRequest,
      paymentIdempotencyKey: 'checkout-payment-key-2',
      sourceId: 'cnon:card-source-token',
      tipAmount: 999,
    }),
    (error) => error.status === 400 && /tip option/.test(error.message)
  );
  assert.equal(calls.some((call) => call.url.endsWith('/payments')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
});

function requestServer(port, pathname, ip = '203.0.113.25', options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: options.method || 'GET',
        headers: { 'x-real-ip': ip, ...(options.headers || {}) },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const isJson = String(response.headers['content-type'] || '').includes('application/json');
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: isJson ? JSON.parse(rawBody) : rawBody,
          });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

test('rate limits menu requests, ignores spoofed client IP headers, and protects private files', async () => {
  const calls = [];
  installSquareMock(calls);
  const { server } = require('../server');
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  try {
    const home = await requestServer(port, '/', '203.0.113.24');
    assert.equal(home.status, 200);
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal(home.headers['x-frame-options'], 'DENY');
    assert.equal(home.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(home.headers['x-permitted-cross-domain-policies'], 'none');
    const csp = home.headers['content-security-policy'];
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /https:\/\/sandbox\.web\.squarecdn\.com/);
    assert.match(csp, /https:\/\/pci-connect\.squareupsandbox\.com/);
    const structuredData = home.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(structuredData);
    const structuredDataHash = crypto.createHash('sha256').update(structuredData[1]).digest('base64');
    assert.ok(csp.includes(`'sha256-${structuredDataHash}'`));

    for (const privatePath of ['/.env', '/id.md', '/server.js', '/square-config.js', '/archive/file.txt', '/images/%252e%252e/.env']) {
      const privateResponse = await requestServer(port, privatePath, '203.0.113.24');
      assert.equal(privateResponse.status, 404);
      assert.equal(privateResponse.headers['x-content-type-options'], 'nosniff');
    }

    const callsBeforeCrossSiteRequest = calls.length;
    const crossSiteRequest = await requestServer(port, '/api/checkout', '203.0.113.23', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://untrusted.example' },
      body: '{}',
    });
    assert.equal(crossSiteRequest.status, 415);
    assert.equal(crossSiteRequest.body.error, 'Content-Type must be application/json.');
    assert.equal(calls.length, callsBeforeCrossSiteRequest);

    for (let index = 0; index < 10; index += 1) {
      const response = await requestServer(port, '/api/menu');
      assert.equal(response.status, 200);
    }
    const limited = await requestServer(port, '/api/menu');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['ratelimit-limit'], '10');
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    const spoofedIp = await requestServer(port, '/api/menu', '198.51.100.99');
    assert.equal(spoofedIp.status, 429);

    for (const pathname of ['/api/checkout', '/api/payments']) {
      const requestsAlreadyCounted = pathname === '/api/checkout' ? 1 : 0;
      for (let index = requestsAlreadyCounted; index < 10; index += 1) {
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
