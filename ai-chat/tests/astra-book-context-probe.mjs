/**
 * Why does Astra answer from general knowledge instead of the ingested books?
 *
 * The chatbot puts the retrieved textbook excerpts (and the "answer from the
 * book or not at all" rules, plus the page-citation format) into a single
 * `system` message. Astra is handed the exact same message array as the old
 * Groq/Qwen/Mistral chain, so if Astra reads the system prompt it must behave
 * the same. Two candidate causes, tested here independently:
 *
 *   A) The retrieval layer returns nothing, so there is no book text in the
 *      prompt for ANY model to use.
 *   B) The tunnel drops/ignores/truncates `system` messages, so Astra never
 *      sees the excerpts and falls back to its own memory.
 *
 * Part C probes a workaround shape (excerpts merged into the user turn) so a fix
 * can be picked on evidence rather than guesswork.
 *
 * Run:  node ai-chat/tests/astra-book-context-probe.mjs
 */
const ASTRA_URL = 'https://rmwit9z.abc-tunnel.us/v1/chat/completions';
const ASTRA_KEY = 'sk-1af196978a75d6af-d5608e-c0e8ab59';
const ASTRA_MODEL = 'gpt-6-astra';

const SUPABASE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';

// ── A) Does the textbook RPC actually return pages? ──────────────────
// Same call the browser makes in ai-chatbot.js → searchTextbooks().
async function rpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

const QUERIES = [
  { subj: 'Physics', q: 'explain Newton second law of motion' },
  { subj: 'Biology', q: 'what is photosynthesis' },
  { subj: 'Chemistry', q: 'define periodic table groups' },
];

console.log('A) Textbook retrieval (browser-equivalent RPC call)');
for (const { subj, q } of QUERIES) {
  // Mirror of the client's query shaping.
  const searchQuery = (subj + ' ' + q)
    .replace(/\b(explain|what is|what are|define|tell me about|how does|how do|describe|give me|help me with)\b/gi, '')
    .trim()
    .slice(0, 200);
  const params = { p_query: searchQuery, p_book_id: null, p_limit: 8, p_class_level_id: null };
  const withChapters = await rpc('search_textbook_pages_with_chapters', params);
  const legacy = withChapters.status !== 200 ? await rpc('search_textbook_pages', params) : null;
  const used = withChapters.status === 200 ? withChapters : legacy;
  const rows = Array.isArray(used.json) ? used.json : [];

  console.log(`\n  query: "${searchQuery}"`);
  console.log(`  search_textbook_pages_with_chapters -> HTTP ${withChapters.status}` +
    (withChapters.status === 200 ? `, ${rows.length} page(s)` : ` (${String(withChapters.text).slice(0, 120)})`));
  if (legacy) console.log(`  search_textbook_pages (fallback) -> HTTP ${legacy.status}`);
  rows.slice(0, 3).forEach((p, i) => {
    const txt = String(p.full_text || p.snippet || '');
    console.log(`    [${i + 1}] ${p.book_title || '?'} · ch ${p.chapter_number ?? '-'} ${p.chapter_name || ''} ` +
      `· printed p.${p.printed_page_number ?? '-'} · pdf p.${p.page_number ?? '-'} · text ${txt.length} chars`);
  });
  if (rows.length) {
    console.log(`  has full_text/snippet: ${rows.some(p => (p.full_text || p.snippet))}`);
    console.log(`  sample: ${String(rows[0].full_text || rows[0].snippet || '').replace(/\s+/g, ' ').slice(0, 140)}`);
  }
}

// ── B/C) Does Astra actually read the `system` message? ──────────────
// A fabricated "book" the model cannot know from memory: if the excerpt is
// read, the answer must contain 42.5 and page 137. General knowledge cannot
// produce those numbers, so a miss proves the system prompt was ignored.
const CANARY_FACT = 'The pookium conversion, described on page 137 of this book, takes place at exactly 42.5 degrees Celsius and releases 7.7 joules per mole.';
const EXCERPT =
  '[BOOK: "Pookie Biology 11", Chapter 3: Pookie Processes, PAGE: 137]\n' + CANARY_FACT;
const RULES =
  'You were given the student\'s EXACT textbook excerpts below. You MUST read and comprehend them ' +
  'BEFORE writing your answer. Do NOT answer from general memory alone. Your explanation must be ' +
  'GROUNDED in these excerpts. If the answer is not in the excerpts, say NOT_IN_BOOK. ' +
  'End with a References section citing the book, chapter and page you used.';
