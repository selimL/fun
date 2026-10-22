// Markdown + LaTeX + code highlighting + function plots.
window.SC = window.SC || {};

SC.Render = (() => {
  marked.setOptions({ gfm: true, breaks: false });

  // Pull math out before Markdown so "_" and "*" inside it aren't mangled.
  function protectMath(src) {
    const math = [];
    const keep = (tex, display) => `\uE000M${math.push({ tex, display }) - 1}\uE001`;
    // Leave code alone.
    const code = [];
    src = src.replace(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g, m => `\uE000C${code.push(m) - 1}\uE001`);
    src = src
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
      .replace(/(^|[^\\$\d])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => pre + keep(t, false));
    src = src.replace(/\uE000C(\d+)\uE001/g, (_, i) => code[+i]);
    return { src, math };
  }

  function restoreMath(html, math) {
    return html.replace(/\uE000M(\d+)\uE001/g, (_, i) => {
      const { tex, display } = math[+i];
      try {
        return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
      } catch {
        return escapeHtml(tex);
      }
    });
  }

  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function markdown(src) {
    const { src: safe, math } = protectMath(src || '');
    const html = DOMPurify.sanitize(marked.parse(safe), { ADD_ATTR: ['target'] });
    return restoreMath(html, math);
  }

  // Render into an element, then upgrade code blocks and plots.
  function into(el, src) {
    el.innerHTML = markdown(src);
    el.querySelectorAll('pre code').forEach(code => {
      const lang = (code.className.match(/language-(\w+)/) || [])[1];
      if (lang === 'plot') {
        const div = document.createElement('div');
        div.className = 'plot';
        try { div.appendChild(plot(JSON.parse(code.textContent))); }
        catch { return; } // still streaming / bad JSON: leave as code
        code.parentElement.replaceWith(div);
        return;
      }
      try { hljs.highlightElement(code); } catch { /* unknown language */ }
      const pre = code.parentElement;
      if (!pre.querySelector('.copy-code')) {
        const b = document.createElement('button');
        b.className = 'copy-code';
        b.textContent = SC.t('copy');
        b.onclick = () => { navigator.clipboard.writeText(code.textContent); b.textContent = '✓'; setTimeout(() => (b.textContent = SC.t('copy')), 1200); };
        pre.appendChild(b);
      }
    });
    el.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  const PLOT_COLORS = ['#7f5af0', '#2cb67d', '#e4b363', '#e07a5f', '#3aa6b9', '#ff99c8'];

  function plot(spec) {
    const fns = (spec.functions || [spec.function || spec.y]).filter(Boolean).slice(0, 6);
    if (!fns.length) throw new Error('no functions');
    const xmin = +(spec.xmin ?? -10), xmax = +(spec.xmax ?? 10);
    const W = 560, H = 320, P = 36, N = 400;
    const series = fns.map(f => {
      const c = math.compile(String(f).replace(/^\s*y\s*=/, ''));
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const x = xmin + (xmax - xmin) * i / N;
        let y;
        try { y = c.evaluate({ x }); } catch { y = NaN; }
        pts.push([x, typeof y === 'number' && Number.isFinite(y) ? y : NaN]);
      }
      return pts;
    });
    let ys = series.flat().map(p => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ys.length) throw new Error('nothing to plot');
    // Clip extreme values (asymptotes) using percentiles.
    let ymin = spec.ymin ?? ys[Math.floor(ys.length * 0.02)], ymax = spec.ymax ?? ys[Math.ceil(ys.length * 0.98) - 1];
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const pad = (ymax - ymin) * 0.08; if (spec.ymin === undefined) ymin -= pad; if (spec.ymax === undefined) ymax += pad;
    const sx = x => P + (x - xmin) / (xmax - xmin) * (W - 2 * P);
    const sy = y => H - P - (y - ymin) / (ymax - ymin) * (H - 2 * P);

    const ns = 'http://www.w3.org/2000/svg';
    const clipId = 'clip' + Math.random().toString(36).slice(2);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(ns, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text !== undefined) e.textContent = text;
      svg.appendChild(e);
      return e;
    };
    const ticks = (a, b) => {
      const step = Math.pow(10, Math.floor(Math.log10((b - a) / 5)));
      const s = [1, 2, 5, 10].map(m => m * step).find(v => (b - a) / v <= 8);
      const out = [];
      for (let v = Math.ceil(a / s) * s; v <= b + 1e-9; v += s) out.push(+v.toPrecision(10));
      return out;
    };
    for (const t of ticks(xmin, xmax)) {
      add('line', { x1: sx(t), x2: sx(t), y1: P, y2: H - P, class: 'grid' });
      add('text', { x: sx(t), y: H - P + 14, class: 'tick', 'text-anchor': 'middle' }, t);
    }
    for (const t of ticks(ymin, ymax)) {
      add('line', { x1: P, x2: W - P, y1: sy(t), y2: sy(t), class: 'grid' });
      add('text', { x: P - 4, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, t);
    }
    if (ymin < 0 && ymax > 0) add('line', { x1: P, x2: W - P, y1: sy(0), y2: sy(0), class: 'axis' });
    if (xmin < 0 && xmax > 0) add('line', { x1: sx(0), x2: sx(0), y1: P, y2: H - P, class: 'axis' });

    series.forEach((pts, i) => {
      let d = '', pen = false;
      for (const [x, y] of pts) {
        if (!Number.isFinite(y) || y < ymin - (ymax - ymin) || y > ymax + (ymax - ymin)) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1);
        pen = true;
      }
      add('path', { d, fill: 'none', stroke: PLOT_COLORS[i % PLOT_COLORS.length], 'stroke-width': 2, 'clip-path': `url(#${clipId})` });
      add('text', { x: W - P, y: P + 14 + i * 16, class: 'legend', 'text-anchor': 'end', fill: PLOT_COLORS[i % PLOT_COLORS.length] }, 'y = ' + fns[i]);
    });
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = `<clipPath id="${clipId}"><rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}"/></clipPath>`;
    svg.prepend(defs);
    return svg;
  }

  return { markdown, into, escapeHtml };
})();
