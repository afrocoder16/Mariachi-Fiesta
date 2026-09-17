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
  fulfillmentType: 'PICKUP',
  expectedAmount: 1087,
  expectedCurrency: 'USD',
};
const OPEN_NOW = new Date('2026-09-08T17:00:00.000Z'); // Tuesday at noon in Marshall.
const CLOSED_NOW = new Date('2026-09-09T03:00:00.000Z'); // Tuesday at 10 PM in Marshall.
const LATE_OPEN_NOW = new Date('2026-09-09T01:40:00.000Z'); // Tuesday at 8:40 PM in Marshall.
const squareLocation = {
  id: 'TEST_LOCATION',
  status: 'ACTIVE',
  timezone: 'America/Chicago',
  business_hours: {
    periods: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day_of_week) => ({
      day_of_week,
      start_local_time: '11:00:00',
      end_local_time: '21:00:00',
    })),
  },
};

function locationClosedAt(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const day = { Sun: 'SUN', Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI', Sat: 'SAT' }[parts.weekday];
  const startHour = (Number(parts.hour) + 2) % 24;
  const endHour = (startHour + 1) % 24;
  return {
    ...squareLocation,
    business_hours: {
      periods: [{
        day_of_week: day,
        start_local_time: `${String(startHour).padStart(2, '0')}:00:00`,
        end_local_time: `${String(endHour).padStart(2, '0')}:00:00`,
      }],
    },
  };
}

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
    if (String(url).includes('/locations/TEST_LOCATION')) {
      return squareResponse(200, { location: overrides.location || squareLocation });
    }
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

const {
  clearBusinessScheduleCache,
  createCheckoutRequest,
  createPaymentRequest,
  getOrderingAvailability,
  validateCustomerNote,
  validateTipAmount,
} = require('../square-config');

test('matches Square smart-tip choices for small and regular totals', () => {
  assert.equal(validateTipAmount(100, { amount: 550, currency: 'USD' }), 100);
  assert.equal(validateTipAmount(163, { amount: 1087, currency: 'USD' }), 163);
  assert.throws(() => validateTipAmount(82, { amount: 550, currency: 'USD' }), /tip option/);
  assert.throws(() => validateTipAmount(164, { amount: 1087, currency: 'USD' }), /tip option/);
});

test('normalizes order notes and enforces Square\'s 500-character limit', () => {
  assert.equal(validateCustomerNote('  Please   ring the bell.\r\nThank you!  '), 'Please ring the bell.\nThank you!');
  assert.equal(validateCustomerNote(''), '');
  assert.throws(() => validateCustomerNote({ note: 'not plain text' }), /plain text/);
  assert.throws(() => validateCustomerNote('x'.repeat(501)), /500 characters/);
});

test('rejects a changed Square order total before payment', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, expectedAmount: 1000 }, OPEN_NOW),
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

test('creates a pickup ASAP order with contact details and links the payment', async () => {
  const calls = [];
  installSquareMock(calls);

  const result = await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'cnon:card-source-token',
    tipAmount: 163,
  }, OPEN_NOW);

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
  assert.equal(orderBody.order.fulfillments[0].pickup_details.schedule_type, 'ASAP');
  assert.equal(orderBody.order.fulfillments[0].pickup_details.prep_time_duration, 'PT20M');
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
  assert.deepEqual(result.pickup, { fulfillmentType: 'PICKUP', scheduleType: 'ASAP', pickupAt: null, prepMinutes: 20 });

  await createPaymentRequest({
    ...baseRequest,
    paymentIdempotencyKey: 'checkout-payment-key',
    sourceId: 'cnon:card-source-token',
    tipAmount: 163,
  }, OPEN_NOW);
  const orderKeys = calls
    .filter((call) => call.url.endsWith('/orders'))
    .map((call) => JSON.parse(call.options.body).idempotency_key);
  const paymentKeys = calls
    .filter((call) => call.url.endsWith('/payments'))
    .map((call) => JSON.parse(call.options.body).idempotency_key);
  assert.deepEqual(orderKeys, ['checkout-order-key-order', 'checkout-order-key-order']);
  assert.deepEqual(paymentKeys, ['checkout-payment-key-payment', 'checkout-payment-key-payment']);
});

test('allows checkout during Square business hours without creating persistent data', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const checkout = await createCheckoutRequest(baseRequest, OPEN_NOW);
  const availability = await getOrderingAvailability(OPEN_NOW);

  assert.equal(checkout.amount, 1087);
  assert.equal(availability.isOpen, true);
  assert.equal(availability.timeZone, 'America/Chicago');
  assert.equal(calls.some((call) => call.url.endsWith('/orders/calculate')), true);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
  assert.equal(calls.some((call) => call.url.includes('/customers')), false);
});

