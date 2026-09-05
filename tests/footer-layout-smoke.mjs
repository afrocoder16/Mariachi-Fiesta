import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('Usage: node tests/footer-layout-smoke.mjs <CDP websocket URL>');

const socket = new WebSocket(endpoint);
const pending = new Map();
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
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

async function waitFor(expression, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function inspectFooter() {
  return evaluate(`(() => {
    const viewportCenter = document.documentElement.clientWidth / 2;
    const shell = document.querySelector('.footer-shell').getBoundingClientRect();
  const callout = document.querySelector('.footer-cta').getBoundingClientRect();
  const years = document.querySelector('.footer-stat--years').getBoundingClientRect();
  const hours = document.querySelector('.footer-stat--hours').getBoundingClientRect();
    const credit = document.querySelector('.footer-credit').getBoundingClientRect();
    const cart = document.querySelector('#cart-toggle').getBoundingClientRect();
    const footer = document.querySelector('.site-footer').getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      shellCenterOffset: Math.round(shell.left + shell.width / 2 - viewportCenter),
      calloutCenterOffset: Math.round(callout.left + callout.width / 2 - viewportCenter),
      creditCenterOffset: Math.round(credit.left + credit.width / 2 - viewportCenter),
      sidePanelBalance: Math.round(years.width - hours.width),
      cartOverlapsCredit: !(credit.right < cart.left || credit.left > cart.right || credit.bottom < cart.top || credit.top > cart.bottom),
      clip: { x: footer.left + scrollX, y: footer.top + scrollY, width: footer.width, height: footer.height }
    };
  })()`);
}

function assertCentered(layout) {
  assert.equal(layout.documentWidth, layout.viewport, JSON.stringify(layout));
  assert.ok(Math.abs(layout.shellCenterOffset) <= 2, JSON.stringify(layout));
  assert.ok(Math.abs(layout.calloutCenterOffset) <= 2, JSON.stringify(layout));
  assert.ok(Math.abs(layout.creditCenterOffset) <= 2, JSON.stringify(layout));
  assert.ok(Math.abs(layout.sidePanelBalance) <= 2, JSON.stringify(layout));
  assert.equal(layout.cartOverlapsCredit, false, JSON.stringify(layout));
}

async function capture(path, clip) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:3000' });
await waitFor("document.readyState === 'complete' && document.querySelector('.footer-shell')");
await evaluate("document.querySelector('.site-footer').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 600));

const desktop = await inspectFooter();
assertCentered(desktop);
await capture('ui-check-footer-desktop.png', desktop.clip);

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evaluate("document.querySelector('.site-footer').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 600));

const mobile = await inspectFooter();
assertCentered(mobile);
await capture('ui-check-footer-mobile.png', mobile.clip);

socket.close();
console.log(JSON.stringify({ desktop, mobile }, null, 2));
