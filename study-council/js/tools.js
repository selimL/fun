// Tools the experts can call so they don't have to do arithmetic "in their head".
window.SC = window.SC || {};

SC.Tools = (() => {
  const ATOMIC = {
    H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
    Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
    Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
    Ga: 69.723, Ge: 72.630, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
    Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71,
    Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24,
    Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.50, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05,
    Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
    Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04, Pa: 231.04, U: 238.03,
    Np: 237, Pu: 244, Am: 243, Cm: 247, Bk: 247, Cf: 251, Es: 252, Fm: 257,
  };

  const definitions = [
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Evaluate a math expression exactly with math.js. Supports units and conversion ("3 m/s * 4 s to km", "9.81 m/s^2 * 70 kg to N"), ' +
          'trig in radians (sin(pi/6)) or with deg (sin(30 deg)), log(x) natural log, log10, sqrt, factorial, combinations(n,k), ' +
          'matrices ([[1,2],[3,4]], det, inv, transpose, eigs, multiply, lusolve), complex numbers (2+3i), ' +
          'statistics (mean, median, std, variance), symbolic derivative("x^2*sin(x)", "x") and simplify("2x+3x"). ' +
          'Use several statements separated by ";" or newlines; variables persist within one call.',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'math.js expression(s)' } },
          required: ['expression'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'solve_equation',
        description: 'Find all real numeric roots of an equation in one variable within a range, e.g. equation "x^3 - 2x = 5", variable "x". ' +
          'Use for equations without a simple closed form.',
        parameters: {
          type: 'object',
          properties: {
            equation: { type: 'string', description: 'Equation with "=" or an expression assumed equal to 0' },
            variable: { type: 'string', description: 'Variable to solve for, default x' },
            min: { type: 'number', description: 'Search range start, default -1000' },
            max: { type: 'number', description: 'Search range end, default 1000' },
          },
          required: ['equation'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'molar_mass',
        description: 'Molar mass in g/mol of a chemical formula such as "H2SO4", "Ca(OH)2", "CuSO4·5H2O", "[Fe(CN)6]". Also returns mass percent of each element.',
        parameters: {
          type: 'object',
          properties: { formula: { type: 'string' } },
          required: ['formula'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_javascript',
        description: 'Run JavaScript code in a sandbox (no DOM, no network, 3 s limit) and return console.log output and the value of the last expression. ' +
          'Use it to test algorithms, check code logic, or brute-force/simulate a problem.',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
        },
      },
    },
  ];

  const fmt = v => {
    try { return math.format(v, { precision: 12 }); } catch { return String(v); }
  };

  function calculate({ expression }) {
    if (!expression) return 'Error: empty expression';
    const scope = {};
    const results = math.evaluate(String(expression).split(/;|\n/).map(s => s.trim()).filter(Boolean), scope);
    return results.map(fmt).filter(s => s !== 'undefined').join('\n');
  }

  function solveEquation({ equation, variable = 'x', min = -1000, max = 1000 }) {
    const parts = String(equation).split('=');
    const expr = parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : parts[0];
    const f = math.compile(expr);
    const g = x => { const v = f.evaluate({ [variable]: x }); return typeof v === 'number' ? v : NaN; };
    const roots = [];
    const N = 20000, step = (max - min) / N;
    let x0 = min, y0 = g(x0);
    for (let i = 1; i <= N; i++) {
      const x1 = min + i * step, y1 = g(x1);
      if (Number.isFinite(y0) && Number.isFinite(y1)) {
        if (y0 === 0) roots.push(x0);
        else if (y0 * y1 < 0) {
          let a = x0, b = x1, fa = y0;
          for (let k = 0; k < 100; k++) {
            const m = (a + b) / 2, fm = g(m);
            if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
          }
          const r = (a + b) / 2;
          // Reject sign changes caused by poles (e.g. tan, 1/x).
          if (Math.abs(g(r)) < 1e-6 * (1 + Math.abs(y0) + Math.abs(y1))) roots.push(r);
        }
      }
      x0 = x1; y0 = y1;
    }
    if (Number.isFinite(y0) && y0 === 0) roots.push(x0);
    const uniq = roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-9).map(r => +r.toPrecision(12));
    return uniq.length
      ? `${variable} ≈ ${uniq.join(', ')}  (real roots in [${min}, ${max}])`
      : `No real roots found in [${min}, ${max}]. Try another range, or the roots are complex.`;
  }

  function molarMass({ formula }) {
    const src = String(formula).replace(/\s+/g, '');
    // Split hydrates: CuSO4·5H2O or CuSO4*5H2O or CuSO4.5H2O
    const pieces = src.split(/[·*•]|\.(?=\d)/);
    const total = {};
    for (const piece of pieces) {
      const m = piece.match(/^(\d+)(.*)$/);
      const mult = m ? +m[1] : 1;
      const counts = parseFormula(m ? m[2] : piece);
      for (const [el, n] of Object.entries(counts)) total[el] = (total[el] || 0) + n * mult;
    }
    let mass = 0;
    for (const [el, n] of Object.entries(total)) {
      if (!(el in ATOMIC)) throw new Error('Unknown element: ' + el);
      mass += ATOMIC[el] * n;
    }
    const pct = Object.entries(total).map(([el, n]) => `${el}${n > 1 ? n : ''}: ${(ATOMIC[el] * n / mass * 100).toFixed(2)}%`);
    return `${formula}: ${mass.toFixed(3)} g/mol\nComposition: ${Object.entries(total).map(([e, n]) => e + '×' + n).join(', ')}\nMass %: ${pct.join(', ')}`;
  }

  function parseFormula(s) {
    let i = 0;
    const group = () => {
      const counts = {};
      while (i < s.length) {
        const ch = s[i];
        if (ch === '(' || ch === '[') {
          i++;
          const inner = group();
          i++; // closing bracket
          const n = num();
          for (const [el, c] of Object.entries(inner)) counts[el] = (counts[el] || 0) + c * n;
        } else if (ch === ')' || ch === ']') {
          return counts;
        } else if (/[A-Z]/.test(ch)) {
          let el = ch; i++;
          while (i < s.length && /[a-z]/.test(s[i])) el += s[i++];
          const n = num();
          counts[el] = (counts[el] || 0) + n;
        } else {
          throw new Error(`Cannot parse "${s}" at "${s.slice(i)}"`);
        }
      }
      return counts;
    };
    const num = () => {
      let d = '';
      while (i < s.length && /\d/.test(s[i])) d += s[i++];
      return d ? +d : 1;
    };
    return group();
  }

  const WORKER_SRC = `
    self.onmessage = e => {
      const out = [];
      const show = v => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
      const log = (...a) => out.push(a.map(show).join(' '));
      self.console = { log, info: log, warn: log, error: log };
      try {
        const value = (0, eval)(e.data);
        if (value !== undefined) out.push('→ ' + show(value));
        self.postMessage(out.join('\\n') || '(no output)');
      } catch (err) {
        out.push('Error: ' + err.message);
        self.postMessage(out.join('\\n'));
      }
    };`;

  function runJavascript({ code }) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      const done = msg => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(String(msg).slice(0, 4000)); };
      const t = setTimeout(() => done('Error: timed out after 3 s (infinite loop?)'), 3000);
      w.onmessage = e => done(e.data);
      w.onerror = e => { e.preventDefault(); done('Error: ' + e.message); };
      w.postMessage(String(code || ''));
    });
  }

  async function run(name, args) {
    try {
      switch (name) {
        case 'calculate': return calculate(args);
        case 'solve_equation': return solveEquation(args);
        case 'molar_mass': return molarMass(args);
        case 'run_javascript': return await runJavascript(args);
        default: return 'Error: unknown tool ' + name;
      }
    } catch (e) {
      return 'Error: ' + e.message;
    }
  }

  return { definitions, run, _test: { calculate, solveEquation, molarMass } };
})();
