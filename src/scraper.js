import { parse } from "node-html-parser";

const BASE_URL = "https://www.petzi.ch";

const DEFAULT_ORGANISER_URL =
  process.env.PETZI_ORGANISER_URL ?? `${BASE_URL}/fr/organiser/143/`;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PontRouge-RSS/1.0)",
  Accept: "text/html",
};

const BOILERPLATE = /PETZI\s*[-–]|Design by KANULART/i;

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
export async function getEventUrls(fetcher = fetch, organiserUrl = DEFAULT_ORGANISER_URL) {
  const resp = await fetcher(organiserUrl, { headers: HEADERS });
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

  const seen = new Set();
  const description = root
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter((t) => {
      if (t.length <= 40) return false;
      if (BOILERPLATE.test(t)) return false;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .join("\n\n");

  const imageUrl =
    root.querySelector("meta[property='og:image']")?.getAttribute("content") ?? null;

  const ticketHref =
    root.querySelector("a[href*='/tickets/']")?.getAttribute("href") ?? null;
  let ticketUrl = null;
  if (ticketHref) {
    ticketUrl = ticketHref.startsWith("/") ? `${BASE_URL}${ticketHref}` : ticketHref;
  }

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
export async function fetchAllEvents(fetcher = fetch, organiserUrl = DEFAULT_ORGANISER_URL) {
  const urls = await getEventUrls(fetcher, organiserUrl);

  const results = await Promise.allSettled(
    urls.map((url) => parseEvent(url, fetcher))
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

/**
 * Fetch organiser page and extract venue metadata (h1 title + external link).
 * @param {typeof fetch} fetcher
 * @param {string} organiserUrl
 * @returns {Promise<{ venueName: string, siteUrl: string }>}
 */
export async function fetchVenueMetadata(organiserUrl, fetcher = fetch) {
  const resp = await fetcher(organiserUrl, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching metadata from ${organiserUrl}`);

  const root = parse(await resp.text());
  const h1 = root.querySelector("h1");
  if (!h1) throw new Error(`No h1 found on ${organiserUrl}`);

  const siteUrl = h1.querySelector("a.icon-external-link")?.getAttribute("href") ?? null;
  const venueName = h1.text?.replaceAll("Voir le site officiel", "").trim();
  if (!venueName) throw new Error(`No venue name found on ${organiserUrl}`);

  return { venueName, siteUrl };
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
