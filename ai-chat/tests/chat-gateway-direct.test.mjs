/**
 * Contract test for the BazaarLink-direct chat route.
 *
 * The browser talks ONLY to the ai-chat-gateway edge function, which holds
 * the provider key server-side and streams the reply through. There is no
 * fallback chain: provider failures surface to the student.
 *
 * Run it with:
 *   node ai-chat/tests/chat-gateway-direct.test.mjs
 *
 * Everything upstream is mocked (global fetch); no network, no credentials.
 */
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;

const SERVICE = new URL('../code/js/ai-api-service.js', import.meta.url).pathname;
(0, eval)(readFileSync(SERVICE, 'utf8'));
const AiApiService = globalThis.AiApiService;
if (typeof AiApiService !== 'function') throw new Error('AiApiService did not load');

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}

async function collect(svc, messages) {
  let out = '';
  for await (const chunk of svc.streamChat(messages)) out += chunk;
  return out;
}

const enc = new TextEncoder();
function sseResponse(frames, headers = {}) {
  const parts = frames.map(f => enc.encode(f));
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (headers[String(k).toLowerCase()] ?? null) },
    body: {
      getReader: () => ({
        read: async () => (i < parts.length
          ? { done: false, value: parts[i++] }
          : { done: true, value: undefined }),
        releaseLock() {},
      }),
    },
  };
}
function errResponse(status, bodyObj) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(bodyObj),
  };
}
const CHUNK = (content, model) =>
  'data: ' + JSON.stringify({ model, choices: [{ delta: { content }, finish_reason: null }] }) + '\n\n';

// ── 1. Happy path: content streams, model + search flag captured ──────────
console.log('\nScenario 1 - gateway streams a reply through');
{
  const svc = new AiApiService();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    return sseResponse(
      [CHUNK('hello ', 'deepseek/deepseek-v4-flash-0731free'), CHUNK('world', 'deepseek/deepseek-v4-flash-0731free')],
      { 'x-web-searched': '1' },
    );
  };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('content streamed through', text === 'hello world', JSON.stringify(text));
  check('went to the gateway, not a provider', String(seen[0].url).includes('/functions/v1/ai-chat-gateway'), seen[0].url);
  check('real model id captured', svc.lastServed && svc.lastServed.model === 'deepseek/deepseek-v4-flash-0731free', JSON.stringify(svc.lastServed));
  check('unknown family falls back to Groq provider', svc.lastServed && svc.lastServed.provider === 'Groq', JSON.stringify(svc.lastServed));
  check('engine tag is direct', svc.lastServed && svc.lastServed.engine === 'direct', JSON.stringify(svc.lastServed));
  check('search header captured', svc.lastSearched === true);
  check('no failures recorded', svc._astraFails === 0);
  check('no cooldown', svc._astraCooldownUntil === 0);
}

// ── 1b. X-Model header supplies the id when chunks omit it ───────────────
console.log('\nScenario 1b - gateway model header as label source');
{
  const svc = new AiApiService();
  globalThis.fetch = async () => sseResponse(
    ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n'],
    { 'x-model': 'openai/gpt-oss-20b' },
  );
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('content streamed', text === 'hi', JSON.stringify(text));
  check('label falls back to header model', svc.lastServed && svc.lastServed.model === 'openai/gpt-oss-20b', JSON.stringify(svc.lastServed));
}

// ── 2. 401 with no refresh available -> session_expired ───────────────────
console.log('\nScenario 2 - 401 surfaces as session_expired when refresh is impossible');
{
  const svc = new AiApiService();
  delete globalThis.db;
  globalThis.fetch = async () => errResponse(401, { error: 'Unauthorized' });
  let err = null;
  try { await collect(svc, [{ role: 'user', content: 'hi' }]); }
  catch (e) { err = e; }
  check('session_expired code', !!err && err.code === 'session_expired', String(err && err.code));
}

// ── 3. 401 then refresh replays once with the fresh token ─────────────────
console.log('\nScenario 3 - 401 replays once after a real refresh');
{
  const svc = new AiApiService();
  svc._accessToken = 'expired-token';
  const auths = [];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    auths.push(init.headers.Authorization);
    if (calls === 1) return errResponse(401, { error: 'Unauthorized' });
    return sseResponse([CHUNK('recovered', 'auto:free')], {});
  };
  globalThis.db = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({ data: { session: { access_token: 'fresh-token', expires_at: Date.now() / 1000 + 3600 } }, error: null }),
    },
  };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('replay succeeded', text === 'recovered', JSON.stringify(text));
  check('replay carried the fresh token', auths[1] === 'Bearer fresh-token', JSON.stringify(auths));
  delete globalThis.db;
}

// ── 4. Two failures arm the cooldown ──────────────────────────────────────
console.log('\nScenario 4 - cooldown after two consecutive failures');
{
  const svc = new AiApiService();
  delete globalThis.db;
  globalThis.fetch = async () => { throw new Error('socket hangup'); };
  for (let i = 0; i < 2; i++) {
    try { await collect(svc, [{ role: 'user', content: 'x' }]); } catch (_) {}
  }
  check('cooldown armed', svc._astraCooldownUntil > Date.now());
  let err = null;
  try { await collect(svc, [{ role: 'user', content: 'y' }]); }
  catch (e) { err = e; }
  check('third call short-circuits with cooldown message',
    !!err && /cooling down/.test(err.message), String(err && err.message));
}

// ── 5. Upstream errors are labeled Chat, never a provider name ────────────
console.log('\nScenario 5 - error text names the route honestly');
{
  const svc = new AiApiService();
  delete globalThis.db;
  globalThis.fetch = async () => errResponse(502, { error: 'bad gateway' });
  let err = null;
  try { await collect(svc, [{ role: 'user', content: 'hi' }]); }
  catch (e) { err = e; }
  check('message starts with Chat service failed',
    !!err && String(err.message).startsWith('Chat service failed: Chat 502'), String(err && err.message));
  check('no Flagship/Astra/Muse Spark in message',
    !!err && !/flagship|astra|muse spark/i.test(err.message), String(err && err.message));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
