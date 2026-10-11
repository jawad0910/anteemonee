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
const lblStart = src.indexOf('function tunnelModelLabel(model)');
const lblEnd = src.indexOf('\n  }', lblStart) + 4;
(0, eval)(src.slice(lblStart, lblEnd) + '\nglobalThis.__lbl = tunnelModelLabel;');
const lbl = globalThis.__lbl;
check('muse-spark id -> Muse Spark 1.3', lbl('oc/muse-spark-1.3-contributor-free') === 'Muse Spark 1.3');
check('space-bunny id -> Space Bunny', lbl('oc/space-bunny-free') === 'Space Bunny');
check('astra id -> GPT-6 Astra', lbl('gpt-6-astra') === 'GPT-6 Astra');
check('unknown id -> null (caller falls back)', lbl('some-other-model') === null);

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
