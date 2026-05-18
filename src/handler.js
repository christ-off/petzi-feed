import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fetchAllEvents } from "./scraper.js";
import { buildAtomFeed } from "./feed.js";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "eu-west-1" });
const BUCKET = process.env.S3_BUCKET;
const KEY = process.env.S3_KEY ?? "pontrouge/atom.xml";
const FEED_URL = process.env.FEED_URL ?? `https://${BUCKET}.s3.eu-west-1.amazonaws.com/${KEY}`;

export async function handler(event, context) {
  console.log(`Scraping ${process.env.PETZI_ORGANISER_URL}`);
  const events = await fetchAllEvents();
  console.log(`Found ${events.length} events`);

  const venueName = process.env.VENUE_NAME ?? "Pont Rouge";
  const feed = buildAtomFeed(events, FEED_URL, venueName);

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
