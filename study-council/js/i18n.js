window.SC = window.SC || {};

SC.STRINGS = {
  en: {
    tagline: 'Expert AI tutors that work together',
    newChat: 'New chat', history: 'History', settings: 'Settings', noHistory: 'No saved chats yet.',
    subjects: 'Subjects', suggest: '✨ Suggest', clear: 'Clear',
    pickHint: 'Pick one subject for an expert, or several for a panel discussion.',
    panelOf: n => `Panel of ${n} experts`, single: 'Single expert',
    placeholder: 'Ask a question… (Shift+Enter for a new line, paste or drop an image)',
    send: 'Ask', stop: 'Stop', attach: 'Attach image',
    outAnswer: 'Answer', outDoc: 'Doc', outSheet: 'Sheet', outSlides: 'Slides', output: 'Output',
    welcomeTitle: 'What do you want to understand today?',
    welcomeText: 'Choose subjects above, then ask. With several subjects, the experts discuss, correct each other, and a moderator writes one combined answer.',
    examples: 'Try an example',
    ex: [
      { s: ['math'], q: 'Evaluate ∫ x² e^x dx and verify by differentiation.' },
      { s: ['physics', 'eng'], q: 'A 1200 kg car brakes from 90 km/h to rest in 45 m. Find the average braking force and the heat produced in the brakes. How should brake discs be designed to handle it?' },
      { s: ['chem', 'bio'], q: 'Why does blood pH stay near 7.4? Explain the bicarbonate buffer with the Henderson–Hasselbalch equation and what happens during hyperventilation.' },
      { s: ['history', 'geo', 'econ'], q: 'Why was Istanbul so important for trade in the Ottoman era, and how did the opening of new sea routes change that?' },
      { s: ['philo', 'code'], q: 'Can a computer program truly "understand"? Discuss the Chinese Room argument and how modern neural networks relate to it.' },
      { s: ['code'], q: 'Write a Python function that returns the k most frequent words in a text, explain its complexity, and test it.' },
    ],
    you: 'You', moderator: 'Moderator — final answer', checking: 'Checking the solution', readingImage: 'Reading the image',
    round1: 'Opening statements', discussion: 'Discussion', synthesis: 'Final synthesis',
    reasoning: 'Reasoning', tools: 'Tool calls', copy: 'Copy', copied: 'Copied',
    stopped: 'Stopped.', thinking: 'Thinking…',
    noSubject: 'Pick at least one subject first (or press ✨ Suggest).',
    noModel: 'Choose a model in Settings first.',
    noVisionModel: 'No vision model set — choose one in Settings to read images.',
    offline: 'Ollama is not reachable', online: n => `Ollama connected · ${n} models`,
    exportWord: 'Word (.docx)', exportDoc: 'Study doc', exportSheet: 'Spreadsheet', exportSlides: 'Slides', making: 'Creating…',
    exportHint: 'Opens in Word, Google Docs/Sheets/Slides, Excel and PowerPoint.',
    // Settings
    sConnection: 'Connection', sHost: 'Ollama address', sTest: 'Test', sModels: 'Models',
    sDefault: 'Main model (general subjects + moderator)', sMath: 'Math & science model', sCode: 'Coding model', sVision: 'Vision model (reads images)',
    sPerSubject: 'Per-subject override', sSame: '— use default —',
    sQuality: 'Answer quality', sTools: 'Tools (calculator with units, equation solver, molar mass, code runner)',
    sThink: 'Reasoning mode (step-by-step thinking, for models that support it)',
    sVerify: 'Verify answers (a second pass checks and corrects the solution)',
    sRounds: 'Discussion rounds between experts', sCtx: 'Context size (tokens)',
    sPresets: 'Recommended models', sPresetHint: 'Run these in a terminal to install, then press Test. Pick the row that matches your computer.',
    sApply: 'Use these', sSetup: 'Setup help', sClose: 'Done', sLang: 'Language',
    setupHelp: `<ol><li>Install Ollama from <a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com/download</a>.</li>
      <li>Install models (see the recommended commands below).</li>
      <li>If this page is opened from a website (not localhost or a file), allow it in Ollama:<br><code>OLLAMA_ORIGINS="*" ollama serve</code><br>(Windows: set the environment variable <code>OLLAMA_ORIGINS=*</code>, then restart Ollama.)</li></ol>`,
    errConnect: 'Could not reach Ollama. Is it running? See Settings → Setup help.',
    deleteChat: 'Delete',
  },
  tr: {
    tagline: 'Birlikte çalışan uzman yapay zekâ öğretmenler',
    newChat: 'Yeni sohbet', history: 'Geçmiş', settings: 'Ayarlar', noHistory: 'Henüz kayıtlı sohbet yok.',
    subjects: 'Dersler', suggest: '✨ Öner', clear: 'Temizle',
    pickHint: 'Tek uzman için bir ders, panel tartışması için birden fazla ders seç.',
    panelOf: n => `${n} uzmanlık panel`, single: 'Tek uzman',
    placeholder: 'Sorunu yaz… (Yeni satır için Shift+Enter, resim yapıştırabilir veya sürükleyebilirsin)',
    send: 'Sor', stop: 'Durdur', attach: 'Resim ekle',
    outAnswer: 'Cevap', outDoc: 'Belge', outSheet: 'Tablo', outSlides: 'Sunum', output: 'Çıktı',
    welcomeTitle: 'Bugün neyi anlamak istiyorsun?',
    welcomeText: 'Yukarıdan dersleri seç ve sor. Birden fazla ders seçersen uzmanlar tartışır, birbirini düzeltir ve bir moderatör tek bir ortak cevap yazar.',
    examples: 'Bir örnek dene',
    ex: [
      { s: ['math'], q: '∫ x² eˣ dx integralini hesapla ve türev alarak doğrula.' },
      { s: ['physics', 'eng'], q: '1200 kg\'lık bir araba 90 km/sa hızdan 45 m\'de duruyor. Ortalama fren kuvvetini ve frenlerde oluşan ısıyı bul. Fren diskleri buna göre nasıl tasarlanmalı?' },
      { s: ['chem', 'bio'], q: 'Kanın pH\'ı neden 7,4 civarında kalır? Bikarbonat tamponunu Henderson–Hasselbalch denklemiyle açıkla; hiperventilasyonda ne olur?' },
      { s: ['history', 'geo', 'econ'], q: 'Osmanlı döneminde İstanbul ticaret için neden bu kadar önemliydi ve yeni deniz yollarının açılması bunu nasıl değiştirdi?' },
      { s: ['philo', 'code'], q: 'Bir bilgisayar programı gerçekten "anlayabilir" mi? Çin Odası argümanını ve modern sinir ağlarının bununla ilişkisini tartış.' },
      { s: ['code'], q: 'Bir metindeki en sık geçen k kelimeyi döndüren bir Python fonksiyonu yaz, karmaşıklığını açıkla ve test et.' },
    ],
    you: 'Sen', moderator: 'Moderatör — son cevap', checking: 'Çözüm kontrol ediliyor', readingImage: 'Resim okunuyor',
    round1: 'Açılış konuşmaları', discussion: 'Tartışma', synthesis: 'Ortak sonuç',
    reasoning: 'Düşünme süreci', tools: 'Araç kullanımı', copy: 'Kopyala', copied: 'Kopyalandı',
    stopped: 'Durduruldu.', thinking: 'Düşünüyor…',
    noSubject: 'Önce en az bir ders seç (veya ✨ Öner\'e bas).',
    noModel: 'Önce Ayarlar\'dan bir model seç.',
    noVisionModel: 'Görsel model seçilmedi — resimleri okumak için Ayarlar\'dan bir tane seç.',
    offline: 'Ollama\'ya ulaşılamıyor', online: n => `Ollama bağlı · ${n} model`,
    exportWord: 'Word (.docx)', exportDoc: 'Ders notu', exportSheet: 'Tablo', exportSlides: 'Sunum', making: 'Hazırlanıyor…',
    exportHint: 'Word, Google Dokümanlar/E-Tablolar/Slaytlar, Excel ve PowerPoint\'te açılır.',
    sConnection: 'Bağlantı', sHost: 'Ollama adresi', sTest: 'Test et', sModels: 'Modeller',
    sDefault: 'Ana model (genel dersler + moderatör)', sMath: 'Matematik ve fen modeli', sCode: 'Kodlama modeli', sVision: 'Görsel model (resim okur)',
    sPerSubject: 'Derse özel model', sSame: '— varsayılan —',
    sQuality: 'Cevap kalitesi', sTools: 'Araçlar (birimli hesap makinesi, denklem çözücü, mol kütlesi, kod çalıştırıcı)',
    sThink: 'Düşünme modu (destekleyen modellerde adım adım akıl yürütme)',
    sVerify: 'Cevapları doğrula (ikinci bir tur çözümü kontrol edip düzeltir)',
    sRounds: 'Uzmanlar arası tartışma turu', sCtx: 'Bağlam boyutu (token)',
    sPresets: 'Önerilen modeller', sPresetHint: 'Kurmak için bunları terminalde çalıştır, sonra Test et\'e bas. Bilgisayarına uyan satırı seç.',
    sApply: 'Bunları kullan', sSetup: 'Kurulum yardımı', sClose: 'Tamam', sLang: 'Dil',
    setupHelp: `<ol><li>Ollama'yı <a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com/download</a> adresinden kur.</li>
      <li>Modelleri kur (aşağıdaki önerilen komutlar).</li>
      <li>Bu sayfa bir web sitesinden açılıyorsa (localhost veya dosya değilse) Ollama'da izin ver:<br><code>OLLAMA_ORIGINS="*" ollama serve</code><br>(Windows: <code>OLLAMA_ORIGINS=*</code> ortam değişkenini ayarla ve Ollama'yı yeniden başlat.)</li></ol>`,
    errConnect: 'Ollama\'ya ulaşılamadı. Çalışıyor mu? Ayarlar → Kurulum yardımı\'na bak.',
    deleteChat: 'Sil',
  },
};

SC.lang = (() => {
  let saved = null;
  try { saved = localStorage.getItem('sc-lang'); } catch { /* storage blocked */ }
  return saved || ((navigator.language || '').startsWith('tr') ? 'tr' : 'en');
})();

SC.t = (key, ...args) => {
  const v = SC.STRINGS[SC.lang][key] ?? SC.STRINGS.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
};
