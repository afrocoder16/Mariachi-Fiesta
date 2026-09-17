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
const MARSHALL_TIME_ZONE = 'America/Chicago';
const BUSINESS_HOURS_CACHE_MS = 5 * 60_000;
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_CODES = Object.freeze({ Sun: 'SUN', Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI', Sat: 'SAT' });
const PICKUP_PREP_MINUTES = environmentInteger('PICKUP_PREP_MINUTES', 20, 5, 240);
const PICKUP_SLOT_INTERVAL_MINUTES = 15;
const PICKUP_SCHEDULE_DAYS = 7;
const DINE_IN_NOTE_PREFIX = 'DINE-IN — Customer will eat here';
let businessScheduleCache = null;

const missing = [
  ['SQUARE_APPLICATION_ID', applicationId],
  ['SQUARE_ACCESS_TOKEN', accessToken],
  ['SQUARE_LOCATION_ID', locationId],
].filter(([, value]) => !value);

if (missing.length) {
  throw new Error(`Missing Square configuration: ${missing.map(([name]) => name).join(', ')}`);
}

function environmentInteger(name, fallback, minimum, maximum) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
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

function parseBusinessTime(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function normalizeBusinessSchedule(location) {
  if (!location || location.id !== locationId || location.status !== 'ACTIVE') {
    throw new SquareApiError('The Square location is not available for online ordering.', 503);
  }
  if (location.timezone !== MARSHALL_TIME_ZONE) {
    throw new SquareApiError('The Square location timezone is not configured for Marshall, Minnesota.', 503);
  }

  const periods = Array.isArray(location.business_hours?.periods)
    ? location.business_hours.periods.map((period) => ({
      dayOfWeek: String(period?.day_of_week || ''),
      startLocalTime: String(period?.start_local_time || ''),
      endLocalTime: String(period?.end_local_time || ''),
      startSeconds: parseBusinessTime(period?.start_local_time),
      endSeconds: parseBusinessTime(period?.end_local_time),
    }))
    : [];
  if (!periods.length || periods.some((period) => (
    !DAY_CODES.includes(period.dayOfWeek) || period.startSeconds === null ||
    period.endSeconds === null || period.startSeconds === period.endSeconds
  ))) {
    throw new SquareApiError('Business hours are not configured in Square. Online ordering is unavailable.', 503);
  }

  return {
    timeZone: location.timezone,
    periods,
  };
}

async function getBusinessSchedule() {
  const now = Date.now();
  if (businessScheduleCache && now < businessScheduleCache.expiresAt) return businessScheduleCache.schedule;
  const payload = await squareRequest(`/locations/${encodeURIComponent(locationId)}`);
  const schedule = normalizeBusinessSchedule(payload.location);
  businessScheduleCache = { schedule, expiresAt: now + BUSINESS_HOURS_CACHE_MS };
  return schedule;
}

function clearBusinessScheduleCache() {
  businessScheduleCache = null;
}

function localTimeParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    dayOfWeek: WEEKDAY_CODES[values.weekday],
    seconds: Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second),
  };
}

function isOpenAt(instant, schedule) {
  const local = localTimeParts(instant, schedule.timeZone);
  const dayIndex = DAY_CODES.indexOf(local.dayOfWeek);
  if (dayIndex < 0) return false;
  const previousDay = DAY_CODES[(dayIndex + DAY_CODES.length - 1) % DAY_CODES.length];

  return schedule.periods.some((period) => {
    if (period.dayOfWeek === local.dayOfWeek) {
      if (period.endSeconds > period.startSeconds) {
        return local.seconds >= period.startSeconds && local.seconds < period.endSeconds;
      }
      return local.seconds >= period.startSeconds;
    }
    return period.dayOfWeek === previousDay && period.endSeconds < period.startSeconds && local.seconds < period.endSeconds;
  });
}

