(function createShoppingCart(global) {
  'use strict';

  const STORAGE_KEY = 'mariachi-fiesta-cart-v2';
  const MAX_QUANTITY = 25;
  const listeners = new Set();

  function readCart() {
    try {
      const stored = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(stored) ? stored.map(normalizeItem).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function createCartLineId(variationId, modifiers = []) {
    const modifierKey = modifiers
      .map((modifier) => `${modifier.modifierId}:${modifier.quantity}`)
      .sort()
      .join(',');
    return modifierKey ? `${variationId}:${modifierKey}` : variationId;
  }

  function normalizeItem(item) {
    if (!item || typeof item.variationId !== 'string' || typeof item.name !== 'string' ||
      !Number.isSafeInteger(item.price) || item.price < 0 || typeof item.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(item.currency) || !Number.isInteger(item.quantity) ||
      item.quantity < 1 || item.quantity > MAX_QUANTITY) return null;

    const seen = new Set();
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map((modifier) => {
      if (!modifier || typeof modifier.modifierId !== 'string' || !modifier.modifierId || seen.has(modifier.modifierId) ||
        typeof modifier.name !== 'string' || typeof modifier.listName !== 'string' ||
        !Number.isSafeInteger(modifier.price) || modifier.price < 0 || modifier.currency !== item.currency ||
        !Number.isInteger(modifier.quantity) || modifier.quantity < 1 || modifier.quantity > MAX_QUANTITY) return null;
      seen.add(modifier.modifierId);
      return {
        modifierId: modifier.modifierId,
        listId: String(modifier.listId || ''),
        listName: modifier.listName,
        name: modifier.name,
        price: modifier.price,
        currency: modifier.currency,
        quantity: modifier.quantity,
      };
    });
    if (modifiers.some((modifier) => !modifier)) return null;

    return {
      variationId: item.variationId,
      cartLineId: createCartLineId(item.variationId, modifiers),
      name: item.name,
      variationName: String(item.variationName || ''),
      price: item.price,
      currency: item.currency,
      modifiers,
      quantity: item.quantity,
    };
  }

  function unitPrice(item) {
    return item.price + item.modifiers.reduce((total, modifier) => total + modifier.price * modifier.quantity, 0);
  }

  let items = readCart();

  function commit() {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    const snapshot = getItems();
    listeners.forEach((listener) => listener(snapshot));
    global.dispatchEvent(new CustomEvent('cart:change', { detail: snapshot }));
  }

  function getItems() {
    return items.map((item) => ({
      ...item,
      modifiers: item.modifiers.map((modifier) => ({ ...modifier })),
    }));
  }

  function addItem(item) {
    const normalized = normalizeItem({ ...item, quantity: Math.min(MAX_QUANTITY, Math.max(1, Number(item.quantity) || 1)) });
    if (!normalized) throw new TypeError('Cannot add an invalid item to the cart.');
    const existing = items.find((entry) => entry.cartLineId === normalized.cartLineId);
    if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + normalized.quantity);
    else items.push(normalized);
    commit();
  }

  function removeItem(cartLineId) {
    items = items.filter((item) => item.cartLineId !== cartLineId);
    commit();
  }

  function updateQuantity(cartLineId, quantity) {
    const nextQuantity = Number(quantity);
    if (!Number.isInteger(nextQuantity)) return;
    if (nextQuantity <= 0) return removeItem(cartLineId);
    const item = items.find((entry) => entry.cartLineId === cartLineId);
    if (!item) return;
    item.quantity = Math.min(MAX_QUANTITY, nextQuantity);
    commit();
  }

  function calculateTotal() {
    return items.reduce((total, item) => total + unitPrice(item) * item.quantity, 0);
  }

  function syncWithCatalog(catalogItems) {
    const available = new Map(
      (Array.isArray(catalogItems) ? catalogItems : [])
        .map(normalizeItem)
        .filter(Boolean)
        .map((item) => [item.cartLineId, item])
    );
    const previousLength = items.length;
    const nextItems = items
      .filter((item) => available.has(item.cartLineId))
      .map((item) => ({ ...available.get(item.cartLineId), quantity: item.quantity }));
    const changed = JSON.stringify(nextItems) !== JSON.stringify(items);
    items = nextItems;
    if (changed) commit();
    return previousLength - items.length;
  }

  function clear() {
    items = [];
    commit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getItems());
    return () => listeners.delete(listener);
  }

  global.shoppingCart = { addItem, removeItem, updateQuantity, calculateTotal, syncWithCatalog, getItems, clear, subscribe, createCartLineId, unitPrice };
})(window);
