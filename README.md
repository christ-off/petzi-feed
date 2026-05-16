# petzi-feed

Pont Rouge concerts RSS/Atom feed, generated automatically by scraping [petzi.ch](https://www.petzi.ch/fr/organiser/143/).

## Overview

Scrape the Pont Rouge venue page on Petzi, extract concert details (title, date, description, images, ticket links, genres, prices), build an Atom 1.0 feed, and publish it to an S3 bucket. Runs daily via EventBridge.

**Runtime:** Node.js 22.x on AWS Lambda.

## Architecture

```
EventBridge (cron) → Lambda (Node.js) → S3 (atom.xml) → Public URL
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
│   └── feed.test.js
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

## Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "node-html-parser": "^6.1.13"
  }
}
```

## Deploy

**One-time setup** (S3, IAM, EventBridge, Lambda creation): [etc/deploy-cli.md](etc/deploy-cli.md)

**Each deploy**: push to `main` — GitHub Actions builds, tests, and updates the Lambda automatically.

## Limitations

- Relies on Petzi HTML structure — set a CloudWatch alarm on Lambda errors to detect breakages early.
