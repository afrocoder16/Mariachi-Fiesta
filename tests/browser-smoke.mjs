import assert from 'node:assert/strict';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('Usage: node tests/browser-smoke.mjs <CDP websocket URL>');

const socket = new WebSocket(endpoint);
const pending = new Map();
const runtimeErrors = [];
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Storage.clearDataForOrigin', { origin: 'http://localhost:3000', storageTypes: 'local_storage' });
await send('Page.navigate', { url: 'http://localhost:3000' });
await waitFor("document.readyState === 'complete'");
await waitFor("document.querySelectorAll('.menu-item').length > 0");

const initial = await evaluate(`(() => ({
  title: document.title,
  logoLoaded: document.querySelector('.brand-logo')?.complete && document.querySelector('.brand-logo')?.naturalWidth > 0,
  menuItems: document.querySelectorAll('.menu-item').length,
  menuError: Boolean(document.querySelector('.menu-load-error')),
  paymentInitiallyHidden: document.querySelector('#payment-step').hidden,
  billingInitiallyVisible: !document.querySelector('#billing-step').hidden
}))()`);
assert.equal(initial.title, 'Mariachi Fiesta | Marshall, Minnesota');
assert.equal(initial.logoLoaded, true);
assert.equal(initial.menuError, false);
assert.equal(initial.paymentInitiallyHidden, true);
assert.equal(initial.billingInitiallyVisible, true);

await evaluate('window.scrollTo(0, 1000)');
await new Promise((resolve) => setTimeout(resolve, 250));
const stickyHeader = await evaluate(`(() => {
  const header = document.querySelector('.site-header');
  return {
    top: Math.round(header.getBoundingClientRect().top),
    compact: header.classList.contains('is-scrolled')
  };
})()`);
assert.deepEqual(stickyHeader, { top: 0, compact: true });

await evaluate("document.querySelector('.add-to-cart').click()");
await waitFor("document.querySelector('#cart-count').textContent === '1'");
await evaluate("document.querySelector('#cart-toggle').click()");

const cart = await evaluate(`(() => ({
  open: document.querySelector('#cart-drawer').getAttribute('aria-hidden') === 'false',
  focusable: !document.querySelector('#cart-drawer').inert,
  checkoutEnabled: !document.querySelector('#checkout-button').disabled,
  lineCount: document.querySelectorAll('.cart-line').length
}))()`);
assert.deepEqual(cart, { open: true, focusable: true, checkoutEnabled: true, lineCount: 1 });

await evaluate("document.querySelector('#checkout-button').click()");
const firstStep = await evaluate(`(() => ({
  dialogOpen: document.querySelector('#checkout-dialog').open,
  billingVisible: !document.querySelector('#billing-step').hidden,
  paymentHidden: document.querySelector('#payment-step').hidden
}))()`);
assert.deepEqual(firstStep, { dialogOpen: true, billingVisible: true, paymentHidden: true });

await evaluate(`(() => {
  const values = {
    'billing-full-name': 'Test Customer',
    'billing-email': 'test@example.com',
    'billing-address': '123 Main Street',
    'billing-city': 'Marshall',
    'billing-state': 'MN',
    'billing-postal-code': '56258'
  };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('policy-consent').checked = true;
  document.querySelector('#billing-contact-form').requestSubmit();
})()`);

await waitFor("!document.querySelector('#payment-step').hidden");
await waitFor("!document.querySelector('#payment-submit').disabled", 20_000);
const paymentStep = await evaluate(`(() => ({
  billingHidden: document.querySelector('#billing-step').hidden,
  paymentVisible: !document.querySelector('#payment-step').hidden,
  cardMounted: document.querySelector('#card-container').childElementCount > 0,
  payEnabled: !document.querySelector('#payment-submit').disabled
}))()`);
assert.deepEqual(paymentStep, { billingHidden: true, paymentVisible: true, cardMounted: true, payEnabled: true });

await evaluate("document.querySelector('#checkout-close').click(); document.querySelector('.site-footer').scrollIntoView({ block: 'end' })");
await new Promise((resolve) => setTimeout(resolve, 500));
const footer = await evaluate(`(() => {
  const viewportCenter = document.documentElement.clientWidth / 2;
  const shell = document.querySelector('.footer-shell').getBoundingClientRect();
  const callout = document.querySelector('.footer-cta').getBoundingClientRect();
  const credit = document.querySelector('.footer-credit').getBoundingClientRect();
  const cart = document.querySelector('#cart-toggle').getBoundingClientRect();
  const overlaps = !(credit.right < cart.left || credit.left > cart.right || credit.bottom < cart.top || credit.top > cart.bottom);
  return {
    viewport: document.documentElement.clientWidth,
    shellCenterOffset: Math.round((shell.left + shell.width / 2) - viewportCenter),
    calloutCenterOffset: Math.round((callout.left + callout.width / 2) - viewportCenter),
    creditCenterOffset: Math.round((credit.left + credit.width / 2) - viewportCenter),
    cartOverlapsCredit: overlaps
  };
})()`);
assert.ok(Math.abs(footer.shellCenterOffset) <= 2, JSON.stringify(footer));
assert.ok(Math.abs(footer.calloutCenterOffset) <= 2, JSON.stringify(footer));
assert.ok(Math.abs(footer.creditCenterOffset) <= 2, JSON.stringify(footer));
assert.equal(footer.cartOverlapsCredit, false, JSON.stringify(footer));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate(`(() => ({
  viewport: document.documentElement.clientWidth,
  logoWidth: Math.round(document.querySelector('.brand').getBoundingClientRect().width),
  documentWidth: document.documentElement.scrollWidth,
  bodyOverflowX: getComputedStyle(document.body).overflowX,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  overflowingElements: Array.from(document.querySelectorAll('body *'))
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      id: element.id,
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width)
    }))
    .filter((element) => element.right > document.documentElement.clientWidth + 1 || element.left < -1)
    .slice(0, 15)
}))()`);
await evaluate("window.scrollTo(100, 0)");
await new Promise((resolve) => setTimeout(resolve, 100));
mobile.scrollXAfterAttempt = await evaluate('window.scrollX');
assert.equal(mobile.viewport, 390);
assert.ok(mobile.logoWidth >= 64 && mobile.logoWidth <= 65, `Unexpected mobile logo width: ${mobile.logoWidth}`);
assert.ok(['clip', 'hidden'].includes(mobile.bodyOverflowX), `Unexpected body overflow-x: ${mobile.bodyOverflowX}`);
assert.equal(mobile.scrollXAfterAttempt, 0, JSON.stringify(mobile.overflowingElements));

assert.deepEqual(runtimeErrors, []);
socket.close();
console.log(JSON.stringify({ initial, stickyHeader, cart, firstStep, paymentStep, footer, mobile }, null, 2));