test('requires a supported fulfillment choice and enforces the dine-in note limit', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const missingFulfillment = { ...baseRequest };
  delete missingFulfillment.fulfillmentType;
  await assert.rejects(
    createCheckoutRequest(missingFulfillment, OPEN_NOW),
    (error) => error.status === 400 && error.code === 'INVALID_FULFILLMENT_TYPE'
  );
  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, fulfillmentType: 'DINE_IN', customerNote: 'x'.repeat(468) }, OPEN_NOW),
    (error) => error.status === 400 && error.code === 'INVALID_CUSTOMER_NOTE' && /467 characters/.test(error.message)
  );
  assert.equal(calls.some((call) => call.url.includes('/catalog/list')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
});

test('rejects pickup and dine-in ASAP and scheduled checkout outside Square business hours', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const combinations = [
    { fulfillmentType: 'PICKUP', pickupType: 'ASAP' },
    { fulfillmentType: 'PICKUP', pickupType: 'SCHEDULED', pickupAt: '2026-09-09T16:30:00.000Z' },
    { fulfillmentType: 'DINE_IN', pickupType: 'ASAP' },
    { fulfillmentType: 'DINE_IN', pickupType: 'SCHEDULED', pickupAt: '2026-09-09T16:30:00.000Z' },
  ];
  for (const [index, selection] of combinations.entries()) {
    await assert.rejects(
      createCheckoutRequest({ ...baseRequest, ...selection }, CLOSED_NOW),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, 'ORDERING_CLOSED');
        assert.match(error.message, /currently closed/i);
        assert.equal(error.data.availability.isOpen, false);
        assert.equal(error.data.availability.nextOpenAt, '2026-09-09T16:00:00.000Z');
        return true;
      }
    );
    await assert.rejects(
      createPaymentRequest({
        ...baseRequest,
        ...selection,
        paymentIdempotencyKey: `closed-payment-key-${index}`,
        sourceId: 'cnon:card-source-token',
        tipAmount: 163,
      }, CLOSED_NOW),
      (error) => error.status === 409 && error.code === 'ORDERING_CLOSED'
    );
  }

  assert.equal(calls.some((call) => call.url.includes('/catalog/list')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/payments')), false);
});

test('offers only open-hour pickup slots and sends scheduled pickup_at to Square', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const availability = await getOrderingAvailability(OPEN_NOW);
  assert.equal(availability.isOpen, true);
  assert.equal(availability.timeZone, 'America/Chicago');
  assert.equal(availability.pickup.prepMinutes, 20);
  assert.equal(availability.pickup.asapAvailable, true);
  assert.ok(availability.pickup.slots.length > 0);
  assert.ok(availability.pickup.slots.every((slot) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: availability.timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(slot.pickupAt)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return parts.weekday !== 'Sun' && minutes >= 11 * 60 && minutes < 21 * 60;
  }));

  const pickupAt = availability.pickup.slots[0].pickupAt;
  const checkout = await createCheckoutRequest({ ...baseRequest, pickupType: 'SCHEDULED', pickupAt }, OPEN_NOW);
  const calculatedOrder = JSON.parse(calls.find((call) => call.url.endsWith('/orders/calculate')).options.body).order;
  const pickupDetails = calculatedOrder.fulfillments[0].pickup_details;
  assert.equal(pickupDetails.schedule_type, 'SCHEDULED');
  assert.equal(pickupDetails.pickup_at, pickupAt);
  assert.equal(pickupDetails.prep_time_duration, 'PT20M');
  assert.deepEqual(checkout.pickup, { fulfillmentType: 'PICKUP', scheduleType: 'SCHEDULED', pickupAt, prepMinutes: 20 });
});

test('sends dine-in ASAP as a labeled Square pickup fulfillment', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const checkout = await createCheckoutRequest({ ...baseRequest, fulfillmentType: 'DINE_IN' }, OPEN_NOW);
  const calculatedOrder = JSON.parse(calls.find((call) => call.url.endsWith('/orders/calculate')).options.body).order;
  const fulfillment = calculatedOrder.fulfillments[0];
  assert.equal(fulfillment.type, 'PICKUP');
  assert.equal(fulfillment.pickup_details.schedule_type, 'ASAP');
  assert.equal(fulfillment.pickup_details.prep_time_duration, 'PT20M');
  assert.equal(fulfillment.pickup_details.note, 'DINE-IN — Customer will eat here\nPlease include extra napkins.');
  assert.deepEqual(checkout.pickup, { fulfillmentType: 'DINE_IN', scheduleType: 'ASAP', pickupAt: null, prepMinutes: 20 });
});

