# Mariachi Fiesta

Production website and Square-powered online ordering for Mariachi Fiesta in Marshall, Minnesota.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Main customer-facing website |
| `privacy.html` | Privacy policy |
| `order-policy.html` | Online ordering policy |
| `styles.css` | Site styles, responsive layouts, and motion |
| `script.js` | Website UI, menu rendering, cart, and checkout flow |
| `shopping-cart.js` | Cart state and local storage |
| `square-config.js` | Server-side Square Catalog and Payments integration |
| `site-config.js` | Public site configuration exposed by the server |
| `server.js` | Node server and API routes |
| `images/` | Optimized WebP assets used by the live website |
| `tests/` | Automated server, checkout, and browser smoke tests |
| `archive/` | Original source assets and retired code; not used at runtime |

## Local setup

Requirements: Node.js 20 or newer and Square developer credentials.

1. Copy `.env.example` to `.env`.
2. Add the appropriate Square application, access token, and location values.
3. Start the site with `npm start`.
4. Open `http://localhost:3000`.

Never put a Square access token in browser code, commit `.env`, or commit `id.md`.

## Quality checks

Run these before deployment:

```powershell
npm run check
npm test
```

## Deployment

This is a Node application, not a static GitHub Pages site. The host must run `server.js` so `/api/config`, `/api/menu`, `/api/checkout`, and `/api/payments` are available.

For a live launch:

- use HTTPS;
- set `SQUARE_ENVIRONMENT=production`;
- use production Square credentials from the Square Developer Console;
- confirm the production location ID and API version;
- complete a real low-value order and verify it in Square before advertising online ordering.

The current `.env.example` values are placeholders and safe to commit.