function findNextOpenAt(instant, schedule) {
  const minute = 60_000;
  let candidate = Math.floor(instant.getTime() / minute) * minute + minute;
  const limit = candidate + 8 * 24 * 60 * minute;
  for (; candidate <= limit; candidate += minute) {
    const date = new Date(candidate);
    if (isOpenAt(date, schedule)) return date.toISOString();
  }
  return null;
}

function formatOpeningTime(value, timeZone) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function formatPickupSlot(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

function buildPickupSlots(instant, schedule) {
  const intervalMs = PICKUP_SLOT_INTERVAL_MINUTES * 60_000;
  const earliest = instant.getTime() + PICKUP_PREP_MINUTES * 60_000;
  const firstSlot = Math.ceil(earliest / intervalMs) * intervalMs;
  const lastSlot = instant.getTime() + PICKUP_SCHEDULE_DAYS * 24 * 60 * 60_000;
  const slots = [];
  for (let value = firstSlot; value <= lastSlot; value += intervalMs) {
    const slot = new Date(value);
    if (isOpenAt(slot, schedule)) {
      slots.push({ pickupAt: slot.toISOString(), label: formatPickupSlot(slot, schedule.timeZone) });
    }
  }
  return slots;
}

async function getOrderingAvailability(instant = new Date()) {
  const now = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(now.getTime())) throw new TypeError('A valid availability time is required.');
  const schedule = await getBusinessSchedule();
  const isOpen = isOpenAt(now, schedule);
  const nextOpenAt = isOpen ? null : findNextOpenAt(now, schedule);
  const nextOpening = formatOpeningTime(nextOpenAt, schedule.timeZone);
  const pickupSlots = isOpen ? buildPickupSlots(now, schedule) : [];
  const asapReadyAt = new Date(now.getTime() + PICKUP_PREP_MINUTES * 60_000);
  const asapAvailable = isOpen && isOpenAt(asapReadyAt, schedule);
  return {
    isOpen,
    timeZone: schedule.timeZone,
    checkedAt: now.toISOString(),
    nextOpenAt,
    message: isOpen
      ? 'Online ordering is open now.'
      : `Online ordering is currently closed.${nextOpening ? ` Ordering reopens ${nextOpening}.` : ''}`,
    periods: schedule.periods.map((period) => ({
      dayOfWeek: period.dayOfWeek,
      startLocalTime: period.startLocalTime,
      endLocalTime: period.endLocalTime,
    })),
    pickup: {
      prepMinutes: PICKUP_PREP_MINUTES,
      asapAvailable,
      asapReadyAt: asapAvailable ? asapReadyAt.toISOString() : null,
      slotIntervalMinutes: PICKUP_SLOT_INTERVAL_MINUTES,
      scheduleDays: PICKUP_SCHEDULE_DAYS,
      slots: pickupSlots,
    },
  };
}

async function assertOrderingOpen(instant = new Date()) {
  const availability = await getOrderingAvailability(instant);
  if (!availability.isOpen) {
    throw new SquareApiError(availability.message, 409, [], 'ORDERING_CLOSED', { availability });
  }
  return availability;
}

