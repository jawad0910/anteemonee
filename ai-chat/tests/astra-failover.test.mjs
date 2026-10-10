/**
 * Live regression test for the GPT-6 Astra priority route.
 *
 * Run it with:
 *   node ai-chat/tests/astra-failover.test.mjs
 *
 * Scenario 1 talks to the real Astra tunnel (needs network). Scenarios 2-11
 * swap the tunnel URL for a dead port or a throwaway local server, so they
 * assert the fallback contract without touching any real provider. Scenarios
 * 9-11 cover the no-output-cap and stall-timeout behaviour: Astra must never
 * be asked for a fixed token budget, and a connection that dies mid-reply must
 * continue where it stopped rather than restarting the whole answer.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';

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

/**
 * Same as collect(), but keeps whatever was streamed before a failure and
 * hands back the error — exactly how the chatbot's streaming loop behaves.
 */
async function drainPartial(svc, messages) {
  const result = { text: '', error: null };
  try {
    for await (const chunk of svc.streamChat(messages)) result.text += chunk;
  } catch (e) {
    result.error = e;
  }
  return result;
}

function fakeAstraServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    url: 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions',
  })));
}

// ── 1. Live Astra is the priority engine ─────────────────────────────
console.log('\nScenario 1 - live Astra is the priority engine');
{
  const svc = new AiApiService();
  let edgeCalls = 0;
  svc._streamFromEdge = async function* () { edgeCalls++; yield 'EDGE_FALLBACK_TEXT'; };
  const t0 = Date.now();
  const text = await collect(svc, [{
    role: 'user',
    content: 'Reply with exactly this token and nothing else: PRIORITY_OK',
  }]);
  console.log('    (' + ((Date.now() - t0) / 1000).toFixed(1) + 's, ' + text.length +
    ' chars) got: ' + JSON.stringify(text.slice(0, 90)));
  check('answer came back non-empty', text.trim().length > 0);
  check('edge chain never used', edgeCalls === 0, 'edgeCalls=' + edgeCalls);
  check('lastServed.engine === astra', !!svc.lastServed && svc.lastServed.engine === 'astra', JSON.stringify(svc.lastServed));
  check('tunnel reported the gpt-6-astra model id', !!svc.lastServed && /astra/i.test(String(svc.lastServed.model)), JSON.stringify(svc.lastServed));
  check('no Astra failures recorded', svc._astraFails === 0, String(svc._astraFails));
  check('no cooldown', svc._astraCooldownUntil === 0);
  check('currentProvider names Astra', svc.currentProvider.name === 'GPT-6 Astra', svc.currentProvider.name);
}

// ── 2. Astra unreachable -> automatic fallback ───────────────────────
console.log('\nScenario 2 - Astra unreachable -> automatic fallback');
{
  const svc = new AiApiService();
  svc.astraUrl = 'http://127.0.0.1:9/v1/chat/completions';
  let edgeCalls = 0;
  svc._streamFromEdge = async function* () { edgeCalls++; yield 'FALLBACK_TEXT_OK'; };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('user still got an answer', text.includes('FALLBACK_TEXT_OK'), JSON.stringify(text));
  check('edge chain used exactly once', edgeCalls === 1, 'edgeCalls=' + edgeCalls);
  check('lastServed.engine === edge', !!svc.lastServed && svc.lastServed.engine === 'edge', JSON.stringify(svc.lastServed));
  check('one Astra failure counted', svc._astraFails === 1, String(svc._astraFails));
  check('cooldown not armed after a single failure', svc._astraCooldownUntil === 0);
}

// ── 3. Two failures arm the cooldown; Astra is then skipped ──────────
console.log('\nScenario 3 - cooldown after two consecutive failures');
{
  const svc = new AiApiService();
  svc.astraUrl = 'http://127.0.0.1:9/v1/chat/completions';
  svc._streamFromEdge = async function* () { yield 'FB'; };
  const realAstra = svc._streamAstra.bind(svc);
  let astraCalls = 0;
  svc._streamAstra = async function* (m) { astraCalls++; yield* realAstra(m); };
  await collect(svc, [{ role: 'user', content: 'a' }]);
  await collect(svc, [{ role: 'user', content: 'b' }]);
  check('cooldown armed after 2 failures', svc._astraCooldownUntil > Date.now(), String(svc._astraCooldownUntil));
  await collect(svc, [{ role: 'user', content: 'c' }]);
  check('Astra skipped while cooling down', astraCalls === 2, 'astraCalls=' + astraCalls);
}

// ── 4. Stop tap during Astra must not trigger a fallback ─────────────
console.log('\nScenario 4 - user taps Stop during Astra');
{
  const svc = new AiApiService();
  let edgeCalls = 0;
  svc._streamFromEdge = async function* () { edgeCalls++; yield 'EDGE'; };
  svc._streamAstra = async function* () {
    svc.abort();
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  let err = null;
  try { await collect(svc, [{ role: 'user', content: 'hi' }]); } catch (e) { err = e; }
  check('AbortError propagates to the caller', !!err && err.name === 'AbortError', err && err.name);
  check('no fallback after Stop', edgeCalls === 0, 'edgeCalls=' + edgeCalls);
  check('Stop is not counted as an Astra outage', svc._astraFails === 0, String(svc._astraFails));
}

// ── 5. Empty Astra reply (no usable content) -> fallback
console.log('\nScenario 5 - Astra answers with empty content -> fallback');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{"role":"assistant","content":""}}]}\n\n');
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'REAL_ANSWER_FROM_FALLBACK'; };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('empty Astra reply falls back', text.includes('REAL_ANSWER_FROM_FALLBACK'), JSON.stringify(text));
  check('empty reply counted as an Astra failure', svc._astraFails === 1, String(svc._astraFails));
  check('the badge would say fallback', !!svc.lastServed && svc.lastServed.engine === 'edge', JSON.stringify(svc.lastServed));
  server.close();
}

