/**
 * The "which model answered this" label sits in the feedback row, right after
 * the sound button, and is shown to EVERY account (logged in, guest, any
 * email). It must read the real served model id — never a hardcoded name.
 *
 * Run it with:
 *   node ai-chat/tests/engine-badge-visibility.test.mjs
 */
import { readFileSync } from 'node:fs';

const CHATBOT = new URL('../code/js/ai-chatbot.js', import.meta.url).pathname;
const src = readFileSync(CHATBOT, 'utf8');
const css = readFileSync(new URL('../code/css/messages.css', import.meta.url).pathname, 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}

console.log('\nModel label visibility (every account)');
// No allowlist machinery may remain.
check('no ENGINE_BADGE_EMAILS allowlist', src.indexOf('ENGINE_BADGE_EMAILS') === -1);
check('no canSeeEngineBadge helper', src.indexOf('canSeeEngineBadge') === -1);
// The label builder places .msg-model directly after the sound button.
const badgeFn = src.slice(src.indexOf('function attachEngineBadge(body, idx)'));
check('label inserted after sound button',
  badgeFn.includes("wrap.querySelector('.fb-tts')") &&
  badgeFn.includes("insertAdjacentElement('afterend', label)"));
check('label uses msg-model class', badgeFn.includes("label.className = 'msg-model'"));
check('dot separator before label', css.includes('.msg-model::before') && css.includes("content: '·'"));
// The live streaming status names the engine without any gate.
check('streaming status names engine ungated',
  /var servingEngine = getServingEngineLabel\(\);/.test(src));

// tunnelModelLabel must map real ids to friendly names.
const lblStart = src.indexOf('function tunnelModelLabel(');
const lblEnd = src.indexOf('\n  }', lblStart) + 4;
if (lblStart < 0 || lblEnd < 4) throw new Error('tunnelModelLabel() not found');
(0, eval)(src.slice(lblStart, lblEnd) + '\nglobalThis.__lbl = tunnelModelLabel;');
const lbl = globalThis.__lbl;
check('muse-spark id -> Muse Spark 1.3', lbl('oc/muse-spark-1.3-contributor-free') === 'Muse Spark 1.3');
check('space-bunny id -> Space Bunny', lbl('oc/space-bunny-free') === 'Space Bunny');
check('astra id -> GPT-6 Astra', lbl('gpt-6-astra') === 'GPT-6 Astra');
check('nemotron id -> Nemotron 3 Ultra', lbl('oc/nemotron-3-ultra-free') === 'Nemotron 3 Ultra');
check('nemotron 3.5 id -> Nemotron 3.5 Lightning', lbl('nemotron-3.5-lightning-free') === 'Nemotron 3.5 Lightning');
check('unknown id shows the real model, never "Flagship"', lbl('some-other-model') === 'Some other model');
check('unknown provider-prefixed id is tidied', lbl('groq/llama-3.3-70b') === 'Llama 3.3 70b');
check('empty id falls back to provider', lbl('', 'Groq') === 'Groq');

