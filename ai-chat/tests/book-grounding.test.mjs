/**
 * The ingested textbook has to actually reach the model, and the prompt has to
 * make the model teach from it.
 *
 * Astra is a large general model: handed one thin snippet it blends towards
 * general knowledge, so answers stopped reading like they came from the Punjab
 * board textbook. This test pulls the real formatTextbookContext() and
 * aiPrefsPrompt() straight out of ai-chatbot.js and asserts the book-grounding
 * contract:
 *
 *   - up to 5 pages, 1800 characters each, and a duplicated page is not counted
 *     as a second source
 *   - the 70% book / 30% general ratio is spelled out for the model
 *   - book and page are named in the body when references are on, and are not
 *     named at all when the student has references switched off
 *   - the [BOOK: ...] header the models are told to cite from is unchanged
 *
 * Run it with:
 *   node ai-chat/tests/book-grounding.test.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../code/js/ai-chatbot.js', import.meta.url), 'utf8');

/** Pull a top-level `function name(...) { ... }` out of the chatbot source. */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('book-grounding: function not found: ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('book-grounding: unbalanced braces in ' + name);
}

const constStart = src.indexOf('var TEXTBOOK_MAX_PAGES');
if (constStart === -1) throw new Error('book-grounding: TEXTBOOK_* knobs not found in ai-chatbot.js');
const fnStart = src.indexOf('function formatTextbookContext(', constStart);
if (fnStart === -1) throw new Error('book-grounding: formatTextbookContext() not found');

const factory = new Function(
  'aiPrefs',
  src.slice(constStart, fnStart) + '\n' +
    extractFunction(src, 'formatTextbookContext') + '\n' +
    extractFunction(src, 'aiPrefsPrompt') + '\n' +
    'return { formatTextbookContext: formatTextbookContext, aiPrefsPrompt: aiPrefsPrompt };'
);

const build = overrides => factory(Object.assign({
  responseStyle: 'balanced',
  explanationLevel: 'standard',
  language: 'english',
  studySuggestions: false,
  emojis: false,
  personalization: '',
  references: true,
}, overrides || {}));

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}

function page(i, extra) {
  return Object.assign({
    book_id: 1,
    book_title: 'Physics Class 11',
    page_number: 30 + i,
    printed_page_number: 27 + i,
    chapter_number: 2,
    chapter_name: 'Force and Motion',
    topic_name: 'Momentum',
    full_text: 'x'.repeat(2600),
  }, extra || {});
}

