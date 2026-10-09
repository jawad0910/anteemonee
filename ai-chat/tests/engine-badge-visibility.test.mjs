/**
 * The "GPT-6 Astra / Groq fallback" chip is a rollout verification aid, so it
 * must only be shown to the allowlisted accounts. This test pulls the real
 * canSeeEngineBadge() helper straight out of ai-chatbot.js (it is written
 * against a global `currentUser`, so it runs standalone) and checks who gets
 * to see the text.
 *
 * Run it with:
 *   node ai-chat/tests/engine-badge-visibility.test.mjs
 */
import { readFileSync } from 'node:fs';

const CHATBOT = new URL('../code/js/ai-chatbot.js', import.meta.url).pathname;
const src = readFileSync(CHATBOT, 'utf8');

const start = src.indexOf('const ENGINE_BADGE_EMAILS');
const jsdocEnd = src.indexOf('Name of the engine that is actually serving', start);
if (start === -1 || jsdocEnd === -1) throw new Error('canSeeEngineBadge() not found in ai-chatbot.js');
const chunk = src.slice(start, src.lastIndexOf('/**', jsdocEnd));
(0, eval)(chunk);

if (typeof globalThis.canSeeEngineBadge !== 'function') {
  throw new Error('extracted helper did not evaluate');
}

let pass = 0;
let fail = 0;
function check(name, email, expected) {
  globalThis.currentUser = email;
  const got = globalThis.canSeeEngineBadge();
  if (got === expected) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '   -> expected ' + expected + ', got ' + got); }
}

console.log('\nEngine badge visibility');
check('the allowlisted address sees the chip', { email: 'jawadshafaqat0910@gmail.com' }, true);
check('case does not matter', { email: 'JAWADSHAFAQAT0910@GMAIL.COM' }, true);
check('surrounding whitespace does not matter', { email: '  JawadShafaqat0910@Gmail.com  ' }, true);
check('a different gmail address is hidden', { email: 'someoneelse@gmail.com' }, false);
check('a blank email is hidden', { email: '' }, false);
check('a user with no email is hidden', {}, false);
check('email only in user_metadata still matches', { user_metadata: { email: 'jawadshafaqat0910@gmail.com' } }, true);
check('another user_metadata email is hidden', { user_metadata: { email: 'friend@gmail.com' } }, false);
check('anonymous / logged out is hidden', null, false);

// The two places that show engine text must both go through the helper.
const badgeGated = /function attachEngineBadge\(body, idx\) \{\s*\n\s*try \{\s*\n\s*if \(!canSeeEngineBadge\(\)\) return;/.test(src);
const statusGated = /canSeeEngineBadge\(\) \? getServingEngineLabel\(\) : null/.test(src);
if (badgeGated) { pass++; console.log('  PASS  the chip below a reply is gated'); }
else { fail++; console.log('  FAIL  the chip below a reply is gated'); }
if (statusGated) { pass++; console.log('  PASS  the live streaming status is gated'); }
else { fail++; console.log('  FAIL  the live streaming status is gated'); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);