// Functional: the label renders even logged out / guest (no currentUser).
function makeEl(tag, cls) {
  const el = {
    tag, className: cls || '', children: [], textContent: '', title: '', dataset: {},
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    addEventListener() {},
    querySelector(sel) {
      const m = sel.match(/^\.([\w-]+)$/);
      if (!m) return null;
      const q = [this];
      while (q.length) {
        const n = q.shift();
        if (n !== this && n.className && n.className.split(' ').includes(m[1])) return n;
        q.push(...n.children);
      }
      return null;
    },
    insertAdjacentElement(pos, node) {
      const sibs = this.parent.children;
      sibs.splice(sibs.indexOf(this) + 1, 0, node);
      node.parent = this.parent;
      return node;
    },
  };
  return el;
}
globalThis.document = { createElement(tag) { return makeEl(tag); } };
globalThis.currentUser = null; // logged out
globalThis.messages = [{ role: 'assistant', content: 'hi', engine: { engine: 'astra', provider: 'Flagship', model: 'oc/muse-spark-1.3-contributor-free' } }];
const fnStart = src.indexOf('function attachEngineBadge(body, idx) {');
const fnLines = src.slice(fnStart).split('\n');
let fnEnd = 1;
for (let i = 1; i < fnLines.length; i++) {
  if (fnLines[i] === '  }') { fnEnd = i; break; }
}
(0, eval)(fnLines.slice(0, fnEnd + 1).join('\n') + '\nglobalThis.__attach = attachEngineBadge;');
const body = makeEl('div', 'msg-body');
const wrap = makeEl('div', 'msg-feedback');
['fb-like', 'fb-dislike', 'fb-copy'].forEach(c => wrap.appendChild(makeEl('button', 'fb-btn ' + c)));
wrap.appendChild(makeEl('button', 'fb-btn fb-tts tts-btn'));
body.appendChild(wrap);
globalThis.__attach(body, '0');
const order = wrap.children.map(c => c.className);
const ti = order.findIndex(c => c.includes('fb-tts'));
check('logged-out user still gets label after sound button',
  order[ti + 1] === 'msg-model', order.join(' | '));
check('logged-out label text is Muse Spark 1.3',
  wrap.children[ti + 1] && wrap.children[ti + 1].textContent === 'Muse Spark 1.3');

