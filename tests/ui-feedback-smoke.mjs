import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('Usage: node tests/ui-feedback-smoke.mjs <CDP websocket URL>');

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
    runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
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

async function waitFor(expression, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function captureElement(selector, path) {
  const clip = await evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
  })()`);
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { ...clip, scale: 1 }
  });
  await writeFile(path, Buffer.from(result.data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:3000' });
await waitFor("document.readyState === 'complete' && document.querySelector('.weekly-promo__media img')?.complete");

const structure = await evaluate(`(() => ({
  removedOrderExplainer: !document.querySelector('#order-online'),
  removedOldPromoCards: document.querySelectorAll('.dish-card, .promo-card').length === 0,
  promoImageLoaded: document.querySelector('.weekly-promo__media img').naturalWidth > 0,
  promoUsesWebp: document.querySelector('.weekly-promo__media img').getAttribute('src').endsWith('.webp'),
  ownerLabel: document.querySelector('.story-owner-card small').textContent.trim(),
  storyHasOldOwnershipYear: document.querySelector('.story-copy').textContent.includes('2023'),
  storyValueLabels: Array.from(document.querySelectorAll('.story-values strong')).map((node) => node.textContent.trim())
}))()`);
assert.equal(structure.removedOrderExplainer, true);
assert.equal(structure.removedOldPromoCards, true);
assert.equal(structure.promoImageLoaded, true);
assert.equal(structure.promoUsesWebp, true);
assert.equal(structure.ownerLabel, 'Owner');
assert.equal(structure.storyHasOldOwnershipYear, false);
assert.deepEqual(structure.storyValueLabels, ['Local roots', 'Generous plates', 'Personal welcome']);

await evaluate("document.querySelector('#specials').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 1100));
const desktop = await evaluate(`(() => ({
  viewport: document.documentElement.clientWidth,
  documentWidth: document.documentElement.scrollWidth,
  headerTop: Math.round(document.querySelector('.site-header').getBoundingClientRect().top),
  headerCompact: document.querySelector('.site-header').classList.contains('is-scrolled'),
  activeNavigation: document.querySelector('.desktop-nav a.is-active')?.getAttribute('href'),
  sectionInView: document.querySelector('#specials').classList.contains('is-in-view'),
  headingRevealed: document.querySelector('.weekly-feature__heading').classList.contains('is-visible'),
  mediaRevealed: document.querySelector('.weekly-promo__media').classList.contains('is-visible'),
  badgeAnimation: getComputedStyle(document.querySelector('.weekly-promo__badge')).animationName
}))()`);
assert.equal(desktop.documentWidth, desktop.viewport, JSON.stringify(desktop));
assert.equal(desktop.headerTop, 0, JSON.stringify(desktop));
assert.equal(desktop.headerCompact, true, JSON.stringify(desktop));
assert.equal(desktop.activeNavigation, '#specials', JSON.stringify(desktop));
assert.equal(desktop.sectionInView, true, JSON.stringify(desktop));
assert.equal(desktop.headingRevealed, true, JSON.stringify(desktop));
assert.equal(desktop.mediaRevealed, true, JSON.stringify(desktop));
assert.equal(desktop.badgeAnimation, 'promo-bob', JSON.stringify(desktop));
await captureElement('#specials', 'ui-check-weekly-feature-desktop.png');

await evaluate("document.querySelector('#story').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 900));
await captureElement('#story', 'ui-check-story-desktop.png');

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evaluate("document.querySelector('#specials').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 500));
const mobile = await evaluate(`(() => ({
  viewport: document.documentElement.clientWidth,
  documentWidth: document.documentElement.scrollWidth,
  headerTop: Math.round(document.querySelector('.site-header').getBoundingClientRect().top),
  promoColumns: getComputedStyle(document.querySelector('.weekly-promo')).gridTemplateColumns,
  imageLoaded: document.querySelector('.weekly-promo__media img').naturalWidth > 0
}))()`);
assert.equal(mobile.documentWidth, mobile.viewport, JSON.stringify(mobile));
assert.equal(mobile.headerTop, 0, JSON.stringify(mobile));
assert.equal(mobile.imageLoaded, true, JSON.stringify(mobile));
assert.equal(mobile.promoColumns.split(' ').length, 1, JSON.stringify(mobile));
await captureElement('#specials', 'ui-check-weekly-feature-mobile.png');

const unexpectedRuntimeErrors = runtimeErrors.filter((error) => !error.includes('Square Web Payments SDK did not load'));
assert.deepEqual(unexpectedRuntimeErrors, []);
socket.close();
console.log(JSON.stringify({ structure, desktop, mobile, externalSdkUnavailable: runtimeErrors.length > 0 }, null, 2));
