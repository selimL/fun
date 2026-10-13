// Topic configuration for Tech Breakthrough Radar.

// Fields shown as filter chips. `re` is matched against the English headline
// (and the feed's description, when there is one).
window.TOPICS = [
  { id: "ai", name: "AI", icon: "🧠", color: "#a78bfa",
    re: /\b(a\.?i\.?|artificial intelligence|machine learning|deep learning|neural (net(work)?s?)|llms?|large language models?|chatbots?|gpt-?\d*|generative|transformer models?|reinforcement learning|computer vision|openai|deepmind|anthropic|claude|gemini|deepseek|copilot|agi|foundation models?|ai models?|ai agents?)\b/i },
  { id: "robotics", name: "Robotics", icon: "🤖", color: "#34d399",
    re: /\b(robots?|robotics?|robotic|humanoids?|exoskeletons?|automation|autonomous (vehicles?|cars?|driving|systems?)|self-driving|drones?|cobots?|manipulators?|grippers?|boston dynamics|unitree|quadruped)\b/i },
  { id: "aero", name: "Aerospace & Aerodynamics", icon: "✈️", color: "#38bdf8",
    re: /\b(aerodynamics?|aerodynamic|aerospace|aircraft|airplanes?|aviation|airliners?|jets? engines?|hypersonic|supersonic|wind tunnel|airflow|turbulence|drag reduction|evtol|air taxis?|propulsion|scramjets?|ramjets?|flight tests?|airbus|boeing|fluid dynamics)\b/i },
  { id: "space", name: "Space", icon: "🚀", color: "#f472b6",
    re: /\b(space ?craft|spaceships?|rockets?|satellites?|orbit(al)?|nasa|esa|spacex|isro|jaxa|cnsa|roscosmos|mars|moon|lunar|asteroids?|telescopes?|exoplanets?|galax(y|ies)|black holes?|astronom(y|ers?)|astrophysic\w*|launch(es|ed)? (vehicle|pad)|starship|space station|iss)\b/i },
  { id: "coding", name: "Software & Coding", icon: "💻", color: "#facc15",
    re: /\b(software|programming|programmers?|coding|coders?|developers?|open[- ]source|github|compilers?|algorithms?|python|javascript|typescript|rust language|golang|c\+\+|linux|kernel|databases?|cyber ?security|encryption|cryptograph\w*|vulnerabilit(y|ies)|operating systems?|cloud computing|webassembly)\b/i },
  { id: "engineering", name: "Engineering", icon: "⚙️", color: "#fb923c",
    re: /\b(engineer(s|ing|ed)?|3d[- ]print\w*|additive manufacturing|manufacturing|bridges?|structural|civil engineering|mechanical|sensors?|actuators?|prototypes?|infrastructure|desalination|tunnel(ing)?|construction tech|mems)\b/i },
  { id: "physics", name: "Physics", icon: "⚛️", color: "#60a5fa",
    re: /\b(physics|physicists?|particles?|quarks?|neutrinos?|higgs|collider|cern|lasers?|photons?|plasma|superconduct\w*|thermodynamics|gravit(y|ational)|relativity|dark matter|dark energy|atoms?|atomic|electrons?|magnet(ic|s|ism)?|optics|photonic\w*|condensed matter|antimatter)\b/i },
  { id: "quantum", name: "Quantum", icon: "🌀", color: "#22d3ee",
    re: /\b(quantum|qubits?|entangle(d|ment)|superposition|quantum computers?|quantum computing|error correction)\b/i },
  { id: "energy", name: "Energy", icon: "⚡", color: "#4ade80",
    re: /\b(fusion|fission|nuclear (power|reactors?|energy)|reactors?|batter(y|ies)|solid-state batter\w*|solar (cells?|panels?|power)|perovskites?|wind (turbines?|power|farms?)|hydrogen|fuel cells?|energy storage|power grid|renewables?|geothermal|tokamak|stellarator)\b/i },
  { id: "chips", name: "Chips & Hardware", icon: "🔌", color: "#e879f9",
    re: /\b(chips?|semiconductors?|transistors?|processors?|cpus?|gpus?|npus?|tpus?|silicon|wafers?|lithography|euv|nanometer|\d+\s?nm|tsmc|nvidia|intel|amd|asml|arm-based|supercomputers?|exascale|memory chips?|hardware|neuromorphic)\b/i },
  { id: "bio", name: "Biotech & Medicine", icon: "🧬", color: "#f87171",
    re: /\b(biotech\w*|gene (editing|therapy)|crispr|genom(e|ic|ics)|dna|rna|mrna|proteins?|protein folding|vaccines?|cancer|clinical trials?|brain[- ]computer interfaces?|neuralink|implants?|prosthe(tic|sis|ses)|stem cells?|drug discovery|medical devices?)\b/i },
  { id: "materials", name: "Materials", icon: "🧪", color: "#c084fc",
    re: /\b(materials? science|new materials?|graphene|nanotub\w*|nanomaterials?|metamaterials?|alloys?|ceramics?|polymers?|composites?|crystals?|2d materials?|aerogels?|self-healing)\b/i },
];

