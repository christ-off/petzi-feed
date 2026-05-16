/**
 * Build an Atom 1.0 feed from a list of events.
 * @param {import('./scraper.js').Event[]} events
 * @param {string} feedUrl - Public self URL of this feed
 * @returns {string}
 */
export function buildAtomFeed(events, feedUrl) {
  const updated = new Date().toISOString();

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:media="http://search.yahoo.com/mrss/">
  <title>Pont Rouge — Concerts</title>
  <id>${feedUrl}</id>
  <link href="https://www.pontrouge.ch" rel="alternate"/>
  <link href="${feedUrl}" rel="self"/>
  <updated>${updated}</updated>
  <author><name>Pont Rouge</name></author>
${events.map(buildEntry).join("\n")}
</feed>`;
}

function buildEntry(event) {
  const { title, dateIso, description, imageUrl, eventUrl, ticketUrl, price, genres } = event;

  const imageTag = imageUrl
    ? `    <media:content url="${esc(imageUrl)}" medium="image"/>`
    : "";

  const ticketTag = ticketUrl
    ? `    <link rel="enclosure" href="${esc(ticketUrl)}" title="Acheter des billets"/>`
    : "";

  const priceHtml = price ? `<p><strong>Prix:</strong> ${esc(price)}</p>` : "";
  const genresHtml = genres.length ? `<p><em>${esc(genres.join(", "))}</em></p>` : "";
  const body = description.replace(/\n\n/g, "</p><p>");
  const contentHtml = esc(`${priceHtml}${genresHtml}<p>${body}</p>`);

  return `  <entry>
    <title>${esc(title)}</title>
    <id>${esc(eventUrl)}</id>
    <link href="${esc(eventUrl)}" rel="alternate"/>
    ${ticketTag}
    <updated>${dateIso}</updated>
    <published>${dateIso}</published>
    <content type="html">${contentHtml}</content>
    ${imageTag}
  </entry>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
