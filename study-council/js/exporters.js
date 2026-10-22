// Create Word documents, Excel spreadsheets and PowerPoint slides from answers.
// The files also open in Google Docs / Sheets / Slides (File → Open / upload).
window.SC = window.SC || {};

SC.Export = (() => {
  // ---------- LaTeX → readable text (for Word/PowerPoint) ----------
  const SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
    infty: '∞', partial: '∂', nabla: '∇', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', to: '→', rightarrow: '→', Rightarrow: '⇒',
    leftarrow: '←', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
    cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅', degree: '°', circ: '°', ldots: '…', cdots: '⋯', dots: '…', angle: '∠',
    perp: '⊥', parallel: '∥', propto: '∝', hbar: 'ħ', ell: 'ℓ', quad: '  ', qquad: '    ', ',': ' ', ';': ' ', '!': '', ' ': ' ',
  };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', '(': '⁽', ')': '⁾', '=': '⁼' };
  const SUB = {
    0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '(': '₍', ')': '₎', '=': '₌',
    a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  };
  const script = (s, map, mark) => [...s].every(c => map[c]) ? [...s].map(c => map[c]).join('') : `${mark}(${s})`;

  function latexToText(tex) {
    let s = tex;
    for (let k = 0; k < 4; k++) {
      s = s
        .replace(/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `(${wrap(a)}/${wrap(b)})`)
        .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, '$1√($2)')
        .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
        .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|mathbb|boxed)\{([^{}]*)\}/g, '$1')
        .replace(/\\(?:vec|overrightarrow)\{([^{}]*)\}/g, '$1⃗')
        .replace(/\\(?:hat)\{([^{}]*)\}/g, '$1̂')
        .replace(/\\(?:bar|overline)\{([^{}]*)\}/g, '$1̄')
        .replace(/\^\{([^{}]*)\}/g, (_, a) => script(a, SUP, '^'))
        .replace(/_\{([^{}]*)\}/g, (_, a) => script(a, SUB, '_'));
    }
    return s
      .replace(/\^(\w)/g, (_, a) => script(a, SUP, '^'))
      .replace(/_(\w)/g, (_, a) => script(a, SUB, '_'))
      .replace(/\\left|\\right|\\big|\\Big|\\displaystyle/g, '')
      // \alpha → α (eating the space after it, as LaTeX does); \sin x → sin x
      .replace(/\\([a-zA-Z]+|[,;! ])( ?)/g, (m, name, sp) => SYMBOLS[name] !== undefined ? SYMBOLS[name] : name + sp)
      .replace(/[{}]/g, '')
      .replace(/\\\\/g, '; ')
      .replace(/&/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const wrap = s => /^[\w.]+$/.test(s.trim()) ? s.trim() : `(${s.trim()})`;

  // Replace $..$ and $$..$$ in Markdown text with readable Unicode.
  const mathToText = md => md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => '\n\n' + latexToText(t) + '\n\n')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => '\n\n' + latexToText(t) + '\n\n')
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => latexToText(t))
    .replace(/(^|[^\\$\d])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g, (_, p, t) => p + latexToText(t));

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  const safeName = s => (s || 'study-council').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60) || 'study-council';

  // ---------- Word ----------
  function inlineRuns(tokens, style = {}) {
    const D = docx, runs = [];
    for (const t of tokens || []) {
      switch (t.type) {
        case 'strong': runs.push(...inlineRuns(t.tokens, { ...style, bold: true })); break;
        case 'em': runs.push(...inlineRuns(t.tokens, { ...style, italics: true })); break;
        case 'del': runs.push(...inlineRuns(t.tokens, { ...style, strike: true })); break;
        case 'codespan': runs.push(new D.TextRun({ text: decode(t.text), font: 'Consolas', ...style })); break;
        case 'link': runs.push(...inlineRuns(t.tokens, { ...style, color: '2F5BEA', underline: {} })); break;
        case 'br': runs.push(new D.TextRun({ text: '', break: 1 })); break;
        default:
          if (t.tokens) runs.push(...inlineRuns(t.tokens, style));
          else runs.push(new D.TextRun({ text: decode(t.text ?? t.raw ?? ''), ...style }));
      }
    }
    return runs;
  }
  const decode = s => { const el = document.createElement('textarea'); el.innerHTML = s; return el.value; };

  function blocks(tokens, depth = 0) {
    const D = docx, out = [];
    const H = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
    for (const t of tokens) {
      switch (t.type) {
        case 'heading': out.push(new D.Paragraph({ heading: H[t.depth - 1], children: inlineRuns(t.tokens) })); break;
        case 'paragraph': out.push(new D.Paragraph({ children: inlineRuns(t.tokens), spacing: { after: 120 } })); break;
        case 'text': out.push(new D.Paragraph({ children: inlineRuns(t.tokens || [t]) })); break;
        case 'code':
          for (const line of t.text.split('\n')) {
            out.push(new D.Paragraph({ children: [new D.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })], shading: { fill: 'F2F2F2', type: D.ShadingType.CLEAR, color: 'auto' } }));
          }
          break;
        case 'blockquote': out.push(...blocks(t.tokens, depth).map(p => p)); break;
        case 'list':
          t.items.forEach((item, i) => {
            const [first, ...rest] = item.tokens;
            const prefix = t.ordered ? `${(+t.start || 1) + i}. ` : '';
            const runs = first && (first.type === 'text' || first.type === 'paragraph') ? inlineRuns(first.tokens || [first]) : [];
            out.push(new D.Paragraph({
              children: [new D.TextRun(prefix), ...runs],
              ...(t.ordered ? { indent: { left: 360 * (depth + 1) } } : { bullet: { level: Math.min(depth, 8) } }),
            }));
            const nested = first && !(first.type === 'text' || first.type === 'paragraph') ? item.tokens : rest;
            out.push(...blocks(nested, depth + 1));
          });
          break;
        case 'table': {
          const cell = (c, header) => new D.TableCell({
            children: [new D.Paragraph({ children: inlineRuns(c.tokens, header ? { bold: true } : {}) })],
            shading: header ? { fill: 'E8E4FB', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
          });
          out.push(new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            rows: [new D.TableRow({ tableHeader: true, children: t.header.map(c => cell(c, true)) }), ...t.rows.map(r => new D.TableRow({ children: r.map(c => cell(c)) }))],
          }));
          out.push(new D.Paragraph(''));
          break;
        }
        case 'hr': out.push(new D.Paragraph({ border: { bottom: { color: 'CCCCCC', style: D.BorderStyle.SINGLE, size: 6, space: 1 } } })); break;
        case 'space': break;
        default: if (t.text) out.push(new D.Paragraph(decode(t.text)));
      }
    }
    return out;
  }

  async function wordFromMarkdown(md, title) {
    const D = docx;
    const clean = mathToText(md).replace(/```plot[\s\S]*?```/g, '');
    const tokens = marked.lexer(clean);
    const hasTitle = tokens[0] && tokens[0].type === 'heading' && tokens[0].depth === 1;
    const doc = new D.Document({
      creator: 'Study Council',
      title,
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{
        children: [
          ...(hasTitle ? [] : [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(title)] })]),
          ...blocks(tokens),
        ],
      }],
    });
    download(await D.Packer.toBlob(doc), safeName(title) + '.docx');
  }

  // ---------- Model-generated structured content ----------
  async function generate(kind, question, answer, signal) {
    const lang = 'Write in the same language as the question.';
    const prompts = {
      doc: `Turn the material below into a polished study document in Markdown: a "# " title, a short introduction, clear "## " sections with explanations and worked examples (math in LaTeX $...$), a summary of key points, and practice questions with answers at the end. ${lang}`,
      sheet: `Turn the material below into a useful spreadsheet. Choose 1–3 sheets (e.g. data, formulas/constants, step-by-step calculation, comparison table, glossary). ` +
        `Each sheet has a short name, column headers and rows. Cells are strings; numbers as plain numbers ("9.81"); you may use Excel formulas starting with "=" referencing cells (e.g. "=B2*C2"). ${lang}`,
      slides: `Turn the material below into a clear slide deck for a class presentation: 6–12 slides. Each slide has a title, 2–6 short bullet points (max ~15 words each, math written in plain text like x² or √x, not LaTeX) and speaker notes with the fuller explanation. Start with a title slide and end with a summary slide. ${lang}`,
    };
    const schemas = {
      sheet: {
        type: 'object', required: ['title', 'sheets'],
        properties: {
          title: { type: 'string' },
          sheets: { type: 'array', items: { type: 'object', required: ['name', 'columns', 'rows'], properties: {
            name: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          } } },
        },
      },
      slides: {
        type: 'object', required: ['title', 'slides'],
        properties: {
          title: { type: 'string' }, subtitle: { type: 'string' },
          slides: { type: 'array', items: { type: 'object', required: ['title', 'bullets'], properties: {
            title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
          } } },
        },
      },
    };
    const res = await SC.Ollama.chat({
      model: SC.settings.defaultModel,
      messages: [{ role: 'user', content: `${prompts[kind]}\n\nQuestion:\n${question}\n\nMaterial:\n${answer}` }],
      format: schemas[kind], useTools: false, useThink: false, temperature: 0.3, signal,
    });
    return kind === 'doc' ? res.content : JSON.parse(res.content);
  }

  // ---------- Excel ----------
  function excel(data) {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    for (const sh of data.sheets || []) {
      const aoa = [sh.columns || [], ...(sh.rows || [])];
      const ws = XLSX.utils.aoa_to_sheet([]);
      aoa.forEach((row, r) => row.forEach((v, c) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        const s = String(v ?? '').trim();
        if (r > 0 && s.startsWith('=')) ws[ref] = { t: 'n', f: s.slice(1) };
        else if (r > 0 && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) ws[ref] = { t: 'n', v: +s };
        else ws[ref] = { t: 's', v: s };
      }));
      const cols = Math.max(...aoa.map(r => r.length), 1);
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: cols - 1 } });
      ws['!cols'] = Array.from({ length: cols }, (_, c) => ({ wch: Math.min(60, Math.max(10, ...aoa.map(r => String(r[c] ?? '').length + 2))) }));
      let name = (sh.name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
      while (used.has(name)) name = name.slice(0, 28) + used.size;
      used.add(name);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    if (!wb.SheetNames.length) throw new Error('The model returned no sheets.');
    XLSX.writeFile(wb, safeName(data.title) + '.xlsx');
  }

  // ---------- PowerPoint ----------
  function slides(data) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = data.title || 'Study Council';
    const BG = '0F0F1A', ACC = '7F5AF0', ACC2 = '2CB67D', FG = 'F2F2F7', SUBT = 'A0A0B8';

    const t = pptx.addSlide();
    t.background = { color: BG };
    t.addShape(pptx.ShapeType.rect, { x: 0, y: 6.9, w: 13.33, h: 0.6, fill: { color: ACC } });
    t.addText(data.title || '', { x: 0.8, y: 2.3, w: 11.7, h: 1.5, fontSize: 40, bold: true, color: FG, fontFace: 'Segoe UI' });
    if (data.subtitle) t.addText(data.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.8, fontSize: 20, color: SUBT, fontFace: 'Segoe UI' });

    const list = (data.slides || []).filter((s, i) => !(i === 0 && s.title === data.title && !(s.bullets || []).length));
    list.forEach((s, i) => {
      const sl = pptx.addSlide();
      sl.background = { color: BG };
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: i % 2 ? ACC2 : ACC } });
      sl.addText(latexToText(s.title || ''), { x: 0.6, y: 0.35, w: 12, h: 0.9, fontSize: 30, bold: true, color: FG, fontFace: 'Segoe UI' });
      const bullets = (s.bullets || []).map(b => ({ text: latexToText(String(b).replace(/\$/g, '')), options: { bullet: { indent: 18 }, paraSpaceAfter: 10 } }));
      if (bullets.length) sl.addText(bullets, { x: 0.8, y: 1.45, w: 11.8, h: 5.4, fontSize: 22, color: FG, valign: 'top', fontFace: 'Segoe UI' });
      sl.addText(`${i + 1} / ${list.length}`, { x: 11.6, y: 6.95, w: 1.4, h: 0.4, fontSize: 11, color: SUBT, align: 'right' });
      if (s.notes) sl.addNotes(s.notes);
    });
    return pptx.writeFile({ fileName: safeName(data.title) + '.pptx' });
  }

  async function create(kind, question, answer, signal) {
    if (kind === 'word') return wordFromMarkdown(answer, question.split('\n')[0].slice(0, 80));
    const data = await generate(kind, question, answer, signal);
    if (kind === 'doc') {
      const title = (data.match(/^#\s+(.+)$/m) || [])[1] || question.slice(0, 80);
      return wordFromMarkdown(data, title);
    }
    if (kind === 'sheet') return excel(data);
    if (kind === 'slides') return slides(data);
  }

  return { create, latexToText, _test: { mathToText } };
})();
