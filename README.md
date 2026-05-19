# petzi-feed

Concert RSS/Atom feeds, generated automatically by scraping [petzi.ch](https://www.petzi.ch).

## Overview

Scrape venue pages on Petzi, extract concert details (title, date, description, images, ticket links, genres, prices), build Atom 1.0 feeds, and publish them to an S3 bucket. Runs daily via EventBridge.

**Runtime:** Node.js 22.x on AWS Lambda.

## Multi-feed

Set `FEEDS_CONFIG` as a JSON array during deployment. Each entry needs only `organiserUrl` and `s3Key`. Both the venue name and its website URL are extracted automatically from the organiser page.

```json
[
  {
    "organiserUrl": "https://www.petzi.ch/fr/organiser/143/",
    "s3Key": "feeds/pont-rouge-atom.xml"
  }
]
```

- `organiserUrl` — the Petzi venue page to scrape
- `s3Key` — where to store the Atom XML file

Each venue is scraped independently and its feed is uploaded to its own S3 key under the same bucket. To add more venues, append entries and re-deploy.

## Architecture

```
EventBridge (cron) → Lambda (Node.js) → S3 (one atom.xml per venue) → Public URLs
```

## Project Structure

```
petzi-feed/
├── src/
│   ├── scraper.js   # Petzi scraping logic
│   ├── feed.js      # Atom XML builder
│   └── handler.js   # Lambda entry point
├── tests/
│   ├── scraper.test.js
│   ├── feed.test.js
│   ├── handler.test.js
│   └── integration.test.js
├── package.json
└── vitest.config.js
```

## Getting Started

```bash
npm install
npm test            # run tests
npm run test:coverage # with coverage report
```

## Tech Stack

- **Runtime:** Node.js 22.x (native `fetch`)
- **Lambda:** AWS Lambda, triggered daily by EventBridge (`cron(0 7 * * ? *)`)
- **Storage:** S3 bucket serving `atom.xml` with public read
- **Parsing:** `node-html-parser` (lightweight, no transitive deps)
- **Testing:** Vitest with v8 coverage
- **Quality:** SonarCloud with coverage gate

## Deploy

**One-time setup with Terraform (recommended): see **[infra/README.md](infra/README.md)**

**Each deploy**: push to `main` — GitHub Actions builds, tests, and updates the Lambda automatically.

## Limitations

- Relies on Petzi HTML structure — set a CloudWatch alarm on Lambda errors to detect breakages early.
