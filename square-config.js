/**
 * Server-only Square integration.
 *
 * Never load this file in index.html: it reads the private access token from
 * .env and is intentionally excluded from the static-file allowlist.
 */

const fs = require('node:fs');
const path = require('node:path');

const environment = (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase();
const applicationId = process.env.SQUARE_APPLICATION_ID;
const accessToken = process.env.SQUARE_ACCESS_TOKEN;
const locationId = process.env.SQUARE_LOCATION_ID;
const apiVersion = process.env.SQUARE_API_VERSION || '2026-08-19';
const apiEndpoint =
  process.env.SQUARE_API_ENDPOINT ||
  (environment === 'production' ? 'https://connect.squareup.com/v2' : 'https://connect.squareupsandbox.com/v2');

const missing = [
  ['SQUARE_APPLICATION_ID', applicationId],
  ['SQUARE_ACCESS_TOKEN', accessToken],
  ['SQUARE_LOCATION_ID', locationId],
].filter(([, value]) => !value);

if (missing.length) {
  throw new Error(`Missing Square configuration: ${missing.map(([name]) => name).join(', ')}`);
}

class SquareApiError extends Error {
  constructor(message, status = 500, details = [], code = '', data = null) {
    super(message);
    this.name = 'SquareApiError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.data = data;
  }
}

async function squareRequest(path, options = {}) {
  const method = options.method || 'GET';
  const startedAt = Date.now();
  console.log(`[Square] -> ${method} ${path}`);

  const response = await fetch(`${apiEndpoint}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': apiVersion,
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  console.log(`[Square] <- ${response.status} ${method} ${path} (${Date.now() - startedAt}ms)`);

  if (!response.ok) {
    const details = Array.isArray(payload.errors) ? payload.errors : [];
    const message = details.map((error) => error.detail || error.code).filter(Boolean).join('; ');
    throw new SquareApiError(message || `Square returned HTTP ${response.status}`, response.status, details);
  }

  return payload;
}

function isAtLocation(object) {
  if (!object || object.is_deleted) return false;
  if ((object.absent_at_location_ids || []).includes(locationId)) return false;
  // Square defaults present_at_all_locations to true when the field is omitted.
  return object.present_at_all_locations !== false || (object.present_at_location_ids || []).includes(locationId);
}

function slugify(value) {
  return String(value || 'uncategorized')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'uncategorized';
}

async function listCatalogObjects() {
  const objects = [];
  let cursor = '';

  do {
    const query = new URLSearchParams({ types: 'ITEM,CATEGORY,IMAGE' });
    if (cursor) query.set('cursor', cursor);
    const page = await squareRequest(`/catalog/list?${query}`);
    objects.push(...(page.objects || []));
    cursor = page.cursor || '';
  } while (cursor);

  return objects;
}

function normalizeCatalog(objects) {
  const categories = new Map(
    objects
      .filter((object) => object.type === 'CATEGORY' && !object.is_deleted)
      .map((object) => [object.id, object.category_data?.name || 'Uncategorized'])
  );
  const images = new Map(
    objects
      .filter((object) => object.type === 'IMAGE' && !object.is_deleted && object.image_data?.url)
      .map((object) => [object.id, object.image_data.url])
  );

  const groups = new Map();

  objects
    .filter((object) => object.type === 'ITEM' && isAtLocation(object) && !object.item_data?.is_archived)
    .forEach((object) => {
      const data = object.item_data || {};
      const variations = (data.variations || [])
        .filter((variation) => isAtLocation(variation))
        .map((variation) => {
          const variationData = variation.item_variation_data || {};
          const money = variationData.price_money;
          if (!money || !Number.isSafeInteger(Number(money.amount))) return null;
          return {
            id: variation.id,
            name: variationData.name || 'Regular',
            price: Number(money.amount),
            currency: money.currency || 'USD',
          };
        })
        .filter(Boolean);

      if (!variations.length) return;

      const categoryId = data.categories?.[0]?.id || data.category_id;
      const categoryName = categories.get(categoryId) || 'More Favorites';
      const groupId = slugify(categoryName);
      if (!groups.has(groupId)) groups.set(groupId, { id: groupId, title: categoryName, items: [] });

      const localImagePath = `images/menu/${slugify(data.name)}.webp`;
      const catalogImageUrl = (data.image_ids || []).map((id) => images.get(id)).find(Boolean) || '';
      const imageUrl = catalogImageUrl || (fs.existsSync(path.join(__dirname, localImagePath)) ? localImagePath : '');

      groups.get(groupId).items.push({
        id: object.id,
        name: data.name || 'Menu item',
        description: data.description_plaintext || data.description || '',
        imageUrl,
        variations,
      });
    });

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: group.items.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Fetches and normalizes purchasable menu items from the Square Catalog API. */
async function fetchMenuItems() {
  const objects = await listCatalogObjects();
  const typeCounts = objects.reduce((counts, object) => {
    counts[object.type] = (counts[object.type] || 0) + 1;
    return counts;
  }, {});
  console.log(`[Square] Catalog objects: ${JSON.stringify(typeCounts)}`);
  const groups = normalizeCatalog(objects);
  const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
  console.log(`[Square] Catalog ready: ${itemCount} items in ${groups.length} categories`);
  return groups;
}

function validateCart(cart, menu) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > 50) {
    throw new SquareApiError('The cart must contain between 1 and 50 items.', 400);
  }

  const catalogVariations = new Map();
  menu.forEach((group) =>
    group.items.forEach((item) =>
      item.variations.forEach((variation) =>
        catalogVariations.set(variation.id, { ...variation, itemName: item.name })
      )
    )
  );

  let amount = 0;
  let currency = '';
  const lines = cart.map((line) => {
    const quantity = Number(line.quantity);
    const variation = catalogVariations.get(String(line.variationId || ''));
    if (!variation || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
      throw new SquareApiError('The cart contains an unavailable item or invalid quantity.', 400);
    }
    if (currency && variation.currency !== currency) {
      throw new SquareApiError('All cart items must use the same currency.', 400);
    }
    currency = variation.currency;
    amount += variation.price * quantity;
    if (!Number.isSafeInteger(amount) || amount > 1_000_000) {
      throw new SquareApiError('The cart total is outside the supported range.', 400);
    }
    return {
      variationId: variation.id,
      name: variation.itemName,
      variationName: variation.name,
      quantity,
      price: variation.price,
      currency: variation.currency,
    };
  });

  return { amount, currency: currency || 'USD', lines };
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new SquareApiError('A valid checkout idempotency key is required.', 400);
  }
  return value;
}

function validateBillingContact(contact = {}) {
  const givenName = String(contact.givenName || '').trim().replace(/\s+/g, ' ');
  const familyName = String(contact.familyName || '').trim().replace(/\s+/g, ' ');
  const email = String(contact.email || '').trim().toLowerCase();
  const address = String(contact.addressLines?.[0] || '').trim().replace(/\s+/g, ' ');
  const city = String(contact.city || '').trim().replace(/\s+/g, ' ');
  const state = String(contact.state || '').trim().toUpperCase();
  const postalCode = String(contact.postalCode || '').trim();
  const displayName = `${givenName} ${familyName}`.trim();

  if (!displayName || displayName.length > 100) {
    throw new SquareApiError('Enter a valid customer name.', 400);
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SquareApiError('Enter a valid customer email address.', 400);
  }
  if (!address || address.length > 200 || !city || city.length > 100) {
    throw new SquareApiError('Enter a valid billing address and city.', 400);
  }
  if (!/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new SquareApiError('Enter a valid state and postal code.', 400);
  }

  return {
    givenName,
    familyName,
    displayName,
    email,
    addressLines: [address],
    city,
    state,
    countryCode: 'US',
    postalCode,
  };
}

function validateExpectedTotal(expectedAmount, expectedCurrency) {
  const amount = Number(expectedAmount);
  const currency = String(expectedCurrency || '').toUpperCase();
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_500_000 || !/^[A-Z]{3}$/.test(currency)) {
    throw new SquareApiError('A valid displayed checkout total is required.', 400);
  }
  return { amount, currency };
}

function checkoutSummary(order, lines) {
  const amount = Number(order.total_money?.amount);
  const currency = order.total_money?.currency || lines[0]?.currency || 'USD';
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new SquareApiError('Square did not return a valid order total.', 502);
  }

  return {
    orderId: order.id,
    orderVersion: order.version,
    amount,
    currency,
    subtotal: Number(order.total_money?.amount ?? amount) + Number(order.total_discount_money?.amount || 0) - Number(order.total_tax_money?.amount || 0),
    tax: Number(order.total_tax_money?.amount || 0),
    discount: Number(order.total_discount_money?.amount || 0),
    items: lines,
  };
}

async function createSquareOrder(request = {}) {
  const { orderIdempotencyKey, idempotencyKey, cart, billingContact, expectedAmount, expectedCurrency } = request || {};
  const checkoutKey = validateIdempotencyKey(orderIdempotencyKey || idempotencyKey);
  const contact = validateBillingContact(billingContact);
  const expected = validateExpectedTotal(expectedAmount, expectedCurrency);

  // Confirm availability, then let Square calculate the authoritative order total.
  const menu = await fetchMenuItems();
  const { lines } = validateCart(cart, menu);
  const orderPayload = await squareRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: `${checkoutKey}-order`,
      order: {
        location_id: locationId,
        reference_id: checkoutKey.slice(0, 40),
        source: { name: 'Mariachi Fiesta Website' },
        line_items: lines.map((line) => ({
          catalog_object_id: line.variationId,
          quantity: String(line.quantity),
        })),
        pricing_options: {
          auto_apply_discounts: true,
          auto_apply_taxes: true,
        },
        fulfillments: [
          {
            type: 'PICKUP',
            state: 'PROPOSED',
            pickup_details: {
              schedule_type: 'ASAP',
              recipient: {
                display_name: contact.displayName,
                email_address: contact.email,
              },
              note: 'Pickup order placed on the Mariachi Fiesta website.',
            },
          },
        ],
      },
    }),
  });

  const order = orderPayload.order;
  if (!order?.id || order.location_id !== locationId) {
    throw new SquareApiError('Square did not return a valid order.', 502);
  }

  const checkout = checkoutSummary(order, lines);
  if (checkout.amount !== expected.amount || checkout.currency !== expected.currency) {
    throw new SquareApiError(
      'The order total changed. Review and confirm the updated total before paying.',
      409,
      [],
      'PRICE_CHANGED',
      { checkout }
    );
  }

  return { checkoutKey, contact, order, checkout };
}

/** Creates or retrieves an idempotent Square order for customer confirmation. */
async function createCheckoutRequest(request = {}) {
  const { checkout } = await createSquareOrder(request);
  return checkout;
}

/** Revalidates the checkout, creates the Square order, and links its payment. */
async function createPaymentRequest(request = {}) {
  const { sourceId, paymentIdempotencyKey } = request || {};
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 500) {
    throw new SquareApiError('A valid payment token is required.', 400);
  }
  const paymentKey = validateIdempotencyKey(paymentIdempotencyKey);

  const { contact, order, checkout } = await createSquareOrder(request);
  let payload;
  try {
    payload = await squareRequest('/payments', {
      method: 'POST',
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: `${paymentKey}-payment`,
        amount_money: { amount: checkout.amount, currency: checkout.currency },
        location_id: locationId,
        order_id: order.id,
        buyer_email_address: contact.email,
        autocomplete: true,
        note: `Website pickup for ${contact.displayName}`.slice(0, 500),
      }),
    });
  } catch (error) {
    if (error instanceof SquareApiError && error.status >= 400 && error.status < 500) {
      error.code = error.code || 'PAYMENT_RETRY_ALLOWED';
    }
    throw error;
  }

  const payment = payload.payment || {};
  return {
    id: payment.id,
    status: payment.status,
    orderId: payment.order_id || order.id,
    receiptUrl: payment.receipt_url,
    amount: Number(payment.amount_money?.amount ?? checkout.amount),
    currency: payment.amount_money?.currency || checkout.currency,
  };
}

function getPublicConfig() {
  return { applicationId, locationId, environment, currency: 'USD' };
}

console.log(`[Square] Configured for ${environment} at location ${locationId}`);

module.exports = {
  SquareApiError,
  createCheckoutRequest,
  createPaymentRequest,
  fetchMenuItems,
  getPublicConfig,
  validateBillingContact,
  validateCart,
};
