/* Tech & Science Radar
 *
 * Pipeline:
 *   1. Collect   – GDELT worldwide news index (100+ languages, every country)
 *                  plus science / engineering / tech RSS feeds, journals,
 *                  lab news and arXiv preprints.
 *   2. Translate – non-English headlines are machine-translated to English.
 *   3. Classify  – each headline is tagged with fields (AI, robotics, …).
 *   4. Verify    – headlines are grouped into stories; a story is rated by how
 *                  many independent outlets report it and what kind of source
 *                  (peer-reviewed journal, lab, preprint, press release).
 *   5. Rank      – stories are scored by corroboration, source quality,
 *                  how notable the headline looks, and recency.
 *   6. Show      – globe heat map, top stories, per-country feed, popups.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ config
  const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
  const GDELT_GAP_MS = 5500;            // GDELT allows one request every 5 s
  const REFRESH_MS = 10 * 60 * 1000;    // auto refresh every 10 minutes
  // GDELT matches these against article text in every language
  // Broad on purpose: anything interesting in tech & science. Off-topic hits
  // are dropped later by the field classifier.
  const TECH_QUERIES = [
    "(technology OR \"artificial intelligence\" OR robot OR robotics OR software OR startup OR innovation OR engineering OR aerospace OR semiconductor OR cybersecurity)",
    "(science OR scientists OR researchers OR physics OR quantum OR spacecraft OR satellite OR battery OR \"electric vehicle\" OR smartphone OR telescope)",
  ];
  // The same search limited to news written in other languages, so coverage
  // isn't dominated by English-language (mostly US) outlets.
  const REGION_QUERY =
    "(technology OR science OR \"artificial intelligence\" OR robot OR researchers OR scientists OR engineers OR semiconductor OR satellite OR startup OR smartphone)";
  const REGION_LANGS = ["chinese", "japanese", "korean", "german", "french", "spanish", "italian"];
  const COUNTRY_QUERY =
    "(technology OR science OR scientists OR researchers OR engineers OR \"artificial intelligence\" OR robot OR startup OR space OR innovation)";
  const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

  const STOP = new Set(("the a an and or of to in on for at by with from as is are was were be been has have had " +
    "it its this that these those after before over under into about amid says said say new us will would could " +
    "his her their they he she not no but than then also more most up out off just how why what who when where " +
    "while report reports reported news live update updates latest video watch photos day week year").split(" "));

  // ------------------------------------------------------------------- state
  const articles = new Map();           // url -> article
  let stories = [];                     // clustered + scored
  let countryFeatures = [];
  const countryByName = new Map();      // map name -> feature
  const countryMatchers = [];           // [{name, re}] longest first
  const countryFetched = new Map();     // name -> timestamp of last GDELT query
  let selectedCountry = null;
  let hoverCountry = null;
  let feedFilter = "all";
  let topicFilter = "all";
  let feedSearch = "";
  const sourceStatus = { gdelt: "pending", rss: 0, rssTotal: RSS_FEEDS.length, translated: 0 };
  let lastUpdate = null;
  let globe;

  // ----------------------------------------------------------------- helpers
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function rootDomain(host) {
    host = (host || "").toLowerCase().replace(/^www\./, "");
    const p = host.split(".");
    if (p.length <= 2) return host;
    const sld = p[p.length - 2];
    if (["co", "com", "org", "net", "gov", "ac", "or", "ne", "go"].includes(sld) && p[p.length - 1].length === 2)
      return p.slice(-3).join(".");
    return p.slice(-2).join(".");
  }
  function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }

  const REPUTABLE = new Set(REPUTABLE_DOMAINS);
  const STATE = new Set(STATE_MEDIA_DOMAINS);
  const JOURNAL = new Set(JOURNAL_DOMAINS);
  const PREPRINT = new Set(PREPRINT_DOMAINS);
  const PRESS = new Set(PRESS_DOMAINS);
  const INSTITUTION = new Set(INSTITUTION_DOMAINS);
  // What kind of source is this? journal / preprint / institution / press /
  // reputable (established newsroom) / state / other
  function sourceKind(host, domain, override) {
    if (override) return override;
    host = (host || "").toLowerCase().replace(/^www\./, "");
    const has = (set) => set.has(domain) || set.has(host);
    if (has(PREPRINT)) return "preprint";
    if (has(JOURNAL)) return "journal";
    if (has(PRESS)) return "press";
    if (has(INSTITUTION) || INSTITUTION_RE.test(host) || INSTITUTION_RE.test(domain)) return "institution";
    if (has(REPUTABLE)) return "reputable";
    if (has(STATE) || /sputnik/.test(domain)) return "state";
    return "other";
  }

  function timeAgo(d) {
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  function fetchJSON(url, timeout = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    return fetch(url, { signal: ctl.signal }).then(async (r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { throw new Error(txt.slice(0, 120)); }
    }, (e) => { clearTimeout(t); throw e; });
  }
  function fetchText(url, timeout = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    return fetch(url, { signal: ctl.signal }).then((r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }, (e) => { clearTimeout(t); throw e; });
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rebuild, 250);
  }

  // ------------------------------------------------------- country detection
  function buildCountryMatchers() {
    for (const f of countryFeatures) {
      const name = f.properties.name;
      const extra = COUNTRY_EXTRA[name] || {};
      if (extra.skip) continue;
      const words = new Set([name.toLowerCase(), ...(extra.q ? [extra.q.toLowerCase()] : []), ...(extra.a || []),
        ...(ORG_COUNTRY[name] || [])]);
      for (const w of words) countryMatchers.push({ name, w });
    }
    // longest phrases first so "papua new guinea" wins over "guinea"
    countryMatchers.sort((a, b) => b.w.length - a.w.length);
    for (const m of countryMatchers) {
      const pat = m.w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      m.re = new RegExp("(^|[^a-z0-9])" + pat + "(?=$|[^a-z0-9])", "i");
    }
  }

  function detectCountries(text) {
    const found = new Set();
    let t = " " + (text || "").toLowerCase() + " ";
    for (const m of countryMatchers) {
      if (m.re.test(t)) {
        found.add(m.name);
        t = t.replace(m.re, "$1 ");     // consume so shorter names don't re-match
      }
    }
    return found;
  }

  // ------------------------------------------------------------- collection
  const gdeltQueue = [];
  let gdeltBusy = false;
  let gdeltLast = 0;
  function gdelt(params) {
    return new Promise((resolve, reject) => {
      gdeltQueue.push({ params, resolve, reject });
      pumpGdelt();
    });
  }
  async function pumpGdelt() {
    if (gdeltBusy) return;
    gdeltBusy = true;
    while (gdeltQueue.length) {
      const job = gdeltQueue.shift();
      const wait = gdeltLast + GDELT_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      gdeltLast = Date.now();
      const q = new URLSearchParams({ mode: "artlist", format: "json", ...job.params });
      try {
        let data;
        try { data = await fetchJSON(GDELT + "?" + q, 30000); }
        catch (e) {
          // rate limited or hiccup: wait and retry once
          await sleep(GDELT_GAP_MS);
          gdeltLast = Date.now();
          data = await fetchJSON(GDELT + "?" + q, 30000);
        }
        job.resolve((data && data.articles) || []);
      } catch (e) { job.reject(e); }
    }
    gdeltBusy = false;
  }

  function parseGdeltDate(s) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
    return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date();
  }

  // Decode entities and drop a trailing " - Site Name" / " | Site Name".
  function cleanTitle(t) {
    t = stripHtml(t);
    const m = /\s+[-–—|]\s+([^-–—|]{2,40})$/.exec(t);
    if (m && t.length - m[0].length >= 25) t = t.slice(0, m.index);
    return t.trim();
  }
  // Headline to show: English (original or translated), else the original.
  const shown = (a) => a.titleEn || a.title;

  function detectTopics(text) {
    const found = new Set();
    for (const t of TOPICS) if (t.re.test(text || "")) found.add(t.id);
    return found;
  }
  function classify(a) {
    a.topics = detectTopics((a.titleEn || "") + " " + (a.desc || ""));
    if (a.forcedTopic) a.topics.add(a.forcedTopic);
  }

  function addArticle(a) {
    if (!a.url || !a.title) return null;
    const existing = articles.get(a.url);
    if (existing) {
      if (a.forcedCountry) existing.queried.add(a.forcedCountry);
      return existing;
    }
    a.title = cleanTitle(a.title);
    if (!a.title) return null;
    a.host = hostOf(a.url) || a.domain || "";
    a.domain = rootDomain(a.host);
    a.rep = sourceKind(a.host, a.domain, a.kind);
    a.needsTranslation = !!a.lang && !/^english$/i.test(a.lang);
    a.titleEn = a.needsTranslation ? null : a.title;
    a.countries = detectCountries(a.titleEn || "");
    classify(a);
    // nothing named in the headline: fall back to where the outlet is based
    a.homeCountry = GDELT_COUNTRY_FIX[a.srcCountry] || a.srcCountry || "";
    if (!countryByName.has(a.homeCountry)) a.homeCountry = "";
    if (!a.countries.size && a.homeCountry) { a.countries.add(a.homeCountry); a.countryFromSource = true; }
    // found by a country-specific search: shown in that country's feed only
    a.queried = new Set(a.forcedCountry ? [a.forcedCountry] : []);
    articles.set(a.url, a);
    return a;
  }

  function ingestGdelt(list, forcedCountry) {
    let n = 0;
    for (const x of list) {
      if (NOISE_RE.test(x.title || "")) continue;
      const a = addArticle({
        url: x.url, title: x.title, lang: x.language || "English", domain: x.domain,
        srcCountry: x.sourcecountry || "", time: parseGdeltDate(x.seendate),
        image: x.socialimage || "", via: "GDELT", forcedCountry,
      });
      if (a) n++;
    }
    return n;
  }

  async function loadGdeltGlobal() {
    sourceStatus.gdelt = "loading";
    updateStatus();
    let ok = 0;
    // interleave so non-US news shows up early
    const searches = [
      { query: TECH_QUERIES[0], maxrecords: "250" },
      ...REGION_LANGS.slice(0, 3).map((l) => ({ query: `${REGION_QUERY} sourcelang:${l}`, maxrecords: "100" })),
      { query: TECH_QUERIES[1], maxrecords: "250" },
      ...REGION_LANGS.slice(3).map((l) => ({ query: `${REGION_QUERY} sourcelang:${l}`, maxrecords: "75" })),
    ];
    for (const { query, maxrecords } of searches) {
      try {
        const list = await gdelt({ query, maxrecords, timespan: "48h", sort: "hybridrel" });
        ingestGdelt(list);
        ok++;
        queueTranslations();
        scheduleRender();
      } catch (e) {
        console.warn("GDELT failed", e);
      }
    }
    sourceStatus.gdelt = ok ? "ok" : "error";
    updateStatus();
  }

  async function loadCountry(name) {
    const last = countryFetched.get(name) || 0;
    if (Date.now() - last < REFRESH_MS) return;
    countryFetched.set(name, Date.now());
    const extra = COUNTRY_EXTRA[name] || {};
    const q = extra.q || name;
    setFeedStatus(`Searching worldwide sources for ${name}…`);
    try {
      const list = await gdelt({
        query: `${COUNTRY_QUERY} "${q.replace(/"/g, "")}"`, maxrecords: "150", timespan: "7d", sort: "hybridrel",
      });
      ingestGdelt(list, name);
      queueTranslations();
      if (selectedCountry === name) setFeedStatus("");
    } catch (e) {
      countryFetched.delete(name);
      if (selectedCountry === name) setFeedStatus("Couldn't reach the worldwide index right now — showing what's already loaded.");
    }
    scheduleRender();
  }

  // RSS: rss2json first (CORS friendly), then a raw CORS proxy + XML parse.
  async function loadFeed(feed) {
    let items = [];
    try {
      const d = await fetchJSON("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url), 15000);
      if (d.status !== "ok") throw new Error(d.message || "rss2json error");
      items = d.items.map((i) => ({
        title: i.title, link: i.link, date: i.pubDate ? new Date(i.pubDate.replace(" ", "T") + "Z") : new Date(),
        desc: i.description, image: i.thumbnail || (i.enclosure && i.enclosure.link) || "",
      }));
    } catch {
      const xml = await fetchText("https://api.allorigins.win/raw?url=" + encodeURIComponent(feed.url), 15000);
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      items = [...doc.querySelectorAll("item, entry")].map((n) => {
        const g = (sel) => n.querySelector(sel)?.textContent || "";
        const link = n.querySelector("link")?.getAttribute("href") || g("link");
        const media = n.querySelector("enclosure, content, thumbnail");
        return {
          title: g("title"), link, date: new Date(g("pubDate") || g("published") || g("updated") || g("date") || Date.now()),
          desc: g("description") || g("summary"), image: media?.getAttribute("url") || "",
        };
      });
    }
    let n = 0;
    for (const i of items.slice(0, feed.limit || items.length)) {
      const desc = stripHtml(i.desc).replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*/i, "").slice(0, 400);
      const english = !feed.lang || feed.lang === "English";
      // non-English feeds are checked for topics after translation
      if (!feed.all && english && !detectTopics(i.title + " " + desc).size) continue;
      if (isNaN(i.date)) i.date = new Date();
      if (Date.now() - i.date > 7 * 86400000) continue;
      const a = addArticle({
        url: i.link, title: stripHtml(i.title), lang: feed.lang || "English", srcCountry: feed.country || "",
        time: i.date, image: i.image, desc, via: feed.name, kind: feed.kind, forcedTopic: feed.topic,
      });
      if (a) {
        // description helps detect the country when the headline doesn't name it
        if (!a.countries.size && desc) a.countries = detectCountries(desc);
        n++;
      }
    }
    return n;
  }
  function stripHtml(s) {
    // DOMParser documents are inert: nothing in the markup runs or loads
    const d = new DOMParser().parseFromString(String(s || ""), "text/html");
    d.querySelectorAll("script,style").forEach((n) => n.remove());
    return (d.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  async function loadRss() {
    sourceStatus.rss = 0;
    const queue = [...RSS_FEEDS];
    const worker = async () => {
      for (let f; (f = queue.shift());) {
        try { await loadFeed(f); sourceStatus.rss++; queueTranslations(); scheduleRender(); }
        catch (e) { console.warn("RSS failed", f.name, e); }
        updateStatus();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // ------------------------------------------------------------ translation
  // Headlines are grouped by language and sent with the source language set
  // explicitly (auto-detecting a mixed batch garbles most of it). Requests are
  // spaced out; when the free endpoint starts refusing, we back off and retry
  // later instead of giving up. Untranslated headlines are still shown.
  const GT = "https://translate.googleapis.com/translate_a/single?client=gtx&tl=en&dt=t&sl=";
  const LANG_CODES = {
    afrikaans: "af", albanian: "sq", arabic: "ar", armenian: "hy", azerbaijani: "az", basque: "eu",
    belarusian: "be", bengali: "bn", bosnian: "bs", bulgarian: "bg", catalan: "ca", chinese: "zh-CN",
    croatian: "hr", czech: "cs", danish: "da", dutch: "nl", estonian: "et", filipino: "tl", finnish: "fi",
    french: "fr", galician: "gl", georgian: "ka", german: "de", greek: "el", gujarati: "gu", hausa: "ha",
    hebrew: "iw", hindi: "hi", hungarian: "hu", icelandic: "is", indonesian: "id", irish: "ga",
    italian: "it", japanese: "ja", kannada: "kn", kazakh: "kk", khmer: "km", korean: "ko", kurdish: "ku",
    kyrgyz: "ky", lao: "lo", latvian: "lv", lithuanian: "lt", macedonian: "mk", malay: "ms",
    malayalam: "ml", maltese: "mt", marathi: "mr", mongolian: "mn", burmese: "my", nepali: "ne",
    norwegian: "no", pashto: "ps", persian: "fa", polish: "pl", portuguese: "pt", punjabi: "pa",
    romanian: "ro", russian: "ru", serbian: "sr", sinhala: "si", sinhalese: "si", slovak: "sk",
    slovenian: "sl", somali: "so", spanish: "es", swahili: "sw", swedish: "sv", tajik: "tg", tamil: "ta",
    telugu: "te", thai: "th", tibetan: "bo", turkish: "tr", turkmen: "tk", ukrainian: "uk", urdu: "ur",
    uzbek: "uz", vietnamese: "vi", welsh: "cy", yoruba: "yo", zulu: "zu",
  };
  const langCode = (name) => LANG_CODES[(name || "").toLowerCase()] || "auto";

  const TCACHE_KEY = "gmw-translations-v2";
  try { localStorage.removeItem("gmw-translations-v1"); } catch { /* ignore */ }
  let tcache = {};
  try { tcache = JSON.parse(localStorage.getItem(TCACHE_KEY) || "{}"); } catch { tcache = {}; }
  function saveCache() {
    try {
      const keys = Object.keys(tcache);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete tcache[k];
      localStorage.setItem(TCACHE_KEY, JSON.stringify(tcache));
    } catch { /* storage full or blocked – fine */ }
  }

  const MAX_TRIES = 5;
  let translating = false;
  let retryTimer = null;
  let cooldownUntil = 0;     // Google refused us: pause until then
  let strikes = 0;
  function queueTranslations() {
    clearTimeout(retryTimer);
    if (!translating) runTranslations();
  }
  const awaitingTranslation = (a) => a.needsTranslation && !a.titleEn && !a.tGaveUp;

  // Is `out` a usable English rendering of `orig`?
  function goodTranslation(orig, out) {
    if (!out || !out.trim()) return false;
    if (/MYMEMORY WARNING|INVALID (SOURCE|TARGET) LANGUAGE|QUERY LENGTH LIMIT/i.test(out)) return false;
    const letters = out.match(/\p{L}/gu) || [];
    const latin = out.match(/[A-Za-z]/g) || [];
    if (letters.length && latin.length / letters.length < 0.6) return false;   // still mostly non-Latin script
    if (out.trim().toLowerCase() === orig.trim().toLowerCase() && letters.length > 15) return false;
    return true;
  }

  async function google(text, sl) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(GT + encodeURIComponent(sl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "q=" + encodeURIComponent(text),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      return (d[0] || []).map((seg) => seg[0] || "").join("");
    } finally { clearTimeout(t); }
  }

  // Translate same-language headlines in one request, one per line. If the
  // line count doesn't come back intact, split the batch and try again.
  async function translateGroup(items, sl) {
    const out = await google(items.map((a) => a.title.replace(/\n/g, " ")).join("\n"), sl);
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === items.length) return lines;
    if (items.length === 1) return [lines.join(" ")];
    const mid = Math.ceil(items.length / 2);
    return [...await translateGroup(items.slice(0, mid), sl), ...await translateGroup(items.slice(mid), sl)];
  }

  // Backup service, used for a few important headlines while Google is cooling down.
  async function myMemory(a) {
    const code = langCode(a.lang);
    if (code === "auto") throw new Error("unknown language");
    const d = await fetchJSON("https://api.mymemory.translated.net/get?langpair=" + encodeURIComponent(code.split("-")[0] + "|en") +
      "&q=" + encodeURIComponent(a.title.slice(0, 480)), 12000);
    if (d.responseStatus !== 200 && d.responseStatus !== "200") throw new Error("mymemory " + d.responseStatus);
    const txt = new DOMParser().parseFromString(d.responseData.translatedText, "text/html").documentElement.textContent;
    return txt;
  }

  function priority(a) {
    let p = -(Date.now() - a.time) / 3600000;              // newer first
    if (selectedCountry && (a.queried.has(selectedCountry) || a.countries.has(selectedCountry))) p += 1000;
    if (a.inTop) p += 500;
    return p;
  }

  function failed(a) {
    a.tTries = (a.tTries || 0) + 1;
    if (a.tTries >= MAX_TRIES) a.tGaveUp = true;
    else a.tRetryAt = Date.now() + 30000 * a.tTries;
  }

  async function translateBatch(batch, sl) {
    try {
      const out = await translateGroup(batch, sl);
      strikes = 0;
      const redo = [];
      batch.forEach((a, i) => {
        if (goodTranslation(a.title, out[i])) { tcache[a.title] = out[i]; applyTranslation(a, out[i]); }
        else if (sl !== "auto" && !a.triedAuto) redo.push(a);   // language label may be wrong
        else failed(a);
      });
      for (const a of redo) {
        a.triedAuto = true;
        await sleep(300);
        try {
          const [en] = await translateGroup([a], "auto");
          if (goodTranslation(a.title, en)) { tcache[a.title] = en; applyTranslation(a, en); } else failed(a);
        } catch { failed(a); }
      }
    } catch (e) {
      // usually rate limiting (Google answers with a redirect the browser blocks)
      // (parallel batches failing together count as one strike)
      if (Date.now() >= cooldownUntil) {
        strikes++;
        cooldownUntil = Date.now() + Math.min(300000, 15000 * 2 ** (strikes - 1));
      }
      console.warn("translation paused", Math.round((cooldownUntil - Date.now()) / 1000) + "s", e);
    }
  }

  async function runTranslations() {
    translating = true;
    try {
      for (;;) {
        const now = Date.now();
        const waiting = [...articles.values()].filter(awaitingTranslation);
        for (const a of waiting) if (tcache[a.title]) applyTranslation(a, tcache[a.title]);
        const ready = waiting.filter((a) => !a.titleEn && (a.tRetryAt || 0) <= now);
        const later = waiting.filter((a) => !a.titleEn && (a.tRetryAt || 0) > now);
        if (!ready.length) {
          if (later.length) retryTimer = setTimeout(queueTranslations, Math.min(...later.map((a) => a.tRetryAt)) - now + 50);
          break;
        }
        ready.sort((x, y) => priority(y) - priority(x));

        if (now < cooldownUntil) {
          // Google is refusing for now: do the most important few via the backup.
          for (const a of ready.slice(0, 4)) {
            try {
              const en = await myMemory(a);
              if (goodTranslation(a.title, en)) { tcache[a.title] = en; applyTranslation(a, en); } else failed(a);
            } catch { failed(a); }
            await sleep(1200);
          }
          scheduleRender();
          retryTimer = setTimeout(queueTranslations, Math.max(1000, cooldownUntil - Date.now()));
          break;
        }

        // next batches: up to 3 languages at once, most important first
        const batches = [];
        const used = new Set();
        for (const lead of ready) {
          const sl = langCode(lead.lang);
          if (used.has(sl)) continue;
          used.add(sl);
          const batch = [];
          let chars = 0;
          for (const a of ready) {
            if (langCode(a.lang) !== sl) continue;
            if (batch.length && (batch.length >= 25 || chars + a.title.length > 3500)) break;
            batch.push(a); chars += a.title.length + 1;
          }
          batches.push({ sl, batch });
          if (batches.length === 3) break;
        }
        await Promise.all(batches.map(({ sl, batch }) => translateBatch(batch, sl)));
        saveCache();
        updateStatus();
        scheduleRender();
        await sleep(400);
      }
    } finally { translating = false; }
  }

  function applyTranslation(a, en) {
    a.titleEn = en.replace(/\s+/g, " ").trim();
    a.translated = true;
    const named = detectCountries(a.titleEn);
    if (named.size && a.countryFromSource) { a.countries.clear(); a.countryFromSource = false; }
    for (const c of named) a.countries.add(c);
    classify(a);
    sourceStatus.translated++;
  }

  // ---------------------------------------------------- clustering + scoring
  function stem(w) {
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    return new Set((text || "").toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
  }
  function similar(A, B) {
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    if (inter < 2) return false;
    const overlap = inter / Math.min(A.size, B.size);
    const jacc = inter / (A.size + B.size - inter);
    return (inter >= 3 && overlap >= 0.5) || jacc >= 0.4;
  }

  function cluster() {
    const list = [...articles.values()]
      .sort((a, b) => b.time - a.time);
    const groups = [];
    for (const a of list) {
      if (a.titleEn && !a.topics.size) continue;      // readable, but not about science / tech
      a.tok = a.tok && a.tokFor === shown(a) ? a.tok : tokens(shown(a));
      a.tokFor = shown(a);
      if (!a.tok.size) continue;
      let g = null;
      for (const c of groups) {
        if (similar(a.tok, c.lead.tok) || (c.second && similar(a.tok, c.second.tok))) { g = c; break; }
      }
      if (g) { g.items.push(a); if (!g.second && a.domain !== g.lead.domain) g.second = a; }
      else groups.push({ lead: a, second: null, items: [a] });
    }
    return groups.map(scoreStory);
  }

  function scoreStory(g) {
    // one vote per independent outlet
    const byDomain = new Map();
    for (const a of g.items) if (!byDomain.has(a.domain)) byDomain.set(a.domain, a);
    const outlets = [...byDomain.values()];
    const kinds = (k) => outlets.filter((a) => a.rep === k).length;
    const journal = kinds("journal"), preprint = kinds("preprint"), press = kinds("press"), institution = kinds("institution");
    const reputable = kinds("reputable") + journal + institution;
    const stateOnly = kinds("state");
    // state media and press-release wires count half: they aren't independent reporting
    const indep = outlets.length - (stateOnly + press) * 0.5;
    const srcCountries = new Set(outlets.map((a) => a.srcCountry).filter(Boolean)).size;
    const langs = new Set(outlets.map((a) => a.lang)).size;

    let status;
    if ((indep >= 3 && (reputable >= 1 || srcCountries >= 2 || langs >= 2)) || (journal && indep >= 2)) status = "verified";
    else if (indep >= 2) status = "corroborated";
    else status = "single";
    // extra label describing the strongest kind of source behind the story
    const proof = journal ? "journal" : institution ? "institution"
      : preprint === outlets.length ? "preprint" : press === outlets.length ? "press" : "";

    const confidence = Math.round(Math.max(5, Math.min(99,
      (status === "single" ? (reputable ? 35 : stateOnly ? 10 : 20) : 30) +
      12 * Math.max(0, indep - 1) + 8 * Math.min(reputable, 4) + 5 * Math.max(0, Math.min(srcCountries, 4) - 1) +
      4 * Math.max(0, Math.min(langs, 4) - 1) + (journal ? 20 : 0) + (institution ? 10 : 0) -
      (proof === "preprint" || proof === "press" ? 5 : 0))));

    // headline shown: prefer a reputable English original
    const display = outlets.find((a) => a.rep === "reputable" && !a.translated && a.titleEn) ||
      outlets.find((a) => !a.translated && a.titleEn) || outlets.find((a) => a.titleEn) || g.lead;
    const newest = g.items.reduce((m, a) => (a.time > m ? a.time : m), g.items[0].time);
    const countries = new Set();
    const queried = new Set();
    const topics = new Set();
    for (const a of g.items) {
      for (const c of a.countries) countries.add(c);
      for (const c of a.queried) queried.add(c);
      for (const t of a.topics) topics.add(t);
    }

    const text = shown(display).toLowerCase() + " " + (display.desc || "").toLowerCase().slice(0, 200);
    let signal = 0;
    for (const [re, w] of BREAKTHROUGH_WORDS) if (re.test(text)) signal += w;
    signal = Math.max(-10, Math.min(signal, 16));
    const ageH = (Date.now() - newest) / 3600000;
    const score = 9 * Math.log2(1 + indep) + 4 * Math.min(reputable, 4) + 2 * Math.min(srcCountries, 4)
      + (journal ? 8 : 0) + (institution ? 4 : 0) + signal + 12 * Math.exp(-ageH / 24)
      - (status === "single" && stateOnly ? 6 : 0);

    return {
      id: display.url, display, items: g.items, outlets, reputable, stateOnly, indep, srcCountries, langs,
      journal, preprint, press, institution, proof,
      status, confidence, newest, countries, queried, topics, score,
      image: (outlets.find((a) => a.image) || {}).image || "",
      desc: (outlets.find((a) => a.desc) || {}).desc || "",
    };
  }

  // -------------------------------------------------------------- rendering
  function rebuild() {
    stories = cluster();
    lastUpdate = new Date();
    renderTop();
    renderFeed();
    renderGlobe();
    updateStatus();
    refreshOpenWindows();
  }

  const BADGE = { verified: "Verified", corroborated: "Corroborated", single: "Single source" };
  const PROOF = {
    journal: ["Peer-reviewed", "Published in a scientific journal"],
    institution: ["Official source", "Comes straight from the university, lab, agency or company"],
    preprint: ["Preprint", "Research paper not yet peer-reviewed"],
    press: ["Press release", "Only press releases so far, no independent reporting"],
  };
  function badgeHtml(s) {
    let h = `<span class="badge ${s.status}">${BADGE[s.status]}</span>`;
    if (s.proof) h += ` <span class="badge ${s.proof}" title="${esc(PROOF[s.proof][1])}">${PROOF[s.proof][0]}</span>`;
    if (s.status === "single" && s.stateOnly) h += ` <span class="badge state">State media</span>`;
    return h;
  }
  function topicTags(s, max = 3) {
    return [...s.topics].slice(0, max).map((id) => {
      const t = TOPIC_BY_ID.get(id);
      return `<span class="tag">${t.icon} ${esc(t.name)}</span>`;
    }).join("");
  }
  const matchesTopic = (s) => topicFilter === "all" || s.topics.has(topicFilter);

  // Re-rank so the list mixes countries: each further story from a country
  // that's already listed loses a few points.
  function diversify(list, limit) {
    const pool = [...list];
    const seen = new Map();
    const out = [];
    while (pool.length && out.length < limit) {
      let best = 0, bestScore = -Infinity;
      pool.forEach((s, i) => {
        let rep = 0;
        for (const c of s.countries) rep = Math.max(rep, seen.get(c) || 0);
        const v = s.score - 6 * rep;
        if (v > bestScore) { bestScore = v; best = i; }
      });
      const [s] = pool.splice(best, 1);
      out.push(s);
      for (const c of s.countries) seen.set(c, (seen.get(c) || 0) + 1);
    }
    return out;
  }
  function transNote(a) {
    if (a.translated) return ` · <span title="Machine-translated from ${esc(a.lang)}">🌐 ${esc(a.lang)}</span>`;
    if (!a.needsTranslation) return "";
    if (a.tGaveUp) return ` · <span class="untranslated" title="Translation failed; showing the original">⚠ ${esc(a.lang)}, not translated</span>`;
    return ` · <span class="untranslated">⏳ translating from ${esc(a.lang)}…</span>`;
  }
  function storyLi(s, opts = {}) {
    const c = [...s.countries].slice(0, 2).map((n) => `<span class="tag">${esc(n)}</span>`).join("");
    const tr = transNote(s.display);
    return `<li data-id="${esc(s.id)}">
      <div class="headline"${s.display.titleEn ? "" : ' lang="' + esc(langCode(s.display.lang)) + '"'}>${esc(shown(s.display))}</div>
      <div class="meta">${badgeHtml(s)}<span>${s.outlets.length} source${s.outlets.length > 1 ? "s" : ""}</span>
        <span>· ${timeAgo(s.newest)}</span>${tr}</div>
      <div class="meta tags">${topicTags(s)}${opts.countries === false ? "" : c}</div>
    </li>`;
  }

  function renderTop() {
    const pool = stories.filter(matchesTopic);
    const top = diversify(pool
      .filter((s) => s.status !== "single" || s.proof === "journal" || s.proof === "institution" || pool.length < 25), 7);
    // translate what's in the top list first
    for (const a of articles.values()) a.inTop = false;
    for (const s of top) for (const a of s.items) a.inTop = true;
    const t = TOPIC_BY_ID.get(topicFilter);
    $("#top-title").textContent = t ? `Top in ${t.name}` : "Top Stories";
    const tl = $("#top-list"), keep = tl.scrollTop;
    tl.innerHTML = top.length ? top.map((s) => storyLi(s)).join("")
      : `<li class="empty">${sourceStatus.gdelt === "error" && !sourceStatus.rss ? "Couldn't reach news sources. Check your connection and press ⟳." : "Scanning labs, journals and newsrooms worldwide…"}</li>`;
    tl.scrollTop = keep;
  }

  function renderFeed() {
    let list = selectedCountry ? stories.filter((s) => s.countries.has(selectedCountry) || s.queried.has(selectedCountry)) : stories;
    list = list.filter(matchesTopic);
    if (feedFilter === "confirmed") list = list.filter((s) => s.status !== "single");
    if (feedSearch) {
      const q = feedSearch.toLowerCase();
      list = list.filter((s) => s.items.some((a) => shown(a).toLowerCase().includes(q) || a.title.toLowerCase().includes(q) || a.domain.includes(q)));
    }
    // most important first, but keep fresh stuff near the top
    list = selectedCountry ? [...list].sort((a, b) => b.score - a.score).slice(0, 200) : diversify(list, 200);
    $("#feed-title").textContent = selectedCountry ? selectedCountry : "Global Feed";
    $("#feed-clear").hidden = !selectedCountry;
    const fl = $("#feed-list"), keep = fl.scrollTop;
    fl.innerHTML = list.length
      ? list.map((s) => storyLi(s, { countries: !selectedCountry })).join("")
      : `<li class="empty">${selectedCountry ? "No tech or science news found for " + esc(selectedCountry) + " yet." : "Nothing here yet."}</li>`;
    fl.scrollTop = keep;
  }

  function setFeedStatus(t) { $("#feed-status").textContent = t; }

  function updateStatus() {
    const langs = new Set([...articles.values()].map((a) => a.lang)).size;
    const outlets = new Set([...articles.values()].map((a) => a.domain)).size;
    const g = { pending: "…", loading: "loading", ok: "online", error: "offline" }[sourceStatus.gdelt];
    const pending = [...articles.values()].filter(awaitingTranslation).length;
    $("#status-text").textContent =
      `${articles.size} articles · ${outlets} outlets · ${langs} languages · ${stories.length} stories` +
      ` · GDELT ${g} · RSS ${sourceStatus.rss}/${sourceStatus.rssTotal}` +
      (pending ? ` · translating ${pending}${Date.now() < cooldownUntil ? " (paused, retrying soon)" : "…"}` : "") +
      (lastUpdate ? ` · updated ${lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "");
  }

  // ------------------------------------------------------------------ globe
  function countryCounts() {
    const m = new Map();
    for (const s of stories) {
      if (!matchesTopic(s)) continue;
      for (const c of s.countries) m.set(c, (m.get(c) || 0) + (s.status === "single" ? 1 : 2));
    }
    return m;
  }
  let counts = new Map();
  let maxCount = 1;

  // Muted palette from few stories (slate blue) to many (brick red). Countries
  // are coloured by their rank, so one busy country doesn't wash out the rest.
  const HEAT_STOPS = [[78, 122, 168], [66, 146, 134], [124, 160, 90], [192, 162, 80], [198, 118, 74], [182, 78, 70]];
  let heatRank = new Map();
  function heatColor(t, alpha) {
    const x = Math.max(0, Math.min(1, t)) * (HEAT_STOPS.length - 1);
    const i = Math.min(HEAT_STOPS.length - 2, Math.floor(x)), f = x - i;
    const [r, g, b] = HEAT_STOPS[i].map((v, k) => Math.round(v + (HEAT_STOPS[i + 1][k] - v) * f));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function heat(f) {
    const name = f.properties.name;
    if (name === selectedCountry) return "rgba(190,205,222,0.6)";
    if (name === hoverCountry) return "rgba(255,255,255,0.22)";
    const c = counts.get(name) || 0;
    if (!c) return "rgba(255,255,255,0.025)";
    const t = heatRank.get(c) ?? 0;
    return heatColor(t, (0.65 + 0.2 * t).toFixed(2));
  }

  function centerOf(f) {
    const extra = COUNTRY_EXTRA[f.properties.name];
    if (extra && extra.center) return { lng: extra.center[0], lat: extra.center[1] };
    // centre of the bounding box of the largest polygon ring
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let best = polys[0][0];
    for (const p of polys) if (p[0].length > best.length) best = p[0];
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const [x, y] of best) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { lng: (x0 + x1) / 2, lat: (y0 + y1) / 2 };
  }

  function initGlobe() {
    const el = $("#globe");
    globe = Globe()(el)
      .globeImageUrl("vendor/earth-dark.jpg")
      .backgroundImageUrl("vendor/night-sky.png")
      .showAtmosphere(true)
      .atmosphereColor("#3d5266")
      .atmosphereAltitude(0.12)
      .polygonsData(countryFeatures)
      .polygonCapColor(heat)
      .polygonSideColor(() => "rgba(10,14,20,0.5)")
      .polygonStrokeColor(() => "rgba(255,255,255,0.12)")
      .polygonAltitude(altFor)
      .polygonsTransitionDuration(250)
      .polygonLabel((f) => {
        const n = f.properties.name;
        const k = stories.filter((s) => s.countries.has(n) && matchesTopic(s)).length;
        return `<div class="globe-tip"><b>${esc(n)}</b><span>${k ? k + " stor" + (k > 1 ? "ies" : "y") : "Click to search"}</span></div>`;
      })
      .onPolygonHover((f) => {
        hoverCountry = f ? f.properties.name : null;
        el.style.cursor = f ? "pointer" : "grab";
        globe.polygonCapColor(heat).polygonAltitude(altFor);
      })
      .onPolygonClick((f) => selectCountry(f.properties.name))
      .ringsData([])
      .ringColor(() => (t) => `rgba(190,120,90,${0.7 * (1 - t)})`)
      .ringMaxRadius((d) => d.r)
      .ringPropagationSpeed(2)
      .ringRepeatPeriod(1400);

    globe.pointOfView({ lat: 35, lng: 30, altitude: 2.3 });
    const ctl = globe.controls();
    ctl.autoRotate = true;
    ctl.autoRotateSpeed = 0.35;
    ctl.enableDamping = true;
    let idle;
    el.addEventListener("pointerdown", () => { ctl.autoRotate = false; clearTimeout(idle); });
    el.addEventListener("pointerup", () => {
      clearTimeout(idle);
      idle = setTimeout(() => { if (!selectedCountry) ctl.autoRotate = true; }, 20000);
    });
    const resize = () => globe.width(innerWidth).height(innerHeight);
    addEventListener("resize", resize);
    resize();
  }

  function altFor(f) {
    const n = f.properties.name;
    if (n === selectedCountry) return 0.05;
    if (n === hoverCountry) return 0.025;
    return 0.006;
  }

  function renderGlobe() {
    if (!globe) return;
    counts = countryCounts();
    maxCount = Math.max(1, ...counts.values());
    const levels = [...new Set(counts.values())].sort((a, b) => a - b);
    heatRank = new Map(levels.map((v, i) => [v, levels.length > 1 ? i / (levels.length - 1) : 1]));
    globe.polygonCapColor(heat);
    // pulsing rings on the hottest countries
    const hot = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .filter(([n]) => countryByName.has(n))
      .map(([n, c]) => ({ ...centerOf(countryByName.get(n)), r: 2 + 4 * (c / maxCount) }));
    globe.ringsData(hot);
  }

  function selectCountry(name) {
    if (!name || (COUNTRY_EXTRA[name] || {}).skip) return;
    selectedCountry = name;
    const f = countryByName.get(name);
    if (f && globe) {
      globe.controls().autoRotate = false;
      globe.pointOfView({ ...centerOf(f), altitude: 1.6 }, 1000);
      globe.polygonCapColor(heat).polygonAltitude(altFor);
    }
    setFeedStatus("");
    renderFeed();
    $("#feed-list").scrollTop = 0;
    loadCountry(name);
  }

  function clearCountry() {
    selectedCountry = null;
    setFeedStatus("");
    if (globe) {
      globe.polygonCapColor(heat).polygonAltitude(altFor);
      globe.pointOfView({ altitude: 2.3 }, 800);
      globe.controls().autoRotate = true;
    }
    renderFeed();
  }

  // ------------------------------------------------------ floating windows
  let zTop = 100;
  let cascade = 0;
  const openWindows = new Map();   // story id -> element

  function openStory(id) {
    const s = stories.find((x) => x.id === id) || stories.find((x) => x.items.some((a) => a.url === id));
    if (!s) return;
    if (openWindows.has(s.id)) { focusWin(openWindows.get(s.id)); return; }
    const w = document.createElement("div");
    w.className = "news-window";
    w.dataset.id = s.id;
    w.innerHTML = windowHtml(s);
    w.dataset.sig = s.outlets.length + "|" + s.status + "|" + shown(s.display);
    $("#windows").appendChild(w);
    const width = Math.min(420, innerWidth - 20);
    const x = Math.max(10, Math.min(innerWidth - width - 10, innerWidth / 2 - width / 2 + (cascade % 6) * 28 - 70));
    const y = Math.max(10, Math.min(innerHeight - 200, 90 + (cascade % 6) * 28));
    cascade++;
    w.style.left = x + "px";
    w.style.top = y + "px";
    focusWin(w);
    makeDraggable(w);
    w.addEventListener("pointerdown", () => focusWin(w));
    w.addEventListener("click", (e) => {
      if (e.target.closest(".win-close")) closeWin(w);
    });
    openWindows.set(s.id, w);
  }

  const KIND_ICON = {
    journal: "<span title='Peer-reviewed journal'>📄</span>", institution: "<span title='University, lab, agency or company'>🏛</span>",
    preprint: "<span title='Preprint (not peer-reviewed)'>📝</span>", press: "<span title='Press release'>📣</span>",
    reputable: "<span title='Established newsroom'>✓</span>", state: "<span title='State-affiliated media'>⚑</span>",
  };
  function windowHtml(s) {
    const a = s.display;
    const color = { verified: "var(--verified)", corroborated: "var(--corroborated)", single: "var(--single)" }[s.status];
    const srcs = s.outlets.slice(0, 40).map((o) => `<li>
        <span class="tag">${esc(o.domain)}</span>
        <a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener noreferrer" title="${esc(o.title)}">${esc(shown(o))}</a>
        ${KIND_ICON[o.rep] || ""}
      </li>`).join("");
    const explain = {
      verified: `Reported independently by ${s.outlets.length} outlets${s.srcCountries > 1 ? " in " + s.srcCountries + " countries" : ""}${s.reputable ? ", including " + s.reputable + " established newsroom" + (s.reputable > 1 ? "s" : "") : ""}.`,
      corroborated: `Reported by ${s.outlets.length} different outlets. Not yet confirmed widely.`,
      single: s.stateOnly ? "Only reported by state-affiliated media so far. Treat with caution."
        : a.rep === "reputable" ? "Only one source so far, but an established newsroom." : "Only one source so far. Treat as unconfirmed.",
    }[s.status] + (s.proof ? " " + {
      journal: "Backed by a peer-reviewed journal publication.",
      institution: "Includes the original source (university, lab, agency or company).",
      preprint: "Based on a preprint: a research paper that hasn't been peer-reviewed yet.",
      press: "Only press releases so far, which aren't independent reporting.",
    }[s.proof] : "");
    return `
      <div class="win-bar">
        <span class="win-title">${esc(a.domain)} · ${esc(BADGE[s.status])}</span>
        <button class="icon-btn win-close" title="Close">✕</button>
      </div>
      <div class="win-body">
        ${s.image ? `<img class="hero" src="${esc(safeUrl(s.image))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <h3>${esc(shown(a))}</h3>
        ${a.translated ? `<div class="orig">Machine-translated from ${esc(a.lang)}. Original: “${esc(a.title)}”</div>`
          : a.needsTranslation ? `<div class="orig">${a.tGaveUp ? "Couldn't translate this" : "Translating"} from ${esc(a.lang)}${a.tGaveUp ? "; showing the original." : "…"}</div>` : ""}
        <div class="meta">${badgeHtml(s)}
          <span>${esc(a.time.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span>
          <span>· ${esc(a.via === "GDELT" ? (a.srcCountry || "worldwide index") : a.via)}</span>
        </div>
        <div class="meta tags">${topicTags(s, 5)}${[...s.countries].slice(0, 4).map((c) => `<span class="tag">${esc(c)}</span>`).join("")}</div>
        ${s.desc ? `<p class="desc">${esc(s.desc)}</p>` : ""}
        <div class="verify">
          <h4>Verification · ${s.confidence}% confidence</h4>
          <div class="meter"><div style="width:${s.confidence}%;background:${color}"></div></div>
          <div style="font-size:12.5px">${esc(explain)}</div>
          <ul class="sources">${srcs}</ul>
          <div class="note">Automatic check: independent outlets, countries, languages and source type (📄 journal, 🏛 original source, 📝 preprint, 📣 press release, ✓ established newsroom). It is not a human fact-check.</div>
        </div>
        <a class="open-btn" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">Read full article ↗</a>
      </div>`;
  }

  // When stories are re-clustered, update the content of open windows.
  function refreshOpenWindows() {
    for (const [id, w] of [...openWindows]) {
      const s = stories.find((x) => x.id === id) || stories.find((x) => x.items.some((a) => a.url === id));
      if (!s) continue;
      const body = w.querySelector(".win-body");
      const scroll = body ? body.scrollTop : 0;
      const sig = s.outlets.length + "|" + s.status + "|" + shown(s.display);
      if (w.dataset.sig === sig) continue;
      w.dataset.sig = sig;
      w.innerHTML = windowHtml(s);
      w.querySelector(".win-body").scrollTop = scroll;
      if (s.id !== id) { openWindows.delete(id); openWindows.set(s.id, w); w.dataset.id = s.id; }
    }
  }

  function focusWin(w) { w.style.zIndex = ++zTop; }
  function closeWin(w) {
    for (const [k, v] of openWindows) if (v === w) openWindows.delete(k);
    w.remove();
  }

  function makeDraggable(w) {
    let sx, sy, ox, oy, dragging = false;
    w.addEventListener("pointerdown", (e) => {
      const bar = e.target.closest(".win-bar");
      if (!bar || e.target.closest("button")) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = w.offsetLeft; oy = w.offsetTop;
      w.classList.add("dragging");
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    w.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const nx = Math.max(-w.offsetWidth + 60, Math.min(innerWidth - 60, ox + e.clientX - sx));
      const ny = Math.max(0, Math.min(innerHeight - 40, oy + e.clientY - sy));
      w.style.left = nx + "px";
      w.style.top = ny + "px";
    });
    const end = () => { dragging = false; w.classList.remove("dragging"); };
    w.addEventListener("pointerup", end);
    w.addEventListener("pointercancel", end);
  }

  // ------------------------------------------------------------------ clock
  function tickClock() {
    const now = new Date();
    $("#clock-time").textContent = now.toLocaleTimeString("en-GB", { hour12: false });
    $("#clock-date").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignore */ }
    $("#clock-utc").textContent = `UTC ${now.toISOString().slice(11, 19)}${tz ? " · " + tz : ""}`;
  }

  // ------------------------------------------------------------------ wiring
  function wireUi() {
    const onListClick = (e) => {
      const li = e.target.closest("li[data-id]");
      if (li) openStory(li.dataset.id);
    };
    $("#top-list").addEventListener("click", onListClick);
    $("#feed-list").addEventListener("click", onListClick);
    $("#feed-clear").addEventListener("click", clearCountry);
    $("#toggle-top").addEventListener("click", () => {
      const p = $("#top-stories");
      p.classList.toggle("collapsed");
      $("#toggle-top").textContent = p.classList.contains("collapsed") ? "+" : "–";
    });
    document.querySelectorAll(".chip[data-filter]").forEach((c) => c.addEventListener("click", () => {
      document.querySelectorAll(".chip[data-filter]").forEach((x) => x.classList.toggle("active", x === c));
      feedFilter = c.dataset.filter;
      renderFeed();
    }));
    const tb = $("#topics");
    tb.innerHTML = `<button class="chip active" data-topic="all">All fields</button>` +
      TOPICS.map((t) => `<button class="chip" data-topic="${t.id}">${t.icon} ${esc(t.name)}</button>`).join("");
    tb.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      topicFilter = b.dataset.topic;
      tb.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b));
      renderTop(); renderFeed(); renderGlobe();
    });
    let st;
    $("#feed-search").addEventListener("input", (e) => {
      clearTimeout(st);
      st = setTimeout(() => { feedSearch = e.target.value.trim(); renderFeed(); }, 200);
    });
    $("#refresh").addEventListener("click", () => refreshAll(true));
    addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const ws = [...document.querySelectorAll(".news-window")];
      if (ws.length) closeWin(ws.sort((a, b) => b.style.zIndex - a.style.zIndex)[0]);
      else if (selectedCountry) clearCountry();
    });
  }

  let refreshing = false;
  async function refreshAll(manual) {
    if (refreshing) return;
    refreshing = true;
    $("#refresh").disabled = true;
    // drop articles older than 4 days to keep memory in check
    for (const [u, a] of articles) if (Date.now() - a.time > 7 * 86400000) articles.delete(u);
    if (manual && selectedCountry) countryFetched.delete(selectedCountry);
    try {
      await Promise.all([loadGdeltGlobal(), loadRss()]);
      if (selectedCountry) await loadCountry(selectedCountry);
    } finally {
      refreshing = false;
      $("#refresh").disabled = false;
      scheduleRender();
    }
  }

  async function start() {
    tickClock();
    setInterval(tickClock, 1000);
    wireUi();
    try {
      const topo = await fetchJSON("vendor/countries-110m.json");
      countryFeatures = topojson.feature(topo, topo.objects.countries).features
        .filter((f) => f.properties.name !== "Antarctica");
      for (const f of countryFeatures) countryByName.set(f.properties.name, f);
      buildCountryMatchers();
    } catch (e) {
      console.error("map data failed", e);
    }
    try { initGlobe(); } catch (e) { console.error("globe failed (WebGL?)", e); }
    rebuild();
    refreshAll();
    setInterval(() => refreshAll(false), REFRESH_MS);
    // keep "x min ago" labels fresh
    setInterval(() => { renderTop(); renderFeed(); }, 60000);
  }

  start();
})();
