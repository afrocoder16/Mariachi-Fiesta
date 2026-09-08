const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

function closeMenu() {
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open menu');
  mobileMenu?.setAttribute('aria-hidden', 'true');
  if (mobileMenu) mobileMenu.inert = true;
  mobileMenu?.classList.remove('is-open');
}

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  menuToggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
  mobileMenu.setAttribute('aria-hidden', String(open));
  mobileMenu.inert = open;
  mobileMenu.classList.toggle('is-open', !open);
});

mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px' }
);

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const sectionPresenceObserver = new IntersectionObserver(
  (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-in-view', entry.isIntersecting)),
  { threshold: 0.16 }
);

document.querySelectorAll('main > section').forEach((section) => sectionPresenceObserver.observe(section));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const scrollProgressBar = document.getElementById('scroll-progress-bar');
const siteHeader = document.querySelector('.site-header');
const parallaxFrames = Array.from(document.querySelectorAll('[data-parallax]'));
const navigationLinks = Array.from(document.querySelectorAll('.desktop-nav a[href^="#"], .mobile-menu a[href^="#"]'));
const navigationSections = Array.from(
  new Set(navigationLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean))
);
let activeNavigationId = '';
let scrollFrame;

function updateActiveNavigation() {
  let nextId = '';
  const activationLine = window.innerHeight * 0.42;

  navigationSections.forEach((section) => {
    const bounds = section.getBoundingClientRect();
    if (bounds.top <= activationLine && bounds.bottom > 0) nextId = section.id;
  });

  if (nextId === activeNavigationId) return;
  activeNavigationId = nextId;
  navigationLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${nextId}`;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function updateScrollEffects() {
  scrollFrame = null;
  const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
  scrollProgressBar?.style.setProperty('--scroll-progress', progress);
  siteHeader?.classList.toggle('is-scrolled', window.scrollY > 24);
  updateActiveNavigation();

  if (!reduceMotion) {
    parallaxFrames.forEach((frame) => {
      const bounds = frame.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      const position = (bounds.top + bounds.height / 2 - window.innerHeight / 2) / window.innerHeight;
      frame.style.setProperty('--parallax-y', `${Math.max(-18, Math.min(18, position * -18)).toFixed(1)}px`);
    });
  }
}

function requestScrollUpdate() {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollEffects);
}

window.addEventListener('scroll', requestScrollUpdate, { passive: true });
window.addEventListener('resize', requestScrollUpdate);
updateScrollEffects();

if (!reduceMotion && finePointer) {
  document.querySelectorAll('[data-tilt]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      const maxTilt = card.classList.contains('hero-photo-wrap') ? 2.2 : 4.5;
      card.style.transform = `rotateX(${-y * maxTilt}deg) rotateY(${x * maxTilt}deg)`;
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  });
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 1180) closeMenu();
});

/* ---------- Google rating, reviews and links ---------- */

const googleConfig = window.MARIACHI_GOOGLE;

if (googleConfig) {
  const reviewList = document.getElementById('review-list');
  const clamp = (value) => Math.max(0, Math.min(5, Number(value) || 0));
  const escapeText = (value) =>
    String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

  const starMarkup = (score, label) =>
    `<span class="stars" role="img" aria-label="${escapeText(label)}">` +
    `<i aria-hidden="true">★★★★★</i><b aria-hidden="true" style="width: ${((clamp(score) / 5) * 100).toFixed(1)}%">★★★★★</b></span>`;

  const setLink = (key, url) => {
    document.querySelectorAll(`[data-google="${key}"]`).forEach((node) => node.setAttribute('href', url));
  };

  function showRating(score, count) {
    const rounded = clamp(score).toFixed(1);
    const ratingNode = document.querySelector('[data-google="rating"]');
    const starsNode = document.querySelector('[data-google="stars"]');
    const countNode = document.querySelector('[data-google="count"]');

    if (ratingNode) ratingNode.textContent = rounded;
    if (starsNode) {
      starsNode.setAttribute('aria-label', `Rated ${rounded} out of 5 on Google`);
      const fill = starsNode.querySelector('b');
      if (fill) fill.style.width = `${((clamp(score) / 5) * 100).toFixed(1)}%`;
    }
    if (countNode && count) countNode.textContent = Number(count).toLocaleString('en-US');
  }

  function renderHighlights() {
    if (!reviewList) return;
    const highlights = googleConfig.highlights || [];
    reviewList.innerHTML = `
      <div class="review-highlights">
        ${highlights
          .map(
            (item) =>
              `<div class="review-highlight"><strong>${escapeText(item.label)}</strong><span>${escapeText(
                item.note
              )}</span></div>`
          )
          .join('')}
      </div>
      <div class="review-cta">
        <p>Hundreds of guests have rated us on Google. Read what they said, or add your own after your next visit.</p>
        <a class="button button--green group focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#e49a21]"
           href="${escapeText(googleConfig.reviewsUrl)}" target="_blank" rel="noreferrer">
          <span>Read reviews on Google</span><span aria-hidden="true">↗</span>
        </a>
      </div>`;
  }

  function renderReviews(reviews) {
    if (!reviewList) return;
    reviewList.innerHTML = reviews
      .map((review) => {
        const author = review.authorAttribution || {};
        const name = escapeText(author.displayName || 'Google guest');
        const profile = author.uri
          ? `<a class="review__author" href="${escapeText(author.uri)}" target="_blank" rel="noreferrer">${name}</a>`
          : `<span class="review__author">${name}</span>`;
        const when = review.relativePublishTimeDescription
          ? `<span class="review__when">${escapeText(review.relativePublishTimeDescription)}</span>`
          : '';
        return `<blockquote class="review">
            <span aria-hidden="true">“</span>
            <div>
              <p>${escapeText((review.text && review.text.text) || '')}</p>
              <footer>
                ${starMarkup(review.rating, `Rated ${clamp(review.rating)} out of 5`)}
                ${profile}
                ${when}
              </footer>
            </div>
          </blockquote>`;
      })
      .join('') +
      `<div class="review-cta">
        <p>Reviews from Google, shown newest and most helpful first.</p>
        <a class="button button--green group focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#e49a21]"
           href="${escapeText(googleConfig.reviewsUrl)}" target="_blank" rel="noreferrer">
          <span>See all on Google</span><span aria-hidden="true">↗</span>
        </a>
      </div>`;
  }

  setLink('reviews-link', googleConfig.reviewsUrl);
  setLink('directions', googleConfig.directionsUrl);
  setLink('write', googleConfig.writeReviewUrl);

  const checked = document.querySelector('[data-google="checked"]');
  if (checked && googleConfig.ratingCheckedOn) {
    checked.textContent = `Google rating as of ${googleConfig.ratingCheckedOn}.`;
  }

  showRating(googleConfig.rating, googleConfig.reviewCount);
  renderHighlights();

  // With a key configured, replace the highlights with live review quotes.
  if (googleConfig.placesApiKey) {
    const url =
      `https://places.googleapis.com/v1/places/${encodeURIComponent(googleConfig.placeId)}` +
      `?fields=rating,userRatingCount,reviews&key=${encodeURIComponent(googleConfig.placesApiKey)}`;

    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((place) => {
        if (place.rating) showRating(place.rating, place.userRatingCount);
        const usable = (place.reviews || []).filter((review) => review.text && review.text.text);
        if (usable.length) {
          renderReviews(usable);
          if (checked) checked.textContent = 'Live from Google.';
        }
      })
      .catch((error) => {
        // Keep the highlights fallback on the page rather than showing an error.
        console.warn('Google reviews unavailable:', error.message);
      });
  }
}

