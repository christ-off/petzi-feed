import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFeedsConfig, buildFeedUrl, filterEvents, parseGenres, DEFAULT_GENRES, createHandler } from "../src/handler.js";

function createMockS3(sendFn) {
  return { send: sendFn ?? vi.fn().mockResolvedValue({}) };
}

function createTestHandler(s3Send, scraper, feed) {
  const mockS3 = createMockS3(s3Send);
  return createHandler({
    s3: mockS3,
    fetchAllEvents: scraper.fetchAllEvents,
    fetchVenueMetadata: scraper.fetchVenueMetadata,
    buildAtomFeed: feed.buildAtomFeed,
  });
}

describe("parseFeedsConfig", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when FEEDS_CONFIG is absent", () => {
    delete process.env.FEEDS_CONFIG;
    expect(parseFeedsConfig()).toBeNull();
  });

  it("returns null when FEEDS_CONFIG is empty", () => {
    process.env.FEEDS_CONFIG = "";
    expect(parseFeedsConfig()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    process.env.FEEDS_CONFIG = "not-json";
    expect(parseFeedsConfig()).toBeNull();
  });

  it("parses valid JSON array", () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://x.com/1", s3Key: "a.xml", venueName: "A", siteUrl: "https://a.ch" },
    ]);
    const config = parseFeedsConfig();
    expect(config).toHaveLength(1);
    expect(config[0].venueName).toBe("A");
  });

  it("returns empty array for empty JSON array", () => {
    process.env.FEEDS_CONFIG = "[]";
    expect(parseFeedsConfig()).toEqual([]);
  });
});

describe("buildFeedUrl", () => {
  it("builds correct S3 URL", () => {
    expect(buildFeedUrl("my-bucket", "path/feed.xml", "eu-west-1"))
      .toBe("https://my-bucket.s3.eu-west-1.amazonaws.com/path/feed.xml");
  });
});

describe("filterEvents", () => {
  it("keeps event when genres intersect", () => {
    const events = [{ title: "Metal Show", genres: ["Concert", "Metal"] }];
    expect(filterEvents(events, ["Metal", "Rock"])).toEqual(events);
  });

  it("drops event when no genre match", () => {
    const events = [{ title: "Jazz Night", genres: ["Concert", "Jazz"] }];
    expect(filterEvents(events, ["Metal", "Rock"])).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const events = [{ title: "Show", genres: ["Concert", "metal"] }];
    expect(filterEvents(events, ["Metal"])).toEqual(events);
  });

  it("drops non-Concert events even with genre match", () => {
    const events = [{ title: "Metal Thing", genres: ["Metal"] }];
    expect(filterEvents(events, ["Metal"])).toEqual([]);
  });

  it("throws when filter array is empty", () => {
    expect(() => filterEvents([], [])).toThrow("genres filter cannot be empty");
  });

  it("throws when filter is null", () => {
    expect(() => filterEvents([], null)).toThrow("genres filter cannot be empty");
  });

  it("throws when filter is undefined", () => {
    expect(() => filterEvents([], undefined)).toThrow("genres filter cannot be empty");
  });

  it("keeps event matching any genre in the filter list", () => {
    const events = [
      { title: "Rock Show", genres: ["Concert", "Rock"] },
      { title: "Punk Show", genres: ["Concert", "Punk"] },
      { title: "Jazz Night", genres: ["Concert", "Jazz"] },
    ];
    expect(filterEvents(events, ["Metal", "Rock"])).toHaveLength(1);
    expect(filterEvents(events, ["Metal", "Punk"])).toHaveLength(1);
  });

  it("filters by multiple genres correctly", () => {
    const events = [
      { title: "Metal", genres: ["Concert", "Metal"] },
      { title: "Rock", genres: ["Concert", "Rock"] },
      { title: "Both", genres: ["Concert", "Metal", "Rock"] },
      { title: "Other", genres: ["Concert", "Jazz"] },
    ];
    expect(filterEvents(events, ["Metal", "Rock"])).toHaveLength(3);
  });
});

describe("parseGenres", () => {
  it("returns default when input is undefined", () => {
    expect(parseGenres(undefined)).toEqual(["Metal", "Alternatif"]);
  });

  it("returns default when input is null", () => {
    expect(parseGenres(null)).toEqual(["Metal", "Alternatif"]);
  });

  it("parses comma-separated list", () => {
    expect(parseGenres("Metal,Rock,Punk")).toEqual(["Metal", "Rock", "Punk"]);
  });

  it("trims whitespace", () => {
    expect(parseGenres(" Metal , Rock ")).toEqual(["Metal", "Rock"]);
  });

  it("throws on empty string", () => {
    expect(() => parseGenres("")).toThrow("genres filter cannot be empty");
  });

  it("throws on blank-only string", () => {
    expect(() => parseGenres("  ")).toThrow("genres filter cannot be empty");
  });
});