// ── 6. Astra HTTP 500 -> fallback ────────────────────────────────────
console.log('\nScenario 6 - Astra replies HTTP 500 -> fallback');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream exploded' } }));
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'FALLBACK_AFTER_500'; };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('500 on Astra falls back', text.includes('FALLBACK_AFTER_500'), JSON.stringify(text));
  check('HTTP error counted as an Astra failure', svc._astraFails === 1, String(svc._astraFails));
  server.close();
}

// ── 7. Astra stream cut mid-answer -> IncompleteStreamError surfaces ──
console.log('\nScenario 7 - Astra stream cut mid-answer keeps the same contract');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{"content":"Half an ans"}}]}\n\n');
    res.end();
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'EDGE'; };
  const drained = await drainPartial(svc, [{ role: 'user', content: 'hi' }]);
  const text = drained.text;
  const err = drained.error;
  check('partial text was streamed before the cut', text.includes('Half an ans'), JSON.stringify(text));
  check('IncompleteStreamError surfaces so the chatbot can continue', !!err && err.name === 'IncompleteStreamError', err && err.name);
  check('cut counted as an Astra failure', svc._astraFails === 1, String(svc._astraFails));
  server.close();
}

// ── 8. Non-stream JSON reply is handled too ──────────────────────────
console.log('\nScenario 8 - tunnel ignores stream:true and answers with plain JSON');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: 'gpt-6-astra',
      choices: [{ message: { role: 'assistant', content: 'NON_STREAM_OK' } }],
    }));
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'EDGE'; };
  const text = await collect(svc, [{ role: 'user', content: 'hi' }]);
  check('plain JSON reply is used', text.includes('NON_STREAM_OK'), JSON.stringify(text));
  check('still attributed to Astra', !!svc.lastServed && svc.lastServed.engine === 'astra', JSON.stringify(svc.lastServed));
  server.close();
}

// ── 9. Astra is never given an output cap ────────────────────────────
console.log('\nScenario 9 - Astra is asked for an uncapped answer');
{
  let seenBody = null;
  const { server, url } = await fakeAstraServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try { seenBody = JSON.parse(raw); } catch (_) { seenBody = { parseError: raw.slice(0, 120) }; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (let i = 0; i < 400; i++) {
        res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{"content":"chunk' + i + ' "}}]}\n\n');
      }
      res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'EDGE'; };
  const text = await collect(svc, [{ role: 'user', content: 'write a giant html file' }]);
  check('no max_tokens is sent, so Astra is uncapped',
    !!seenBody && !('max_tokens' in seenBody), JSON.stringify(seenBody));
  check('streaming is still requested',
    !!seenBody && seenBody.stream === true, JSON.stringify(seenBody));
  check('a long answer streams through in full',
    text.includes('chunk0 ') && text.includes('chunk399 '), 'len=' + text.length);
  server.close();
}

// ── 10. Connection dies mid-reply -> continue, do not restart ────────
console.log('\nScenario 10 - Astra connection dies mid-reply');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{"content":"<html>half"}}]}\n\n');
    setTimeout(() => { try { res.destroy(); } catch (_) {} }, 40);
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  let edgeCalls = 0;
  svc._streamFromEdge = async function* () { edgeCalls++; yield 'EDGE_RESTART'; };
  const drained = await drainPartial(svc, [{ role: 'user', content: 'hi' }]);
  check('text that already arrived is kept',
    drained.text.includes('<html>half'), JSON.stringify(drained.text));
  check('the partial reply is handed to the continuation path',
    !!drained.error && drained.error.name === 'IncompleteStreamError', drained.error && drained.error.name);
  check('the fallback chain did not restart the whole answer',
    edgeCalls === 0 && !drained.text.includes('EDGE_RESTART'), 'edgeCalls=' + edgeCalls);
  server.close();
}

// ── 11. A server-side cap is still reported so the app can continue ──
console.log('\nScenario 11 - a cap imposed by the server is still reported');
{
  const { server, url } = await fakeAstraServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{"content":"cut sho"}}]}\n\n');
    res.write('data: {"model":"gpt-6-astra","choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const svc = new AiApiService();
  svc.astraUrl = url;
  svc._streamFromEdge = async function* () { yield 'EDGE'; };
  const text = await collect(svc, [{ role: 'user', content: 'write a long file' }]);
  check('a capped reply still streams', text.includes('cut sho'), JSON.stringify(text));
  check('finish_reason "length" is remembered so the app auto-continues',
    svc._lastFinishReason === 'length', String(svc._lastFinishReason));
  server.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);