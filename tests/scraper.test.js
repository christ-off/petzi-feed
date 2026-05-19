import { describe, it, expect, vi } from "vitest";
import { getEventUrls, parseEvent, fetchAllEvents, fetchVenueMetadata } from "../src/scraper.js";

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
  <p>High Vis fait partie de ces groupes impossibles à enfermer dans une seule case.</p>
  <p>PETZI - Fédération suisse des clubs et des festivals de musiques actuelles</p>
  <p>    Design by KANULART</p>
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

  it("deduplicates repeated paragraphs", async () => {
    const event = await parseEvent("https://x.com/e/1", makeFetcher(EVENT_HTML));
    const count = (event.description.match(/impossibles à enfermer/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("strips PETZI and KANULART boilerplate", async () => {
    const event = await parseEvent("https://x.com/e/1", makeFetcher(EVENT_HTML));
    expect(event.description).not.toContain("PETZI");
    expect(event.description).not.toContain("KANULART");
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

  it("uses provided organiserUrl instead of default", async () => {
    const otherVenueHtml = `
    <html><body>
      <a href="/fr/events/99999-other-venue/">Other Event</a>
    </body></html>`;
    const fetcher = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      text: async () => url.includes("organiser") ? otherVenueHtml : EVENT_HTML,
    }));

    const events = await fetchAllEvents(fetcher, "https://www.petzi.ch/fr/organiser/999/");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("High Vis + Support");
  });
});

describe("fetchVenueMetadata", () => {
  it("extracts venue name and siteUrl from h1 with external link", async () => {
    const html = `<html><body><h1>Pont Rouge <a class="icon-external-link" href="http://www.pontrouge.ch">Voir le site officiel</a></h1></body></html>`;
    const result = await fetchVenueMetadata(makeFetcher(html), "https://www.petzi.ch/fr/organiser/143/");
    expect(result.venueName).toBe("Pont Rouge");
    expect(result.siteUrl).toBe("http://www.pontrouge.ch");
  });

  it("extracts venue name without external link", async () => {
    const html = `<html><body><h1>Le Motorate</h1></body></html>`;
    const result = await fetchVenueMetadata(makeFetcher(html), "https://www.petzi.ch/fr/organiser/55/");
    expect(result.venueName).toBe("Le Motorate");
    expect(result.siteUrl).toBeNull();
  });

  it("strips 'Voir le site officiel' from venue name", async () => {
    const html = `<html><body><h1>Pont Rouge    Voir le site officiel</h1></body></html>`;
    const result = await fetchVenueMetadata(makeFetcher(html), "https://www.petzi.ch/fr/organiser/143/");
    expect(result.venueName).toBe("Pont Rouge");
  });

  it("throws when no h1 found", async () => {
    const html = `<html><body><p>No heading</p></body></html>`;
    await expect(fetchVenueMetadata(makeFetcher(html), "https://x.com/")).rejects.toThrow("No h1 found");
  });

  it("throws on non-200 response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchVenueMetadata(fetcher, "https://x.com/")).rejects.toThrow("HTTP 503");
  });
});