describe("handler — multi-feed loop", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.S3_BUCKET = "test-bucket";
    process.env.AWS_REGION = "eu-west-1";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("processes all feeds and returns success results", async () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://petzi.ch/org/1/", s3Key: "feeds/a.xml" },
      { organiserUrl: "https://petzi.ch/org/2/", s3Key: "feeds/b.xml" },
    ]);
    process.env.GENRES = "Metal,Rock";

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn().mockResolvedValue({ venueName: "Venue A", siteUrl: "https://venue-a.ch" }),
      fetchAllEvents: vi.fn().mockResolvedValue([{ title: "Gig", genres: ["Concert", "Metal"] }]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.feeds).toHaveLength(2);
    expect(result.feeds.every((f) => f.status === "success")).toBe(true);
    expect(s3Send).toHaveBeenCalledTimes(2);
  });

  it("records error result when a feed fails, continues processing others", async () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://petzi.ch/org/1/", s3Key: "feeds/a.xml" },
      { organiserUrl: "https://petzi.ch/org/2/", s3Key: "feeds/b.xml" },
    ]);

    const s3Send = vi.fn().mockResolvedValue({});
    const fetchVenueMetadata = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce({ venueName: "Venue B", siteUrl: null });

    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata,
      fetchAllEvents: vi.fn().mockResolvedValue([]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.feeds[0].status).toBe("error");
    expect(result.feeds[0].error).toBe("HTTP 503");
    expect(result.feeds[1].status).toBe("success");
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it("falls through to legacy path when FEEDS_CONFIG is empty array", async () => {
    process.env.FEEDS_CONFIG = "[]";
    process.env.S3_KEY = "legacy/atom.xml";
    process.env.PETZI_ORGANISER_URL = "https://petzi.ch/org/143/";
    process.env.VENUE_NAME = "Pont Rouge";
    process.env.GENRES = "Metal,Rock";

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn(),
      fetchAllEvents: vi.fn().mockResolvedValue([{ title: "Show", genres: ["Concert", "Metal"] }]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.eventCount).toBe(1);
    expect(result.feeds).toBeUndefined();
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it("filters events by shared GENRES env var in multi-feed", async () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://petzi.ch/org/1/", s3Key: "feeds/a.xml" },
    ]);
    process.env.GENRES = "Metal,Rock";

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn().mockResolvedValue({ venueName: "Venue A", siteUrl: null }),
      fetchAllEvents: vi.fn().mockResolvedValue([
        { title: "Metal Show", genres: ["Concert", "Metal"] },
        { title: "Jazz Night", genres: ["Concert", "Jazz"] },
        { title: "Rock On", genres: ["Concert", "Rock"] },
      ]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.feeds[0].status).toBe("success");
    expect(result.feeds[0].eventCount).toBe(2);
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it("records error when shared GENRES env var is empty in multi-feed", async () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://petzi.ch/org/1/", s3Key: "feeds/a.xml" },
      { organiserUrl: "https://petzi.ch/org/2/", s3Key: "feeds/b.xml" },
    ]);
    process.env.GENRES = "";

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn().mockResolvedValue({ venueName: "Venue A", siteUrl: null }),
      fetchAllEvents: vi.fn().mockResolvedValue([]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.feeds[0].status).toBe("error");
    expect(result.feeds[0].error).toBe("genres filter cannot be empty");
    expect(result.feeds[1].status).toBe("error");
    expect(result.feeds[1].error).toBe("genres filter cannot be empty");
  });

  it("uses default genres when GENRES env var is absent in legacy path", async () => {
    process.env.FEEDS_CONFIG = "[]";
    process.env.S3_KEY = "legacy/atom.xml";
    process.env.PETZI_ORGANISER_URL = "https://petzi.ch/org/143/";
    process.env.VENUE_NAME = "Pont Rouge";
    delete process.env.GENRES;

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn(),
      fetchAllEvents: vi.fn().mockResolvedValue([{ title: "Show", genres: ["Concert", "Metal"] }]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.eventCount).toBe(1);
  });

  it("applies GENRES env var in legacy path", async () => {
    process.env.FEEDS_CONFIG = "[]";
    process.env.S3_KEY = "legacy/atom.xml";
    process.env.PETZI_ORGANISER_URL = "https://petzi.ch/org/143/";
    process.env.VENUE_NAME = "Pont Rouge";
    process.env.GENRES = "Punk";

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = createTestHandler(s3Send, {
      fetchVenueMetadata: vi.fn(),
      fetchAllEvents: vi.fn().mockResolvedValue([
        { title: "Metal Show", genres: ["Concert", "Metal"] },
        { title: "Punk Show", genres: ["Concert", "Punk"] },
      ]),
    }, { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.eventCount).toBe(1);
  });
});
