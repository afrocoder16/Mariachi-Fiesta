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

  const liveItems = new Map();
  let liveGroups = [];
  let liveCategory = 'all';
  let squareCard;
  let cardInitialization;
  let lastFocusedElement;
  let checkoutQuote;
  let checkoutSession;
  let paymentSourceId;

  const CHECKOUT_SESSION_KEY = 'mariachi-fiesta-checkout-v1';

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
    groups.forEach((group) => group.items.forEach((item) => liveItems.set(item.id, item)));

    const catalogCartItems = groups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.variations.map((variation) => ({
          variationId: variation.id,
          name: item.name,
          variationName: variation.name,
          price: variation.price,
          currency: variation.currency,
          quantity: 1,
        }))
      )
    );
    const removedItems = cart.syncWithCatalog(catalogCartItems);
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

            return `<li class="menu-item${imageUrl ? ' menu-item--photo' : ''}" data-item-id="${escapeSquareHtml(item.id)}" data-search="${escapeSquareHtml(haystack)}">
              ${thumbnail}
              <span class="menu-item__top">
                <h4 class="menu-item__name">${escapeSquareHtml(item.name)}</h4>
                <span class="menu-item__leader" aria-hidden="true"></span>
                <span class="menu-item__price">${priceLabel(item.variations)}</span>
              </span>
              ${description}
              <span class="menu-item__order">${selector}<button class="add-to-cart" type="button">Add to cart</button></span>
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
  }

  menuFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('.menu-chip');
    if (!chip || !liveGroups.length) return;
    liveCategory = chip.dataset.category;
    menuFilters.querySelectorAll('.menu-chip').forEach((button) => button.setAttribute('aria-pressed', String(button === chip)));
    chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    applySquareFilters();
  });

  menuSearch?.addEventListener('input', applySquareFilters);
  menuClear?.addEventListener('click', () => {
    menuSearch.value = '';
    menuSearch.focus();
    applySquareFilters();
  });
  menuReset?.addEventListener('click', () => {
    menuSearch.value = '';
    liveCategory = 'all';
    menuFilters.querySelectorAll('.menu-chip').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === 'all')));
    applySquareFilters();
  });

  menuBody.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) {
      const row = event.target.closest('.menu-item');
      event.target.closest('.menu-item__thumb')?.remove();
      row?.classList.remove('menu-item--photo');
    }
  }, true);

  menuBody.addEventListener('click', (event) => {
    const button = event.target.closest('.add-to-cart');
    if (!button) return;
    const row = button.closest('.menu-item');
    const item = liveItems.get(row.dataset.itemId);
    const variationId = row.querySelector('select, input[type="hidden"]')?.value;
    const variation = item?.variations.find((entry) => entry.id === variationId);
    if (!item || !variation) return;

    cart.addItem({
      variationId: variation.id,
      name: item.name,
      variationName: variation.name,
      price: variation.price,
      currency: variation.currency,
      quantity: 1,
    });
    button.textContent = 'Added!';
    if (cartAnnouncer) cartAnnouncer.textContent = `${item.name} added to your cart.`;
    cartToggle.classList.remove('has-update');
    void cartToggle.offsetWidth;
    cartToggle.classList.add('has-update');
    setTimeout(() => cartToggle.classList.remove('has-update'), 650);
    setTimeout(() => (button.textContent = 'Add to cart'), 900);
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
    checkoutTotal.textContent = formattedTotal;
    checkoutCount.textContent = itemCountLabel(totalQuantity);
    cartEmpty.hidden = items.length > 0;
    checkoutButton.disabled = items.length === 0;

    cartList.innerHTML = items
      .map(
        (item) => `<li class="cart-line" data-variation-id="${escapeSquareHtml(item.variationId)}">
          <div><strong>${escapeSquareHtml(item.name)}</strong><span>${escapeSquareHtml(item.variationName === 'Regular' ? '' : item.variationName || '')}</span></div>
          <span class="cart-line__price">${formatMoney(item.price * item.quantity, item.currency)}</span>
          <div class="quantity-control" aria-label="Quantity for ${escapeSquareHtml(item.name)}">
            <button type="button" data-cart-action="decrease" aria-label="Decrease quantity">−</button><b>${item.quantity}</b><button type="button" data-cart-action="increase" aria-label="Increase quantity">+</button>
          </div>
          <button class="cart-line__remove" type="button" data-cart-action="remove">Remove</button>
        </li>`
      )
      .join('');
  }

  cartList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const variationId = button.closest('.cart-line').dataset.variationId;
    const item = cart.getItems().find((entry) => entry.variationId === variationId);
    if (!item) return;
    if (button.dataset.cartAction === 'increase') cart.updateQuantity(variationId, item.quantity + 1);
    if (button.dataset.cartAction === 'decrease') cart.updateQuantity(variationId, item.quantity - 1);
    if (button.dataset.cartAction === 'remove') cart.removeItem(variationId);
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
      addressLines: [String(fields.get('address') || '').trim()],
      city: String(fields.get('city') || '').trim(),
      state: String(fields.get('state') || '').trim().toUpperCase(),
      countryCode: 'US',
      postalCode: String(fields.get('postalCode') || '').trim(),
    };
  }

  async function checkoutSignature(contact, items) {
    const value = JSON.stringify({
      cart: items
        .map((item) => ({ variationId: item.variationId, quantity: item.quantity }))
        .sort((a, b) => a.variationId.localeCompare(b.variationId)),
      contact,
    });
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function readCheckoutSession() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(CHECKOUT_SESSION_KEY) || 'null');
      const validKey = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
      return stored && typeof stored.signature === 'string' && validKey(stored.orderKey) && validKey(stored.paymentKey)
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

  async function ensureCheckoutSession(contact, items) {
    const signature = await checkoutSignature(contact, items);
    const stored = readCheckoutSession();
    const next = stored?.signature === signature
      ? stored
      : { signature, orderKey: window.crypto.randomUUID(), paymentKey: window.crypto.randomUUID() };

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
    try {
      window.sessionStorage.removeItem(CHECKOUT_SESSION_KEY);
    } catch {
      // Nothing else is required when storage is unavailable.
    }
  }

  function checkoutRequestBody(contact, expectedAmount, expectedCurrency) {
    const items = cart.getItems();
    return {
      orderIdempotencyKey: checkoutSession.orderKey,
      cart: items.map((item) => ({ variationId: item.variationId, quantity: item.quantity })),
      billingContact: contact,
      expectedAmount,
      expectedCurrency,
    };
  }

  function applyCheckoutQuote(quote) {
    if (!quote) return;
    cart.syncWithCatalog(quote.items || []);
    checkoutQuote = { ...quote, orderKey: checkoutSession?.orderKey };
    checkoutTotal.textContent = formatMoney(quote.amount, quote.currency);
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
    document.getElementById('billing-full-name')?.focus();
  });

  billingContactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const requiredFields = billingContactForm.querySelectorAll('input[required]');
    requiredFields.forEach((field) => field.setCustomValidity(field.value.trim() ? '' : 'This field is required.'));
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
      const session = await ensureCheckoutSession(contact, items);
      const confirmedQuote = checkoutQuote?.orderKey === session.orderKey ? checkoutQuote : null;
      const expectedAmount = confirmedQuote?.amount ?? cart.calculateTotal();
      const expectedCurrency = confirmedQuote?.currency || items[0]?.currency || 'USD';
      const result = await fetchJson('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutRequestBody(contact, expectedAmount, expectedCurrency)),
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
    checkoutQuote = null;
    checkoutSession = null;
    paymentSourceId = null;
    checkoutContinueLabel.textContent = 'Continue to payment';
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
          amount: (checkoutQuote.amount / 100).toFixed(2),
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
        }),
      });

      console.log(`[Square] Payment ${result.payment.status}: ${result.payment.id}`);
      cart.clear();
      paymentStep.hidden = true;
      billingContactForm.reset();
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
      paymentSubmitLabel.textContent = 'Pay securely';
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
