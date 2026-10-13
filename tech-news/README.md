# Tech Breakthrough Radar

A spinning 3D globe showing the latest technology and science breakthroughs from around the world:
AI, robotics, aerospace & aerodynamics, space, software & coding, engineering, physics, quantum,
energy, chips & hardware, biotech & medicine, and materials.

Open `index.html` through any static web server (GitHub Pages, or `python3 -m http.server` in this folder).
There's no build step.

## What it does

- **Collects** from the [GDELT](https://www.gdeltproject.org/) worldwide news index, searched separately in
  Chinese, Japanese, Korean, German, French, Spanish and Italian so English-language (mostly US) outlets don't
  dominate, plus 64 feeds:
  - **Global science & tech:** MIT Technology Review, IEEE Spectrum, Nature, Science, Phys.org, ScienceDaily,
    New Scientist, Quanta, Ars Technica, Physics World, The Robot Report, Aerospace America, NASA, ESA, SpaceNews,
    GitHub Blog, InfoQ, Hacker News, TechCrunch, The Verge, Wired, EurekAlert, arXiv
  - **China:** SCMP Tech, TechNode, Pandaily, CGTN, 36Kr, IT之家, 科学网
  - **Japan:** Japan Times, Nikkei Asia, ITmedia, PC Watch, sorae
  - **South Korea:** Yonhap, Korea Herald, Korea Bizwire, ZDNet Korea, 전자신문
  - **Taiwan / India:** Focus Taiwan, The Hindu
  - **Europe:** Euronews Next, DW, CERN, Sifted, The Next Web, The Register, heise, golem.de, Spektrum,
    Futura Sciences, Le Monde, El País, ANSA, Tweakers
- **Translates** non-English headlines to English.
- **Classifies** each story into fields. Use the field buttons in the feed panel to filter everything, including the globe.
- **Verifies** each story by how many independent outlets report it, from how many countries and languages,
  and what kind of source backs it:
  - 📄 **Peer-reviewed**: published in a scientific journal
  - 🏛 **Official source**: straight from the university, lab, space agency or company
  - 📝 **Preprint**: research paper not yet peer-reviewed
  - 📣 **Press release**: no independent reporting yet

  This is an automated check, not a human fact-check.
- **Mixes countries**: the top list and feed are re-ranked so one country can't fill them.
- **Ranks** stories by corroboration, source quality, breakthrough signals ("world's first", "record",
  "discovered", …) and recency. Stock-price, shopping and rumour stories are pushed down or dropped.
- **Globe**: countries glow by how much is happening there. Labs and companies are mapped to their country
  (DeepMind → UK, TSMC → Taiwan, CERN → Switzerland, …). Click a country to search for its news.
- **Popups**: click any headline for a window you can drag around, with all sources and a link to the article.
- Clock and date in the top right. Auto-refreshes every 10 minutes (⟳ to refresh now). `Esc` closes the top popup.
