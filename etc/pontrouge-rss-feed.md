# Pont Rouge — RSS/Atom Feed via AWS Lambda (JavaScript)

## Overview

Scrape `petzi.ch/fr/organiser/143/` and publish an Atom feed to S3.
Triggered daily by EventBridge. Runtime: Node.js 22.x.

---

## Architecture

```
EventBridge (cron) → Lambda (Node.js) → S3 (atom.xml) → Public URL
```

---

## Project Structure

```
petzi-feed/
├── src/
│   ├── scraper.js         # Petzi scraping logic
│   ├── feed.js            # Atom XML builder
│   └── handler.js         # Lambda entry point
├── tests/
│   ├── scraper.test.js
│   └── feed.test.js
├── package.json
└── vitest.config.js
```

---

## Dependencies

```json
{
  "name": "petzi-feed",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0",
    "node-html-parser": "^6.1.13"
  },
  "devDependencies": {
    "vitest": "^4.1.6",
    "@vitest/coverage-v8": "^4.1.6"
  }
}
```

> `node-html-parser` over `cheerio` — lighter, no transitive deps, better cold start.
> Native `fetch` (Node 22) replaces `axios`/`node-fetch`.

---

## Vitest Config — `vitest.config.js`

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
});
```

---

## Scraper — `src/scraper.js`

```js
import { parse } from "node-html-parser";

const BASE_URL = "https://www.petzi.ch";
const ORGANISER_URL = `${BASE_URL}/fr/organiser/143/`;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PontRouge-RSS/1.0)",
  Accept: "text/html",
};

/**
 * @typedef {Object} Event
 * @property {string} title
 * @property {string} dateIso   - ISO 8601, e.g. "2026-06-02T19:30:00+02:00"
 * @property {string} description
 * @property {string|null} imageUrl
 * @property {string} eventUrl
 * @property {string|null} ticketUrl
 * @property {string|null} price
 * @property {string[]} genres
 */

/**
 * Fetch organiser page and return all event detail URLs.
 * @param {typeof fetch} fetcher
 * @returns {Promise<string[]>}
 */
export async function getEventUrls(fetcher = fetch) {
  const resp = await fetcher(ORGANISER_URL, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on organiser page`);

  const root = parse(await resp.text());
  const seen = new Set();
  const urls = [];

  for (const a of root.querySelectorAll("a[href*='/fr/events/']")) {
    const href = a.getAttribute("href");
    if (href && !seen.has(href)) {
      seen.add(href);
      urls.push(href.startsWith("/") ? `${BASE_URL}${href}` : href);
    }
  }

  return urls;
}

/**
 * Parse a single event detail page.
 * @param {string} url
 * @param {typeof fetch} fetcher
 * @returns {Promise<Event|null>}
 */
export async function parseEvent(url, fetcher = fetch) {
  const resp = await fetcher(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);

  const root = parse(await resp.text());

  const title = root.querySelector("h1")?.text?.trim();
  if (!title) return null;

  const dateIso = parseDateFromGcal(root) ?? parseDateFromHeading(root);

  const description = root
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter((t) => t.length > 40)
    .join("\n\n");

  const imageUrl =
    root.querySelector("meta[property='og:image']")?.getAttribute("content") ?? null;

  const ticketHref =
    root.querySelector("a[href*='/tickets/']")?.getAttribute("href") ?? null;
  const ticketUrl = ticketHref
    ? ticketHref.startsWith("/") ? `${BASE_URL}${ticketHref}` : ticketHref
    : null;

  const priceText = root.querySelector("h4")?.text ?? "";
  const price = priceText.includes("CHF") ? priceText.trim() : null;

  const genres = root
    .querySelectorAll("a[href*='/search/?q=']")
    .map((a) => a.text.trim())
    .filter(Boolean);

  return { title, dateIso, description, imageUrl, eventUrl: url, ticketUrl, price, genres };
}

/**
 * Fetch all events, failing silently on individual page errors.
 * @param {typeof fetch} fetcher
 * @returns {Promise<Event[]>}
 */
export async function fetchAllEvents(fetcher = fetch) {
  const urls = await getEventUrls(fetcher);

  const results = await Promise.allSettled(
    urls.map((url) => parseEvent(url, fetcher))
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

// --- Helpers ---

function parseDateFromGcal(root) {
  const href = root.querySelector("a[href*='calendar.google.com']")?.getAttribute("href");
  const match = href?.match(/dates=(\d{8}T\d{6})/);
  if (!match) return null;

  const r = match[1]; // e.g. "20260602T193000"
  return `${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)}T${r.slice(9, 11)}:${r.slice(11, 13)}:${r.slice(13, 15)}+02:00`;
}

function parseDateFromHeading(root) {
  return root.querySelector("h3")?.text?.trim() ?? null;
}
```

---

## Feed Builder — `src/feed.js`

```js
/**
 * Build an Atom 1.0 feed from a list of events.
 * @param {import('./scraper.js').Event[]} events
 * @param {string} feedUrl - Public self URL of this feed
 * @returns {string}
 */
export function buildAtomFeed(events, feedUrl) {
  const updated = new Date().toISOString();

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:media="http://search.yahoo.com/mrss/">
  <title>Pont Rouge — Concerts</title>
  <id>${feedUrl}</id>
  <link href="https://www.pontrouge.ch" rel="alternate"/>
  <link href="${feedUrl}" rel="self"/>
  <updated>${updated}</updated>
  <author><name>Pont Rouge</name></author>
${events.map(buildEntry).join("\n")}
</feed>`;
}

