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
    const query = new URLSearchParams({ types: 'ITEM,CATEGORY,IMAGE,MODIFIER_LIST' });
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
  const modifierLists = new Map(
    objects
      .filter((object) => object.type === 'MODIFIER_LIST' && !object.is_deleted)
      .map((object) => [object.id, object])
  );

  function effectiveLimit(itemValue, listValue, fallback) {
    if (Number.isInteger(itemValue) && itemValue >= 0) return itemValue;
    if (Number.isInteger(listValue) && listValue >= 0) return listValue;
    return fallback;
  }

  function normalizeModifierLists(itemData) {
    return (itemData.modifier_list_info || [])
      .filter((info) => info.enabled !== false)
      .map((info) => {
        const list = modifierLists.get(info.modifier_list_id);
        const data = list?.modifier_list_data || {};
        if (!list || data.modifier_type === 'TEXT') return null;

        const overrides = new Map((info.modifier_overrides || []).map((override) => [override.modifier_id, override]));
        const hiddenFromCustomer = info.hidden_from_customer === true || info.hidden_from_customer_override === 'YES' ||
          (info.hidden_from_customer_override !== 'NO' && data.hidden_from_customer === true);
        const allowQuantities = info.allow_quantities === 'YES' ||
          (info.allow_quantities !== 'NO' && data.allow_quantities === true);
        const modifiers = (data.modifiers || [])
          .filter((modifier) => modifier && !modifier.is_deleted)
          .map((modifier) => {
            const modifierData = modifier.modifier_data || {};
            const override = overrides.get(modifier.id) || {};
            const locationOverride = (modifierData.location_overrides || []).find((entry) => entry.location_id === locationId);
            const hiddenOnline = override.hidden_online_override === 'YES' ||
              (override.hidden_online_override !== 'NO' && modifierData.hidden_online === true);
            if (hiddenOnline || locationOverride?.sold_out === true) return null;

            const money = locationOverride?.price_money || modifierData.price_money || { amount: 0, currency: 'USD' };
            if (!Number.isSafeInteger(Number(money.amount))) return null;
            const onByDefault = override.on_by_default_override === 'YES' ||
              (override.on_by_default_override !== 'NO' && (override.on_by_default ?? modifierData.on_by_default) === true);
            return {
              id: modifier.id,
              name: modifierData.name || 'Option',
              price: Number(money.amount),
              currency: money.currency || 'USD',
              onByDefault,
            };
          })
          .filter(Boolean);

        if (!modifiers.length) return null;
        return {
          id: list.id,
          name: data.name || 'Choose an option',
          minSelected: effectiveLimit(info.min_selected_modifiers, data.min_selected_modifiers, 0),
          maxSelected: effectiveLimit(info.max_selected_modifiers, data.max_selected_modifiers, 0),
          allowQuantities,
          hiddenFromCustomer,
          modifiers,
        };
      })
      .filter(Boolean);
  }

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
        modifierLists: normalizeModifierLists(data),
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

function cartLineId(variationId, modifiers = []) {
  const modifierKey = modifiers
    .map((modifier) => `${modifier.modifierId}:${modifier.quantity}`)
    .sort()
    .join(',');
  return modifierKey ? `${variationId}:${modifierKey}` : variationId;
}

