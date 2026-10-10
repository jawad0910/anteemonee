/**
 * Does the deployed `ai-chat` Edge Function inject book content of its own?
 *
 * Astra is called straight from the browser and only ever sees the messages the
 * client builds. The Groq → Qwen → Mistral chain goes through the Edge Function
 * instead, so if the SERVER adds textbook pages to the prompt (the way
 * ai-examiner / ai-test-builder already do), then every reply used to look
 * book-grounded while Astra now looks general.
 *
 * The probe sends a system message that forbids using its own textbook memory
 * and asks the model to report only what it was actually given. So:
 *   NO_BOOK_CONTEXT  -> grounding is entirely client-side, Astra is not missing
 *                       anything (the excerpt block is the whole story).
 *   HAS_BOOK_CONTEXT -> the server injects pages the browser never sent, and
 *                       Astra must be given an equivalent block itself.
 *
 * Run:  node ai-chat/tests/edge-book-context-probe.mjs
 */
const EDGE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/ai-chat';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';

const messages = [
  {
    role: 'system',
    content:
      'Do not use your own knowledge of textbooks. If the content provided to you anywhere in this request ' +
      'includes any TEXTBOOK EXCERPTS, book text, book title or page numbers, reply with HAS_BOOK_CONTEXT ' +
      'and then list the book title and page. If no textbook content was provided anywhere in this request, ' +
      'reply with exactly NO_BOOK_CONTEXT and nothing else.',
  },
  { role: 'user', content: 'What does the ingested Physics textbook say about momentum?' },
];

// Mirror of AiApiService._streamFromEdge's request shape.
const body = { messages, providerIndex: 0, requestId: 'probe-' + Date.now() };

const t0 = Date.now();
const res = await fetch(EDGE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON_KEY },
  body: JSON.stringify(body),
});
console.log(`HTTP ${res.status} · ${res.headers.get('content-type')} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (!res.ok) {
  console.log('non-OK body:', (await res.text()).slice(0, 400));
  process.exit(0);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let out = '';
const seen = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data: ')) continue;
    const data = t.slice(6);
    if (data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      if (json.model && !seen.includes(json.model)) seen.push(json.model);
      const c = json.choices?.[0]?.delta?.content;
      if (c) out += c;
    } catch (_) {}
  }
}

console.log('models seen:', seen.join(', ') || '(none)');
console.log('reply:', out.replace(/\s+/g, ' ').slice(0, 600));
console.log(
  '\nverdict: ' +
    (out.includes('HAS_BOOK_CONTEXT')
      ? 'EDGE INJECTS BOOK CONTENT — Astra bypasses it'
      : out.includes('NO_BOOK_CONTEXT')
        ? 'no server-side book injection (grounding is client-side only)'
        : 'inconclusive — model did not follow the reporting rule')
);