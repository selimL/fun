// UI wiring: subject picker, chat thread, composer, history, settings.
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = s => SC.Render.escapeHtml(s);

  SC.loadSettings();

  const state = {
    selected: new Set(loadJSON('sc-subjects', ['math'])),
    output: 'answer',
    images: [],
    chat: null,
    controller: null,
    models: [],
  };

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }

  // ---------- i18n ----------
  function applyI18n() {
    document.documentElement.lang = SC.lang;
    document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = SC.t(e.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(e => { e.innerHTML = SC.t(e.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = SC.t(e.dataset.i18nTitle); });
    $('#input').placeholder = SC.t('placeholder');
    document.querySelectorAll('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === SC.lang));
    renderSubjects();
    if (!state.chat) renderWelcome();
    refreshStatus();
  }

  // ---------- Subjects ----------
  function renderSubjects() {
    const box = $('#subjects');
    box.innerHTML = '';
    for (const s of SC.SUBJECTS) {
      const b = el('button', 'chip' + (state.selected.has(s.id) ? ' on' : ''));
      b.style.setProperty('--c', s.color);
      b.innerHTML = `<span class="chip-icon">${esc(s.icon)}</span><span>${esc(s.name[SC.lang])}</span>`;
      b.onclick = () => {
        state.selected.has(s.id) ? state.selected.delete(s.id) : state.selected.add(s.id);
        onSubjectsChanged();
      };
      box.appendChild(b);
    }
    updateModeBadge();
  }
  function onSubjectsChanged() {
    saveJSON('sc-subjects', [...state.selected]);
    renderSubjects();
  }
  function updateModeBadge() {
    const n = state.selected.size;
    const badge = $('#modeBadge');
    badge.textContent = n === 0 ? '' : n === 1 ? SC.t('single') : SC.t('panelOf', n);
    badge.classList.toggle('panel', n > 1);
  }

  // ---------- Thread rendering ----------
  function renderWelcome() {
    const t = $('#thread');
    t.innerHTML = '';
    const w = el('div', 'welcome');
    w.innerHTML = `<div class="welcome-logo">◈</div><h1>${esc(SC.t('welcomeTitle'))}</h1><p>${esc(SC.t('welcomeText'))}</p><div class="side-label">${esc(SC.t('examples'))}</div>`;
    const ex = el('div', 'examples');
    for (const e of SC.t('ex')) {
      const b = el('button', 'example');
      b.innerHTML = `<div class="ex-subjects">${e.s.map(id => `<span style="--c:${SC.subjectById[id].color}">${esc(SC.subjectById[id].icon)} ${esc(SC.subjectById[id].name[SC.lang])}</span>`).join('')}</div><div>${esc(e.q)}</div>`;
      b.onclick = () => {
        state.selected = new Set(e.s);
        onSubjectsChanged();
        $('#input').value = e.q;
        autosize();
        $('#input').focus();
      };
      ex.appendChild(b);
    }
    w.appendChild(ex);
    t.appendChild(w);
  }

  const nearBottom = () => { const t = $('#thread'); return t.scrollHeight - t.scrollTop - t.clientHeight < 120; };
  const scrollDown = (force) => { const t = $('#thread'); if (force || nearBottom()) t.scrollTop = t.scrollHeight; };

  function renderUser(turn) {
    const u = el('div', 'msg user');
    const subs = turn.subjects.map(id => SC.subjectById[id]).filter(Boolean);
    u.innerHTML = `<div class="user-meta">${subs.map(s => `<span class="tag" style="--c:${s.color}">${esc(s.icon)} ${esc(s.name[SC.lang])}</span>`).join('')}</div>`;
    const bubble = el('div', 'bubble');
    bubble.textContent = turn.question;
    if (turn.thumbs && turn.thumbs.length) {
      const imgs = el('div', 'user-images');
      turn.thumbs.forEach(src => { const i = el('img'); i.src = src; imgs.appendChild(i); });
      bubble.prepend(imgs);
    }
    u.appendChild(bubble);
    $('#thread').appendChild(u);
  }

  function addDivider(text) {
    const d = el('div', 'divider', `<span>${esc(text)}</span>`);
    $('#thread').appendChild(d);
    return d;
  }

  // A post is one speaker's message. Returns a live handle used by the council.
  function addPost(data, live = true) {
    const sub = data.subjectId ? SC.subjectById[data.subjectId] : null;
    const card = el('div', `post ${data.kind}`);
    if (sub) card.style.setProperty('--c', sub.color);
    const icon = sub ? sub.icon : data.kind === 'moderator' ? '◈' : data.kind === 'check' ? '✓' : '🖼';
    card.innerHTML = `
      <div class="post-head">
        <span class="avatar">${esc(icon)}</span>
        <span class="post-title">${esc(data.title)}</span>
        <span class="model">${esc(data.model || '')}</span>
        <span class="state"></span>
      </div>
      <details class="reasoning" hidden><summary>${esc(SC.t('reasoning'))}</summary><div class="reasoning-body"></div></details>
      <div class="tools" hidden></div>
      <div class="content md"></div>`;
    $('#thread').appendChild(card);
    const contentEl = card.querySelector('.content');
    const reasonBox = card.querySelector('.reasoning');
    const reasonEl = card.querySelector('.reasoning-body');
    const toolsEl = card.querySelector('.tools');
    const stateEl = card.querySelector('.state');

    let pending = false;
    const paint = () => {
      pending = false;
      const stick = nearBottom();
      if (data.content) SC.Render.into(contentEl, data.content);
      else contentEl.innerHTML = live && !data.error ? `<span class="typing">${esc(SC.t('thinking'))}</span>` : '';
      if (data.error) contentEl.insertAdjacentHTML('beforeend', `<div class="error">${esc(data.error)}</div>`);
      if (data.thinking) { reasonBox.hidden = false; reasonEl.textContent = data.thinking; }
      if (stick) scrollDown(true);
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(paint); } };

    const addToolChip = t => {
      toolsEl.hidden = false;
      const d = el('details', 'tool');
      const arg = t.args ? (t.args.expression || t.args.equation || t.args.formula || t.args.code || JSON.stringify(t.args)) : '';
      d.innerHTML = `<summary>🛠 ${esc(t.name)} <code>${esc(String(arg).slice(0, 80))}</code></summary><pre>${esc(String(arg))}\n→ ${esc(String(t.result))}</pre>`;
      toolsEl.appendChild(d);
    };
    (data.tools || []).forEach(addToolChip);

    if (live) { card.classList.add('streaming'); stateEl.innerHTML = '<span class="spinner"></span>'; }
    if (data.error) { card.classList.add('failed'); stateEl.textContent = '⚠'; }
    paint();

    return {
      data,
      appendContent(s) { data.content += s; schedule(); },
      appendThinking(s) { data.thinking += s; schedule(); },
      setContent(c, th) { data.content = c; if (th) data.thinking = (data.thinking || '') + th; schedule(); },
      addTool(t) { const rec = { name: t.name, args: t.args, result: String(t.result) }; data.tools.push(rec); addToolChip(rec); },
      done() {
        card.classList.remove('streaming');
        stateEl.innerHTML = '';
        if (data.kind === 'check') stateEl.textContent = /^\s*VERIFIED/i.test(data.content) ? '✓' : /^\s*CORRECTED/i.test(data.content) ? '✎' : '';
        paint();
      },
      error(msg) {
        data.error = msg;
        card.classList.remove('streaming');
        card.classList.add('failed');
        stateEl.textContent = '⚠';
        paint();
      },
    };
  }

  function renderActions(turn) {
    if (!turn.final) return;
    const bar = el('div', 'actions');
    const mk = (kind, label) => {
      const b = el('button', 'btn small', esc(label));
      b.onclick = () => runExport(kind, turn, b);
      bar.appendChild(b);
      return b;
    };
    mk('word', '📄 ' + SC.t('exportWord'));
    mk('doc', '📘 ' + SC.t('exportDoc'));
    mk('sheet', '📊 ' + SC.t('exportSheet'));
    mk('slides', '📽 ' + SC.t('exportSlides'));
    const copy = el('button', 'btn small ghost', '⧉ ' + esc(SC.t('copy')));
    copy.onclick = () => { navigator.clipboard.writeText(turn.final); copy.textContent = '✓ ' + SC.t('copied'); };
    bar.appendChild(copy);
    bar.appendChild(el('span', 'hint', esc(SC.t('exportHint'))));
    $('#thread').appendChild(bar);
    return bar;
  }

  async function runExport(kind, turn, btn) {
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + esc(SC.t('making')); }
    try {
      await SC.Export.create(kind, turn.question, turn.final);
    } catch (e) {
      toast(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  function renderTurn(turn) {
    renderUser(turn);
    for (const p of turn.posts) {
      if (p.kind === 'divider') addDivider(p.title);
      else addPost(p, false);
    }
    renderActions(turn);
  }

  // ---------- Sending ----------
  async function send() {
    if (state.controller) { state.controller.abort(); return; }
    const question = $('#input').value.trim();
    if (!question && !state.images.length) return;
    if (!state.selected.size) { toast(SC.t('noSubject')); return; }
    if (!SC.settings.defaultModel) { toast(SC.t('noModel')); openSettings(); return; }

    if (!state.chat) {
      state.chat = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: question.slice(0, 70) || '🖼', createdAt: Date.now(), turns: [] };
      $('#thread').innerHTML = '';
    }
    const subjects = SC.SUBJECTS.map(s => s.id).filter(id => state.selected.has(id));
    const images = state.images.map(i => i.full);
    const turn = { question: question || '(see image)', subjects, thumbs: state.images.map(i => i.thumb), posts: [], final: '', output: state.output };
    const history = state.chat.turns.filter(t => t.final).map(t => ({ question: t.question, final: t.final }));
    state.chat.turns.push(turn);

    $('#input').value = '';
    autosize();
    state.images = [];
    renderThumbs();
    renderUser(turn);
    scrollDown(true);

    const controller = new AbortController();
    state.controller = controller;
    setBusy(true);

    const ui = {
      addPost: d => {
        const data = { kind: d.kind, subjectId: d.subject ? d.subject.id : null, title: d.title, model: d.model, content: '', thinking: '', tools: [] };
        turn.posts.push(data);
        return addPost(data, true);
      },
      addDivider: text => { turn.posts.push({ kind: 'divider', title: text }); addDivider(text); },
    };

    try {
      turn.final = await SC.Council.run({ question: turn.question, images, subjects, history, ui, signal: controller.signal });
      const bar = renderActions(turn);
      if (turn.final && turn.output !== 'answer' && bar) {
        const idx = { doc: 1, sheet: 2, slides: 3 }[turn.output];
        await runExport(turn.output, turn, bar.children[idx]);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        const msg = SC.isNetworkError(e) ? SC.t('errConnect') : e.message;
        toast(msg);
        turn.error = msg;
      }
    } finally {
      state.controller = null;
      setBusy(false);
      state.chat.updatedAt = Date.now();
      await SC.DB.put(state.chat);
      renderHistory();
      scrollDown();
    }
  }

  function setBusy(busy) {
    const b = $('#sendBtn');
    b.textContent = busy ? '■ ' + SC.t('stop') : SC.t('send');
    b.classList.toggle('danger', busy);
  }

  // ---------- Images ----------
  function resize(file, max, quality) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  async function addImages(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      state.images.push({ full: await resize(f, 1600, 0.9), thumb: await resize(f, 360, 0.75) });
    }
    renderThumbs();
  }
  function renderThumbs() {
    const box = $('#thumbs');
    box.innerHTML = '';
    state.images.forEach((im, i) => {
      const t = el('div', 'thumb');
      t.innerHTML = `<img src="${im.thumb}" alt=""><button aria-label="Remove">×</button>`;
      t.querySelector('button').onclick = () => { state.images.splice(i, 1); renderThumbs(); };
      box.appendChild(t);
    });
  }

  // ---------- History ----------
  async function renderHistory() {
    const box = $('#history');
    const chats = await SC.DB.all();
    box.innerHTML = '';
    if (!chats.length) { box.appendChild(el('div', 'muted small', esc(SC.t('noHistory')))); return; }
    for (const c of chats) {
      const row = el('div', 'hist' + (state.chat && state.chat.id === c.id ? ' on' : ''));
      const subs = [...new Set(c.turns.flatMap(t => t.subjects))].slice(0, 4).map(id => SC.subjectById[id]).filter(Boolean);
      row.innerHTML = `<div class="hist-title">${esc(c.title)}</div><div class="hist-icons">${subs.map(s => `<span style="color:${s.color}">${esc(s.icon)}</span>`).join(' ')}</div><button class="del" title="${esc(SC.t('deleteChat'))}">×</button>`;
      row.onclick = () => openChat(c.id);
      row.querySelector('.del').onclick = async ev => {
        ev.stopPropagation();
        await SC.DB.del(c.id);
        if (state.chat && state.chat.id === c.id) newChat();
        renderHistory();
      };
      box.appendChild(row);
    }
  }
  async function openChat(id) {
    if (state.controller) return;
    const chat = await SC.DB.get(id);
    if (!chat) return;
    state.chat = chat;
    $('#thread').innerHTML = '';
    chat.turns.forEach(renderTurn);
    const last = chat.turns[chat.turns.length - 1];
    if (last) { state.selected = new Set(last.subjects); onSubjectsChanged(); }
    renderHistory();
    scrollDown(true);
    document.body.classList.remove('sidebar-open');
  }
  function newChat() {
    if (state.controller) state.controller.abort();
    state.chat = null;
    renderWelcome();
    renderHistory();
    document.body.classList.remove('sidebar-open');
    $('#input').focus();
  }

  // ---------- Connection & settings ----------
  async function refreshStatus() {
    const st = $('#status');
    try {
      state.models = await SC.Ollama.listModels();
      st.className = 'status ok';
      st.querySelector('.status-text').textContent = SC.t('online', state.models.length);
      autoPickModels();
    } catch {
      state.models = [];
      st.className = 'status bad';
      st.querySelector('.status-text').textContent = SC.t('offline');
    }
    return state.models;
  }

  // First run: pick sensible installed models automatically.
  function autoPickModels() {
    const m = state.models;
    if (!m.length) return;
    const find = (...pats) => { for (const p of pats) { const hit = m.find(x => p.test(x)); if (hit) return hit; } return ''; };
    const s = SC.settings;
    let changed = false;
    const set = (k, v) => { if (!s[k] && v) { s[k] = v; changed = true; } };
    const general = find(/^qwen3:(32|30|14)b/, /^gpt-oss/, /^qwen3/, /^gemma3:(27|12)b/, /^qwen2\.5:(32|14)b/, /^llama3\.\d/, /^mistral/, /.*/);
    set('defaultModel', general);
    set('mathModel', find(/^gpt-oss/, /^qwen3/, /^deepseek-r1/, /^qwq/) || general);
    set('codeModel', find(/coder/, /^qwen3/, /^gpt-oss/) || general);
    set('visionModel', find(/vl/, /vision/, /^gemma3:(4|12|27)b/, /llava/, /minicpm-v/));
    if (changed) SC.saveSettings();
  }

  function fillSelect(sel, value, allowEmpty) {
    sel.innerHTML = '';
    const opts = [...state.models];
    if (value && !opts.includes(value)) opts.unshift(value);
    if (allowEmpty) sel.appendChild(new Option(SC.t('sSame'), ''));
    opts.forEach(m => sel.appendChild(new Option(m, m)));
    sel.value = value || '';
  }

  function populateSettings() {
    const s = SC.settings;
    $('#sHost').value = s.host;
    fillSelect($('#sDefault'), s.defaultModel);
    fillSelect($('#sMath'), s.mathModel, true);
    fillSelect($('#sCode'), s.codeModel, true);
    fillSelect($('#sVision'), s.visionModel, true);
    $('#sTools').checked = s.useTools;
    $('#sThink').checked = s.useThink;
    $('#sVerify').checked = s.verify;
    $('#sRounds').value = String(s.rounds);
    $('#sCtx').value = String(s.numCtx);

    const per = $('#perSubject');
    per.innerHTML = '';
    for (const sub of SC.SUBJECTS) {
      const l = el('label');
      l.innerHTML = `<span>${esc(sub.icon)} ${esc(sub.name[SC.lang])}</span>`;
      const sel = el('select');
      fillSelect(sel, (s.subjectModels || {})[sub.id], true);
      sel.onchange = () => {
        s.subjectModels = { ...s.subjectModels, [sub.id]: sel.value };
        if (!sel.value) delete s.subjectModels[sub.id];
        SC.saveSettings();
      };
      l.appendChild(sel);
      per.appendChild(l);
    }

    const pre = $('#presets');
    pre.innerHTML = '';
    for (const p of SC.MODEL_PRESETS) {
      const names = [...new Set([p.general, p.math, p.code, p.vision])];
      const row = el('div', 'preset');
      const cmd = names.map(n => `ollama pull ${n}`).join('\n');
      row.innerHTML = `<div class="preset-head"><b>${esc(p.label[SC.lang])}</b><span class="spacer"></span>
        <button type="button" class="btn small ghost copy">${esc(SC.t('copy'))}</button>
        <button type="button" class="btn small use">${esc(SC.t('sApply'))}</button></div><pre>${esc(cmd)}</pre>`;
      row.querySelector('.copy').onclick = e => { navigator.clipboard.writeText(cmd); e.target.textContent = '✓'; };
      row.querySelector('.use').onclick = () => {
        Object.assign(SC.settings, { defaultModel: p.general, mathModel: p.math, codeModel: p.code, visionModel: p.vision });
        SC.saveSettings();
        populateSettings();
      };
      pre.appendChild(row);
    }
  }

  function bindSettings() {
    const s = SC.settings;
    const save = () => SC.saveSettings();
    $('#sHost').onchange = e => { s.host = e.target.value.trim() || SC.DEFAULT_SETTINGS.host; save(); };
    $('#sTest').onclick = async () => {
      s.host = $('#sHost').value.trim() || SC.DEFAULT_SETTINGS.host; save();
      await refreshStatus();
      populateSettings();
      if (!state.models.length) toast(SC.t('errConnect'));
    };
    $('#sDefault').onchange = e => { s.defaultModel = e.target.value; save(); };
    $('#sMath').onchange = e => { s.mathModel = e.target.value; save(); };
    $('#sCode').onchange = e => { s.codeModel = e.target.value; save(); };
    $('#sVision').onchange = e => { s.visionModel = e.target.value; save(); };
    $('#sTools').onchange = e => { s.useTools = e.target.checked; save(); };
    $('#sThink').onchange = e => { s.useThink = e.target.checked; save(); };
    $('#sVerify').onchange = e => { s.verify = e.target.checked; save(); };
    $('#sRounds').onchange = e => { s.rounds = +e.target.value; save(); };
    $('#sCtx').onchange = e => { s.numCtx = +e.target.value; save(); };
  }

  async function openSettings() {
    populateSettings();
    $('#settings').showModal();
    await refreshStatus();
    populateSettings();
  }

  // ---------- Misc ----------
  function toast(msg) {
    const t = el('div', 'toast', esc(msg));
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4500);
    setTimeout(() => t.remove(), 5000);
  }

  function autosize() {
    const i = $('#input');
    i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight, 220) + 'px';
  }

  function setOutput(o) {
    state.output = o;
    document.querySelectorAll('#outputSeg button').forEach(b => b.classList.toggle('on', b.dataset.out === o));
  }

  // ---------- Events ----------
  $('#sendBtn').onclick = send;
  $('#input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('#input').addEventListener('input', autosize);
  $('#input').addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addImages(files); }
  });
  $('#attachBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => { addImages([...e.target.files]); e.target.value = ''; };
  const dz = $('#dropZone');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || !e.relatedTarget) dz.classList.remove('drag'); }));
  document.addEventListener('drop', e => addImages([...(e.dataTransfer?.files || [])]));

  $('#newChat').onclick = newChat;
  $('#openSettings').onclick = openSettings;
  $('#toggleSidebar').onclick = () => document.body.classList.toggle('sidebar-open');
  $('#clearSubjects').onclick = () => { state.selected.clear(); onSubjectsChanged(); };
  $('#collapseSubjects').onclick = e => {
    const c = document.body.classList.toggle('subjects-collapsed');
    e.target.textContent = c ? '▾' : '▴';
  };
  $('#suggestBtn').onclick = async e => {
    const q = $('#input').value.trim();
    if (!q) { $('#input').focus(); return; }
    if (!SC.settings.defaultModel) { toast(SC.t('noModel')); return; }
    const b = e.currentTarget, label = b.textContent;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try {
      const ids = await SC.Council.suggestSubjects(q);
      if (ids.length) { state.selected = new Set(ids); onSubjectsChanged(); }
    } catch (err) {
      toast(SC.isNetworkError(err) ? SC.t('errConnect') : err.message);
    } finally {
      b.disabled = false; b.textContent = label;
    }
  };
  document.querySelectorAll('#langSeg button').forEach(b => b.onclick = () => {
    SC.lang = b.dataset.lang;
    try { localStorage.setItem('sc-lang', SC.lang); } catch { /* ignore */ }
    applyI18n();
    renderHistory();
    if (state.chat && !state.controller) { $('#thread').innerHTML = ''; state.chat.turns.forEach(renderTurn); }
  });
  document.querySelectorAll('#outputSeg button').forEach(b => b.onclick = () => setOutput(b.dataset.out));

  // ---------- Start ----------
  bindSettings();
  setOutput('answer');
  applyI18n();
  renderHistory();
  refreshStatus().then(models => { if (!models.length || !SC.settings.defaultModel) openSettings(); });
})();