function validateCart(cart, menu) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > 50) {
    throw new SquareApiError('The cart must contain between 1 and 50 items.', 400);
  }

  const catalogVariations = new Map();
  menu.forEach((group) =>
    group.items.forEach((item) =>
      item.variations.forEach((variation) =>
        catalogVariations.set(variation.id, {
          ...variation,
          itemName: item.name,
          modifierLists: item.modifierLists || [],
        })
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
    const requestedModifiers = Array.isArray(line.modifiers) ? line.modifiers : [];
    if (requestedModifiers.length > 50) {
      throw new SquareApiError('The cart contains too many modifier selections.', 400);
    }

    const availableModifierIds = new Set();
    const selectedModifiers = [];
    const requestedById = new Map();
    requestedModifiers.forEach((selection) => {
      const modifierId = String(selection?.modifierId || '');
      const modifierQuantity = Number(selection?.quantity ?? 1);
      if (!modifierId || requestedById.has(modifierId) || !Number.isInteger(modifierQuantity) || modifierQuantity < 1 || modifierQuantity > 25) {
        throw new SquareApiError('The cart contains an invalid modifier selection.', 400);
      }
      requestedById.set(modifierId, modifierQuantity);
    });

    variation.modifierLists.forEach((list) => {
      const selectionsForList = [];
      list.modifiers.forEach((modifier) => {
        availableModifierIds.add(modifier.id);
        const modifierQuantity = requestedById.get(modifier.id);
        if (!modifierQuantity) return;
        if (!list.allowQuantities && modifierQuantity !== 1) {
          throw new SquareApiError(`Choose valid options for ${list.name}.`, 400);
        }
        selectionsForList.push({
          modifierId: modifier.id,
          listId: list.id,
          listName: list.name,
          name: modifier.name,
          quantity: modifierQuantity,
          price: modifier.price,
          currency: modifier.currency,
        });
      });

      const selectionCount = selectionsForList.reduce((count, modifier) => count + modifier.quantity, 0);
      if (selectionCount < list.minSelected || (list.maxSelected > 0 && selectionCount > list.maxSelected)) {
        throw new SquareApiError(`Choose ${list.minSelected === list.maxSelected ? list.minSelected : `${list.minSelected}–${list.maxSelected || 'more'}`} option(s) for ${list.name}.`, 400);
      }
      selectedModifiers.push(...selectionsForList);
    });

    if ([...requestedById.keys()].some((modifierId) => !availableModifierIds.has(modifierId))) {
      throw new SquareApiError('The cart contains an unavailable modifier.', 400);
    }
    if (selectedModifiers.some((modifier) => modifier.currency !== variation.currency)) {
      throw new SquareApiError('Item and modifier currencies must match.', 400);
    }

    const modifierAmount = selectedModifiers.reduce((total, modifier) => total + modifier.price * modifier.quantity, 0);
    amount += (variation.price + modifierAmount) * quantity;
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
      modifiers: selectedModifiers,
      cartLineId: cartLineId(variation.id, selectedModifiers),
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

function squareIdempotencyKey(value, suffix) {
  return `${value.slice(0, 45 - suffix.length)}${suffix}`;
}

function validateBillingContact(contact = {}) {
  const givenName = String(contact.givenName || '').trim().replace(/\s+/g, ' ');
  const familyName = String(contact.familyName || '').trim().replace(/\s+/g, ' ');
  const email = String(contact.email || '').trim().toLowerCase();
  const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
  const phone = phoneDigits.length === 10 ? `+1${phoneDigits}` : phoneDigits.length === 11 && phoneDigits.startsWith('1') ? `+${phoneDigits}` : '';
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
  if (!phone) {
    throw new SquareApiError('Enter a valid 10-digit US phone number.', 400);
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
    phone,
    addressLines: [address],
    city,
    state,
    countryCode: 'US',
    postalCode,
  };
}

function validateCustomerNote(value) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new SquareApiError('Pickup notes must be plain text.', 400);
  }
  const note = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (note.length > 500) {
    throw new SquareApiError('Pickup notes must be 500 characters or fewer.', 400);
  }
  return note;
}

function smartTipOptions(amount, currency) {
  const values = amount < 1_000
    ? [0, 100, 200, 300]
    : [0, 15, 20, 25].map((percent) => Math.round((amount * percent) / 100));
  const labels = amount < 1_000 ? ['No tip', '$1', '$2', '$3'] : ['No tip', '15%', '20%', '25%'];
  return values.map((tipAmount, index) => ({
    amount: tipAmount,
    currency,
    label: labels[index],
    isDefault: index === 1,
  }));
}

function validateTipAmount(value, checkout) {
  const amount = Number(value);
  const options = smartTipOptions(checkout.amount, checkout.currency);
  if (!Number.isSafeInteger(amount) || !options.some((option) => option.amount === amount)) {
    throw new SquareApiError('Select one of the available tip options.', 400);
  }
  return amount;
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
    taxIncluded: (order.taxes || []).some((tax) => tax.type === 'INCLUSIVE'),
    tipOptions: smartTipOptions(amount, currency),
    items: lines,
  };
}

async function searchCustomers(filter) {
  const payload = await squareRequest('/customers/search', {
    method: 'POST',
    body: JSON.stringify({ query: { filter }, limit: 10 }),
  });
  return payload.customers || [];
}

