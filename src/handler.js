import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fetchAllEvents, fetchVenueMetadata } from "./scraper.js";
import { buildAtomFeed } from "./feed.js";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "eu-west-3" });

export function parseFeedsConfig() {
  const raw = process.env.FEEDS_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Invalid FEEDS_CONFIG JSON, falling back to single feed");
    return null;
  }
}

export function buildFeedUrl(bucket, key, region) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function handler(event, context) {
  const config = parseFeedsConfig();
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION ?? "eu-west-3";

  if (config && Array.isArray(config) && config.length > 0) {
    const results = [];

    for (const feed of config) {
      const { organiserUrl, s3Key } = feed;
      try {
        const { venueName, siteUrl } = await fetchVenueMetadata(organiserUrl, fetch);
        console.log(`Scraping ${organiserUrl} for venue ${venueName}`);
        const events = await fetchAllEvents(fetch, organiserUrl);
        console.log(`Found ${events.length} events for ${venueName}`);
        const feedUrl = buildFeedUrl(bucket, s3Key, region);
        const atom = buildAtomFeed(events, feedUrl, venueName, siteUrl);
        await s3.send(new PutObjectCommand({
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
  const events = await fetchAllEvents();
  console.log(`Found ${events.length} events`);

  const feedUrl = buildFeedUrl(bucket, key, region);
  const feed = buildAtomFeed(events, feedUrl, venueName, "https://www.pontrouge.ch");

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: feed,
    ContentType: "application/atom+xml; charset=utf-8",
    CacheControl: "max-age=3600",
    ServerSideEncryption: "AES256",
  }));

  console.log(`Published to s3://${bucket}/${key}`);
  return { statusCode: 200, eventCount: events.length };
}