function buildEntry(event) {
  const { title, dateIso, description, imageUrl, eventUrl, ticketUrl, price, genres } = event;

  const imageTag = imageUrl
    ? `    <media:content url="${esc(imageUrl)}" medium="image"/>`
    : "";

  const ticketTag = ticketUrl
    ? `    <link rel="enclosure" href="${esc(ticketUrl)}" title="Acheter des billets"/>`
    : "";

  const priceHtml = price ? `<p><strong>Prix:</strong> ${esc(price)}</p>` : "";
  const genresHtml = genres.length ? `<p><em>${esc(genres.join(", "))}</em></p>` : "";
  const body = description.replace(/\n\n/g, "</p><p>");
  const contentHtml = esc(`${priceHtml}${genresHtml}<p>${body}</p>`);

  return `  <entry>
    <title>${esc(title)}</title>
    <id>${esc(eventUrl)}</id>
    <link href="${esc(eventUrl)}" rel="alternate"/>
    ${ticketTag}
    <updated>${dateIso}</updated>
    <published>${dateIso}</published>
    <content type="html">${contentHtml}</content>
    ${imageTag}
  </entry>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

---

## Lambda Handler — `src/handler.js`

```js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fetchAllEvents } from "./scraper.js";
import { buildAtomFeed } from "./feed.js";

const s3 = new S3Client({});
const BUCKET = process.env.S3_BUCKET;
const KEY = process.env.S3_KEY ?? "petzi-feed/atom.xml";
const FEED_URL = process.env.FEED_URL ?? `https://${BUCKET}.s3.amazonaws.com/${KEY}`;

export async function handler() {
  console.log("Fetching events...");
  const events = await fetchAllEvents();
  console.log(`Found ${events.length} events`);

  const feed = buildAtomFeed(events, FEED_URL);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: KEY,
    Body: feed,
    ContentType: "application/atom+xml; charset=utf-8",
    CacheControl: "max-age=3600",
  }));

  console.log(`Published to s3://${BUCKET}/${KEY}`);
  return { statusCode: 200, eventCount: events.length };
}
```

---

## Tests — `tests/scraper.test.js`

```js
import { describe, it, expect, vi } from "vitest";
import { getEventUrls, parseEvent, fetchAllEvents } from "../src/scraper.js";

const ORGANISER_HTML = `
<html><body>
  <a href="/fr/events/63101-pont-rouge-high-vis-support/">High Vis</a>
  <a href="/fr/events/62759-pont-rouge-man-with-a-mission/">MWAM</a>
  <a href="/fr/events/63101-pont-rouge-high-vis-support/">duplicate</a>
</body></html>`;

const EVENT_HTML = `
<html>
<head>
  <meta property="og:image" content="https://www.petzi.ch/media/events/highvis.jpg"/>
</head>
<body>
  <h1>High Vis + Support</h1>
  <h4>Prix à partir de CHF 27,00</h4>
  <h3>mardi 2 juin 2026</h3>
  <a href="https://calendar.google.com/calendar/render?dates=20260602T193000%2F20260603T013000">
    Google calendar
  </a>
  <a href="/fr/events/63101-pont-rouge-high-vis-support/tickets/">Acheter des billets</a>
  <a href="/fr/search/?q=punk">Punk</a>
  <a href="/fr/search/?q=rock">Rock</a>
  <p>High Vis fait partie de ces groupes impossibles à enfermer dans une seule case.</p>
  <p>Déjà aperçu sur les scènes des plus grands festivals européens.</p>
  <p>ok</p>
</body></html>`;

const makeFetcher = (html) =>
  vi.fn().mockResolvedValue({ ok: true, text: async () => html });

describe("getEventUrls", () => {
  it("extracts unique event URLs", async () => {
    const urls = await getEventUrls(makeFetcher(ORGANISER_HTML));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://www.petzi.ch/fr/events/63101-pont-rouge-high-vis-support/");
  });

  it("throws on non-200 response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(getEventUrls(fetcher)).rejects.toThrow("HTTP 503");
  });
});

