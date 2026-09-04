(function createShoppingCart(global) {
  'use strict';

  const STORAGE_KEY = 'mariachi-fiesta-cart-v1';
  const MAX_QUANTITY = 25;
  const listeners = new Set();

  function readCart() {
    try {
      const stored = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(stored) ? stored.filter(isValidItem) : [];
    } catch {
      return [];
    }
  }

  function isValidItem(item) {
    return (
      item &&
      typeof item.variationId === 'string' &&
      typeof item.name === 'string' &&
      Number.isSafeInteger(item.price) &&
      item.price >= 0 &&
      typeof item.currency === 'string' &&
      /^[A-Z]{3}$/.test(item.currency) &&
      Number.isInteger(item.quantity) &&
      item.quantity >= 1 &&
      item.quantity <= MAX_QUANTITY
    );
  }

  let items = readCart();

  function commit() {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    const snapshot = getItems();
    listeners.forEach((listener) => listener(snapshot));
    global.dispatchEvent(new CustomEvent('cart:change', { detail: snapshot }));
  }

  function getItems() {
    return items.map((item) => ({ ...item }));
  }

  function addItem(item) {
    const normalized = { ...item, quantity: Math.min(MAX_QUANTITY, Math.max(1, Number(item.quantity) || 1)) };
    if (!isValidItem(normalized)) throw new TypeError('Cannot add an invalid item to the cart.');
    const existing = items.find((entry) => entry.variationId === normalized.variationId);
    if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + normalized.quantity);
    else items.push(normalized);
    commit();
  }

  function removeItem(variationId) {
    items = items.filter((item) => item.variationId !== variationId);
    commit();
  }

  function updateQuantity(variationId, quantity) {
    const nextQuantity = Number(quantity);
    if (!Number.isInteger(nextQuantity)) return;
    if (nextQuantity <= 0) return removeItem(variationId);
    const item = items.find((entry) => entry.variationId === variationId);
    if (!item) return;
    item.quantity = Math.min(MAX_QUANTITY, nextQuantity);
    commit();
  }

  function calculateTotal() {
    return items.reduce((total, item) => total + item.price * item.quantity, 0);
  }

  function syncWithCatalog(catalogItems) {
    const available = new Map(
      (Array.isArray(catalogItems) ? catalogItems : [])
        .filter(isValidItem)
        .map((item) => [item.variationId, item])
    );
    const previousLength = items.length;
    const nextItems = items
      .filter((item) => available.has(item.variationId))
      .map((item) => ({ ...available.get(item.variationId), quantity: item.quantity }));
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

  global.shoppingCart = { addItem, removeItem, updateQuantity, calculateTotal, syncWithCatalog, getItems, clear, subscribe };
})(window);
