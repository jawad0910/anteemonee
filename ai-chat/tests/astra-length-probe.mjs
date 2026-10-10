/**
 * Why do long Astra replies stop mid-way?
 *
 * Test A: ask for far more than 4096 tokens WITH max_tokens: 50. Tells us
 *         whether the tunnel reports finish_reason at all, and whether it sends
 *         [DONE] after hitting the cap (i.e. whether truncation is detectable).
 * Test B: same request with max_tokens OMITTED. Tells us the effective cap and
 *         how long a long generation takes end to end.
 *
 * Run:  node ai-chat/tests/astra-length-probe.mjs
 */
const URL_ = 'https://rmwit9z.abc-tunnel.us/v1/chat/completions';
const KEY = 'sk-1af196978a75d6af-d5608e-c0e8ab59';
const MODEL = 'gpt-6-astra';

const PROMPT = 'Output lines numbered 1 to 500. Each line must read exactly: "<n>: pookie pookie pookie pookie". Start at 1, do not stop early, do not add any other text.';

async function run(label, maxTokens) {
  const body = { model: MODEL, stream: true, messages: [{ role: 'user', content: PROMPT }] };
  if (maxTokens !== null) body.max_tokens = maxTokens;

  const t0 = Date.now();
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`\n${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chars = 0;
  let firstTokenAt = null;
  let frames = 0;
  const finishReasons = [];
  let sawDone = false;
  let topLine = 0;

  const note = (text) => {
    chars += text.length;
    const m = text.match(/(\d+):\s*pookie/g);
    if (m) { const n = parseInt(m[m.length - 1], 10); if (n > topLine) topLine = n; }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const payload = t.slice(6);
      if (payload === '[DONE]') { sawDone = true; continue; }
      try {
        const json = JSON.parse(payload);
        frames++;
        const fr = json.choices?.[0]?.finish_reason;
        if (fr) finishReasons.push(fr);
        const c = json.choices?.[0]?.delta?.content;
        if (c) { if (!firstTokenAt) firstTokenAt = Date.now() - t0; note(c); }
      } catch (_) {}
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${label}`);
  console.log(`  requested max_tokens: ${maxTokens === null ? '(omitted)' : maxTokens}`);
  console.log(`  HTTP ${res.status} · ${secs}s total · first token ${firstTokenAt ? (firstTokenAt / 1000).toFixed(1) + 's' : 'never'}`);
  console.log(`  content frames: ${frames} · chars: ${chars} · highest line: ${topLine}/500`);
  console.log(`  finish_reason frames: ${JSON.stringify(finishReasons)}`);
  console.log(`  saw [DONE]: ${sawDone}`);
  return { chars, topLine, finishReasons, sawDone, secs };
}

console.log('A) truncation detection:');
await run('  Test A — max_tokens 50', 50);

console.log('\nB) no cap (this one can take minutes):');
await run('  Test B — no max_tokens', null);