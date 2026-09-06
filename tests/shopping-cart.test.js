const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCart(initialValue = null) {
  const storage = {};
  if (initialValue !== null) storage['mariachi-fiesta-cart-v2'] = initialValue;
  const window = {
    localStorage: {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => {
        storage[key] = value;
      },
    },
    dispatchEvent() {},
  };
  const context = {
    window,
    CustomEvent: function CustomEvent(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'shopping-cart.js'), 'utf8');
  vm.runInNewContext(source, context);
  return { cart: window.shoppingCart, storage };
}

function snapshot(cart) {
  return JSON.parse(JSON.stringify(cart.getItems()));
}

const taco = {
  variationId: 'variation-taco',
  name: 'Taco',
  variationName: 'Regular',
  price: 250,
  currency: 'USD',
  modifiers: [],
  quantity: 1,
};

test('adds, merges, updates, removes, and persists cart items', () => {
  const { cart, storage } = loadCart();
  cart.addItem(taco);
  cart.addItem({ ...taco, quantity: 2 });
  assert.equal(cart.getItems()[0].quantity, 3);
  assert.equal(cart.calculateTotal(), 750);

  cart.updateQuantity(taco.variationId, 4);
  assert.equal(cart.calculateTotal(), 1000);
  assert.equal(JSON.parse(storage['mariachi-fiesta-cart-v2'])[0].quantity, 4);

  cart.removeItem(taco.variationId);
  assert.deepEqual(snapshot(cart), []);
});

test('caps quantities and rejects malformed items', () => {
  const { cart } = loadCart();
  cart.addItem({ ...taco, quantity: 100 });
  assert.equal(cart.getItems()[0].quantity, 25);
  assert.throws(() => cart.addItem({ ...taco, currency: 'invalid' }), /invalid item/);
});

test('drops corrupt persisted data', () => {
  assert.deepEqual(snapshot(loadCart('{not-json').cart), []);
  assert.deepEqual(snapshot(loadCart(JSON.stringify([{ name: '<script>' }])).cart), []);
});

test('reconciles saved items with authoritative catalog data', () => {
  const { cart } = loadCart();
  cart.addItem(taco);
  cart.addItem({ ...taco, variationId: 'removed-item', name: 'Old item' });

  const removed = cart.syncWithCatalog([{ ...taco, name: 'Taco updated', price: 275 }]);
  assert.equal(removed, 1);
  assert.deepEqual(snapshot(cart), [{ ...taco, cartLineId: taco.variationId, name: 'Taco updated', price: 275 }]);
  assert.equal(cart.calculateTotal(), 275);
});

test('keeps different modifier combinations as separate cart lines and prices them', () => {
  const { cart } = loadCart();
  const corn = {
    modifierId: 'modifier-corn',
    listId: 'tortilla-choice',
    listName: 'Tortilla Choice',
    name: 'Corn',
    price: 0,
    currency: 'USD',
    quantity: 1,
  };
  const cheese = {
    modifierId: 'modifier-cheese',
    listId: 'extras',
    listName: 'Extras',
    name: 'Cheese',
    price: 75,
    currency: 'USD',
    quantity: 1,
  };

  cart.addItem({ ...taco, modifiers: [corn] });
  cart.addItem({ ...taco, modifiers: [corn, cheese] });
  assert.equal(cart.getItems().length, 2);
  assert.equal(cart.calculateTotal(), 575);

  const cheeseLine = cart.getItems().find((item) => item.modifiers.some((modifier) => modifier.modifierId === 'modifier-cheese'));
  cart.updateQuantity(cheeseLine.cartLineId, 2);
  assert.equal(cart.calculateTotal(), 900);
});
