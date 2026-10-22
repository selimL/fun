// Minimal Ollama client: model list, capabilities, and streaming chat with tool calls.
window.SC = window.SC || {};

SC.isNetworkError = e => e instanceof TypeError && /fetch|network|load failed/i.test(e.message);

SC.Ollama = (() => {
  const capCache = {};

  const base = () => (SC.settings.host || 'http://localhost:11434').replace(/\/+$/, '');

  async function listModels() {
    const r = await fetch(base() + '/api/tags');
    if (!r.ok) throw new Error('Ollama /api/tags → HTTP ' + r.status);
    const j = await r.json();
    return (j.models || []).map(m => m.name).sort();
  }

  // Returns e.g. ['completion', 'tools', 'thinking', 'vision'].
  async function capabilities(model) {
    if (capCache[model]) return capCache[model];
    let caps = null;
    try {
      const r = await fetch(base() + '/api/show', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (r.ok) {
        const j = await r.json();
        caps = j.capabilities || null;
      }
    } catch { /* fall through to guesses */ }
    if (!caps) {
      // Older Ollama: guess from the name, and learn from errors later.
      caps = ['completion', 'tools'];
      if (/qwen3|deepseek-r1|qwq|gpt-oss|magistral/i.test(model)) caps.push('thinking');
      if (/vl|vision|llava|gemma3|minicpm-v|moondream/i.test(model)) caps.push('vision');
    }
    capCache[model] = caps;
    return caps;
  }

  function forget(model, cap) {
    if (capCache[model]) capCache[model] = capCache[model].filter(c => c !== cap);
  }

  // One streaming /api/chat call. onDelta({content, thinking}) is called for each chunk.
  // Resolves to { content, thinking, tool_calls }.
  async function chatOnce({ model, messages, tools, think, format, options, signal, onDelta }) {
    const body = { model, messages, stream: true, options: options || {} };
    if (tools && tools.length) body.tools = tools;
    if (think !== undefined) body.think = think;
    if (format) body.format = format;
    if (SC.settings.keepAlive) body.keep_alive = SC.settings.keepAlive;

    const r = await fetch(base() + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch { /* keep status */ }
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', content = '', thinking = '';
    const tool_calls = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        const m = j.message || {};
        if (m.thinking) { thinking += m.thinking; onDelta && onDelta({ thinking: m.thinking }); }
        if (m.content) { content += m.content; onDelta && onDelta({ content: m.content }); }
        if (m.tool_calls) tool_calls.push(...m.tool_calls);
      }
    }
    return { content, thinking, tool_calls };
  }

  // Chat with automatic tool execution and graceful fallback for models
  // that lack tool or thinking support.
  async function chat({ model, messages, useTools, useThink, format, temperature, signal, onDelta, onTool }) {
    const caps = await capabilities(model);
    let tools = useTools && caps.includes('tools') ? SC.Tools.definitions : null;
    let think;
    if (useThink && caps.includes('thinking')) think = /gpt-oss/i.test(model) ? 'high' : true;
    else if (caps.includes('thinking')) think = /gpt-oss/i.test(model) ? 'low' : false;

    const options = { temperature: temperature ?? 0.3, num_ctx: +SC.settings.numCtx || 16384 };
    const convo = messages.slice();
    let allContent = '', allThinking = '';

    for (let step = 0; step < 8; step++) {
      let res;
      try {
        res = await chatOnce({ model, messages: convo, tools, think, format, options, signal, onDelta });
      } catch (e) {
        if (/does not support tools/i.test(e.message) && tools) { forget(model, 'tools'); tools = null; step--; continue; }
        if (/does not support thinking|think value/i.test(e.message) && think !== undefined) { forget(model, 'thinking'); think = undefined; step--; continue; }
        throw e;
      }
      allContent += res.content;
      allThinking += res.thinking;
      if (!res.tool_calls.length) break;

      convo.push({ role: 'assistant', content: res.content, tool_calls: res.tool_calls });
      for (const call of res.tool_calls) {
        const fn = call.function || {};
        let args = fn.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        const result = await SC.Tools.run(fn.name, args || {});
        onTool && onTool({ name: fn.name, args, result });
        convo.push({ role: 'tool', content: String(result), tool_name: fn.name });
      }
      // Keep text written before and after a tool call in separate paragraphs.
      if (allContent && !/\n\n$/.test(allContent)) { allContent += '\n\n'; onDelta && onDelta({ content: '\n\n' }); }
    }
    return { content: allContent, thinking: allThinking };
  }

  return { listModels, capabilities, chat, chatOnce };
})();
