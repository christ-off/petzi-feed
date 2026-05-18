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
  const venueName = "Pont Rouge";

  it("produces valid Atom XML envelope", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("</feed>");
  });

  it("includes venue name in feed title and author", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain(`<title>${venueName} — Concerts</title>`);
    expect(xml).toContain(`<author><name>${venueName}</name></author>`);
  });

  it("uses custom venue name when provided", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", "The Velvet Note");
    expect(xml).toContain("<title>The Velvet Note — Concerts</title>");
    expect(xml).toContain("<author><name>The Velvet Note</name></author>");
  });

  it("escapes venue name in title and author", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", "AC/DC Club");
    expect(xml).toContain("<title>AC/DC Club — Concerts</title>");
    expect(xml).toContain("<author><name>AC/DC Club</name></author>");
  });

  it("defaults to Pont Rouge when venue name is omitted", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml");
    expect(xml).toContain("<title>Pont Rouge — Concerts</title>");
    expect(xml).toContain("<author><name>Pont Rouge</name></author>");
  });

  it("includes event title", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain("<title>High Vis + Support</title>");
  });

  it("includes published date", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain("<published>2026-06-02T19:30:00+02:00</published>");
  });

  it("includes ticket enclosure link", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain('rel="enclosure"');
    expect(xml).toContain("tickets/");
  });

  it("includes media image tag", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain("media:content");
    expect(xml).toContain("highvis.jpg");
  });

  it("escapes HTML special characters in event title", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, title: "AC/DC & Friends <Tour>" }],
      "https://example.com/atom.xml",
      venueName
    );
    expect(xml).toContain("AC/DC &amp; Friends &lt;Tour&gt;");
  });

  it("includes category elements for genres", () => {
    const xml = buildAtomFeed([MOCK_EVENT], "https://example.com/atom.xml", venueName);
    expect(xml).toContain('<category term="Punk"/>');
    expect(xml).toContain('<category term="Rock"/>');
  });

  it("escapes genres in category elements", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, genres: ["AC/DC", "Metallica & Sons"] }],
      "https://example.com/atom.xml",
      venueName
    );
    expect(xml).toContain('<category term="AC/DC"/>');
    expect(xml).toContain('<category term="Metallica &amp; Sons"/>');
  });

  it("omits category elements when no genres", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, genres: [] }],
      "https://example.com/atom.xml",
      venueName
    );
    expect(xml).not.toContain("<category");
  });

  it("omits media and enclosure tags when null", () => {
    const xml = buildAtomFeed(
      [{ ...MOCK_EVENT, imageUrl: null, ticketUrl: null }],
      "https://example.com/atom.xml",
      venueName
    );
    expect(xml).not.toContain("media:content");
    expect(xml).not.toContain('rel="enclosure"');
  });

  it("handles empty event list", () => {
    const xml = buildAtomFeed([], "https://example.com/atom.xml", venueName);
    expect(xml).toContain("<feed");
    expect(xml).not.toContain("<entry>");
  });
});
