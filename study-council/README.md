# Study Council

A panel of expert AI tutors that runs entirely on your own computer through [Ollama](https://ollama.com).
Pick one subject to ask a single expert, or several subjects and the experts **discuss the question together**
and a moderator writes one combined answer for interdisciplinary questions.

Subjects: Mathematics, Statistics, Physics, Chemistry, Biology, Astronomy, Earth & Environmental Science,
Geography, History, Philosophy, Economics, Psychology, Political Science & Law, Literature, Linguistics,
Computer Science & Coding, Engineering, Medicine & Health, Art & Music.

## Quick start

1. Install Ollama: <https://ollama.com/download>
2. Install models that fit your computer (Settings in the app shows these too):

   | Computer | Commands |
   |---|---|
   | 8 GB RAM | `ollama pull qwen3:8b` · `ollama pull qwen2.5-coder:7b` · `ollama pull qwen2.5vl:7b` |
   | 16 GB RAM / GPU | `ollama pull qwen3:14b` · `ollama pull qwen2.5-coder:14b` · `ollama pull qwen2.5vl:7b` |
   | 32 GB+ RAM / big GPU | `ollama pull qwen3:32b` · `ollama pull gpt-oss:20b` · `ollama pull qwen2.5-coder:32b` · `ollama pull gemma3:27b` |

3. Open `index.html` (double-click it, or run `python3 -m http.server` in this folder and go to <http://localhost:8000>).
   The app finds your models and picks sensible ones automatically.

If you host the page on a website (e.g. GitHub Pages), Ollama must allow it:
`OLLAMA_ORIGINS="*" ollama serve` (Windows: set the environment variable `OLLAMA_ORIGINS=*` and restart Ollama).
Opening the file directly or from `localhost` needs nothing extra.

## How it reaches college level with local models

- **Expert prompts per subject.** Each expert has a method written for its field: restate the problem, name the
  technique, show every step, mark the **Final answer**, then check it (dimensional analysis, substituting back,
  balancing equations, limiting cases), and avoid the usual traps for that subject.
- **Tools instead of mental arithmetic.** Models that support tool calling can use:
  - `calculate`: math.js with units ("90 km/h to m/s"), matrices, complex numbers, statistics, symbolic derivatives
  - `solve_equation`: all real roots of an equation in a range
  - `molar_mass`: molar mass and mass percentages from a formula (handles `Ca(OH)2`, `CuSO4·5H2O`)
  - `run_javascript`: runs code in a sandbox to test algorithms

  Every tool call is shown under the message.
- **Reasoning mode** for thinking models (qwen3, deepseek-r1, gpt-oss). The reasoning appears in a collapsible box.
- **Verification pass.** A second pass grades the solution, recomputes it, and either confirms it (✓) or writes a
  corrected solution (✎).
- **Model routing.** Math and science subjects use the math model, coding uses the coding model, and the rest use
  the main model. Each subject can also have its own model.
- **Larger context window** (16k tokens by default) so long discussions fit.

## Panel discussions

With two or more subjects selected:

1. **Opening statements.** Each expert answers from its own field and sees what the earlier experts said, so it
   can build on it or correct it.
2. **Discussion rounds** (0–3, set in Settings). Experts respond to each other: they point out errors, fill gaps,
   and connect ideas across fields.
3. **Final synthesis.** A moderator resolves disagreements and writes one complete answer. For science subjects
   this answer is then verified.

✨ **Suggest** picks the right subjects for the question you typed.

## Other features

- **Math rendering** with KaTeX, **code highlighting**, and **function graphs** (experts can draw plots).
- **Images:** attach, paste or drag in a photo of a problem or diagram. Vision models see it directly. For other
  models, the vision model first transcribes it.
- **Docs, sheets and slides:** under every answer you can create a Word file, a study document (notes with
  practice questions), an Excel spreadsheet (with working formulas) or PowerPoint slides (with speaker notes).
  Set **Output** before asking to have one created automatically. The files also open in Google
  Docs/Sheets/Slides.
- **Chat history** is saved in your browser, and follow-up questions keep the context.
- **Turkish & English:** the interface switches with EN/TR, and the experts answer in the language you write in.

## Files

```
index.html, style.css
js/subjects.js    subjects, expert methods, recommended models
js/council.js     single-expert solve + verify, panel discussion, moderator
js/ollama.js      Ollama client (streaming, tool calls, capability detection)
js/tools.js       calculator, equation solver, molar mass, JS sandbox
js/render.js      Markdown + LaTeX + code + plots
js/exporters.js   .docx / .xlsx / .pptx creation
js/storage.js     settings + history (IndexedDB)
js/i18n.js        English / Turkish text
vendor/           KaTeX, marked, DOMPurify, highlight.js, math.js, docx, SheetJS, PptxGenJS (with licenses)
```

Everything runs locally. Your questions are never sent anywhere except your own Ollama.
