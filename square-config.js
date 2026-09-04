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
  constructor(message, status = 500, details = []) {
    super(message);
    this.name = 'SquareApiError';
    this.status = status;
    this.details = details;
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

      const localImagePath = `images/menu/${slugify(data.name)}.jpg`;
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

async function verifySquareConnection() {
  const payload = await squareRequest('/locations');
  const locations = (payload.locations || []).map((location) => ({
    id: location.id,
    name: location.name || '',
    status: location.status || '',
  }));
  const configuredLocation = locations.find((location) => location.id === locationId);
  console.log(`[Square] Connection verified: ${locations.length} location(s), configured location found: ${Boolean(configuredLocation)}`);
  return {
    connected: true,
    locationFound: Boolean(configuredLocation),
    locationName: configuredLocation?.name || '',
    locationStatus: configuredLocation?.status || '',
  };
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
    return `${quantity}x ${variation.itemName}${variation.name === 'Regular' ? '' : ` (${variation.name})`}`;
  });

  return { amount, currency: currency || 'USD', lines };
}

/** Revalidates catalog pricing and creates a Square Payments API request. */
async function createPaymentRequest(request = {}) {
  const { sourceId, idempotencyKey, cart } = request || {};
  if (!sourceId || !idempotencyKey || !/^[a-zA-Z0-9_-]{1,192}$/.test(idempotencyKey)) {
    throw new SquareApiError('A payment token and valid idempotency key are required.', 400);
  }

  // Deliberately fetch fresh prices at checkout; never trust browser totals.
  const menu = await fetchMenuItems();
  const { amount, currency, lines } = validateCart(cart, menu);
  const payload = await squareRequest('/payments', {
    method: 'POST',
    body: JSON.stringify({
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: { amount, currency },
      location_id: locationId,
      autocomplete: true,
      note: `Website order: ${lines.join(', ')}`.slice(0, 500),
    }),
  });

  const payment = payload.payment || {};
  return {
    id: payment.id,
    status: payment.status,
    orderId: payment.order_id,
    receiptUrl: payment.receipt_url,
    amount: Number(payment.amount_money?.amount ?? amount),
    currency: payment.amount_money?.currency || currency,
  };
}

function getPublicConfig() {
  return { applicationId, locationId, environment, currency: 'USD' };
}

console.log(`[Square] Configured for ${environment} at location ${locationId}`);

module.exports = {
  SquareApiError,
  createPaymentRequest,
  fetchMenuItems,
  getPublicConfig,
  verifySquareConnection,
};
