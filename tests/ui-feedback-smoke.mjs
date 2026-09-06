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
await send('Storage.clearDataForOrigin', { origin: 'http://localhost:3000', storageTypes: 'local_storage,session_storage' });
await send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:3000' });
await waitFor("document.readyState === 'complete' && document.querySelector('.weekly-promo__media img')?.complete");
await waitFor("Array.from(document.querySelectorAll('.menu-item[data-item-id] .menu-item__name')).some((node) => node.textContent.trim() === 'Pollo Asado')", 20_000);

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

await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).find(
    (item) => item.querySelector('.menu-item__name')?.textContent.trim() === 'Pollo Asado'
  );
  row.querySelector('.menu-item__details').click();
})()`);
await waitFor("document.querySelector('#item-options-dialog').open && document.querySelector('#item-options-image').complete");
const dishDetails = await evaluate(`(() => ({
  title: document.querySelector('#item-options-title').textContent.trim(),
  description: document.querySelector('#item-options-description').textContent.trim(),
  imageVisible: !document.querySelector('#item-options-media').hidden,
  imageLoaded: document.querySelector('#item-options-image').naturalWidth > 0,
  imageFit: getComputedStyle(document.querySelector('#item-options-image')).objectFit
}))()`);
assert.equal(dishDetails.title, 'Pollo Asado');
assert.ok(dishDetails.description.length > 20, JSON.stringify(dishDetails));
assert.equal(dishDetails.imageVisible, true, JSON.stringify(dishDetails));
assert.equal(dishDetails.imageLoaded, true, JSON.stringify(dishDetails));
assert.equal(dishDetails.imageFit, 'contain', JSON.stringify(dishDetails));
await captureElement('#item-options-dialog', 'ui-check-dish-details.png');
await evaluate("document.querySelector('#item-options-close').click()");

await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).find(
    (item) => item.querySelector('.menu-item__name')?.textContent.trim() === 'Pollo Asado'
  );
  row.querySelector('.add-to-cart').click();
})()`);
await waitFor("document.querySelector('#item-options-dialog').open");
const modifiers = await evaluate(`(() => {
  const checked = document.querySelector('#item-modifier-options input[data-modifier-id]:checked');
  return {
    title: document.querySelector('#item-options-title').textContent.trim(),
    group: document.querySelector('#item-modifier-options legend').textContent.trim(),
    choices: Array.from(document.querySelectorAll('#item-modifier-options input[data-modifier-id]')).map((input) => input.nextElementSibling.textContent.trim()),
    defaultChoice: checked?.nextElementSibling.textContent.trim(),
    required: document.querySelector('#item-modifier-options .item-option-group__hint').textContent.includes('required')
  };
})()`);
assert.deepEqual(modifiers, {
  title: 'Pollo Asado',
  group: 'Tortilla Choice',
  choices: ['Corn Tortilla', 'Flour Tortilla', 'None'],
  defaultChoice: 'Corn Tortilla',
  required: true,
});
await captureElement('#item-options-dialog', 'ui-check-item-options.png');
await evaluate("document.querySelector('#item-options-form').requestSubmit()");
await waitFor("document.querySelector('#cart-count').textContent === '1'");
const configuredCartLine = await evaluate("document.querySelector('.cart-line__mods')?.textContent.trim()");
assert.equal(configuredCartLine, 'Corn Tortilla');

await evaluate(`(() => {
  const chip = Array.from(document.querySelectorAll('#menu-filters .menu-chip')).find(
    (button) => button.textContent.trim() === 'Appetizers'
  );
  chip.click();
})()`);
await waitFor("document.querySelector('#menu-filters .menu-chip[aria-pressed=\"true\"]')?.textContent.trim() === 'Appetizers' && !document.querySelector('#menu-stage').classList.contains('is-switching')");
await evaluate(`(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  const visible = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).filter((item) => !item.hidden);
  visible.at(-1).scrollIntoView({ block: 'center' });
})()`);
await new Promise((resolve) => setTimeout(resolve, 250));
const deepMenuStageTop = await evaluate("Math.round(document.querySelector('#menu-stage').getBoundingClientRect().top)");