// --- "Searched the web" chip -----------------------------------------------
globalThis.FB_GLOBE_SVG = '<svg>globe</svg>';
function buildRow() {
  const b = makeEl('div', 'msg-body');
  const w = makeEl('div', 'msg-feedback');
  ['fb-like', 'fb-dislike', 'fb-copy'].forEach(c => w.appendChild(makeEl('button', 'fb-btn ' + c)));
  w.appendChild(makeEl('button', 'fb-btn fb-tts tts-btn'));
  b.appendChild(w);
  return { b, w };
}
globalThis.messages = [{ role: 'assistant', content: 'hi',
  engine: { engine: 'astra', provider: 'Flagship', model: 'oc/nemotron-3-ultra' }, searched: true }];
{
  const { b, w } = buildRow();
  globalThis.__attach(b, '0');
  const o = w.children.map(c => c.className);
  const mi = o.findIndex(c => c === 'msg-model');
  check('web chip follows the model label',
    mi >= 0 && o[mi + 1] === 'msg-model msg-web', o.join(' | '));
  const chip = w.children[mi + 1];
  check('web chip reads Searched the web',
    chip && chip.innerHTML.includes('Searched the web') && chip.innerHTML.includes('globe'),
    chip && chip.innerHTML);
}
globalThis.messages = [{ role: 'assistant', content: 'hi',
  engine: { engine: 'astra', provider: 'Flagship', model: 'oc/nemotron-3-ultra' }, searched: false }];
{
  const { b, w } = buildRow();
  globalThis.__attach(b, '0');
  check('no web chip without a search',
    !w.children.some(c => (c.className || '').includes('msg-web')),
    w.children.map(c => c.className).join(' | '));
}
// Static wiring: gateway exposes + sets the header, service reads it.
const SVC = readFileSync(new URL('../code/js/ai-api-service.js', import.meta.url).pathname, 'utf8');
check('service captures X-Web-Searched', SVC.includes("res.headers.get('X-Web-Searched')"));
const GW = readFileSync('/Users/sharjahlaptops1/Documents/anteemonee/supabase/functions/ai-chat-gateway/index.ts', 'utf8');
check('gateway exposes X-Web-Searched', GW.includes('"Access-Control-Expose-Headers": "X-Served-By, X-Web-Searched"'));
check('gateway sets X-Web-Searched on stream', GW.includes('"X-Web-Searched": searched ? "1" : "0"'));
check('gateway searches searxng via flagship', GW.includes("provider: \"searxng\""));
check('empty search retries once', /if \(!r\.text\) \{[\s\S]{0,400}?searchViaFlagship\(sq\)/.test(GW));
check('ran-but-empty still grounds the reply', GW.includes('no usable results'));
check('ran flag drives the header', /if \(r\.ran\) \{[\s\S]{0,200}?searched = true/.test(GW));

// shouldWebSearch trigger: extract and run the real function.
{
  const sIdx = GW.indexOf('function shouldWebSearch(text: string): boolean {');
  if (sIdx === -1) { check('shouldWebSearch found', false); }
  else {
    const tail = GW.slice(sIdx).split('\n');
    let sEnd = 1;
    for (let i = 1; i < tail.length; i++) {
      if (tail[i] === '  }') { sEnd = i; break; }
    }
    const jsBody = tail.slice(0, sEnd + 1).join('\n').replace(': string', '').replace(': boolean', '');
    (0, eval)(jsBody + '\nglobalThis.__should = shouldWebSearch;');
    const should = globalThis.__should;
    check('"web search it" triggers (web-first order)', should('web search it') === true);
    check('"search the web for X" triggers', should('search the web for date sheet') === true);
    check('"what is the news upto" triggers', should('what is the news upto') === true);
    check('"what is happening" triggers', should("what's happening in Pakistan") === true);
    check('"BISE date sheet 2026" triggers', should('BISE Lahore date sheet 2026') === true);
    check('plain study question does not trigger', should('explain photosynthesis with examples') === false);
    check('empty text does not trigger', should('   ') === false);
  }
}

// cleanSearchQuery: strip the conversational wrapper, keep the searchable core.
{
  const cIdx = GW.indexOf('function cleanSearchQuery(q: string): string {');
  if (cIdx === -1) { check('cleanSearchQuery found', false); }
  else {
    const tail = GW.slice(cIdx).split('\n');
    let cEnd = 1;
    for (let i = 1; i < tail.length; i++) {
      if (tail[i] === '  }') { cEnd = i; break; }
    }
    const jsBody = tail.slice(0, cEnd + 1).join('\n').split(': string').join('');
    (0, eval)(jsBody + '\nglobalThis.__clean = cleanSearchQuery;');
    const clean = globalThis.__clean;
    check('wrapper stripped to the core question',
      clean('i want to know that if oxbridge school and college in rahimyar khan has a website do web search') === 'oxbridge school and college in rahimyar khan has a website',
      clean('i want to know that if oxbridge school and college in rahimyar khan has a website do web search'));
    check('short query survives', clean('BISE date sheet 2026') === 'BISE date sheet 2026');
    check('empty falls back safely', clean('  ') === '');
  }
}

// Client tool line: mirrors the server trigger, shows during streaming,
// always removed on finalize.
{
  const cSrc = readFileSync(new URL('../code/js/ai-chatbot.js', import.meta.url).pathname, 'utf8');
  const wIdx = cSrc.indexOf('function clientWillSearch(text) {');
  if (wIdx === -1) { check('clientWillSearch found', false); }
  else {
    const tail = cSrc.slice(wIdx).split('\n');
    let wEnd = 1;
    for (let i = 1; i < tail.length; i++) {
      if (tail[i] === '  }') { wEnd = i; break; }
    }
    (0, eval)(tail.slice(0, wEnd + 1).join('\n') + '\nglobalThis.__cwill = clientWillSearch;');
    const cwill = globalThis.__cwill;
    check('client mirrors "web search it"', cwill('web search it') === true);
    check('client mirrors plain-question negative', cwill('explain photosynthesis') === false);
    check('client mirrors length guard', cwill('x'.repeat(2001)) === false);
  }
  check('tool line shown at send', /showWebSearchToolLine\(streamDiv, text\)/.test(cSrc));
  check('tool line removed on finalize', (cSrc.match(/hideWebSearchToolLine\(div\)/g) || []).length >= 1);
  check('toolcall CSS present', readFileSync(new URL('../code/css/messages.css', import.meta.url).pathname, 'utf8').includes('.msg-toolcall'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
