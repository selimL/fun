# Global Military Watch

A spinning 3D globe with live military news from around the world.

Open `index.html` through any static web server (for example GitHub Pages, or
`python3 -m http.server` in this folder) and it runs in the browser — there's no build step.

## What it does

- **Collects** news from the [GDELT](https://www.gdeltproject.org/) worldwide news index
  (tens of thousands of outlets, 100+ languages, every country) and from defence/world RSS feeds
  (Defense News, Breaking Defense, BBC, Al Jazeera, DW, …).
- **Translates** non-English headlines to English automatically.
- **Verifies** stories with an automatic cross-source check: headlines about the same event are grouped,
  and each story is rated by how many *independent* outlets report it, from how many countries and languages,
  and whether established newsrooms are among them. State-affiliated media count for less.
  - **Verified**: 3+ independent outlets, including an established newsroom or several countries/languages
  - **Corroborated**: 2+ independent outlets
  - **Single source**: unconfirmed so far

  This is an automated check, not a human fact-check.
- **Ranks** stories by corroboration, severity and how recent they are. The most important ones appear in the top left.
- **Globe**: countries glow by how much military news mentions them. Spin it, then click a country to
  search worldwide sources for that country's news.
- **Popups**: click any headline to open a small window you can drag around, with the
  verification details, every source that reported it, and a link to the full article.
- Clock and date in the top right. Auto-refreshes every 10 minutes (⟳ to refresh now). `Esc` closes the top popup.

Libraries (globe.gl / three.js, topojson-client, world-atlas map data, NASA night texture) are included in `vendor/`.