// Words that make a headline look like a genuine breakthrough (raise its rank)
// or like routine business / hype (lower it).
window.BREAKTHROUGH_WORDS = [
  [/\bbreakthrough\b/, 6], [/\bworld'?s first|first[- ]ever|for the first time\b/, 6], [/\brecord[- ](breaking|setting)?|new record|world record\b/, 4],
  [/\bdiscover(s|ed|y|ies)?\b/, 5], [/\bnobel\b/, 5], [/\bmilestone\b/, 4], [/\bunveil(s|ed)?|reveal(s|ed)?\b/, 2],
  [/\bachiev(e|es|ed)|demonstrat(e|es|ed)\b/, 3], [/\bnovel|new (method|technique|approach|way)\b/, 3],
  [/\boutperform(s|ed)?|surpass(es|ed)?\b/, 3], [/\bpublished in|peer[- ]reviewed|study (finds|shows)\b/, 3],
  [/\bprototype|first flight|maiden flight|test flight\b/, 3], [/\bscientists|researchers|physicists|engineers\b/, 2],
  [/\bunprecedented|revolutionary|game[- ]chang\w*\b/, 2], [/\blaunch(es|ed)?\b/, 1],
  [/\bshares?|stocks?|earnings|revenue|investors?|ipo|valuation|funding round|raises \$|price\b/, -3],
  [/\bdeals?|discount|% off|sale|coupon|best .* (to buy|of 20\d\d)|review:|hands-on\b/, -6],
  [/\blawsuit|sues|court|layoffs?|rumou?rs?|leak(s|ed)?\b/, -3],
];
// Headlines with these are dropped from GDELT results (shopping / listicles).
window.NOISE_RE = /\b(deals? (on|of)|black friday|cyber monday|% off|coupon|promo code|best .* to buy|horoscope|lottery)\b/i;

// Source types used by the verification check.
window.JOURNAL_DOMAINS = [
  "nature.com", "science.org", "cell.com", "pnas.org", "thelancet.com", "nejm.org", "aps.org",
  "iop.org", "acs.org", "rsc.org", "springer.com", "sciencedirect.com", "wiley.com", "plos.org",
  "frontiersin.org", "mdpi.com", "ieeexplore.ieee.org", "acm.org", "aiaa.org", "jamanetwork.com", "bmj.com",
];
window.PREPRINT_DOMAINS = ["arxiv.org", "biorxiv.org", "medrxiv.org", "chemrxiv.org", "ssrn.com", "openreview.net"];
window.PRESS_DOMAINS = ["eurekalert.org", "prnewswire.com", "businesswire.com", "globenewswire.com", "newswise.com", "accesswire.com"];
window.INSTITUTION_DOMAINS = [
  "nasa.gov", "esa.int", "cern.ch", "nist.gov", "energy.gov", "nih.gov", "nsf.gov", "darpa.mil", "jaxa.jp",
  "isro.gov.in", "riken.jp", "mpg.de", "fraunhofer.de", "csiro.au", "llnl.gov", "ornl.gov", "anl.gov",
  "lbl.gov", "pnnl.gov", "sandia.gov", "lanl.gov", "nrel.gov", "openai.com", "deepmind.google",
  "anthropic.com", "research.google", "ai.meta.com", "microsoft.com", "nvidia.com", "github.blog", "ibm.com",
];
// Universities are recognised by domain pattern as well.
window.INSTITUTION_RE = /(\.edu(\.[a-z]{2})?$|\.ac\.[a-z]{2}$|^uni-|university|universite|universitat|\.ethz\.ch$|^ethz\.ch$|^epfl\.ch$|^kaist\.ac\.kr$|^tsinghua\.edu\.cn$)/;
window.REPUTABLE_DOMAINS = [
  "technologyreview.com", "spectrum.ieee.org", "ieee.org", "arstechnica.com", "phys.org", "sciencedaily.com",
  "newscientist.com", "quantamagazine.org", "scientificamerican.com", "wired.com", "theverge.com",
  "techcrunch.com", "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "theguardian.com", "nytimes.com",
  "ft.com", "bloomberg.com", "economist.com", "wsj.com", "washingtonpost.com", "space.com",
  "therobotreport.com", "aerospaceamerica.aiaa.org", "aviationweek.com", "flightglobal.com",
  "interestingengineering.com", "engadget.com", "zdnet.com", "theregister.com", "venturebeat.com",
  "livescience.com", "popularmechanics.com", "smithsonianmag.com", "nationalgeographic.com",
  "dw.com", "france24.com", "aljazeera.com", "nhk.or.jp", "scmp.com", "spacenews.com", "anandtech.com",
  "tomshardware.com", "infoq.com", "lwn.net", "chemistryworld.com", "physicsworld.com", "eetimes.com",
  "electrek.co", "cnet.com", "axios.com", "politico.com", "lemonde.fr", "spiegel.de", "heise.de",
];
window.STATE_MEDIA_DOMAINS = [
  "rt.com", "sputniknews.com", "sputnikglobe.com", "tass.ru", "tass.com", "ria.ru", "globaltimes.cn",
  "xinhuanet.com", "news.cn", "chinadaily.com.cn", "cgtn.com", "presstv.ir", "irna.ir", "kcna.kp",
  "trtworld.com", "aa.com.tr", "belta.by",
];

// Companies / labs / universities -> country, so headlines like
// "DeepMind's new model…" land on the right place on the globe.
window.ORG_COUNTRY = {
  "United States of America": ["openai", "google", "nvidia", "mit", "stanford", "caltech", "harvard", "berkeley",
    "nasa", "spacex", "boston dynamics", "tesla", "microsoft", "anthropic", "darpa", "ibm", "intel", "amd",
    "blue origin", "figure ai", "xai", "carnegie mellon", "princeton", "jpl", "lockheed martin", "boeing",
    "northrop grumman", "qualcomm", "agility robotics", "apptronik", "rocket lab", "fermilab", "los alamos",
    "lawrence livermore", "oak ridge", "nist", "noaa", "georgia tech", "purdue", "cornell", "yale", "columbia university"],
  "China": ["deepseek", "huawei", "baidu", "alibaba", "tencent", "byd", "unitree", "chinese academy of sciences",
    "tsinghua", "peking university", "cnsa", "xiaomi", "catl", "moonshot ai", "zhipu", "smic", "comac", "ubtech",
    "chang'e", "tiangong", "shenzhou", "zhejiang university", "fudan", "hefei", "bytedance"],
  "United Kingdom": ["deepmind", "oxford", "cambridge university", "university of cambridge", "imperial college",
    "rolls-royce", "arm holdings", "ucl", "university college london", "edinburgh", "manchester university", "bae systems"],
  "Japan": ["toyota", "sony", "honda", "jaxa", "riken", "softbank", "university of tokyo", "fanuc", "kyoto university",
    "mitsubishi", "panasonic", "fujitsu", "hitachi", "nec", "kawasaki", "osaka university", "tokyo tech"],
  "South Korea": ["samsung", "lg", "hyundai", "kaist", "sk hynix", "naver", "seoul national university", "postech"],
  "Taiwan": ["tsmc", "foxconn", "mediatek", "itri", "national taiwan university"],
  "Switzerland": ["cern", "eth zurich", "epfl", "abb", "university of zurich"],
  "France": ["mistral ai", "mistral", "airbus", "cnes", "thales", "dassault", "safran", "cnrs", "iter", "sorbonne", "inria"],
  "Germany": ["max planck", "fraunhofer", "siemens", "bmw", "bosch", "dlr", "mercedes-benz", "volkswagen", "kuka",
    "tu munich", "technical university of munich", "helmholtz", "aleph alpha", "isar aerospace", "wendelstein"],
  "India": ["isro", "iit", "tata", "infosys", "chandrayaan", "gaganyaan", "iisc", "drdo", "wipro"],
  "Netherlands": ["asml", "philips", "tu delft", "delft university", "nxp", "qutech"],
  "Israel": ["technion", "weizmann", "mobileye", "tel aviv university"],
  "Canada": ["university of toronto", "mila", "waterloo", "mcgill", "cohere", "sanctuary ai", "d-wave", "triumf"],
  "Russia": ["roscosmos", "yandex", "rosatom", "skoltech"],
  "Australia": ["csiro", "university of sydney", "unsw", "university of melbourne", "monash"],
  "Sweden": ["ericsson", "kth", "volvo", "saab", "chalmers"],
  "Finland": ["nokia", "iqm", "aalto university"],
  "Denmark": ["novo nordisk", "niels bohr", "vestas"],
  "Italy": ["leonardo", "politecnico di milano", "iit genoa", "enea"],
  "Spain": ["iberdrola", "bsc", "barcelona supercomputing"],
  "Norway": ["equinor", "sintef"],
  "Belgium": ["imec"],
  "United Arab Emirates": ["g42", "mbzuai", "technology innovation institute", "falcon llm"],
  "Saudi Arabia": ["kaust", "aramco", "neom"],
  "Brazil": ["embraer", "petrobras"],
  "Turkey": ["baykar", "tusas", "aselsan", "togg"],
  "Austria": ["ist austria", "tu wien"],
  "Ireland": ["trinity college dublin"],
  "Poland": ["polish academy of sciences"],
};

// RSS feeds read in addition to the GDELT worldwide index.
//   all:   every item is kept (otherwise filtered by topic keywords)
//   topic: force this topic on every item
//   limit: keep at most this many items (busy feeds)
//   kind:  journal / preprint / press / institution source type override
window.RSS_FEEDS = [
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", all: true },
  { name: "IEEE Spectrum", url: "https://spectrum.ieee.org/feeds/feed.rss", all: true },
  { name: "Ars Technica Science", url: "https://feeds.arstechnica.com/arstechnica/science", all: true },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "Phys.org", url: "https://phys.org/rss-feed/", all: true },
  { name: "ScienceDaily Tech", url: "https://www.sciencedaily.com/rss/top/technology.xml", all: true },
  { name: "ScienceDaily Science", url: "https://www.sciencedaily.com/rss/top/science.xml", all: true },
  { name: "Nature", url: "https://www.nature.com/nature.rss", all: true, kind: "journal" },
  { name: "Science (AAAS)", url: "https://www.science.org/rss/news_current.xml", all: true },
  { name: "New Scientist", url: "https://www.newscientist.com/feed/home/", all: true },
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", all: true },
  { name: "Physics World", url: "https://physicsworld.com/feed/", all: true, topic: "physics" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Wired Science", url: "https://www.wired.com/feed/category/science/latest/rss", all: true },
  { name: "Hacker News", url: "https://hnrss.org/frontpage?points=150" },
  { name: "The Robot Report", url: "https://www.therobotreport.com/feed/", all: true, topic: "robotics" },
  { name: "Interesting Engineering", url: "https://interestingengineering.com/feed" },
  { name: "Aerospace America", url: "https://aerospaceamerica.aiaa.org/feed/", all: true, topic: "aero" },
  { name: "NASA", url: "https://www.nasa.gov/news-release/feed/", all: true, topic: "space", kind: "institution" },
  { name: "ESA", url: "https://www.esa.int/rssfeed/Our_Activities/Space_Science", all: true, topic: "space", kind: "institution" },
  { name: "Space.com", url: "https://www.space.com/feeds/all", all: true },
  { name: "SpaceNews", url: "https://spacenews.com/feed/", all: true, topic: "space" },
  { name: "GitHub Blog", url: "https://github.blog/feed/", all: true, topic: "coding", kind: "institution" },
  { name: "InfoQ", url: "https://feed.infoq.com/", all: true, topic: "coding" },
  { name: "EurekAlert Tech", url: "https://www.eurekalert.org/rss/technology_engineering.xml", all: true, kind: "press" },
  { name: "arXiv AI", url: "https://rss.arxiv.org/rss/cs.AI", all: true, topic: "ai", limit: 8, kind: "preprint" },
  { name: "arXiv Robotics", url: "https://rss.arxiv.org/rss/cs.RO", all: true, topic: "robotics", limit: 8, kind: "preprint" },
  { name: "arXiv Fluid Dynamics", url: "https://rss.arxiv.org/rss/physics.flu-dyn", all: true, topic: "aero", limit: 6, kind: "preprint" },
  { name: "arXiv Quantum", url: "https://rss.arxiv.org/rss/quant-ph", all: true, topic: "quantum", limit: 6, kind: "preprint" },
  { name: "arXiv Software Eng.", url: "https://rss.arxiv.org/rss/cs.SE", all: true, topic: "coding", limit: 6, kind: "preprint" },
];

// GDELT country names that differ from the map's names.
window.GDELT_COUNTRY_FIX = {
  "United States": "United States of America", "Czech Republic": "Czechia", "Bosnia-Herzegovina": "Bosnia and Herz.",
  "Dominican Republic": "Dominican Rep.", "Central African Republic": "Central African Rep.",
  "Democratic Republic of the Congo": "Dem. Rep. Congo", "Republic of the Congo": "Congo",
  "South Sudan": "S. Sudan", "Ivory Coast": "Côte d'Ivoire", "Cote d'Ivoire": "Côte d'Ivoire",
  "Macedonia": "Macedonia", "North Macedonia": "Macedonia", "Swaziland": "eSwatini", "Burma": "Myanmar",
  "Occupied Palestinian Territory": "Palestine", "West Bank": "Palestine", "Gaza Strip": "Palestine",
  "Korea, South": "South Korea", "Korea, North": "North Korea", "East Timor": "Timor-Leste",
};
