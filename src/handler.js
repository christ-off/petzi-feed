const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const scraper = require("./scraper.js");
const feedModule = require("./feed.js");

const deps = { ...scraper, ...feedModule };

function createS3Client() {
  return new S3Client({ region: process.env.AWS_REGION ?? "eu-west-3" });
}

const DEFAULT_GENRES = ["Metal", "Rock"];

function filterEvents(events, genres) {
  if (!genres || genres.length === 0) throw new Error("genres filter cannot be empty");
  const lower = genres.map((s) => s.toLowerCase());
  return events
    .filter((e) => e.genres.includes("Concert"))
    .filter((e) => e.genres.some((g) => lower.includes(g.toLowerCase())));
}

function parseGenres(raw) {
  if (raw === undefined || raw === null) return DEFAULT_GENRES;
  if (raw.trim().length === 0) throw new Error("genres filter cannot be empty");
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parsed.length === 0) throw new Error("genres filter cannot be empty");
  return parsed;
}

function parseFeedsConfig() {
  const raw = process.env.FEEDS_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Invalid FEEDS_CONFIG JSON, falling back to single feed");
    return null;
  }
}

function buildFeedUrl(bucket, key, region) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function createHandler(handlerDeps = {}) {
  Object.assign(deps, handlerDeps);
  const s3client = deps.s3 ?? createS3Client();

  return async function handler(event, context) {
    const config = parseFeedsConfig();
    const bucket = process.env.S3_BUCKET;
    const region = process.env.AWS_REGION ?? "eu-west-3";

    if (config && Array.isArray(config) && config.length > 0) {
      const results = [];

      for (const feed of config) {
        const { organiserUrl, s3Key } = feed;
        try {
          const { venueName, siteUrl } = await deps.fetchVenueMetadata(organiserUrl, fetch);
          console.log(`Scraping ${organiserUrl} for venue ${venueName}`);
          const allEvents = await deps.fetchAllEvents(fetch, organiserUrl);
          const events = filterEvents(allEvents, parseGenres(process.env.GENRES));
          const feedUrl = buildFeedUrl(bucket, s3Key, region);
          const atom = deps.buildAtomFeed(events, feedUrl, venueName, siteUrl);
          await s3client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: atom,
            ContentType: "application/atom+xml; charset=utf-8",
            CacheControl: "max-age=3600",
            ServerSideEncryption: "AES256",
          }));
          console.log(`Published to s3://${bucket}/${s3Key}`);
          results.push({ venue: venueName, status: "success", eventCount: events.length });
        } catch (err) {
          console.error(`Failed to publish feed: ${err.message}`);
          results.push({ status: "error", error: err.message });
        }
      }

      const successCount = results
        .filter((r) => r.status === "success")
        .reduce((sum, r) => sum + r.eventCount, 0);
      return { statusCode: 200, feeds: results, eventCount: successCount };
    }

    // Legacy single-feed path
    const key = process.env.S3_KEY ?? "pontrouge/atom.xml";
    const venueName = process.env.VENUE_NAME ?? "Pont Rouge";

    console.log(`Scraping ${process.env.PETZI_ORGANISER_URL}`);
    const allEvents = await deps.fetchAllEvents();
    const events = filterEvents(allEvents, parseGenres(process.env.GENRES));
    console.log(`Found ${events.length} events`);

    const feedUrl = buildFeedUrl(bucket, key, region);
    const feed = deps.buildAtomFeed(events, feedUrl, venueName, "https://www.pontrouge.ch");

    await s3client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: feed,
      ContentType: "application/atom+xml; charset=utf-8",
      CacheControl: "max-age=3600",
      ServerSideEncryption: "AES256",
    }));

    console.log(`Published to s3://${bucket}/${key}`);
    return { statusCode: 200, eventCount: events.length };
  };
}

const handler = createHandler();

module.exports = { DEFAULT_GENRES, filterEvents, parseGenres, parseFeedsConfig, buildFeedUrl, handler, createHandler };