async function createOrReuseCustomer(contact, checkoutKey) {
  const [emailMatches, phoneMatches] = await Promise.all([
    searchCustomers({ email_address: { exact: contact.email } }),
    searchCustomers({ phone_number: { exact: contact.phone } }),
  ]);
  const phoneIds = new Set(phoneMatches.map((customer) => customer.id));
  const matchingBoth = emailMatches.find((customer) => phoneIds.has(customer.id));
  const customerFields = {
    given_name: contact.givenName,
    family_name: contact.familyName,
    email_address: contact.email,
    phone_number: contact.phone,
  };
  // Checkout contact fields are not authenticated account changes. Reuse a
  // profile only when both exact identifiers match, and never overwrite an
  // existing Square customer's details from this public form.
  if (matchingBoth) return matchingBoth;

  const payload = await squareRequest('/customers', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: squareIdempotencyKey(checkoutKey, '-customer'),
      ...customerFields,
    }),
  });
  if (!payload.customer?.id) throw new SquareApiError('Square did not return a valid customer profile.', 502);
  return payload.customer;
}

async function createSquareOrder(request = {}) {
  const { orderIdempotencyKey, idempotencyKey, cart, billingContact, customerNote, expectedAmount, expectedCurrency } = request || {};
  const checkoutKey = validateIdempotencyKey(orderIdempotencyKey || idempotencyKey);
  const contact = validateBillingContact(billingContact);
  const pickupNote = validateCustomerNote(customerNote);
  const expected = validateExpectedTotal(expectedAmount, expectedCurrency);

  // Confirm availability, then let Square calculate the authoritative order total.
  const menu = await fetchMenuItems();
  const { lines } = validateCart(cart, menu);
  const orderPayload = await squareRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: squareIdempotencyKey(checkoutKey, '-order'),
      order: {
        location_id: locationId,
        reference_id: checkoutKey.slice(0, 40),
        source: { name: 'Mariachi Fiesta Website' },
        line_items: lines.map((line) => ({
          catalog_object_id: line.variationId,
          quantity: String(line.quantity),
          ...(line.modifiers.length ? {
            modifiers: line.modifiers.map((modifier) => ({
              catalog_object_id: modifier.modifierId,
              quantity: String(modifier.quantity),
            })),
          } : {}),
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
                phone_number: contact.phone,
              },
              note: pickupNote || 'Pickup order placed on the Mariachi Fiesta website.',
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
  const { sourceId, paymentIdempotencyKey, tipAmount } = request || {};
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 500) {
    throw new SquareApiError('A valid payment token is required.', 400);
  }
  const paymentKey = validateIdempotencyKey(paymentIdempotencyKey);

  const { checkoutKey, contact, order, checkout } = await createSquareOrder(request);
  const validatedTip = validateTipAmount(tipAmount, checkout);
  const customer = await createOrReuseCustomer(contact, checkoutKey);
  let payload;
  try {
    payload = await squareRequest('/payments', {
      method: 'POST',
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: squareIdempotencyKey(paymentKey, '-payment'),
        amount_money: { amount: checkout.amount, currency: checkout.currency },
        ...(validatedTip ? { tip_money: { amount: validatedTip, currency: checkout.currency } } : {}),
        location_id: locationId,
        order_id: order.id,
        customer_id: customer.id,
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
  const paymentAmount = Number(payment.amount_money?.amount);
  const paymentTip = Number(payment.tip_money?.amount || 0);
  const paymentTotal = Number(payment.total_money?.amount);
  const expectedPaymentTotal = checkout.amount + validatedTip;
  if (
    !payment.id ||
    payment.status !== 'COMPLETED' ||
    payment.order_id !== order.id ||
    payment.location_id !== locationId ||
    payment.amount_money?.currency !== checkout.currency ||
    paymentAmount !== checkout.amount ||
    paymentTip !== validatedTip ||
    paymentTotal !== expectedPaymentTotal
  ) {
    throw new SquareApiError('Square did not return a completed payment with the expected total.', 502);
  }
  return {
    id: payment.id,
    status: payment.status,
    orderId: payment.order_id || order.id,
    receiptUrl: payment.receipt_url,
    amount: paymentTotal,
    orderAmount: paymentAmount,
    tipAmount: paymentTip,
    currency: payment.amount_money?.currency || checkout.currency,
    customerId: payment.customer_id || customer.id,
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
  validateCustomerNote,
  validateTipAmount,
};