function validatePickupSelection(request, availability) {
  const fulfillmentType = String(request?.fulfillmentType || '').toUpperCase();
  if (!['PICKUP', 'DINE_IN'].includes(fulfillmentType)) {
    throw new SquareApiError(
      'Choose whether you will pick up your order or eat at the restaurant.',
      400,
      [],
      'INVALID_FULFILLMENT_TYPE',
      { availability }
    );
  }

  const pickupType = String(request?.pickupType || 'ASAP').toUpperCase();
  if (pickupType === 'ASAP') {
    if (!availability.pickup.asapAvailable) {
      throw new SquareApiError(
        'ASAP ordering is no longer available before closing. Choose a later time.',
        409,
        [],
        'INVALID_PICKUP_TIME',
        { availability }
      );
    }
    return { fulfillmentType, scheduleType: 'ASAP', pickupAt: null, prepMinutes: PICKUP_PREP_MINUTES };
  }
  if (pickupType !== 'SCHEDULED' || typeof request?.pickupAt !== 'string') {
    throw new SquareApiError('Choose ASAP or an available later time.', 400, [], 'INVALID_PICKUP_TIME', { availability });
  }

  const requestedTime = new Date(request.pickupAt);
  const matchingSlot = availability.pickup.slots.find((slot) => (
    !Number.isNaN(requestedTime.getTime()) && new Date(slot.pickupAt).getTime() === requestedTime.getTime()
  ));
  if (!matchingSlot) {
    throw new SquareApiError('That ready time is no longer available. Choose another time.', 409, [], 'INVALID_PICKUP_TIME', { availability });
  }
  return { fulfillmentType, scheduleType: 'SCHEDULED', pickupAt: matchingSlot.pickupAt, prepMinutes: PICKUP_PREP_MINUTES };
}

function buildFulfillmentNote(customerNote, fulfillmentType) {
  if (fulfillmentType !== 'DINE_IN') {
    return customerNote || 'Pickup order placed on the Mariachi Fiesta website.';
  }

  const note = customerNote ? `${DINE_IN_NOTE_PREFIX}\n${customerNote}` : DINE_IN_NOTE_PREFIX;
  if (note.length > 500) {
    const maximumCustomerNoteLength = 500 - DINE_IN_NOTE_PREFIX.length - 1;
    throw new SquareApiError(
      `Dine-in order notes must be ${maximumCustomerNoteLength} characters or fewer.`,
      400,
      [],
      'INVALID_CUSTOMER_NOTE'
    );
  }
  return note;
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
    throw new SquareApiError('Order notes must be plain text.', 400);
  }
  const note = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (note.length > 500) {
    throw new SquareApiError('Order notes must be 500 characters or fewer.', 400);
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

function checkoutSummary(order, lines, pickup) {
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
    pickup,
  };
}

async function prepareSquareOrderRequest(request = {}, instant = new Date()) {
  const { orderIdempotencyKey, idempotencyKey, cart, billingContact, customerNote, expectedAmount, expectedCurrency } = request || {};
  const checkoutKey = validateIdempotencyKey(orderIdempotencyKey || idempotencyKey);
  const contact = validateBillingContact(billingContact);
  const pickupNote = validateCustomerNote(customerNote);
  const expected = validateExpectedTotal(expectedAmount, expectedCurrency);
  const availability = await assertOrderingOpen(instant);
  const pickup = validatePickupSelection(request, availability);
  const fulfillmentNote = buildFulfillmentNote(pickupNote, pickup.fulfillmentType);

  // Confirm availability, then let Square calculate the authoritative order total.
  const menu = await fetchMenuItems();
  const { lines } = validateCart(cart, menu);
  const order = {
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
          schedule_type: pickup.scheduleType,
          prep_time_duration: `PT${pickup.prepMinutes}M`,
          ...(pickup.pickupAt ? { pickup_at: pickup.pickupAt } : {}),
          recipient: {
            display_name: contact.displayName,
            email_address: contact.email,
            phone_number: contact.phone,
          },
          note: fulfillmentNote,
        },
      },
    ],
  };
  return { checkoutKey, contact, expected, lines, order, availability, pickup };
}

function verifySquareOrder(order, lines, expected, requireId, pickup) {
  if (!order || (requireId && !order.id) || order.location_id !== locationId) {
    throw new SquareApiError('Square did not return a valid order.', 502);
  }

  const checkout = checkoutSummary(order, lines, pickup);
  if (checkout.amount !== expected.amount || checkout.currency !== expected.currency) {
    throw new SquareApiError(
      'The order total changed. Review and confirm the updated total before paying.',
      409,
      [],
      'PRICE_CHANGED',
      { checkout }
    );
  }
  return checkout;
}