const countBooks = text => (text.match(/\[BOOK:/g) || []).length;
const longestRunOfX = text => Math.max.apply(null, text.split(/[^x]+/).map(s => s.length));

// ── 1. How much book text reaches the model ──────────────────────────
console.log('\n1 - the book text handed to the model');
{
  const on = build({ references: true });
  const pages = [page(0), page(1), page(2), page(3), page(4), page(5)];
  const ctx = on.formatTextbookContext(pages);

  check('up to 5 excerpts are sent', countBooks(ctx) === 5, 'got ' + countBooks(ctx));
  check('each excerpt is capped at 1800 characters',
    longestRunOfX(ctx) === 1800, 'longest run ' + longestRunOfX(ctx));
  check('a later page beyond the cap is dropped',
    !ctx.includes('PRINTED PAGE: 32'), 'page 33 leaked in');
  check('the excerpt block is a real block, not one line', ctx.length > 8000, String(ctx.length));
}

// ── 2. One page is one source ───────────────────────────────────────
console.log('\n2 - a repeated page is not counted twice');
{
  const on = build({ references: true });
  const same = page(0);
  const ctx = on.formatTextbookContext([same, Object.assign({}, same), same, page(1)]);
  check('duplicate book+page collapsed to a single excerpt',
    countBooks(ctx) === 2, 'got ' + countBooks(ctx));
}

// ── 3. The ratio the model is told to keep ──────────────────────────
console.log('\n3 - 70% book / 30% general is spelled out');
{
  const on = build({ references: true });
  const off = build({ references: false });
  const withBook = on.formatTextbookContext([page(0)]);
  const withoutCites = off.formatTextbookContext([page(0)]);

  check('references ON prompt states the 70% share',
    withBook.includes('70% FROM THE BOOK'), 'ratio line missing');
  check('references ON prompt states the 30% share',
    withBook.includes('30% OF YOUR OWN'), 'complement share missing');
  check('references OFF prompt keeps the same 70/30 ratio',
    withoutCites.includes('70% FROM THE BOOK') && withoutCites.includes('30% OF YOUR OWN'));
  check('a book fact beats a general-knowledge fact when they disagree',
    /book wins/i.test(withBook));
  check('the model is told what to do when the book does not cover it',
    /DO NOT COVER IT/.test(withBook));
}

// ── 4. Page citations follow the references setting ─────────────────
console.log('\n4 - page citations follow the student references setting');
{
  const on = build({ references: true });
  const off = build({ references: false });
  const withBook = on.formatTextbookContext([page(0)]);
  const withoutCites = off.formatTextbookContext([page(0)]);

  check('references ON requires the book and printed page in the body',
    /Name the book and the printed page/.test(withBook));
  check('references ON closes with a References section',
    /REFERENCES ON/.test(withBook) && /printed p\. \[printed page\]/.test(withBook));
  check('references OFF forbids naming books or pages in the body',
    /Do NOT name the book or any page number/.test(withoutCites));
  check('references OFF asks for no References section',
    /REFERENCES OFF/.test(withoutCites) && !/printed p\. \[printed page\]/.test(withoutCites));
}

// ── 5. The citation header the models read is stable ────────────────
console.log('\n5 - [BOOK: ...] header format');
{
  const on = build({ references: true });
  const ctx = on.formatTextbookContext([
    page(0),
    page(1, { printed_page_number: null, page_number: 7, book_title: 'Biology Class 11', chapter_number: null, chapter_name: null, topic_name: null }),
    page(2, { printed_page_number: 12, page_number: null, book_title: 'Chemistry Class 11', chapter_number: null, chapter_name: null, topic_name: null }),
  ]);

  check('book, chapter and both page numbers are in the header',
    ctx.includes('[BOOK: "Physics Class 11", Chapter 2: Force and Motion, Topic: Momentum, PRINTED PAGE: 27, PDF PAGE: 30]'),
    (ctx.match(/\[BOOK:[^\]]*\]/) || [''])[0]);
  check('a PDF-only page is labelled PDF PAGE',
    ctx.includes('PDF PAGE: 7]') && !ctx.includes('PAGE: 7, '), 'PDF-only header wrong');
  check('a printed-only page is labelled PAGE',
    ctx.includes('PAGE: 12]'), 'printed-only header wrong');
}

// ── 6. No book text, no book block ──────────────────────────────────
console.log('\n6 - an empty result adds nothing to the prompt');
{
  const on = build({ references: true });
  check('empty array returns an empty string', on.formatTextbookContext([]) === '');
  check('null returns an empty string', on.formatTextbookContext(null) === '');
  check('rows with no book text at all still produce nothing to cite',
    on.formatTextbookContext([{ book_title: 'Physics Class 11', printed_page_number: 12, page_number: 12 }]).includes('[BOOK:'));
}

// ── 7. The same rule is in the study system prompt ──────────────────
console.log('\n7 - the study system prompt agrees with the excerpt block');
{
  check('the academic BEHAVIOR rule states the 70/30 split',
    /teach from the textbook excerpts provided\. Roughly 70% of the answer/.test(src));
  check('the old "enhance with your own knowledge" wording is gone',
    !/Add your own knowledge to enhance/.test(src));
  check('the old 3-page / 1500-char cap is gone',
    !/pages\.slice\(0, 3\)/.test(src) && !/slice\(0, 1500\)/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');

// Eyeball the real prompt text: node ai-chat/tests/book-grounding.test.mjs --print
if (process.argv.includes('--print')) {
  console.log('\n--- textbook excerpt block (references ON) ---');
  console.log(build({ references: true }).formatTextbookContext([page(0), page(1, { full_text: 'y'.repeat(90) })]));
  console.log('\n--- study rule block ---');
  console.log(build({ references: true }).aiPrefsPrompt());
}

process.exit(fail ? 1 : 0);