test('sends dine-in scheduled as a labeled Square pickup fulfillment', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const availability = await getOrderingAvailability(OPEN_NOW);
  const pickupAt = availability.pickup.slots[0].pickupAt;
  const checkout = await createCheckoutRequest({
    ...baseRequest,
    fulfillmentType: 'DINE_IN',
    pickupType: 'SCHEDULED',
    pickupAt,
  }, OPEN_NOW);
  const calculatedOrder = JSON.parse(calls.find((call) => call.url.endsWith('/orders/calculate')).options.body).order;
  const fulfillment = calculatedOrder.fulfillments[0];
  assert.equal(fulfillment.type, 'PICKUP');
  assert.equal(fulfillment.pickup_details.schedule_type, 'SCHEDULED');
  assert.equal(fulfillment.pickup_details.pickup_at, pickupAt);
  assert.equal(fulfillment.pickup_details.prep_time_duration, 'PT20M');
  assert.equal(fulfillment.pickup_details.note, 'DINE-IN — Customer will eat here\nPlease include extra napkins.');
  assert.deepEqual(checkout.pickup, { fulfillmentType: 'DINE_IN', scheduleType: 'SCHEDULED', pickupAt, prepMinutes: 20 });
});

test('rejects a scheduled pickup outside Square business hours before order creation', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({
      ...baseRequest,
      pickupType: 'SCHEDULED',
      pickupAt: '2026-09-13T17:00:00.000Z', // Sunday at noon in Marshall.
    }, OPEN_NOW),
    (error) => error.status === 409 && error.code === 'INVALID_PICKUP_TIME'
  );
  assert.equal(calls.some((call) => call.url.includes('/catalog/list')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
});

test('disables ASAP when preparation would run past closing', async () => {
  const calls = [];
  clearBusinessScheduleCache();
  installSquareMock(calls);

  const availability = await getOrderingAvailability(LATE_OPEN_NOW);
  assert.equal(availability.isOpen, true);
  assert.equal(availability.pickup.asapAvailable, false);
  await assert.rejects(
    createCheckoutRequest(baseRequest, LATE_OPEN_NOW),
    (error) => error.status === 409 && error.code === 'INVALID_PICKUP_TIME' && /before closing/.test(error.message)
  );
  assert.equal(calls.some((call) => call.url.includes('/catalog/list')), false);
  assert.equal(calls.some((call) => call.url.endsWith('/orders')), false);
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
    }, OPEN_NOW),
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
    }, OPEN_NOW),
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
    }, OPEN_NOW),
    (error) => error.status === 502 && /completed payment/.test(error.message)
  );
});

test('rejects missing required modifiers and unapproved tip amounts before charging', async () => {
  const calls = [];
  installSquareMock(calls);

  await assert.rejects(
    createCheckoutRequest({ ...baseRequest, cart: [{ variationId: 'VARIATION_TACO', quantity: 1 }] }, OPEN_NOW),
    (error) => error.status === 400 && /Tortilla Choice/.test(error.message)
  );

  await assert.rejects(
    createPaymentRequest({
      ...baseRequest,
      paymentIdempotencyKey: 'checkout-payment-key-2',
      sourceId: 'cnon:card-source-token',
      tipAmount: 999,
    }, OPEN_NOW),
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

    clearBusinessScheduleCache();
    installSquareMock(calls, { location: locationClosedAt() });
    const persistentCallsBeforeClosedRequests = calls.filter((call) => /\/orders$|\/payments$/.test(call.url)).length;
    const closedAvailability = await requestServer(port, '/api/ordering-availability');
    assert.equal(closedAvailability.status, 200);
    assert.equal(closedAvailability.body.availability.isOpen, false);

    const closedCheckout = await requestServer(port, '/api/checkout', '203.0.113.29', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseRequest),
    });
    assert.equal(closedCheckout.status, 409);
    assert.equal(closedCheckout.body.code, 'ORDERING_CLOSED');

    const closedPayment = await requestServer(port, '/api/payments', '203.0.113.30', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...baseRequest,
        paymentIdempotencyKey: 'closed-payment-key',
        sourceId: 'cnon:card-source-token',
        tipAmount: 163,
      }),
    });
    assert.equal(closedPayment.status, 409);
    assert.equal(closedPayment.body.code, 'ORDERING_CLOSED');
    assert.equal(calls.filter((call) => /\/orders$|\/payments$/.test(call.url)).length, persistentCallsBeforeClosedRequests);

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
      const requestsAlreadyCounted = pathname === '/api/checkout' ? 2 : 1;
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
