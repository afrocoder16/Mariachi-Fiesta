const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

function closeMenu() {
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open menu');
  mobileMenu?.setAttribute('aria-hidden', 'true');
  mobileMenu?.classList.remove('is-open');
}

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  menuToggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
  mobileMenu.setAttribute('aria-hidden', String(open));
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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;

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