describe("parseEvent", () => {
  it("parses all fields correctly", async () => {
    const event = await parseEvent("https://www.petzi.ch/fr/events/63101/", makeFetcher(EVENT_HTML));

    expect(event.title).toBe("High Vis + Support");
    expect(event.dateIso).toBe("2026-06-02T19:30:00+02:00");
    expect(event.price).toBe("Prix à partir de CHF 27,00");
    expect(event.imageUrl).toBe("https://www.petzi.ch/media/events/highvis.jpg");
    expect(event.ticketUrl).toBe("https://www.petzi.ch/fr/events/63101-pont-rouge-high-vis-support/tickets/");
    expect(event.genres).toEqual(["Punk", "Rock"]);
    expect(event.description).toContain("impossible");
  });

  it("filters out short paragraphs", async () => {
    const event = await parseEvent("https://x.com/e/1", makeFetcher(EVENT_HTML));
    expect(event.description).not.toContain("ok");
  });

  it("returns null if no h1 found", async () => {
    const event = await parseEvent("https://x.com/e/1", makeFetcher("<html><body><p>nothing</p></body></html>"));
    expect(event).toBeNull();
  });

  it("throws on non-200 response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(parseEvent("https://x.com/e/1", fetcher)).rejects.toThrow("HTTP 404");
  });
});

describe("fetchAllEvents", () => {
  it("returns successfully parsed events", async () => {
    const fetcher = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      text: async () => url.includes("organiser") ? ORGANISER_HTML : EVENT_HTML,
    }));

    const events = await fetchAllEvents(fetcher);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe("High Vis + Support");
  });

  it("skips failed event pages gracefully", async () => {
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async (url) => {
      callCount++;
      if (url.includes("organiser")) return { ok: true, text: async () => ORGANISER_HTML };
      if (callCount === 2) return { ok: false, status: 404 };
      return { ok: true, text: async () => EVENT_HTML };
    });

    const events = await fetchAllEvents(fetcher);
    expect(events).toHaveLength(1);
  });
});
```

---

## Tests — `tests/feed.test.js`

```js
import { describe, it, expect } from "vitest";
import { buildAtomFeed } from "../src/feed.js";

const MOCK_EVENT = {
  title: "High Vis + Support",
  dateIso: "2026-06-02T19:30:00+02:00",
  description: "A great punk band from London.",
  imageUrl: "https://www.petzi.ch/media/events/highvis.jpg",
  eventUrl: "https://www.petzi.ch/fr/events/63101-pont-rouge-high-vis-support/",
  ticketUrl: "https://www.petzi.ch/fr/events/63101/tickets/",
  price: "CHF 27,00",
  genres: ["Punk", "Rock"],
};

describe("buildAtomFeed", () => {
  it("produces valid Atom XML envelope", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("</feed>");
  });

  it("includes event title", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain("<title>High Vis + Support</title>");
  });

  it("includes published date", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain("<published>2026-06-02T19:30:00+02:00</published>");
  });

  it("includes ticket enclosure link", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain('rel="enclosure"');
    expect(xml).toContain("tickets/");
  });

  it("includes media image tag", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain("media:content");
    expect(xml).toContain("highvis.jpg");
  });

  it("escapes HTML special characters in title", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, title: "AC/DC & Friends <Tour>" }],
      "https://example.com/atom.xml"
    );
    expect(xml).toContain("AC/DC &amp; Friends &lt;Tour&gt;");
  });

  it("omits media and enclosure tags when null", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, imageUrl: null, ticketUrl: null }],
      "https://example.com/atom.xml"
    );
    expect(xml).not.toContain("media:content");
    expect(xml).not.toContain('rel="enclosure"');
  });

  it("handles empty event list", () => {
    const xml = buildAtomFeed([], "https://example.com/atom.xml");
    expect(xml).toContain("<feed");
    expect(xml).not.toContain("<entry>");
  });
});
```

---

## Deploy

```bash
# Run tests first
npm test

# Install prod deps only
npm ci --omit=dev

# Bundle
zip -r function.zip src/ node_modules/ package.json

# Create Lambda
aws lambda create-function \
  --function-name petzi-feed \
  --runtime nodejs22.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-s3-role \
  --handler src/handler.handler \
  --zip-file fileb://function.zip \
  --timeout 60 \
  --environment Variables="{
    S3_BUCKET=my-petzi-feed,
    S3_KEY=petzi-feed/atom.xml,
    FEED_URL=https://my-petzi-feed.s3.eu-west-1.amazonaws.com/petzi-feed/atom.xml
  }"
```

### EventBridge — daily trigger

```bash
aws events put-rule \
  --name petzi-feed-daily \
  --schedule-expression "cron(0 7 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule petzi-feed-daily \
  --targets "Id=1,Arn=arn:aws:lambda:eu-west-1:YOUR_ACCOUNT:function:petzi-feed"
```

### S3 — public read

```bash
aws s3api put-bucket-policy --bucket my-petzi-feed --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::my-petzi-feed/*"
  }]
}'
```

### IAM Role — minimal permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::my-petzi-feed/*"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

---

## Limitations

- Petzi HTML structure may change — set a CloudWatch alarm on Lambda errors.