async function calculateSquareOrder(request = {}, instant = new Date()) {
  const prepared = await prepareSquareOrderRequest(request, instant);
  const payload = await squareRequest('/orders/calculate', {
    method: 'POST',
    body: JSON.stringify({ order: prepared.order }),
  });
  return verifySquareOrder(payload.order, prepared.lines, prepared.expected, false, prepared.pickup);
}

async function createSquareOrder(request = {}, instant = new Date()) {
  const prepared = await prepareSquareOrderRequest(request, instant);
  const payload = await squareRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: squareIdempotencyKey(prepared.checkoutKey, '-order'),
      order: prepared.order,
    }),
  });
  const checkout = verifySquareOrder(payload.order, prepared.lines, prepared.expected, true, prepared.pickup);
  return { ...prepared, order: payload.order, checkout };
}

async function cancelUnpaidOrder(order, checkoutKey) {
  if (!order?.id || !Number.isInteger(order.version)) return;
  let currentOrder = order;
  const openFulfillments = (currentOrder.fulfillments || [])
    .filter((fulfillment) => fulfillment?.uid && !['CANCELED', 'COMPLETED', 'FAILED'].includes(fulfillment.state))
    .map((fulfillment) => ({ uid: fulfillment.uid, state: 'CANCELED' }));

  if (openFulfillments.length) {
    const fulfillmentPayload = await squareRequest(`/orders/${encodeURIComponent(order.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        idempotency_key: squareIdempotencyKey(checkoutKey, '-cancel-fulfillment'),
        order: {
          location_id: locationId,
          version: currentOrder.version,
          fulfillments: openFulfillments,
        },
      }),
    });
    currentOrder = fulfillmentPayload.order || currentOrder;
  }

  await squareRequest(`/orders/${encodeURIComponent(order.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      idempotency_key: squareIdempotencyKey(checkoutKey, '-cancel-order'),
      order: {
        location_id: locationId,
        version: currentOrder.version,
        state: 'CANCELED',
      },
    }),
  });
}

/** Calculates a checkout quote without creating a persistent Square order. */
async function createCheckoutRequest(request = {}, instant = new Date()) {
  return calculateSquareOrder(request, instant);
}

/** Revalidates the checkout, creates the Square order, and links its payment. */
async function createPaymentRequest(request = {}, instant = new Date()) {
  const { sourceId, paymentIdempotencyKey, tipAmount } = request || {};
  if (typeof sourceId !== 'string' || !/^cnon:[a-zA-Z0-9_-]{8,495}$/.test(sourceId)) {
    throw new SquareApiError('A valid payment token is required.', 400);
  }
  const paymentKey = validateIdempotencyKey(paymentIdempotencyKey);
  // Reject malformed tip attempts before creating any persistent Square data.
  validateTipAmount(tipAmount, validateExpectedTotal(request.expectedAmount, request.expectedCurrency));

  const { checkoutKey, contact, order, checkout } = await createSquareOrder(request, instant);
  const validatedTip = validateTipAmount(tipAmount, checkout);
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
        buyer_email_address: contact.email,
        autocomplete: true,
        note: `Website pickup for ${contact.displayName}`.slice(0, 500),
      }),
    });
  } catch (error) {
    if (error instanceof SquareApiError && error.status >= 400 && error.status < 500) {
      error.code = error.code || 'PAYMENT_RETRY_ALLOWED';
      try {
        await cancelUnpaidOrder(order, checkoutKey);
      } catch (cleanupError) {
        console.error(`[Square] Could not cancel unpaid order ${order.id}:`, cleanupError.message);
      }
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
    customerId: payment.customer_id || null,
    pickup: checkout.pickup,
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
  clearBusinessScheduleCache,
  fetchMenuItems,
  getOrderingAvailability,
  getPublicConfig,
  isOpenAt,
  validatePickupSelection,
  validateBillingContact,
  validateCart,
  validateCustomerNote,
  validateTipAmount,
};
