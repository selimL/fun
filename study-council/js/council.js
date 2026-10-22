// Orchestrates single-expert solving and multi-expert panel discussions.
window.SC = window.SC || {};

SC.Council = (() => {
  const LANG_RULE = 'Language: reply in the same language as the student\'s question (Turkish → Turkish, English → English). Keep technical symbols standard.';
  const FORMAT_RULE = `Formatting: use Markdown. Write math in LaTeX: inline $...$ and display $$...$$ (never put math inside code blocks). ` +
    `Use fenced code blocks with a language tag for code. Use tables when comparing things. ` +
    `To draw a function graph, add a fenced block with language "plot" containing JSON like {"functions":["sin(x)","x^2/4"],"xmin":-6,"xmax":6} (math.js syntax).`;
  const TOOL_RULE = 'You have tools (calculate, solve_equation, molar_mass, run_javascript). Use them for every non-trivial computation and to check results; never guess numbers.';

  function modelFor(subjectId) {
    const s = SC.settings;
    if (s.subjectModels && s.subjectModels[subjectId]) return s.subjectModels[subjectId];
    const slot = SC.subjectModelSlot(subjectId);
    return (slot === 'math' && s.mathModel) || (slot === 'code' && s.codeModel) || s.defaultModel;
  }

  function expertSystem(sub, panel) {
    const others = panel.filter(p => p.id !== sub.id).map(p => p.name.en);
    return [
      `You are a ${sub.persona} and an excellent, patient university tutor. You solve beginner-to-intermediate college level problems (first and second year university) correctly and explain them clearly.`,
      sub.method,
      `General standards:
- Think carefully before answering. Be correct first, then clear.
- Structure: short restatement → approach → step-by-step work → **Final answer** (clearly marked) → quick check.
- Define terms a first-year student may not know. Prefer exact values, then decimals with sensible precision and units.
- If the question is ambiguous, state your assumption and continue. If you are not sure of a fact, say so instead of inventing it.`,
      others.length ? `You are part of a panel with experts in: ${others.join(', ')}. Speak from your discipline, build on and correct colleagues when needed, and connect ideas across fields.` : '',
      SC.settings.useTools ? TOOL_RULE : '',
      FORMAT_RULE,
      LANG_RULE,
    ].filter(Boolean).join('\n\n');
  }

  function moderatorSystem(panel) {
    return [
      `You are the chair of an academic panel (${panel.map(p => p.name.en).join(', ')}) and an excellent university teacher.`,
      `Your job: read the panel discussion and write ONE final, integrated answer for the student. Resolve disagreements by checking the reasoning yourself (recompute if needed), keep what is correct, drop what is wrong, and show how the disciplines connect.`,
      `Structure: a one-paragraph direct answer → the full worked solution/explanation organized by sub-question or theme → "**Final answer**" → a short "How the fields connect" section. Make it self-contained (the student should not need the discussion).`,
      SC.settings.useTools ? TOOL_RULE : '',
      FORMAT_RULE,
      LANG_RULE,
    ].filter(Boolean).join('\n\n');
  }

  function historyMessages(history) {
    const msgs = [];
    for (const turn of history.slice(-4)) {
      msgs.push({ role: 'user', content: turn.question });
      msgs.push({ role: 'assistant', content: turn.final });
    }
    return msgs;
  }

  const transcriptText = posts => posts.map(p => `### ${p.speaker}\n${p.content.trim()}`).join('\n\n');

  // Gets a text transcription of attached images from a vision model,
  // for experts whose model can't see images.
  async function describeImages(images, ctx) {
    if (!images.length) return '';
    const vm = SC.settings.visionModel;
    const post = ctx.ui.addPost({ kind: 'system', title: SC.t('readingImage'), model: vm || '—' });
    if (!vm) {
      post.error(SC.t('noVisionModel'));
      return '';
    }
    try {
      const res = await SC.Ollama.chat({
        model: vm,
        messages: [{
          role: 'user',
          content: 'Transcribe this image for a tutor who cannot see it. Copy all text, numbers, equations (in LaTeX), units, labels, axes and table contents EXACTLY. ' +
            'Then describe any diagram, graph, circuit, structure or figure precisely (components, values, positions, arrows). Do not solve anything.',
          images: images.map(stripDataUrl),
        }],
        useTools: false, useThink: false, temperature: 0.1, signal: ctx.signal,
        onDelta: d => d.content && post.appendContent(d.content),
      });
      post.done();
      return res.content.trim();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      post.error(e.message);
      return '';
    }
  }

  const stripDataUrl = u => u.replace(/^data:[^,]+,/, '');

  async function speak({ ctx, kind, sub, title, model, system, userText, attachImages, temperature, useThink = SC.settings.useThink }) {
    const post = ctx.ui.addPost({ kind, subject: sub, title, model });
    const userMsg = { role: 'user', content: userText };
    if (attachImages && ctx.images.length) userMsg.images = ctx.images.map(stripDataUrl);
    try {
      const res = await SC.Ollama.chat({
        model,
        messages: [{ role: 'system', content: system }, ...historyMessages(ctx.history), userMsg],
        useTools: SC.settings.useTools,
        useThink,
        temperature,
        signal: ctx.signal,
        onDelta: d => { if (d.thinking) post.appendThinking(d.thinking); if (d.content) post.appendContent(d.content); },
        onTool: t => post.addTool(t),
      });
      const content = splitThink(res.content, post);
      post.done();
      return content;
    } catch (e) {
      if (e.name === 'AbortError') { post.error(SC.t('stopped')); throw e; }
      // Ollama unreachable: no point asking the other experts.
      if (SC.isNetworkError(e)) { post.error(SC.t('errConnect')); throw e; }
      post.error(e.message);
      return '';
    }
  }

  // Some models put reasoning inline in <think> tags; move it out of the answer.
  function splitThink(text, post) {
    const m = text.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
    if (!m) return text;
    post.setContent(text.slice(m[0].length), m[1]);
    return text.slice(m[0].length);
  }

  async function imageContext(ctx, model) {
    if (!ctx.images.length) return { attach: false, extra: '' };
    const caps = await SC.Ollama.capabilities(model);
    if (caps.includes('vision')) return { attach: true, extra: '' };
    if (ctx.imageText === undefined) ctx.imageText = await describeImages(ctx.images, ctx);
    return { attach: false, extra: ctx.imageText ? `\n\n[Attached image — transcription]\n${ctx.imageText}` : '' };
  }

  async function verify(ctx, sub, model, question, answer, isPanel) {
    const persona = sub ? sub.persona : 'university professor';
    const system = [
      `You are a meticulous ${persona} grading a solution. Check every step: setup, formulas, algebra, arithmetic (recompute with tools), units, logic, and factual claims.`,
      `If everything is correct, reply exactly with the first line "VERIFIED ✓" followed by one or two sentences confirming the key result.`,
      `If anything is wrong or missing, reply with the first line "CORRECTED" then briefly list the errors, then give the complete corrected solution in the same structure, ending with **Final answer**.`,
      SC.settings.useTools ? TOOL_RULE : '', FORMAT_RULE, LANG_RULE,
    ].filter(Boolean).join('\n\n');
    const img = await imageContext(ctx, model);
    const text = `Question:\n${question}${img.extra}\n\n---\nProposed ${isPanel ? 'panel' : ''} solution:\n${answer}`;
    const out = await speak({ ctx, kind: 'check', sub, title: SC.t('checking'), model, system, userText: text, attachImages: img.attach, temperature: 0.1 });
    // A corrected solution replaces the original as the final answer.
    if (/^\s*CORRECTED/i.test(out)) return out.replace(/^\s*CORRECTED[^\n]*\n/i, '').trim() || answer;
    return answer;
  }

  async function run({ question, images, subjects, history, ui, signal }) {
    const panel = subjects.map(id => SC.subjectById[id]);
    const ctx = { ui, signal, images: images || [], history: history || [] };
    const transcript = [];

    if (panel.length === 1) {
      const sub = panel[0];
      const model = modelFor(sub.id);
      const img = await imageContext(ctx, model);
      let final = await speak({
        ctx, kind: 'expert', sub, title: sub.name[SC.lang], model,
        system: expertSystem(sub, panel),
        userText: question + img.extra, attachImages: img.attach, temperature: sub.temp,
      });
      if (final && SC.settings.verify) final = await verify(ctx, sub, model, question, final, false);
      return final;
    }

    // Opening statements, each expert sees what was said before them.
    ui.addDivider(SC.t('round1'));
    for (const sub of panel) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const model = modelFor(sub.id);
      const img = await imageContext(ctx, model);
      const userText = `Student's question:\n${question}${img.extra}\n\n` +
        (transcript.length ? `Panel discussion so far:\n\n${transcriptText(transcript)}\n\n---\n` : '') +
        `Give your opening contribution as the ${sub.name.en} expert: the part of the question your field answers, with full working where calculations are involved. ` +
        (transcript.length ? 'Do not repeat what colleagues said; correct them if your field shows they are wrong. ' : '') +
        'Be focused (about 150–350 words unless calculations need more).';
      const content = await speak({ ctx, kind: 'expert', sub, title: sub.name[SC.lang], model, system: expertSystem(sub, panel), userText, attachImages: img.attach, temperature: sub.temp });
      if (content) transcript.push({ speaker: sub.name.en + ' expert', content });
    }

    // Discussion rounds: respond, critique and connect.
    const rounds = Math.max(0, Math.min(3, +SC.settings.rounds || 0));
    for (let r = 0; r < rounds; r++) {
      ui.addDivider(SC.t('discussion') + (rounds > 1 ? ` ${r + 1}` : ''));
      for (const sub of panel) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const model = modelFor(sub.id);
        const img = await imageContext(ctx, model);
        const userText = `Student's question:\n${question}${img.extra}\n\nPanel discussion so far:\n\n${transcriptText(transcript)}\n\n---\n` +
          `Respond to your colleagues as the ${sub.name.en} expert. Point out any errors (recheck numbers with tools), add what is missing from your field, ` +
          'and explicitly connect your field\'s view with theirs. Be brief (under 200 words). If you fully agree and have nothing to add, say so in one sentence.';
        const content = await speak({ ctx, kind: 'expert', sub, title: sub.name[SC.lang], model, system: expertSystem(sub, panel), userText, attachImages: img.attach, temperature: sub.temp, useThink: false });
        if (content) transcript.push({ speaker: sub.name.en + ' expert', content });
      }
    }

    // Synthesis by the moderator.
    ui.addDivider(SC.t('synthesis'));
    const model = SC.settings.defaultModel;
    const img = await imageContext(ctx, model);
    const temp = Math.min(...panel.map(p => p.temp));
    let final = await speak({
      ctx, kind: 'moderator', sub: null, title: SC.t('moderator'), model,
      system: moderatorSystem(panel),
      userText: `Student's question:\n${question}${img.extra}\n\nPanel discussion:\n\n${transcriptText(transcript)}\n\n---\nWrite the final integrated answer for the student.`,
      attachImages: img.attach, temperature: temp,
    });
    if (final && SC.settings.verify && panel.some(p => p.group === 'stem')) final = await verify(ctx, null, model, question, final, true);
    return final;
  }

  async function suggestSubjects(question, signal) {
    const ids = SC.SUBJECTS.map(s => s.id);
    const res = await SC.Ollama.chat({
      model: SC.settings.defaultModel,
      messages: [{
        role: 'user',
        content: `Which academic subjects are needed to answer this question well? Choose 1 to 4 ids from: ${SC.SUBJECTS.map(s => `${s.id} (${s.name.en})`).join(', ')}.\n` +
          `Return JSON {"subjects": [...]}, most relevant first.\n\nQuestion: ${question}`,
      }],
      format: { type: 'object', properties: { subjects: { type: 'array', items: { type: 'string', enum: ids } } }, required: ['subjects'] },
      useTools: false, useThink: false, temperature: 0, signal,
    });
    const parsed = JSON.parse(res.content);
    return (parsed.subjects || []).filter(id => ids.includes(id)).slice(0, 4);
  }

  return { run, suggestSubjects, modelFor };
})();