/* ---------- Full menu: render, filter, search ---------- */

const menuBody = document.getElementById('menu-body');
const menuFilters = document.getElementById('menu-filters');
const menuSearch = document.getElementById('menu-search-input');
const menuClear = document.querySelector('.menu-search__clear');
const menuEmpty = document.getElementById('menu-empty');
const menuReset = document.getElementById('menu-reset');
const menuStatus = document.getElementById('menu-status');
const menuStage = document.getElementById('menu-stage');
const menuExplore = document.getElementById('menu-explore');
const menuExploreLinks = document.getElementById('menu-explore-links');
const menuData = window.MARIACHI_MENU;

if (menuBody && menuFilters && Array.isArray(menuData)) {
  const ALL = 'all';
  let activeCategory = ALL;

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

  // A handful of grouped chips instead of one per section, so the rail stays scannable.
  // Falls back to one chip per section if the filter list is ever removed.
  const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const defined = Array.isArray(window.MARIACHI_MENU_FILTERS) ? window.MARIACHI_MENU_FILTERS : null;
  const groupDefs = defined || menuData.map((section) => ({ label: section.title, sections: [section.id] }));

  const chips = [
    { id: ALL, label: 'All', sections: null },
    ...groupDefs.map((group) => ({
      id: slugify(group.label),
      label: group.label,
      sections: new Set(group.sections),
    })),
  ];
  const chipsById = new Map(chips.map((chip) => [chip.id, chip]));

  menuFilters.innerHTML = chips
    .map(
      (chip) =>
        `<button class="menu-chip" type="button" data-category="${chip.id}" aria-pressed="${
          chip.id === ALL
        }">${escapeHtml(chip.label)}</button>`
    )
    .join('');

  menuBody.innerHTML = menuData
    .map((section) => {
      const items = section.items
        .map((item) => {
          const thumb = item.image
            ? `<span class="menu-item__thumb"><img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" /></span>`
            : '';
          const desc = item.desc ? `<p class="menu-item__desc">${escapeHtml(item.desc)}</p>` : '';
          const haystack = `${item.name} ${item.desc || ''}`.toLowerCase();
          return `<li class="menu-item${item.image ? ' menu-item--photo' : ''}" data-search="${escapeHtml(haystack)}">
            ${thumb}
            <span class="menu-item__top">
              <h4 class="menu-item__name">${escapeHtml(item.name)}</h4>
              <span class="menu-item__leader" aria-hidden="true"></span>
              <span class="menu-item__price">${escapeHtml(item.price)}</span>
            </span>
            ${desc}
          </li>`;
        })
        .join('');

      return `<div class="menu-group" data-category="${section.id}" id="menu-group-${section.id}">
        <div class="menu-group__head">
          <h3>${escapeHtml(section.title)}</h3>
          <span class="menu-group__rule" aria-hidden="true"></span>
          <span class="menu-group__count"></span>
        </div>
        <ul class="menu-list">${items}</ul>
      </div>`;
    })
    .join('');

  const groups = Array.from(menuBody.querySelectorAll('.menu-group'));
  const items = Array.from(menuBody.querySelectorAll('.menu-item'));

  function applyFilters() {
    const query = (menuSearch?.value || '').trim().toLowerCase();
    let visibleTotal = 0;

    const active = chipsById.get(activeCategory);

    groups.forEach((group) => {
      const inCategory = !active || !active.sections || active.sections.has(group.dataset.category);
      let visibleInGroup = 0;

      group.querySelectorAll('.menu-item').forEach((item) => {
        const matches = inCategory && (!query || item.dataset.search.includes(query));
        item.hidden = !matches;
        if (matches) visibleInGroup += 1;
      });

      const count = group.querySelector('.menu-group__count');
      if (count) count.textContent = `${visibleInGroup} ${visibleInGroup === 1 ? 'item' : 'items'}`;

      group.hidden = visibleInGroup === 0;
      visibleTotal += visibleInGroup;
    });

    if (menuEmpty) menuEmpty.hidden = visibleTotal > 0;
    if (menuClear) menuClear.hidden = query.length === 0;
    if (menuStatus) {
      menuStatus.textContent = `${visibleTotal} ${visibleTotal === 1 ? 'dish' : 'dishes'} shown.`;
    }
  }

  menuFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('.menu-chip');
    if (!chip) return;

    activeCategory = chip.dataset.category;
    menuFilters.querySelectorAll('.menu-chip').forEach((button) => {
      button.setAttribute('aria-pressed', String(button === chip));
    });
    chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    applyFilters();
  });

  menuSearch?.addEventListener('input', applyFilters);
  menuClear?.addEventListener('click', () => {
    if (!menuSearch) return;
    menuSearch.value = '';
    menuSearch.focus();
    applyFilters();
  });

  menuReset?.addEventListener('click', () => {
    if (menuSearch) menuSearch.value = '';
    activeCategory = ALL;
    menuFilters.querySelectorAll('.menu-chip').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.category === ALL));
    });
    menuFilters.scrollTo({ left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    applyFilters();
  });

  // Items render after the reveal observer runs, so opt the new rows in directly.
  items.forEach((item) => item.classList.add('is-visible'));
  applyFilters();
}

/* ---------- Live Square menu, cart and payments ---------- */