await evaluate(`(() => {
  const chip = Array.from(document.querySelectorAll('#menu-filters .menu-chip')).find(
    (button) => button.textContent.trim() === 'Burritos'
  );
  chip.click();
})()`);
await waitFor("document.querySelector('#menu-filters .menu-chip[aria-pressed=\"true\"]')?.textContent.trim() === 'Burritos' && !document.querySelector('#menu-stage').classList.contains('is-switching')");
await new Promise((resolve) => setTimeout(resolve, 550));
const stableMenu = await evaluate(`(() => ({
  visibleItems: Array.from(document.querySelectorAll('.menu-item[data-item-id]')).filter((item) => !item.hidden).length,
  stageHeight: Math.round(document.querySelector('#menu-stage').getBoundingClientRect().height),
  stageMinHeight: Math.round(parseFloat(getComputedStyle(document.querySelector('#menu-stage')).minHeight)),
  stageTop: Math.round(document.querySelector('#menu-stage').getBoundingClientRect().top),
  controlsBottom: Math.round(document.querySelector('.menu-controls').getBoundingClientRect().bottom),
  exploreVisible: !document.querySelector('#menu-explore').hidden,
  activeHeading: Array.from(document.querySelectorAll('.menu-group:not([hidden]) h3')).map((heading) => heading.textContent.trim())
}))()`);
assert.ok(deepMenuStageTop < 0, JSON.stringify({ deepMenuStageTop }));
assert.ok(stableMenu.visibleItems > 0 && stableMenu.visibleItems <= 4, JSON.stringify(stableMenu));
assert.ok(stableMenu.stageHeight >= stableMenu.stageMinHeight, JSON.stringify(stableMenu));
assert.ok(stableMenu.stageTop >= stableMenu.controlsBottom && stableMenu.stageTop - stableMenu.controlsBottom <= 24, JSON.stringify(stableMenu));
assert.equal(stableMenu.exploreVisible, true, JSON.stringify(stableMenu));
assert.deepEqual(stableMenu.activeHeading, ['Burritos']);
const failedThumbnail = await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).find(
    (item) => item.querySelector('.menu-item__name')?.textContent.trim() === 'Fiesta Burrito'
  );
  row.querySelector('.menu-item__thumb img').dispatchEvent(new Event('error'));
  row.classList.add('menu-item--photo');
  const details = row.querySelector('.menu-item__details').getBoundingClientRect();
  const copy = row.querySelector('.menu-item__copy').getBoundingClientRect();
  const order = row.querySelector('.menu-item__order').getBoundingClientRect();
  return {
    thumbnailRemoved: !row.querySelector('.menu-item__thumb'),
    copyRatio: copy.width / details.width,
    orderOffset: Math.round(order.left - details.left)
  };
})()`);
assert.equal(failedThumbnail.thumbnailRemoved, true, JSON.stringify(failedThumbnail));
assert.ok(failedThumbnail.copyRatio > 0.95, JSON.stringify(failedThumbnail));
assert.ok(Math.abs(failedThumbnail.orderOffset) <= 1, JSON.stringify(failedThumbnail));
await captureElement('#menu-stage', 'ui-check-menu-stage.png');

await evaluate("document.querySelector('#cart-toggle').click(); document.querySelector('#checkout-button').click()");
await waitFor("document.querySelector('#checkout-dialog').open");
const pickupNote = await evaluate(`(() => ({
  visible: Boolean(document.querySelector('#customer-note')?.offsetParent),
  optional: document.querySelector('.billing-field--note > span').textContent.includes('optional'),
  maxLength: document.querySelector('#customer-note').maxLength,
  counter: document.querySelector('#customer-note-count').textContent.trim()
}))()`);
assert.deepEqual(pickupNote, { visible: true, optional: true, maxLength: 500, counter: '0/500' });
await captureElement('#checkout-dialog', 'ui-check-pickup-note.png');
await evaluate("document.querySelector('#checkout-close').click()");

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

await evaluate("document.querySelector('#menu').scrollIntoView({ block: 'start' })");
await new Promise((resolve) => setTimeout(resolve, 500));
const mobileMenu = await evaluate(`(() => ({
  viewport: document.documentElement.clientWidth,
  documentWidth: document.documentElement.scrollWidth,
  stageMinHeight: Math.round(parseFloat(getComputedStyle(document.querySelector('#menu-stage')).minHeight)),
  exploreColumns: getComputedStyle(document.querySelector('#menu-explore-links')).gridTemplateColumns,
  visibleItems: Array.from(document.querySelectorAll('.menu-item[data-item-id]')).filter((item) => !item.hidden).length,
  failedImageCopyRatio: (() => {
    const row = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).find(
      (item) => item.querySelector('.menu-item__name')?.textContent.trim() === 'Fiesta Burrito'
    );
    return row.querySelector('.menu-item__copy').getBoundingClientRect().width / row.querySelector('.menu-item__details').getBoundingClientRect().width;
  })()
}))()`);
assert.equal(mobileMenu.documentWidth, mobileMenu.viewport, JSON.stringify(mobileMenu));
assert.ok(mobileMenu.stageMinHeight >= 600, JSON.stringify(mobileMenu));
assert.equal(mobileMenu.exploreColumns.split(' ').length, 1, JSON.stringify(mobileMenu));
assert.equal(mobileMenu.visibleItems, 2, JSON.stringify(mobileMenu));
assert.ok(mobileMenu.failedImageCopyRatio > 0.95, JSON.stringify(mobileMenu));
await captureElement('#menu-stage', 'ui-check-menu-stage-mobile.png');

await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.menu-item[data-item-id]')).find(
    (item) => item.querySelector('.menu-item__name')?.textContent.trim() === 'Fiesta Burrito'
  );
  row.querySelector('.menu-item__details').click();
})()`);
await waitFor("document.querySelector('#item-options-dialog').open");
const mobileDialog = await evaluate(`(() => ({
  width: Math.round(document.querySelector('#item-options-dialog').getBoundingClientRect().width),
  viewport: document.documentElement.clientWidth,
  imageFit: getComputedStyle(document.querySelector('#item-options-image')).objectFit,
  scrollable: document.querySelector('#item-options-dialog').scrollHeight > document.querySelector('#item-options-dialog').clientHeight
}))()`);
assert.ok(mobileDialog.width <= mobileDialog.viewport - 16, JSON.stringify(mobileDialog));
assert.equal(mobileDialog.imageFit, 'contain', JSON.stringify(mobileDialog));
await captureElement('#item-options-dialog', 'ui-check-dish-details-mobile.png');
await evaluate("document.querySelector('#item-options-close').click()");

const unexpectedRuntimeErrors = runtimeErrors.filter((error) => !error.includes('Square Web Payments SDK did not load'));
assert.deepEqual(unexpectedRuntimeErrors, []);
socket.close();
console.log(JSON.stringify({ structure, dishDetails, modifiers, configuredCartLine, stableMenu, failedThumbnail, pickupNote, desktop, mobile, mobileMenu, mobileDialog, externalSdkUnavailable: runtimeErrors.length > 0 }, null, 2));
