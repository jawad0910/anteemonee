/**
 * Does the GPT-6 Astra tunnel accept image input?
 *
 * It sends synthetic PNGs whose answer is known in advance (solid red, solid
 * blue, and red-left/blue-right) and prints what the model says. A model that
 * really sees the pixels must name them; one that ignores the image will
 * either error, refuse, or answer generically.
 *
 * Run it with:
 *   node ai-chat/tests/astra-vision-probe.mjs
 *
 * This is a probe, not a pass/fail gate: read the printed answers.
 */
import zlib from 'node:zlib';

const URL_ = 'https://rmwit9z.abc-tunnel.us/v1/chat/completions';
const KEY = 'sk-1af196978a75d6af-d5608e-c0e8ab59';
const MODEL = 'gpt-6-astra';

// ── Tiny PNG writer (no dependencies) ────────────────────────────────
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** px(x, y) -> [r, g, b] */
function png(w, h, px) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const RED = png(64, 64, () => [255, 0, 0]);
const BLUE = png(64, 64, () => [0, 0, 255]);
const SPLIT = png(64, 64, (x) => (x < 32 ? [255, 0, 0] : [0, 0, 255]));

async function ask(label, question, imageBuffer, maxTokens = 400) {
  const content = [{ type: 'text', text: question }];
  if (imageBuffer) {
    content.push({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,' + imageBuffer.toString('base64') },
    });
  }

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) {
    console.log('\n' + label + '\n  REQUEST FAILED: ' + e.message);
    return null;
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  const bodyText = await res.text();
  if (!res.ok) {
    console.log('\n' + label + '  [' + res.status + ', ' + secs + ']');
    console.log('  ERROR BODY: ' + bodyText.slice(0, 400));
    return null;
  }

  let data = null;
  try { data = JSON.parse(bodyText); } catch (_) {}
  const choice = data && data.choices && data.choices[0];
  const msg = (choice && choice.message) || {};
  const answer = msg.content || '';
  console.log('\n' + label + '  [' + res.status + ', ' + secs + ', model=' + (data && data.model) + ']');
  console.log('  content: ' + JSON.stringify(String(answer).slice(0, 300)));
  if (msg.reasoning_content) {
    console.log('  reasoning: ' + JSON.stringify(String(msg.reasoning_content).slice(0, 200)));
  }
  if (!answer && msg.refusal) console.log('  refusal: ' + JSON.stringify(msg.refusal));
  return String(answer);
}

const COLOR_Q = 'What single colour fills this image? Answer with just the colour word.';

console.log('Probing GPT-6 Astra (' + MODEL + ') for image input.\n' +
  'Ground truth -> image 1: RED, image 2: BLUE, image 3: RED on the left half, BLUE on the right half.');

const a1 = await ask('Image 1 (solid red)', COLOR_Q, RED);
const a2 = await ask('Image 2 (solid blue)', COLOR_Q, BLUE);
const a3 = await ask('Image 3 (split)', 'Which colour is on the left half of this image, and which on the right? One short sentence.', SPLIT);
const a4 = await ask('Control (same question, no image)', COLOR_Q, null);

console.log('\n── Verdict hints ──');
console.log('  image 1 said: ' + JSON.stringify((a1 || '').slice(0, 60)));
console.log('  image 2 said: ' + JSON.stringify((a2 || '').slice(0, 60)));
console.log('  image 3 said: ' + JSON.stringify((a3 || '').slice(0, 120)));
console.log('  control said: ' + JSON.stringify((a4 || '').slice(0, 60)));
console.log('  Vision works only if image 1 says red, image 2 says blue and image 3 names both sides.');