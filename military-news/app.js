/* Global Military Watch
 *
 * Pipeline:
 *   1. Collect   – GDELT worldwide news index (100+ languages, every country)
 *                  plus a set of defence / world RSS feeds.
 *   2. Translate – non-English headlines are machine-translated to English.
 *   3. Verify    – headlines are grouped into stories; a story is rated by how
 *                  many independent outlets (different domains / countries /
 *                  reputations) report it.
 *   4. Rank      – stories are scored by corroboration, severity and recency.
 *   5. Show      – globe heat map, top stories, per-country feed, popups.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ config
  const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
  const GDELT_GAP_MS = 5500;            // GDELT allows one request every 5 s
  const REFRESH_MS = 10 * 60 * 1000;    // auto refresh every 10 minutes
  const MILITARY_QUERY =
    "(military OR army OR troops OR navy OR \"air force\" OR missile OR airstrike OR drone OR soldiers OR defense OR warship OR artillery)";
  const MILITARY_RE =
    /\b(military|army|armies|troops?|soldiers?|navy|naval|air ?force|missiles?|air ?strikes?|drones?|defen[cs]e|warships?|artillery|weapons?|arms|nato|pentagon|militar(y|ies)|militants?|insurgents?|war|ceasefire|shelling|offensive|frontline|front line|tanks?|fighter jets?|submarines?|nuclear|rebels?|junta|coup|bomb(ing|s|ed)?|strikes? on|invasion|marines?|special forces)\b/i;

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
  function reputation(domain) {
    if (REPUTABLE.has(domain)) return "reputable";
    if (STATE.has(domain) || /sputnik/.test(domain)) return "state";
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
      const words = new Set([name.toLowerCase(), ...(extra.q ? [extra.q.toLowerCase()] : []), ...(extra.a || [])]);
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

  function addArticle(a) {
    if (!a.url || !a.title) return null;
    const existing = articles.get(a.url);
    if (existing) {
      if (a.forcedCountry) existing.queried.add(a.forcedCountry);
      return existing;
    }
    a.title = a.title.replace(/\s+/g, " ").trim();
    a.domain = rootDomain(hostOf(a.url) || a.domain);
    a.rep = reputation(a.domain);
    a.needsTranslation = !!a.lang && !/^english$/i.test(a.lang);
    a.titleEn = a.needsTranslation ? null : a.title;
    a.countries = detectCountries(a.titleEn || "");
    // found by a country-specific search: shown in that country's feed only
    a.queried = new Set(a.forcedCountry ? [a.forcedCountry] : []);
    articles.set(a.url, a);
    return a;
  }

  function ingestGdelt(list, forcedCountry) {
    let n = 0;
    for (const x of list) {
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
    for (const sort of ["hybridrel", "datedesc"]) {
      try {
        const list = await gdelt({ query: MILITARY_QUERY, maxrecords: "250", timespan: "24h", sort });
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
        query: `${MILITARY_QUERY} "${q.replace(/"/g, "")}"`, maxrecords: "150", timespan: "3d", sort: "hybridrel",
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
    for (const i of items) {
      const desc = stripHtml(i.desc).slice(0, 400);
      if (!feed.all && !MILITARY_RE.test(i.title + " " + desc)) continue;
      if (isNaN(i.date)) i.date = new Date();
      if (Date.now() - i.date > 4 * 86400000) continue;
      const a = addArticle({
        url: i.link, title: stripHtml(i.title), lang: "English", srcCountry: "",
        time: i.date, image: i.image, desc, via: feed.name,
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
    const d = document.createElement("div");
    d.innerHTML = String(s || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  async function loadRss() {
    sourceStatus.rss = 0;
    await Promise.all(RSS_FEEDS.map(async (f) => {
      try { await loadFeed(f); sourceStatus.rss++; scheduleRender(); }
      catch (e) { console.warn("RSS failed", f.name, e); }
      updateStatus();
    }));
  }

  // ------------------------------------------------------------ translation
  const TCACHE_KEY = "gmw-translations-v1";
  let tcache = {};
  try { tcache = JSON.parse(localStorage.getItem(TCACHE_KEY) || "{}"); } catch { tcache = {}; }
  function saveCache() {
    try {
      const keys = Object.keys(tcache);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete tcache[k];
      localStorage.setItem(TCACHE_KEY, JSON.stringify(tcache));
    } catch { /* storage full or blocked – fine */ }
  }

  let translating = false;
  function queueTranslations() { if (!translating) runTranslations(); }

  async function translateOne(text) {
    const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(text);
    try {
      const d = await fetchJSON(u, 12000);
      return d[0].map((seg) => seg[0]).join("");
    } catch {
      const d = await fetchJSON("https://api.mymemory.translated.net/get?langpair=autodetect|en&q=" + encodeURIComponent(text.slice(0, 450)), 12000);
      if (d.responseStatus !== 200) throw new Error("mymemory");
      return d.responseData.translatedText;
    }
  }

  // Batch several headlines into one request, separated by newlines.
  async function translateBatch(batch) {
    const joined = batch.map((a) => a.title.replace(/\n/g, " ")).join("\n");
    try {
      const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(joined);
      const d = await fetchJSON(u, 15000);
      const out = d[0].map((seg) => seg[0]).join("").split("\n").map((s) => s.trim()).filter(Boolean);
      if (out.length === batch.length) return out;
    } catch { /* fall through to one-by-one */ }
    const res = [];
    for (const a of batch) {
      try { res.push(await translateOne(a.title)); } catch { res.push(null); }
    }
    return res;
  }

  async function runTranslations() {
    translating = true;
    try {
      for (;;) {
        const todo = [...articles.values()].filter((a) => a.needsTranslation && a.titleEn === null && !a.tFailed);
        if (!todo.length) break;
        // cached first
        for (const a of todo) if (tcache[a.title]) applyTranslation(a, tcache[a.title]);
        const rest = todo.filter((a) => a.titleEn === null);
        if (!rest.length) { scheduleRender(); continue; }
        const batches = [];
        let cur = [], len = 0;
        for (const a of rest) {
          const l = encodeURIComponent(a.title).length + 3;
          if (cur.length && (len + l > 1800 || cur.length >= 12)) { batches.push(cur); cur = []; len = 0; }
          cur.push(a); len += l;
        }
        if (cur.length) batches.push(cur);
        // a few batches in parallel
        for (let i = 0; i < batches.length; i += 3) {
          await Promise.all(batches.slice(i, i + 3).map(async (b) => {
            const out = await translateBatch(b);
            b.forEach((a, j) => {
              if (out[j]) { tcache[a.title] = out[j]; applyTranslation(a, out[j]); }
              else a.tFailed = true;
            });
          }));
          updateStatus();
          scheduleRender();
        }
        saveCache();
      }
    } finally { translating = false; }
  }

  function applyTranslation(a, en) {
    a.titleEn = en;
    a.translated = true;
    for (const c of detectCountries(en)) a.countries.add(c);
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
    return new Set((text || "").toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9À-ɏ]+/)
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
      .filter((a) => a.titleEn)
      .sort((a, b) => b.time - a.time);
    const groups = [];
    for (const a of list) {
      a.tok = a.tok && a.tokFor === a.titleEn ? a.tok : tokens(a.titleEn);
      a.tokFor = a.titleEn;
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
    const reputable = outlets.filter((a) => a.rep === "reputable").length;
    const stateOnly = outlets.filter((a) => a.rep === "state").length;
    const indep = outlets.length - stateOnly * 0.5;               // state media count half
    const srcCountries = new Set(outlets.map((a) => a.srcCountry).filter(Boolean)).size;
    const langs = new Set(outlets.map((a) => a.lang)).size;

    let status;
    if (indep >= 3 && (reputable >= 1 || srcCountries >= 2 || langs >= 2)) status = "verified";
    else if (indep >= 2) status = "corroborated";
    else status = "single";

    const confidence = Math.round(Math.min(99,
      (status === "single" ? (reputable ? 35 : stateOnly ? 10 : 20) : 30) +
      12 * Math.max(0, indep - 1) + 8 * Math.min(reputable, 4) + 5 * Math.max(0, Math.min(srcCountries, 4) - 1) +
      4 * Math.max(0, Math.min(langs, 4) - 1)));

    // headline shown: prefer a reputable English original
    const display = outlets.find((a) => a.rep === "reputable" && !a.translated) ||
      outlets.find((a) => !a.translated) || g.lead;
    const newest = g.items.reduce((m, a) => (a.time > m ? a.time : m), g.items[0].time);
    const countries = new Set();
    const queried = new Set();
    for (const a of g.items) {
      for (const c of a.countries) countries.add(c);
      for (const c of a.queried) queried.add(c);
    }

    const text = display.titleEn.toLowerCase();
    let severity = 0;
    for (const [re, w] of SEVERITY_WORDS) if (re.test(text)) severity += w;
    severity = Math.min(severity, 14);
    const ageH = (Date.now() - newest) / 3600000;
    const score = 10 * Math.log2(1 + indep) + 5 * Math.min(reputable, 4) + 2 * Math.min(srcCountries, 4)
      + severity + 12 * Math.exp(-ageH / 12) - (status === "single" && stateOnly ? 6 : 0);

    return {
      id: display.url, display, items: g.items, outlets, reputable, stateOnly, indep, srcCountries, langs,
      status, confidence, newest, countries, queried, score,
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
  function badgeHtml(s) {
    let h = `<span class="badge ${s.status}">${BADGE[s.status]}</span>`;
    if (s.status === "single" && s.stateOnly) h += ` <span class="badge state">State media</span>`;
    return h;
  }
  function storyLi(s, opts = {}) {
    const c = [...s.countries].slice(0, 3).map((n) => `<span class="tag">${esc(n)}</span>`).join("");
    const tr = s.display.translated ? ` · <span title="Machine-translated from ${esc(s.display.lang)}">🌐 ${esc(s.display.lang)}</span>` : "";
    return `<li data-id="${esc(s.id)}">
      <div class="headline">${esc(s.display.titleEn)}</div>
      <div class="meta">${badgeHtml(s)}<span>${s.outlets.length} source${s.outlets.length > 1 ? "s" : ""}</span>
        <span>· ${timeAgo(s.newest)}</span>${tr}${opts.countries === false ? "" : c}</div>
    </li>`;
  }

  function renderTop() {
    const top = [...stories]
      .filter((s) => s.status !== "single" || stories.length < 12)
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
    const tl = $("#top-list"), keep = tl.scrollTop;
    tl.innerHTML = top.length ? top.map((s) => storyLi(s)).join("")
      : `<li class="empty">${sourceStatus.gdelt === "error" && !sourceStatus.rss ? "Couldn't reach news sources. Check your connection and press ⟳." : "Gathering news from around the world…"}</li>`;
    tl.scrollTop = keep;
  }

  function renderFeed() {
    let list = selectedCountry ? stories.filter((s) => s.countries.has(selectedCountry) || s.queried.has(selectedCountry)) : stories;
    if (feedFilter === "confirmed") list = list.filter((s) => s.status !== "single");
    if (feedSearch) {
      const q = feedSearch.toLowerCase();
      list = list.filter((s) => s.items.some((a) => (a.titleEn || "").toLowerCase().includes(q) || a.domain.includes(q)));
    }
    // most important first, but keep fresh stuff near the top
    list = [...list].sort((a, b) => b.score - a.score).slice(0, 200);
    $("#feed-title").textContent = selectedCountry ? selectedCountry : "Global Feed";
    $("#feed-clear").hidden = !selectedCountry;
    const fl = $("#feed-list"), keep = fl.scrollTop;
    fl.innerHTML = list.length
      ? list.map((s) => storyLi(s, { countries: !selectedCountry })).join("")
      : `<li class="empty">${selectedCountry ? "No military news found for " + esc(selectedCountry) + " yet." : "Nothing here yet."}</li>`;
    fl.scrollTop = keep;
  }

  function setFeedStatus(t) { $("#feed-status").textContent = t; }

  function updateStatus() {
    const langs = new Set([...articles.values()].map((a) => a.lang)).size;
    const outlets = new Set([...articles.values()].map((a) => a.domain)).size;
    const g = { pending: "…", loading: "loading", ok: "online", error: "offline" }[sourceStatus.gdelt];
    const pending = [...articles.values()].filter((a) => a.needsTranslation && a.titleEn === null && !a.tFailed).length;
    $("#status-text").textContent =
      `${articles.size} articles · ${outlets} outlets · ${langs} languages · ${stories.length} stories` +
      ` · GDELT ${g} · RSS ${sourceStatus.rss}/${sourceStatus.rssTotal}` +
      (pending ? ` · translating ${pending}…` : "") +
      (lastUpdate ? ` · updated ${lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "");
  }

  // ------------------------------------------------------------------ globe
  function countryCounts() {
    const m = new Map();
    for (const s of stories) for (const c of s.countries) m.set(c, (m.get(c) || 0) + (s.status === "single" ? 1 : 2));
    return m;
  }
  let counts = new Map();
  let maxCount = 1;

  function heat(f) {
    const name = f.properties.name;
    if (name === selectedCountry) return "rgba(79,195,255,0.75)";
    if (name === hoverCountry) return "rgba(255,255,255,0.35)";
    const c = counts.get(name) || 0;
    if (!c) return "rgba(60,90,120,0.12)";
    const t = Math.min(1, Math.log(1 + c) / Math.log(1 + maxCount));
    return `rgba(255,${Math.round(170 - 140 * t)},${Math.round(60 - 40 * t)},${(0.25 + 0.55 * t).toFixed(2)})`;
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
      .globeImageUrl("vendor/earth-night.jpg")
      .backgroundImageUrl("vendor/night-sky.png")
      .showAtmosphere(true)
      .atmosphereColor("#4fc3ff")
      .atmosphereAltitude(0.18)
      .polygonsData(countryFeatures)
      .polygonCapColor(heat)
      .polygonSideColor(() => "rgba(20,40,60,0.35)")
      .polygonStrokeColor(() => "rgba(140,200,255,0.35)")
      .polygonAltitude(altFor)
      .polygonsTransitionDuration(250)
      .polygonLabel((f) => {
        const n = f.properties.name;
        const k = stories.filter((s) => s.countries.has(n)).length;
        return `<div class="globe-tip"><b>${esc(n)}</b><span>${k ? k + " military stor" + (k > 1 ? "ies" : "y") : "Click to search"}</span></div>`;
      })
      .onPolygonHover((f) => {
        hoverCountry = f ? f.properties.name : null;
        el.style.cursor = f ? "pointer" : "grab";
        globe.polygonCapColor(heat).polygonAltitude(altFor);
      })
      .onPolygonClick((f) => selectCountry(f.properties.name))
      .ringsData([])
      .ringColor(() => (t) => `rgba(255,77,77,${1 - t})`)
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
    w.dataset.sig = s.outlets.length + "|" + s.status + "|" + s.display.titleEn;
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

  function windowHtml(s) {
    const a = s.display;
    const color = { verified: "var(--verified)", corroborated: "var(--corroborated)", single: "var(--single)" }[s.status];
    const srcs = s.outlets.slice(0, 40).map((o) => `<li>
        <span class="tag">${esc(o.domain)}</span>
        <a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener noreferrer" title="${esc(o.title)}">${esc(o.titleEn || o.title)}</a>
        ${o.rep === "reputable" ? "✓" : o.rep === "state" ? "<span title='State-affiliated media'>⚑</span>" : ""}
      </li>`).join("");
    const explain = {
      verified: `Reported independently by ${s.outlets.length} outlets${s.srcCountries > 1 ? " in " + s.srcCountries + " countries" : ""}${s.reputable ? ", including " + s.reputable + " established newsroom" + (s.reputable > 1 ? "s" : "") : ""}.`,
      corroborated: `Reported by ${s.outlets.length} different outlets. Not yet confirmed widely.`,
      single: s.stateOnly ? "Only reported by state-affiliated media so far. Treat with caution."
        : a.rep === "reputable" ? "Only one source so far, but an established newsroom." : "Only one source so far. Treat as unconfirmed.",
    }[s.status];
    return `
      <div class="win-bar">
        <span class="win-title">${esc(a.domain)} · ${esc(BADGE[s.status])}</span>
        <button class="icon-btn win-close" title="Close">✕</button>
      </div>
      <div class="win-body">
        ${s.image ? `<img class="hero" src="${esc(safeUrl(s.image))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <h3>${esc(a.titleEn)}</h3>
        ${a.translated ? `<div class="orig">Translated from ${esc(a.lang)}: “${esc(a.title)}”</div>` : ""}
        <div class="meta">${badgeHtml(s)}
          <span>${esc(a.time.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</span>
          <span>· ${esc(a.via === "GDELT" ? (a.srcCountry || "worldwide index") : a.via)}</span>
          ${[...s.countries].slice(0, 4).map((c) => `<span class="tag">${esc(c)}</span>`).join("")}
        </div>
        ${s.desc ? `<p class="desc">${esc(s.desc)}</p>` : ""}
        <div class="verify">
          <h4>Verification · ${s.confidence}% confidence</h4>
          <div class="meter"><div style="width:${s.confidence}%;background:${color}"></div></div>
          <div style="font-size:12.5px">${esc(explain)}</div>
          <ul class="sources">${srcs}</ul>
          <div class="note">Automatic cross-source check (independent outlets, countries, languages, outlet reputation). It is not a human fact-check.</div>
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
      const sig = s.outlets.length + "|" + s.status + "|" + s.display.titleEn;
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
    document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
      feedFilter = c.dataset.filter;
      renderFeed();
    }));
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
    for (const [u, a] of articles) if (Date.now() - a.time > 4 * 86400000) articles.delete(u);
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
