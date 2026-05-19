import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFeedsConfig, buildFeedUrl } from "../src/handler.js";

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

describe("handler — multi-feed loop", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.S3_BUCKET = "test-bucket";
    process.env.AWS_REGION = "eu-west-1";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadHandler(mocks) {
    vi.doMock("../src/scraper.js", () => mocks.scraper);
    vi.doMock("../src/feed.js", () => mocks.feed);
    vi.doMock("@aws-sdk/client-s3", () => {
      const s3Send = mocks.s3Send;
      return {
        S3Client: vi.fn(function () { this.send = s3Send; }),
        PutObjectCommand: vi.fn(function (input) { return input; }),
      };
    });
    const { handler } = await import("../src/handler.js");
    return handler;
  }

  it("processes all feeds and returns success results", async () => {
    process.env.FEEDS_CONFIG = JSON.stringify([
      { organiserUrl: "https://petzi.ch/org/1/", s3Key: "feeds/a.xml" },
      { organiserUrl: "https://petzi.ch/org/2/", s3Key: "feeds/b.xml" },
    ]);

    const s3Send = vi.fn().mockResolvedValue({});
    const handler = await loadHandler({
      scraper: {
        fetchVenueMetadata: vi.fn().mockResolvedValue({ venueName: "Venue A", siteUrl: "https://venue-a.ch" }),
        fetchAllEvents: vi.fn().mockResolvedValue([{ title: "Gig" }]),
      },
      feed: { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") },
      s3Send,
    });

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

    const handler = await loadHandler({
      scraper: {
        fetchVenueMetadata,
        fetchAllEvents: vi.fn().mockResolvedValue([]),
      },
      feed: { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") },
      s3Send,
    });

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

    const s3Send = vi.fn().mockResolvedValue({});
    const fetchAllEvents = vi.fn().mockResolvedValue([{ title: "Show" }]);

    const handler = await loadHandler({
      scraper: {
        fetchVenueMetadata: vi.fn(),
        fetchAllEvents,
      },
      feed: { buildAtomFeed: vi.fn().mockReturnValue("<atom/>") },
      s3Send,
    });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    expect(result.eventCount).toBe(1);
    expect(result.feeds).toBeUndefined();
    expect(s3Send).toHaveBeenCalledTimes(1);
  });
});
