import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { getEventUrls, fetchAllEvents } from "../src/scraper.js";
import { buildAtomFeed } from "../src/feed.js";

const ORGANISER_URL = "https://www.petzi.ch/fr/organiser/143/";

describe("integration - live organiser page", () => {
  it("venue name is Pont Rouge", async () => {
    const resp = await fetch(ORGANISER_URL);
    expect(resp.ok).toBe(true);
    const html = await resp.text();
    const root = parse(html);
    const title = root.querySelector("h1")?.text?.trim();
    expect(title).toContain("Pont Rouge");
  });

  it("has at least one event", async () => {
    const events = await fetchAllEvents(undefined, fetch);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("feed title contains Pont Rouge", async () => {
    const events = await fetchAllEvents(undefined, fetch);
    const feed = buildAtomFeed(events, "https://example.com/atom.xml", "Pont Rouge");
    expect(feed).toContain("<title>Pont Rouge — Concerts</title>");
    expect(feed).toContain("<author><name>Pont Rouge</name></author>");
  });

  it("at least one event has 'Concert' in its tag-list section", async () => {
    const eventUrls = await getEventUrls(fetch);
    expect(eventUrls.length).toBeGreaterThanOrEqual(1);

    for (const url of eventUrls) {
      const resp = await fetch(url);
      expect(resp.ok).toBe(true);
      const html = await resp.text();
      const root = parse(html);
      const tagList = root.querySelector("section.tag-list");
      if (tagList && tagList.text.includes("Concert")) {
        return expect(true).toBe(true);
      }
    }
    expect.fail("No event page contained 'Concert' in a <section class=\"tag-list\">");
  });
});