const QUESTION = 'At what temperature does the pookium conversion happen, and which page states it?';

async function ask(messages, label, timeoutMs = 120000) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
  let res;
  try {
    res = await fetch(ASTRA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ASTRA_KEY },
      body: JSON.stringify({ model: ASTRA_MODEL, messages, stream: true }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.log(`\n  ${label}: fetch failed — ${e.message}`);
    return '';
  }
  if (!res.ok) {
    clearTimeout(timer);
    console.log(`\n  ${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
    return '';
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let out = '';
  let timedOut = false;
  while (true) {
    let read;
    try {
      read = await reader.read();
    } catch (e) {
      timedOut = true;
      break;
    }
    const { done, value } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const payload = t.slice(6);
      if (payload === '[DONE]') continue;
      try {
        const c = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (c) out += c;
      } catch (_) {}
    }
  }
  clearTimeout(timer);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const grounded = out.includes('42.5');
  const cited = /\b137\b/.test(out);
  console.log(`\n  ${label} (${secs}s, ${out.length} chars${timedOut ? ', TIMED OUT after ' + (timeoutMs / 1000) + 's' : ''})`);
  console.log(`    used the excerpt (42.5): ${grounded} · cited page 137: ${cited}`);
  console.log(`    reply: ${out.replace(/\s+/g, ' ').slice(0, 260)}`);
  return out;
}

/** Realistic prompt size: the client's rule block + up to 3 excerpts. */
function padding(bytes) {
  const line = 'TEXTBOOK BACKGROUND LINE — filler for size testing only.\n';
  return line.repeat(Math.ceil(bytes / line.length));
}

const D_ONLY = process.argv.includes('--d-only');

if (!D_ONLY) {
console.log('\n\nB) Does Astra read the `system` message?');
await ask(
  [{ role: 'system', content: RULES + '\n\nTEXTBOOK EXCERPTS (your source of truth):\n' + EXCERPT },
   { role: 'user', content: QUESTION }],
  'B1 system prompt, small'
);

await ask(
  [{ role: 'system', content: RULES + '\n\nTEXTBOOK EXCERPTS (your source of truth):\n' + padding(12000) + EXCERPT },
   { role: 'user', content: QUESTION }],
  'B2 system prompt, canary last, ~12KB (realistic size)'
);

console.log('\n\nC) Workaround shapes (used only if B misses)');
await ask(
  [{ role: 'system', content: RULES },
   { role: 'user', content: 'TEXTBOOK EXCERPTS (your source of truth):\n' + EXCERPT + '\n\n' + QUESTION }],
  'C1 excerpts merged into the user turn'
);

await ask(
  [{ role: 'developer', content: RULES + '\n\nTEXTBOOK EXCERPTS (your source of truth):\n' + EXCERPT },
   { role: 'user', content: QUESTION }],
  'C2 `developer` role instead of `system`'
);
}

// ── D) The REAL prompt, the REAL pages, a REAL question ──────────────
// B/C used a hand-written canary prompt. This part rebuilds the prompt the app
// actually sends, using the app's own formatter and rule block (extracted from
// ai-chatbot.js so the probe follows any edit), plus pages fetched from the
// live textbook RPC. If Astra still answers from general knowledge here, the
// grounding has to be strengthened in the app, not worked around.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHATBOT_SRC = readFileSync(
  fileURLToPath(new URL('../code/js/ai-chatbot.js', import.meta.url)),
  'utf8'
);

/** Pull a top-level `function name(...) { ... }` out of ai-chatbot.js. */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('probe: function not found in ai-chatbot.js: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('probe: unbalanced braces in ' + name);
}

const realPrefs = {
  responseStyle: 'balanced',
  explanationLevel: 'standard',
  language: 'english',
  studySuggestions: false,
  emojis: false,
  personalization: '',
  references: true,
};
const build = new Function(
  'aiPrefs',
  CHATBOT_SRC.slice(CHATBOT_SRC.indexOf('var TEXTBOOK_MAX_PAGES'), CHATBOT_SRC.indexOf('function formatTextbookContext(')) + '\n' +
  extractFunction(CHATBOT_SRC, 'formatTextbookContext') + '\n' +
  extractFunction(CHATBOT_SRC, 'aiPrefsPrompt') + '\n' +
  'return { formatTextbookContext: formatTextbookContext, aiPrefsPrompt: aiPrefsPrompt };'
)(realPrefs);

// The parts of buildSystemPrompt() that surround the textbook block.
const STUDY_HEADER =
  'You are Sir Zardari, an FSc Intermediate tutor (Pakistan). Teach step-by-step, use Unicode math (x₀, v², √2), no LaTeX, no HTML.\n\n' +
  'SELECTED SUBJECT — CRITICAL: The student selected "Physics" (PHY) in the composer dropdown. You are now a dedicated Physics tutor for this entire response.\n' +
  '- Answer ONLY within Physics: all explanations, examples, formulas, diagrams (text), and exam tips must be for Physics.\n' +
  '- Prefer Physics textbook excerpts provided below over general knowledge. Cite the exact Physics book, chapter number/name, and page in References when references are enabled.\n\n';
const BEHAVIOR_BLOCK =
  '\n\nSTYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines.\n\n' +
  'BEHAVIOR:\n' +
  '- For academic/study questions: Use the textbook content provided as your PRIMARY source. Explain step-by-step. Add your own knowledge to enhance.';

console.log('\n\nD) Real app prompt (app formatter + live RPC pages), real Physics question');
const REAL_QUESTION = 'Explain Newton\'s second law of motion.';
{
  const params = { p_query: 'Physics Newton second law of motion', p_book_id: null, p_limit: 8, p_class_level_id: null };
  let r = await rpc('search_textbook_pages_with_chapters', params);
  if (r.status !== 200) r = await rpc('search_textbook_pages', params);
  const pages = Array.isArray(r.json) ? r.json : [];
  const excerptBlock = build.formatTextbookContext(pages);
  const prompt =
    STUDY_HEADER + build.aiPrefsPrompt() + excerptBlock + BEHAVIOR_BLOCK;
  console.log(`  pages used: ${pages.length} · excerpt block: ${excerptBlock.length} chars · full system prompt: ${prompt.length} chars`);
  console.log(`  first excerpt header: ${(excerptBlock.match(/\[BOOK:[^\]]*\]/) || ['(none)'])[0]}`);

  const grounded = await ask(
    [{ role: 'system', content: prompt }, { role: 'user', content: REAL_QUESTION }],
    'D1 real prompt, references ON (full reply below)'
  );
  const titles = pages.map(p => p.book_title).filter(Boolean);
  const firstTitle = titles[0] || '';
  const citesBook = firstTitle && grounded.toLowerCase().includes(firstTitle.toLowerCase());
  const citesPage = /\b(?:p\.|page)\s*\d{1,3}\b/i.test(grounded);
  console.log(`    cited a retrieved book title (${firstTitle || 'n/a'}): ${citesBook}`);
  console.log(`    cited any page number: ${citesPage}`);
  // Book-share proxy: how much of the answer's vocabulary actually comes from
  // the excerpts. This is the number the "70% book / 30% general" rule moves.
  const bookShare = (answer, excerpt) => {
    const words = s => new Set(String(s).toLowerCase().match(/[a-z]{5,}/g) || []);
    const A = words(answer), B = words(excerpt);
    if (!A.size) return 0;
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    return hit / A.size;
  };
  console.log(`    BOOK-SHARE proxy (answer words found in the excerpts): ${(bookShare(grounded, excerptBlock) * 100).toFixed(0)}%`);
  console.log(`    citations: book title ${citesBook} · page number ${citesPage}`);

  // Control: identical prompt with the excerpts stripped. If Astra's answer
  // barely changes, the book text is not driving it.
  const control = await ask(
    [{ role: 'system', content: STUDY_HEADER + build.aiPrefsPrompt() + BEHAVIOR_BLOCK },
     { role: 'user', content: REAL_QUESTION }],
    'D2 control, excerpts removed'
  );
  const overlap = (a, b) => {
    const words = s => new Set(String(s).toLowerCase().match(/[a-z]{5,}/g) || []);
    const A = words(a), B = words(b);
    let hit = 0;
    for (const w of A) if (B.has(w)) hit++;
    return A.size ? hit / A.size : 0;
  };
  console.log(`    with/without-excerpt answers share ${(overlap(grounded, control) * 100).toFixed(0)}% of words`);
}