(function initializeSquareOrdering() {
  if (!menuBody || !menuFilters || !window.shoppingCart) return;

  const cart = window.shoppingCart;
  const cartToggle = document.getElementById('cart-toggle');
  const cartBackdrop = document.getElementById('cart-backdrop');
  const cartDrawer = document.getElementById('cart-drawer');
  const cartClose = document.getElementById('cart-close');
  const cartList = document.getElementById('cart-list');
  const cartEmpty = document.getElementById('cart-empty');
  const cartCount = document.getElementById('cart-count');
  const cartToggleTotal = document.getElementById('cart-toggle-total');
  const cartTotal = document.getElementById('cart-total');
  const checkoutButton = document.getElementById('checkout-button');
  const menuCartButton = document.getElementById('menu-cart-button');
  const weeklyPromoCartButton = document.getElementById('weekly-promo-cart-button');
  const cartAnnouncer = document.getElementById('cart-announcer');
  const checkoutDialog = document.getElementById('checkout-dialog');
  const checkoutClose = document.getElementById('checkout-close');
  const checkoutCount = document.getElementById('checkout-count');
  const checkoutTotal = document.getElementById('checkout-total');
  const billingStep = document.getElementById('billing-step');
  const paymentStep = document.getElementById('payment-step');
  const billingStepIndicator = document.getElementById('billing-step-indicator');
  const paymentStepIndicator = document.getElementById('payment-step-indicator');
  const billingContactForm = document.getElementById('billing-contact-form');
  const checkoutContinue = document.getElementById('checkout-continue');
  const checkoutContinueLabel = document.getElementById('checkout-continue-label');
  const billingBack = document.getElementById('billing-back');
  const paymentForm = document.getElementById('payment-form');
  const paymentSubmit = document.getElementById('payment-submit');
  const paymentSubmitLabel = document.getElementById('payment-submit-label');
  const paymentStatus = document.getElementById('payment-status');
  const sandboxNote = document.querySelector('.sandbox-note');
  const itemOptionsDialog = document.getElementById('item-options-dialog');
  const itemOptionsClose = document.getElementById('item-options-close');
  const itemOptionsEyebrow = document.getElementById('item-options-eyebrow');
  const itemOptionsTitle = document.getElementById('item-options-title');
  const itemOptionsMedia = document.getElementById('item-options-media');
  const itemOptionsImage = document.getElementById('item-options-image');
  const itemOptionsDescription = document.getElementById('item-options-description');
  const itemOptionsForm = document.getElementById('item-options-form');
  const itemVariationOptions = document.getElementById('item-variation-options');
  const itemModifierOptions = document.getElementById('item-modifier-options');
  const itemOptionsStatus = document.getElementById('item-options-status');
  const itemOptionsTotal = document.getElementById('item-options-total');
  const checkoutBreakdown = document.getElementById('checkout-breakdown');
  const checkoutSubtotal = document.getElementById('checkout-subtotal');
  const checkoutTaxLabel = document.getElementById('checkout-tax-label');
  const checkoutTax = document.getElementById('checkout-tax');
  const checkoutDiscountRow = document.getElementById('checkout-discount-row');
  const checkoutDiscount = document.getElementById('checkout-discount');
  const checkoutTip = document.getElementById('checkout-tip');
  const checkoutGrandTotal = document.getElementById('checkout-grand-total');
  const tipOptions = document.getElementById('tip-options');
  const customerNote = document.getElementById('customer-note');
  const customerNoteCount = document.getElementById('customer-note-count');

  const liveItems = new Map();
  const liveVariations = new Map();
  let liveGroups = [];
  let liveCategory = 'all';
  let squareCard;
  let cardInitialization;
  let lastFocusedElement;
  let checkoutQuote;
  let checkoutSession;
  let paymentSourceId;
  let selectedTipAmount = 0;
  let activeCustomItem;
  let activeCustomTrigger;
  let categorySwitchTimer;

  const CHECKOUT_SESSION_KEY = 'mariachi-fiesta-checkout-v2';

  const escapeSquareHtml = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));

  const formatMoney = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((Number(amount) || 0) / 100);

  const itemCountLabel = (count) => `${count} ${count === 1 ? 'item' : 'items'}`;
  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function loadSquareSdk(environment) {
    if (window.Square) return Promise.resolve();
    const source = environment === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js';

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.dataset.squareSdk = environment;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Square Web Payments SDK did not load.'));
      document.head.append(script);
    });
  }

  const squareConfigPromise = fetchJson('/api/config').then(async (config) => {
    console.log(`[Square] Public config loaded: ${config.environment}, location ${config.locationId}`);
    if (sandboxNote) sandboxNote.hidden = config.environment !== 'sandbox';
    await loadSquareSdk(config.environment);
    return config;
  });

  function priceLabel(variations) {
    const prices = variations.map((variation) => variation.price);
    const currency = variations[0]?.currency || 'USD';
    const minimum = Math.min(...prices);
    const maximum = Math.max(...prices);
    return minimum === maximum ? formatMoney(minimum, currency) : `${formatMoney(minimum, currency)} – ${formatMoney(maximum, currency)}`;
  }

  function renderSquareMenu(groups) {
    liveGroups = groups;
    liveItems.clear();
    liveVariations.clear();
    groups.forEach((group) => group.items.forEach((item) => {
      liveItems.set(item.id, item);
      item.variations.forEach((variation) => liveVariations.set(variation.id, { item, variation }));
    }));

    if (weeklyPromoCartButton) {
      const featuredName = weeklyPromoCartButton.dataset.menuItemName?.trim().toLowerCase();
      const featuredItem = Array.from(liveItems.values()).find((item) => item.name.trim().toLowerCase() === featuredName);
      weeklyPromoCartButton.disabled = !featuredItem;
      weeklyPromoCartButton.title = featuredItem ? '' : 'This item is not currently available to order online.';
    }

    const refreshedCart = cart.getItems().map((saved) => {
      const catalogEntry = liveVariations.get(saved.variationId);
      if (!catalogEntry) return null;
      const { item, variation } = catalogEntry;
      const lists = new Map((item.modifierLists || []).map((list) => [list.id, list]));
      const refreshedModifiers = [];
      for (const savedModifier of saved.modifiers || []) {
        const list = lists.get(savedModifier.listId);
        const modifier = list?.modifiers.find((entry) => entry.id === savedModifier.modifierId);
        if (!list || !modifier || (!list.allowQuantities && savedModifier.quantity !== 1)) return null;
        refreshedModifiers.push({
          modifierId: modifier.id,
          listId: list.id,
          listName: list.name,
          name: modifier.name,
          price: modifier.price,
          currency: modifier.currency,
          quantity: savedModifier.quantity,
        });
      }
      for (const list of item.modifierLists || []) {
        const count = refreshedModifiers
          .filter((modifier) => modifier.listId === list.id)
          .reduce((total, modifier) => total + modifier.quantity, 0);
        if (count < list.minSelected || (list.maxSelected > 0 && count > list.maxSelected)) return null;
      }
      return {
        variationId: variation.id,
        name: item.name,
        variationName: variation.name,
        price: variation.price,
        currency: variation.currency,
        modifiers: refreshedModifiers,
        quantity: saved.quantity,
      };
    }).filter(Boolean);
    const removedItems = cart.syncWithCatalog(refreshedCart);
    if (removedItems) console.warn(`[Square] Removed ${removedItems} unavailable item(s) from the saved cart`);

    menuFilters.innerHTML = [
      '<button class="menu-chip" type="button" data-category="all" aria-pressed="true">All</button>',
      ...groups.map(
        (group) =>
          `<button class="menu-chip" type="button" data-category="${escapeSquareHtml(group.id)}" aria-pressed="false">${escapeSquareHtml(group.title)}</button>`
      ),
    ].join('');

    menuBody.innerHTML = groups
      .map((group) => {
        const items = group.items
          .map((item) => {
            const imageUrl = item.imageUrl || '';
            const thumbnail = imageUrl
              ? `<span class="menu-item__thumb"><img src="${escapeSquareHtml(imageUrl)}" alt="${escapeSquareHtml(item.name)}" loading="lazy" decoding="async" /></span>`
              : '';
            const description = item.description ? `<p class="menu-item__desc">${escapeSquareHtml(item.description)}</p>` : '';
            const options = item.variations
              .map(
                (variation) =>
                  `<option value="${escapeSquareHtml(variation.id)}">${escapeSquareHtml(variation.name)} · ${formatMoney(variation.price, variation.currency)}</option>`
              )
              .join('');
            const selector =
              item.variations.length > 1
                ? `<label class="menu-item__variation"><span class="visually-hidden">Choose a ${escapeSquareHtml(item.name)} option</span><select>${options}</select></label>`
                : `<input type="hidden" value="${escapeSquareHtml(item.variations[0].id)}" />`;
            const haystack = `${item.name} ${item.description || ''} ${group.title}`.toLowerCase();

            const hasOptions = (item.modifierLists || []).some((list) => !list.hiddenFromCustomer);
            return `<li class="menu-item${imageUrl ? ' menu-item--photo' : ''}" data-item-id="${escapeSquareHtml(item.id)}" data-search="${escapeSquareHtml(haystack)}">
              <button class="menu-item__details" type="button" aria-haspopup="dialog" aria-label="View details for ${escapeSquareHtml(item.name)}">
                ${thumbnail}
                <span class="menu-item__copy">
                  <span class="menu-item__top">
                    <h4 class="menu-item__name">${escapeSquareHtml(item.name)}</h4>
                    <span class="menu-item__leader" aria-hidden="true"></span>
                    <span class="menu-item__price">${priceLabel(item.variations)}</span>
                  </span>
                  ${description}
                  <span class="menu-item__view">View details <span aria-hidden="true">&rarr;</span></span>
                </span>
              </button>
              <span class="menu-item__order">${selector}<button class="add-to-cart" type="button">${hasOptions ? 'Customize' : 'Add to cart'}</button></span>
            </li>`;
          })
          .join('');

        return `<div class="menu-group" data-category="${escapeSquareHtml(group.id)}">
          <div class="menu-group__head"><h3>${escapeSquareHtml(group.title)}</h3><span class="menu-group__rule" aria-hidden="true"></span><span class="menu-group__count"></span></div>
          <ul class="menu-list">${items}</ul>
        </div>`;
      })
      .join('');

    menuBody.querySelectorAll('.menu-item').forEach((item) => item.classList.add('is-visible'));
    applySquareFilters();
  }

  function applySquareFilters() {
    const query = (menuSearch?.value || '').trim().toLowerCase();
    let visibleTotal = 0;

    menuBody.querySelectorAll('.menu-group').forEach((group) => {
      const categoryMatches = liveCategory === 'all' || group.dataset.category === liveCategory;
      let groupCount = 0;
      group.querySelectorAll('.menu-item').forEach((item) => {
        const matches = categoryMatches && (!query || item.dataset.search.includes(query));
        item.hidden = !matches;
        if (matches) groupCount += 1;
      });
      group.hidden = groupCount === 0;
      const count = group.querySelector('.menu-group__count');
      if (count) count.textContent = itemCountLabel(groupCount);
      visibleTotal += groupCount;
    });

    if (menuEmpty) menuEmpty.hidden = visibleTotal > 0;
    if (menuClear) menuClear.hidden = query.length === 0;
    if (menuStatus) menuStatus.textContent = `${visibleTotal} ${visibleTotal === 1 ? 'dish' : 'dishes'} shown.`;
    renderMenuExplore(visibleTotal, query);
  }

  function renderMenuExplore(visibleTotal, query) {
    if (!menuExplore || !menuExploreLinks) return;
    const currentIndex = liveGroups.findIndex((group) => group.id === liveCategory);
    const shouldShow = !query && liveCategory !== 'all' && visibleTotal > 0 && visibleTotal <= 4 && liveGroups.length > 1;
    menuExplore.hidden = !shouldShow;
    if (!shouldShow) {
      menuExploreLinks.innerHTML = '';
      return;
    }

    const suggestions = Array.from({ length: liveGroups.length - 1 }, (_, offset) =>
      liveGroups[(currentIndex + offset + 1 + liveGroups.length) % liveGroups.length]
    ).filter((group) => group.id !== liveCategory).slice(0, 3);
    menuExploreLinks.innerHTML = suggestions.map((group) =>
      `<button class="menu-explore__button" type="button" data-explore-category="${escapeSquareHtml(group.id)}"><span>${escapeSquareHtml(group.title)}</span><small>${itemCountLabel(group.items.length)} <span aria-hidden="true">&rarr;</span></small></button>`
    ).join('');
  }

  function scrollCategoryChipIntoView(chip) {
    if (!chip) return;
    const left = chip.offsetLeft - (menuFilters.clientWidth - chip.offsetWidth) / 2;
    menuFilters.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function alignMenuStage() {
    if (!menuStage) return 0;
    const controls = document.querySelector('.menu-controls');
    const stickyTop = controls ? Number.parseFloat(getComputedStyle(controls).top) || 0 : 0;
    const controlsHeight = controls?.offsetHeight || 0;
    const absoluteStageTop = window.scrollY + menuStage.getBoundingClientRect().top;
    const targetTop = Math.max(0, absoluteStageTop - stickyTop - controlsHeight - 16);
    const distance = Math.abs(window.scrollY - targetTop);
    window.scrollTo({ top: targetTop, behavior: reduceMotion ? 'auto' : 'smooth' });
    return distance;
  }

  function selectLiveCategory(category, chip) {
    if (!liveGroups.length || (category !== 'all' && !liveGroups.some((group) => group.id === category))) return;
    window.clearTimeout(categorySwitchTimer);
    menuFilters.querySelectorAll('.menu-chip').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.category === category))
    );
    scrollCategoryChipIntoView(chip || menuFilters.querySelector(`[data-category="${CSS.escape(category)}"]`));
    menuStage?.classList.add('is-switching');
    menuStage?.setAttribute('aria-busy', 'true');
    const distance = alignMenuStage();

    const finishSwitch = () => {
      liveCategory = category;
      applySquareFilters();
      window.requestAnimationFrame(() => {
        menuStage?.classList.remove('is-switching');
        menuStage?.removeAttribute('aria-busy');
      });
    };
    if (reduceMotion) finishSwitch();
    else categorySwitchTimer = window.setTimeout(finishSwitch, distance > 80 ? 220 : 120);
  }

  menuFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('.menu-chip');
    if (!chip || !liveGroups.length) return;
    selectLiveCategory(chip.dataset.category, chip);
  });

  menuExploreLinks?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-explore-category]');
    if (!button) return;
    selectLiveCategory(button.dataset.exploreCategory);
  });

  menuSearch?.addEventListener('input', () => {
    window.clearTimeout(categorySwitchTimer);
    menuStage?.classList.remove('is-switching');
    menuStage?.removeAttribute('aria-busy');
    applySquareFilters();
  });
  menuClear?.addEventListener('click', () => {
    menuSearch.value = '';
    menuSearch.focus();
    applySquareFilters();
  });
  menuReset?.addEventListener('click', () => {
    menuSearch.value = '';
    selectLiveCategory('all');
  });

  menuBody.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) {
      const row = event.target.closest('.menu-item');
      event.target.closest('.menu-item__thumb')?.remove();
      row?.classList.remove('menu-item--photo');
    }
  }, true);

  function pulseCart(itemName, button) {
    if (button) {
      const label = button.querySelector('[data-button-label]') || button;
      const original = label.dataset.originalLabel || label.textContent;
      label.dataset.originalLabel = original;
      label.textContent = 'Added!';
      setTimeout(() => (label.textContent = original), 900);
    }
    if (cartAnnouncer) cartAnnouncer.textContent = `${itemName} added to your cart.`;
    cartToggle.classList.remove('has-update');
    void cartToggle.offsetWidth;
    cartToggle.classList.add('has-update');
    setTimeout(() => cartToggle.classList.remove('has-update'), 650);
  }

  function modifierPriceLabel(modifier) {
    return modifier.price ? `+${formatMoney(modifier.price, modifier.currency)}` : 'Included';
  }

  function modifierHint(list) {
    if (list.minSelected === list.maxSelected) {
      return list.minSelected === 1 ? 'Choose 1 (required)' : `Choose ${list.minSelected} (required)`;
    }
    if (list.maxSelected > 0) {
      return list.minSelected > 0
        ? `Choose ${list.minSelected}-${list.maxSelected} (required)`
        : `Choose up to ${list.maxSelected} (optional)`;
    }
    return list.minSelected > 0 ? `Choose at least ${list.minSelected} (required)` : 'Optional';
  }

  function renderModifierChoice(list, modifier, listIndex, modifierIndex, useRadio) {
    const inputId = `modifier-${listIndex}-${modifierIndex}`;
    const inputType = useRadio ? 'radio' : 'checkbox';
    const name = `modifier-list-${listIndex}`;
    const required = useRadio && list.minSelected > 0 ? ' required' : '';
    const checked = modifier.onByDefault ? ' checked' : '';
    const quantity = list.allowQuantities
      ? `<label class="modifier-quantity-label" for="${inputId}-quantity">Qty<span class="visually-hidden"> for ${escapeSquareHtml(modifier.name)}</span></label><input class="modifier-quantity" id="${inputId}-quantity" type="number" min="1" max="${list.maxSelected || 25}" value="1" data-quantity-for="${escapeSquareHtml(modifier.id)}" ${modifier.onByDefault ? '' : 'disabled'} />`
      : '';
    return `<div class="item-option-choice${list.allowQuantities ? ' item-option-choice--quantity' : ''}">
      <input id="${inputId}" type="${inputType}" name="${name}" value="${escapeSquareHtml(modifier.id)}" data-modifier-id="${escapeSquareHtml(modifier.id)}" data-list-id="${escapeSquareHtml(list.id)}"${required}${checked} />
      <label for="${inputId}"><strong>${escapeSquareHtml(modifier.name)}</strong></label>
      <small>${modifierPriceLabel(modifier)}</small>
      ${quantity}
    </div>`;
  }

  function selectedItemVariation() {
    if (!activeCustomItem) return null;
    const variationId = itemVariationOptions.querySelector('select, input[type="hidden"]')?.value;
    return activeCustomItem.variations.find((variation) => variation.id === variationId) || null;
  }

  function selectedItemModifiers() {
    if (!activeCustomItem) return [];
    const selected = [];
    (activeCustomItem.modifierLists || []).forEach((list) => {
      list.modifiers.forEach((modifier) => {
        const input = itemModifierOptions.querySelector(`[data-modifier-id="${CSS.escape(modifier.id)}"]`);
        const automaticallySelected = list.hiddenFromCustomer && modifier.onByDefault;
        if (!automaticallySelected && !input?.checked) return;
        const quantityInput = itemModifierOptions.querySelector(`[data-quantity-for="${CSS.escape(modifier.id)}"]`);
        const quantity = list.allowQuantities && quantityInput ? Number(quantityInput.value) : 1;
        selected.push({
          modifierId: modifier.id,
          listId: list.id,
          listName: list.name,
          name: modifier.name,
          price: modifier.price,
          currency: modifier.currency,
          quantity,
        });
      });
    });
    return selected;
  }

  function validateItemOptions() {
    for (const list of activeCustomItem?.modifierLists || []) {
      const count = selectedItemModifiers()
        .filter((modifier) => modifier.listId === list.id)
        .reduce((total, modifier) => total + modifier.quantity, 0);
      if (!Number.isInteger(count) || count < list.minSelected || (list.maxSelected > 0 && count > list.maxSelected)) {
        const message = `${list.name}: ${modifierHint(list).replace(/\s*\([^)]*\)/g, '').toLowerCase()}.`;
        itemOptionsStatus.textContent = message;
        const firstInput = itemModifierOptions.querySelector(`[data-list-id="${CSS.escape(list.id)}"]`);
        firstInput?.focus();
        return false;
      }
    }
    itemOptionsStatus.textContent = '';
    return true;
  }

  function updateItemOptionsTotal() {
    itemModifierOptions.querySelectorAll('[data-modifier-id]').forEach((input) => {
      const quantityInput = itemModifierOptions.querySelector(`[data-quantity-for="${CSS.escape(input.dataset.modifierId)}"]`);
      if (quantityInput) quantityInput.disabled = !input.checked;
    });
    const variation = selectedItemVariation();
    const modifiers = selectedItemModifiers();
    const total = (variation?.price || 0) + modifiers.reduce((sum, modifier) => sum + modifier.price * modifier.quantity, 0);
    itemOptionsTotal.textContent = formatMoney(total, variation?.currency || 'USD');
    itemOptionsStatus.textContent = '';
  }

  function openItemOptions(item, selectedVariationId, trigger) {
    activeCustomItem = item;
    activeCustomTrigger = trigger;
    const hasCustomerOptions = item.variations.length > 1 || (item.modifierLists || []).some((list) => !list.hiddenFromCustomer);
    itemOptionsEyebrow.textContent = hasCustomerOptions ? 'Customize your order' : 'Menu details';
    itemOptionsTitle.textContent = item.name;
    itemOptionsDescription.textContent = item.description || (hasCustomerOptions
      ? 'Choose your options before adding this item to your cart.'
      : 'Review the current price, then add this dish to your cart when you are ready.');
    itemOptionsStatus.textContent = '';
    if (item.imageUrl) {
      itemOptionsImage.alt = item.name;
      itemOptionsImage.src = item.imageUrl;
      itemOptionsMedia.hidden = false;
    } else {
      itemOptionsMedia.hidden = true;
      itemOptionsImage.removeAttribute('src');
      itemOptionsImage.alt = '';
    }

    if (item.variations.length > 1) {
      itemVariationOptions.innerHTML = `<fieldset class="item-option-group"><legend>Size or style</legend><select class="item-variation-select" aria-label="Choose size or style">${item.variations
        .map((variation) => `<option value="${escapeSquareHtml(variation.id)}"${variation.id === selectedVariationId ? ' selected' : ''}>${escapeSquareHtml(variation.name)} - ${formatMoney(variation.price, variation.currency)}</option>`)
        .join('')}</select></fieldset>`;
    } else {
      itemVariationOptions.innerHTML = `<input type="hidden" value="${escapeSquareHtml(item.variations[0].id)}" />`;
    }

    itemModifierOptions.innerHTML = (item.modifierLists || [])
      .filter((list) => !list.hiddenFromCustomer)
      .map((list, listIndex) => {
        const useRadio = list.maxSelected === 1 && !list.allowQuantities;
        const noThanks = useRadio && list.minSelected === 0
          ? `<div class="item-option-choice"><input id="modifier-${listIndex}-none" type="radio" name="modifier-list-${listIndex}" value=""${list.modifiers.some((modifier) => modifier.onByDefault) ? '' : ' checked'} /><label for="modifier-${listIndex}-none"><strong>No thanks</strong></label><small>No charge</small></div>`
          : '';
        return `<fieldset class="item-option-group" data-option-list="${escapeSquareHtml(list.id)}" data-min-selected="${list.minSelected}">
          <legend>${escapeSquareHtml(list.name)}</legend>
          <p class="item-option-group__hint">${modifierHint(list)}</p>
          <div class="item-option-group__choices">${noThanks}${list.modifiers.map((modifier, modifierIndex) => renderModifierChoice(list, modifier, listIndex, modifierIndex, useRadio)).join('')}</div>
        </fieldset>`;
      })
      .join('');
    updateItemOptionsTotal();
    itemOptionsDialog.showModal();
    (itemOptionsDialog.querySelector('select, input:not([type="hidden"])') || document.getElementById('item-options-submit'))?.focus();
  }

  function closeItemOptions() {
    itemOptionsDialog.close();
    activeCustomTrigger?.focus();
    activeCustomItem = null;
    activeCustomTrigger = null;
  }

  function addConfiguredItem(item, variation, modifiers, button) {
    cart.addItem({
      variationId: variation.id,
      name: item.name,
      variationName: variation.name,
      price: variation.price,
      currency: variation.currency,
      modifiers,
      quantity: 1,
    });
    pulseCart(item.name, button);
  }

  menuBody.addEventListener('click', (event) => {
    const details = event.target.closest('.menu-item__details');
    if (details) {
      const row = details.closest('.menu-item');
      const item = liveItems.get(row.dataset.itemId);
      const variationId = row.querySelector('select, input[type="hidden"]')?.value;
      const variation = item?.variations.find((entry) => entry.id === variationId);
      if (item && variation) openItemOptions(item, variation.id, details);
      return;
    }

    const button = event.target.closest('.add-to-cart');
    if (!button) return;
    const row = button.closest('.menu-item');
    const item = liveItems.get(row.dataset.itemId);
    const variationId = row.querySelector('select, input[type="hidden"]')?.value;
    const variation = item?.variations.find((entry) => entry.id === variationId);
    if (!item || !variation) return;
    if ((item.modifierLists || []).length) openItemOptions(item, variation.id, button);
    else addConfiguredItem(item, variation, [], button);
  });

  weeklyPromoCartButton?.addEventListener('click', () => {
    const featuredName = weeklyPromoCartButton.dataset.menuItemName?.trim().toLowerCase();
    const item = Array.from(liveItems.values()).find((entry) => entry.name.trim().toLowerCase() === featuredName);
    const variation = item?.variations[0];
    if (!item || !variation) return;
    if (item.variations.length > 1 || (item.modifierLists || []).length) {
      openItemOptions(item, variation.id, weeklyPromoCartButton);
    } else {
      addConfiguredItem(item, variation, [], weeklyPromoCartButton);
    }
  });

  itemModifierOptions.addEventListener('input', updateItemOptionsTotal);
  itemVariationOptions.addEventListener('input', updateItemOptionsTotal);
  itemOptionsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!activeCustomItem || !validateItemOptions()) return;
    const variation = selectedItemVariation();
    if (!variation) return;
    const item = activeCustomItem;
    const trigger = activeCustomTrigger;
    addConfiguredItem(item, variation, selectedItemModifiers(), trigger);
    closeItemOptions();
  });
  itemOptionsClose.addEventListener('click', closeItemOptions);
  itemOptionsImage.addEventListener('error', () => {
    itemOptionsMedia.hidden = true;
    itemOptionsImage.removeAttribute('src');
  });
  itemOptionsDialog.addEventListener('click', (event) => {
    if (event.target === itemOptionsDialog) closeItemOptions();
  });

  function openCart() {
    lastFocusedElement = document.activeElement;
    cartDrawer.setAttribute('aria-hidden', 'false');
    cartDrawer.inert = false;
    cartToggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('cart-is-open');
    cartClose.focus();
  }

  function closeCart() {
    cartDrawer.setAttribute('aria-hidden', 'true');
    cartDrawer.inert = true;
    cartToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('cart-is-open');
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  function renderCart(items) {
    const totalQuantity = items.reduce((count, item) => count + item.quantity, 0);
    const total = cart.calculateTotal();
    const currency = items[0]?.currency || 'USD';
    const formattedTotal = formatMoney(total, currency);

    cartCount.textContent = String(totalQuantity);
    cartCount.setAttribute('aria-label', itemCountLabel(totalQuantity));
    cartToggleTotal.textContent = formattedTotal;
    cartTotal.textContent = formattedTotal;
    if (!checkoutQuote) checkoutTotal.textContent = formattedTotal;
    checkoutCount.textContent = itemCountLabel(totalQuantity);
    cartEmpty.hidden = items.length > 0;
    checkoutButton.disabled = items.length === 0;

    cartList.innerHTML = items
      .map((item) => {
        const modifierSummary = (item.modifiers || [])
          .map((modifier) => `${modifier.quantity > 1 ? `${modifier.quantity}x ` : ''}${modifier.name}`)
          .join(', ');
        return `<li class="cart-line" data-cart-line-id="${escapeSquareHtml(item.cartLineId)}">
          <div><strong>${escapeSquareHtml(item.name)}</strong><span>${escapeSquareHtml(item.variationName === 'Regular' ? '' : item.variationName || '')}</span>${modifierSummary ? `<span class="cart-line__mods">${escapeSquareHtml(modifierSummary)}</span>` : ''}</div>
          <span class="cart-line__price">${formatMoney(cart.unitPrice(item) * item.quantity, item.currency)}</span>
          <div class="quantity-control" aria-label="Quantity for ${escapeSquareHtml(item.name)}">
            <button type="button" data-cart-action="decrease" aria-label="Decrease quantity">−</button><b>${item.quantity}</b><button type="button" data-cart-action="increase" aria-label="Increase quantity">+</button>
          </div>
          <button class="cart-line__remove" type="button" data-cart-action="remove">Remove</button>
        </li>`;
      })
      .join('');
  }

  cartList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const cartLineId = button.closest('.cart-line').dataset.cartLineId;
    const item = cart.getItems().find((entry) => entry.cartLineId === cartLineId);
    if (!item) return;
    if (button.dataset.cartAction === 'increase') cart.updateQuantity(cartLineId, item.quantity + 1);
    if (button.dataset.cartAction === 'decrease') cart.updateQuantity(cartLineId, item.quantity - 1);
    if (button.dataset.cartAction === 'remove') cart.removeItem(cartLineId);
  });

  cartToggle.addEventListener('click', openCart);
  menuCartButton?.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartBackdrop.addEventListener('click', closeCart);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('cart-is-open')) closeCart();
  });
  cart.subscribe(renderCart);

  function showBillingStep() {
    billingStep.hidden = false;
    paymentStep.hidden = true;
    paymentForm.hidden = false;
    billingStepIndicator.setAttribute('aria-current', 'step');
    paymentStepIndicator.removeAttribute('aria-current');
    paymentStatus.className = 'payment-status';
    paymentStatus.textContent = '';
  }

  function showPaymentStep() {
    billingStep.hidden = true;
    paymentStep.hidden = false;
    billingStepIndicator.removeAttribute('aria-current');
    paymentStepIndicator.setAttribute('aria-current', 'step');
  }

  function getBillingContact() {
    const fields = new FormData(billingContactForm);
    const fullName = String(fields.get('fullName') || '').trim().replace(/\s+/g, ' ');
    const nameParts = fullName.split(' ').filter(Boolean);
    const familyName = nameParts.length > 1 ? nameParts.pop() : '';
    const givenName = nameParts.join(' ') || fullName;

    return {
      givenName,
      familyName,
      email: String(fields.get('email') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      addressLines: [String(fields.get('address') || '').trim()],
      city: String(fields.get('city') || '').trim(),
      state: String(fields.get('state') || '').trim().toUpperCase(),
      countryCode: 'US',
      postalCode: String(fields.get('postalCode') || '').trim(),
    };
  }

  function getCustomerNote() {
    return String(customerNote?.value || '').trim();
  }

  async function checkoutSignature(contact, items, note) {
    const value = JSON.stringify({
      cart: items
        .map((item) => ({
          variationId: item.variationId,
          quantity: item.quantity,
          modifiers: (item.modifiers || [])
            .map((modifier) => ({ modifierId: modifier.modifierId, quantity: modifier.quantity }))
            .sort((a, b) => a.modifierId.localeCompare(b.modifierId)),
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      contact,
      customerNote: note,
    });
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function readCheckoutSession() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(CHECKOUT_SESSION_KEY) || 'null');
      const validKey = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
      return stored && typeof stored.signature === 'string' && validKey(stored.orderKey) && validKey(stored.paymentKey) &&
        (stored.tipAmount === null || Number.isSafeInteger(stored.tipAmount))
        ? stored
        : null;
    } catch {
      return null;
    }
  }

  function saveCheckoutSession(session) {
    try {
      window.sessionStorage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify(session));
    } catch {
      // The in-memory session still protects retries when browser storage is unavailable.
    }
  }

  async function ensureCheckoutSession(contact, items, note) {
    const signature = await checkoutSignature(contact, items, note);
    const stored = readCheckoutSession();
    const next = stored?.signature === signature
      ? stored
      : { signature, orderKey: window.crypto.randomUUID(), paymentKey: window.crypto.randomUUID(), tipAmount: null };

    if (checkoutSession?.orderKey !== next.orderKey) paymentSourceId = null;
    checkoutSession = next;
    saveCheckoutSession(next);
    return next;
  }

  function rotatePaymentAttempt() {
    if (!checkoutSession) return;
    checkoutSession = { ...checkoutSession, paymentKey: window.crypto.randomUUID() };
    paymentSourceId = null;
    saveCheckoutSession(checkoutSession);
  }

  function clearCheckoutSession() {
    checkoutQuote = null;
    checkoutSession = null;
    paymentSourceId = null;
    selectedTipAmount = 0;
    checkoutBreakdown.hidden = true;
    tipOptions.innerHTML = '';
    try {
      window.sessionStorage.removeItem(CHECKOUT_SESSION_KEY);
    } catch {
      // Nothing else is required when storage is unavailable.
    }
  }

  function checkoutRequestBody(contact, expectedAmount, expectedCurrency, note = getCustomerNote()) {
    const items = cart.getItems();
    return {
      orderIdempotencyKey: checkoutSession.orderKey,
      cart: items.map((item) => ({
        variationId: item.variationId,
        quantity: item.quantity,
        modifiers: (item.modifiers || []).map((modifier) => ({
          modifierId: modifier.modifierId,
          quantity: modifier.quantity,
        })),
      })),
      billingContact: contact,
      customerNote: note,
      expectedAmount,
      expectedCurrency,
    };
  }

  function applyCheckoutQuote(quote) {
    if (!quote) return;
    checkoutQuote = { ...quote, orderKey: checkoutSession?.orderKey };
    cart.syncWithCatalog(quote.items || []);
    renderTipOptions(quote);
    updateCheckoutTotals();
  }

  function setSelectedTip(amount, userInitiated = false) {
    const nextAmount = Number(amount);
    if (!Number.isSafeInteger(nextAmount) || nextAmount < 0) return;
    if (checkoutSession && checkoutSession.tipAmount !== nextAmount) {
      const hadPreviousChoice = Number.isSafeInteger(checkoutSession.tipAmount);
      checkoutSession = {
        ...checkoutSession,
        tipAmount: nextAmount,
        ...(userInitiated && hadPreviousChoice ? { paymentKey: window.crypto.randomUUID() } : {}),
      };
      paymentSourceId = null;
      saveCheckoutSession(checkoutSession);
    }
    selectedTipAmount = nextAmount;
    updateCheckoutTotals();
  }

  function renderTipOptions(quote) {
    const options = Array.isArray(quote.tipOptions) ? quote.tipOptions : [];
    const storedAmount = checkoutSession?.tipAmount;
    const selected = options.find((option) => option.amount === storedAmount) ||
      options.find((option) => option.isDefault) || options[0];
    tipOptions.innerHTML = options.map((option) => {
      const detail = option.amount ? `<small>${formatMoney(option.amount, option.currency || quote.currency)}</small>` : '';
      return `<label class="tip-option"><input type="radio" name="tipAmount" value="${option.amount}"${option.amount === selected?.amount ? ' checked' : ''} /><span>${escapeSquareHtml(option.label)}</span>${detail}</label>`;
    }).join('');
    setSelectedTip(selected?.amount || 0);
  }

  function updateCheckoutTotals() {
    if (!checkoutQuote) return;
    const { currency, subtotal, tax, discount, taxIncluded } = checkoutQuote;
    const totalDue = checkoutQuote.amount + selectedTipAmount;
    checkoutBreakdown.hidden = false;
    checkoutSubtotal.textContent = formatMoney(subtotal, currency);
    checkoutTaxLabel.textContent = taxIncluded ? 'Sales tax (included)' : 'Sales tax';
    checkoutTax.textContent = formatMoney(tax, currency);
    checkoutDiscountRow.hidden = !discount;
    checkoutDiscount.textContent = `−${formatMoney(discount, currency)}`;
    checkoutTip.textContent = formatMoney(selectedTipAmount, currency);
    checkoutGrandTotal.textContent = formatMoney(totalDue, currency);
    checkoutTotal.textContent = formatMoney(totalDue, currency);
    paymentSubmitLabel.textContent = `Pay ${formatMoney(totalDue, currency)} securely`;
  }

  async function initializeCard() {
    if (squareCard) {
      paymentSubmit.disabled = false;
      return squareCard;
    }
    if (cardInitialization) return cardInitialization;

    cardInitialization = (async () => {
      paymentStatus.textContent = 'Loading secure card fields…';
      const config = await squareConfigPromise;
      if (!window.Square) throw new Error('Square Web Payments SDK did not load.');
      const payments = window.Square.payments(config.applicationId, config.locationId);
      squareCard = await payments.card();
      await squareCard.attach('#card-container');
      paymentStatus.textContent = '';
      paymentSubmit.disabled = false;
      console.log('[Square] Web Payments card form initialized');
      return squareCard;
    })().catch((error) => {
      cardInitialization = null;
      paymentStatus.textContent = error.message;
      console.error('[Square] Card form initialization failed:', error.message);
      throw error;
    });

    return cardInitialization;
  }

  checkoutButton.addEventListener('click', () => {
    closeCart();
    checkoutDialog.showModal();
    showBillingStep();
    if (!checkoutQuote) checkoutBreakdown.hidden = true;
    document.getElementById('billing-full-name')?.focus();
  });

  billingContactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const requiredFields = billingContactForm.querySelectorAll('input[required]');
    requiredFields.forEach((field) => field.setCustomValidity(field.value.trim() ? '' : 'This field is required.'));
    const phoneField = document.getElementById('billing-phone');
    const phoneDigits = phoneField.value.replace(/\D/g, '');
    if (phoneDigits.length !== 10 && !(phoneDigits.length === 11 && phoneDigits.startsWith('1'))) {
      phoneField.setCustomValidity('Enter a valid 10-digit US phone number.');
    }
    if (!billingContactForm.reportValidity()) return;
    if (!cart.getItems().length) return;

    const stateField = document.getElementById('billing-state');
    stateField.value = stateField.value.trim().toUpperCase();
    checkoutContinue.disabled = true;
    checkoutContinueLabel.textContent = 'Checking total…';
    paymentStatus.className = 'payment-status';
    paymentStatus.textContent = '';

    try {
      const contact = getBillingContact();
      const items = cart.getItems();
      const note = getCustomerNote();
      const session = await ensureCheckoutSession(contact, items, note);
      const confirmedQuote = checkoutQuote?.orderKey === session.orderKey ? checkoutQuote : null;
      const expectedAmount = confirmedQuote?.amount ?? cart.calculateTotal();
      const expectedCurrency = confirmedQuote?.currency || items[0]?.currency || 'USD';
      const result = await fetchJson('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutRequestBody(contact, expectedAmount, expectedCurrency, note)),
      });

      applyCheckoutQuote(result.checkout);
      checkoutContinueLabel.textContent = 'Continue to payment';
      showPaymentStep();
      await initializeCard();
    } catch (error) {
      if (error.payload?.code === 'PRICE_CHANGED' && error.payload.checkout) {
        applyCheckoutQuote(error.payload.checkout);
        checkoutContinueLabel.textContent = 'Confirm updated total';
        paymentStatus.className = 'payment-status is-warning';
        paymentStatus.textContent = `Your order total changed to ${formatMoney(error.payload.checkout.amount, error.payload.checkout.currency)}. Review it and confirm before entering payment.`;
      } else {
        checkoutContinueLabel.textContent = 'Try again';
        paymentStatus.textContent = error.message || 'The order total could not be verified. Please try again.';
      }
    } finally {
      checkoutContinue.disabled = false;
    }
  });

  billingContactForm.addEventListener('input', (event) => {
    event.target.setCustomValidity('');
    if (event.target === customerNote && customerNoteCount) customerNoteCount.textContent = `${customerNote.value.length}/500`;
    checkoutQuote = null;
    checkoutSession = null;
    paymentSourceId = null;
    selectedTipAmount = 0;
    checkoutBreakdown.hidden = true;
    tipOptions.innerHTML = '';
    const items = cart.getItems();
    checkoutTotal.textContent = formatMoney(cart.calculateTotal(), items[0]?.currency || 'USD');
    checkoutContinueLabel.textContent = 'Continue to payment';
  });
  tipOptions.addEventListener('change', (event) => {
    if (event.target.matches('input[name="tipAmount"]')) setSelectedTip(Number(event.target.value), true);
  });
  billingBack.addEventListener('click', () => {
    showBillingStep();
    document.getElementById('billing-full-name')?.focus();
  });

  checkoutClose.addEventListener('click', () => checkoutDialog.close());
  checkoutDialog.addEventListener('click', (event) => {
    if (event.target === checkoutDialog) checkoutDialog.close();
  });

  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = cart.getItems();
    if (!items.length || !checkoutQuote || !checkoutSession) {
      showBillingStep();
      paymentStatus.textContent = 'Please confirm your contact information and current order total again.';
      return;
    }

    paymentSubmit.disabled = true;
    paymentSubmitLabel.textContent = 'Processing…';
    paymentStatus.className = 'payment-status';
    paymentStatus.textContent = '';

    try {
      const card = await initializeCard();
      const config = await squareConfigPromise;
      const contact = getBillingContact();
      if (!paymentSourceId) {
        const tokenResult = await card.tokenize({
          amount: ((checkoutQuote.amount + selectedTipAmount) / 100).toFixed(2),
          currencyCode: checkoutQuote.currency || config.currency,
          intent: 'CHARGE',
          customerInitiated: true,
          sellerKeyedIn: false,
          billingContact: contact,
        });
        if (tokenResult.status !== 'OK') {
          const details = (tokenResult.errors || []).map((error) => error.message).filter(Boolean).join(' ');
          throw new Error(details || `Card tokenization failed (${tokenResult.status}).`);
        }
        paymentSourceId = tokenResult.token;
      }

      console.log('[Square] Card tokenized; sending payment request');
      const result = await fetchJson('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...checkoutRequestBody(contact, checkoutQuote.amount, checkoutQuote.currency),
          paymentIdempotencyKey: checkoutSession.paymentKey,
          sourceId: paymentSourceId,
          tipAmount: selectedTipAmount,
        }),
      });

      console.log(`[Square] Payment ${result.payment.status}: ${result.payment.id}`);
      cart.clear();
      paymentStep.hidden = true;
      billingContactForm.reset();
      if (customerNoteCount) customerNoteCount.textContent = '0/500';
      clearCheckoutSession();
      paymentStatus.className = 'payment-status is-success';
      paymentStatus.textContent = `Payment successful — ${formatMoney(result.payment.amount, result.payment.currency)} paid.`;
      if (result.payment.receiptUrl) {
        const receipt = document.createElement('a');
        receipt.href = result.payment.receiptUrl;
        receipt.target = '_blank';
        receipt.rel = 'noreferrer';
        receipt.textContent = ' View Square receipt.';
        paymentStatus.append(receipt);
      }
    } catch (error) {
      if (error.payload?.code === 'PRICE_CHANGED' && error.payload.checkout) {
        paymentSourceId = null;
        applyCheckoutQuote(error.payload.checkout);
        showBillingStep();
        checkoutContinueLabel.textContent = 'Confirm updated total';
        paymentStatus.className = 'payment-status is-warning';
        paymentStatus.textContent = `Your order total changed to ${formatMoney(error.payload.checkout.amount, error.payload.checkout.currency)}. Confirm it before trying payment again.`;
      } else {
        if (error.payload?.code === 'PAYMENT_RETRY_ALLOWED') rotatePaymentAttempt();
        paymentStatus.textContent = error.message || 'Payment could not be completed. Please try again.';
      }
      console.error('[Square] Payment failed:', error.message);
      paymentSubmit.disabled = false;
    } finally {
      if (checkoutQuote) updateCheckoutTotals();
      else paymentSubmitLabel.textContent = 'Pay securely';
    }
  });

  console.log('[Square] Requesting catalog menu from /api/menu');
  fetchJson('/api/menu')
    .then(({ categories }) => {
      if (!Array.isArray(categories) || !categories.length) throw new Error('No purchasable items are available in the Square catalog.');
      renderSquareMenu(categories);
      const count = categories.reduce((sum, category) => sum + category.items.length, 0);
      console.log(`[Square] Menu rendered: ${count} items in ${categories.length} categories`);
    })
    .catch((error) => {
      menuFilters.innerHTML = '';
      menuBody.innerHTML = `<p class="menu-load-error" role="alert"><strong>We couldn’t load the live menu.</strong><br>${escapeSquareHtml(error.message)} Please refresh or call (507) 532-2122.</p>`;
      if (menuStatus) menuStatus.textContent = 'The Square menu could not be loaded.';
      console.error('[Square] Catalog request failed:', error.message);
    });
})();
