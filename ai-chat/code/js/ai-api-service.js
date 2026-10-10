/* ==========================================
   Anteemonee - Triple API Failover Service
   Priority engine: Muse Spark (free, called straight from the browser).
   Everything after that routes through the Supabase Edge Function
   (Groq → Qwen → Mistral). Detects incomplete streams and auto-falls back.
   ========================================== */

class AiApiService {
  constructor() {
    this.supabaseUrl = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
    this.edgeFunctionUrl = `${this.supabaseUrl}/functions/v1/ai-chat`;
    // Every student message now goes through the gateway, which holds the
    // Astra key server-side and enforces the 15/day free quota. The browser
    // no longer talks to Astra or to ai-chat directly, so neither the key
    // nor the cap can be bypassed from devtools.
    this.gatewayUrl = `${this.supabaseUrl}/functions/v1/ai-chat-gateway`;
    this.activeProvider = 0;
    this._currentAbort = null;
    this._accessToken = null;
    this._sessionId = null;
    this.totalProviders = 3;
    this._lastFinishReason = null; // finish_reason of the latest completed attempt ('stop' | 'length' | ...)
    // ── Priority engine: Muse Spark (Flagship Router tunnel) ──
    // Astra is tried first for every request. On ANY failure — network error,
    // HTTP error, hung stream, empty reply — we fall through to the Supabase
    // edge function and its Groq → Qwen → Mistral chain, so the student never
    // sees an outage because of the free tunnel.
    this.astraModel = 'oc/muse-spark-1.3-contributor-free';
    // The Astra API key used to live here in cleartext. Anyone who opened
    // devtools could read it and call the tunnel directly, entirely
    // bypassing the site and its quota. It now lives in the gateway's
    // ASTRA_API_KEY secret and is never sent to the browser.
    this._astraFails = 0;         // consecutive Astra failures
    this._astraCooldownUntil = 0; // skip Astra until this timestamp
    this._abortRequested = false; // user tapped Stop — never fail over after that
    this._lastStreamModel = null; // `model` id seen on the latest streamed chunks
    this.lastServed = null;       // { engine, provider, model } of the reply in flight
  }

  get currentProvider() {
    if (this.lastServed && this.lastServed.engine === 'astra') {
      return { name: 'Muse Spark', model: this.lastServed.model };
    }
    const names = ['Groq', 'Qwen', 'Mistral'];
    return { name: names[this.activeProvider] || 'AI', model: this._lastStreamModel };
  }

  _providerName(index) {
    return ['Groq', 'Qwen', 'Mistral'][index] || 'AI';
  }

  /**
   * Set the user's access token for authenticated Edge Function calls.
   */
  setAccessToken(token) {
    this._accessToken = token;
  }

  /**
   * Set the active AI session ID for this request.
   */
  setSessionId(id) {
    this._sessionId = id;
  }

  /**
   * Exchange the stored token for a fresh one.
   *
   * The chat path reads the access token straight out of localStorage, which
   * never triggers Supabase's automatic refresh. Once that token expires the
   * edge functions reject every call with a 401, so we refresh on demand rather
   * than making the student sign in again.
   */
  async _refreshAccessToken() {
    try {
      if (typeof db !== 'undefined' && db && db.auth && typeof db.auth.getSession === 'function') {
        const { data } = await db.auth.getSession();
        const t = data && data.session && data.session.access_token;
        if (t) {
          this._accessToken = t;
          return t;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * An id for one student message, shared by the Astra attempt and every
   * edge fallback so the gateway charges the daily quota exactly once.
   */
  _newRequestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  }

  /**
   * POST, and on a 401 refresh the session and replay once.
   * Bodies here are plain strings, so the request is safe to rebuild.
   */
  async _postWithAuthRetry(url, init) {
    const res = await fetch(url, init);
    if (res.status !== 401) return res;
    const fresh = await this._refreshAccessToken();
    if (!fresh) return res;
    return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${fresh}` } });
  }

  /**
   * Read attached images and return a written description of each.
   *
   * The chat model (gpt-oss-120b) is text-only, so image bytes sent to it are
   * wasted. A vision model describes the images instead and that text is fed
   * back in as context.
   */
  async describeImages({ images, question = '', subject = '' } = {}) {
    const authHeader = this._accessToken
      ? `Bearer ${this._accessToken}`
      : `Bearer ${this.supabaseKey}`;

    const res = await this._postWithAuthRetry(`${this.supabaseUrl}/functions/v1/ai-vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ images, question, subject }),
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) {
      throw new Error(String((data && data.error) || text || 'Vision request failed').slice(0, 300));
    }
    if (!data || !data.description) throw new Error('Vision returned no description');
    return data;
  }

  /**
   * Generate an image: Qwen (SiliconFlow) and/or Mistral.
   * Server cap: 4/day per user, raised to 400/day when the user has saved
   * their own Mistral API key (Settings → AI Keys).
   * Returns { image, provider, model, used, limit, remaining, resetsAt }.
   */
  async generateImage(prompt) {
    const authHeader = this._accessToken
      ? `Bearer ${this._accessToken}`
      : `Bearer ${this.supabaseKey}`;

    const res = await this._postWithAuthRetry(`${this.supabaseUrl}/functions/v1/ai-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ prompt }),
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) {
      const msg = String((data && data.error) || text || 'Image generation failed').slice(0, 300);
      const code = (data && (data.code || data.reason)) || '';
      const err = new Error(code ? `${msg} [${code}]` : msg);
      err.code = code;
      err.status = res.status;
      err.used = data && data.used;
      err.limit = data && data.limit;
      err.remaining = data && data.remaining;
      err.resetsAt = (data && (data.resetsAt || data.resets_at)) || null;
      err.detail = data && data.detail;
      throw err;
    }
    if (!data || !data.image) throw new Error('Image provider returned no image');
    return data;
  }


  /**
   * Stream chat with auto-failover.
   * If the primary provider's stream cuts off mid-response (no [DONE]),
   * it throws an IncompleteStreamError so the caller can retry with fallback.
   */
  async *streamChat(messages, providerIndex = null, images = null) {
    this._lastFinishReason = null;
    this._lastStreamModel = null;
    this.lastServed = null;
    this._abortRequested = false;

    // One id for this whole message, shared by the Astra attempt and every
    // edge fallback below. The gateway treats it as an idempotency key, so
    // a failover — or a replay after a session refresh — is charged once
    // against the 15/day free quota rather than twice.
    this._currentRequestId = this._newRequestId();

    // ── Priority attempt: Muse Spark. Any failure drops to the chain below. ──
    // Note: Astra has no vision support (verified 2026-10-09 with tests/
    // astra-vision-probe.mjs — it accepts image parts but answers "I can't see
    // the image"). Images must therefore be turned into text by the caller
    // before they reach here, which is what the chatbot already does.
    if (this._astraAvailable()) {
      try {
        yield* this._streamAstra(messages);
        this._noteAstraSuccess();
        return;
      } catch (error) {
        if (this._abortRequested) throw error;
        // A quota refusal is final, not an Astra outage: do not count it as
        // an Astra failure and do not spend every fallback on the same
        // refusal. Surface it to the caller with its reset time attached.
        if (error && error.code === 'FREE_DAILY_LIMIT') throw error;
        // Same for a session that is gone: every fallback needs the same JWT,
        // so retrying the whole chain would only produce the same refusal.
        if (error && error.code === 'session_expired') throw error;
        this._noteAstraFailure(error);
        // Partial text was already streamed to the UI, so the caller's
        // continuation path owns it — same contract as the edge providers.
        if (error instanceof IncompleteStreamError) throw error;
      }
    }

    const startIndex = providerIndex !== null ? providerIndex : this.activeProvider;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const idx = (startIndex + attempt) % this.totalProviders;

      try {
        this.activeProvider = idx;
        yield* this._streamFromEdge(messages, idx, images);
        this.lastServed = {
          engine: 'edge',
          provider: this._providerName(idx),
          model: this._lastStreamModel,
          at: Date.now(),
        };
        console.info('[AI] Served by fallback chain: ' + this.lastServed.provider +
          (this.lastServed.model ? ' (' + this.lastServed.model + ')' : ''));
        return; // success
      } catch (error) {
        if (this._abortRequested) throw error; // user tapped Stop — stop immediately
        console.warn(`[AI] Provider ${idx} failed:`, error.message);
        lastError = error;
        // If incomplete stream, the caller already has partial text.
        // Re-throw so the chatbot can decide whether to retry.
        if (error instanceof IncompleteStreamError) {
          throw error;
        }
      }
    }

    throw new Error(lastError?.message || 'All AI providers are currently unavailable. Please try again.');
  }

  async *_streamFromEdge(messages, providerIndex, images = null) {
    const controller = new AbortController();
    this._currentAbort = controller;
    let timeoutId = null;

    // Use user's JWT if available, fall back to anon key
    const authHeader = this._accessToken
      ? `Bearer ${this._accessToken}`
      : `Bearer ${this.supabaseKey}`;

    // Idempotency key: lets the server treat network retries as one request.
    // Display-only concern client-side; the SERVER decides replay vs. new.
    let requestId = null;
    try {
      requestId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    } catch (_) {
      requestId = 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    }

    const body = { mode: 'edge', messages, providerIndex };
    if (this._sessionId) body.sessionId = this._sessionId;
    if (requestId) body.requestId = this._currentRequestId || requestId;
    if (images && images.length > 0) {
      body.images = images;
      console.log('[Edge] Sending', images.length, 'images, sizes:', images.map(i => i.length));
    } else {
      console.log('[Edge] No images to send');
    }

    const res = await this._postWithAuthRetry(this.gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      let msg = detail;
      let code = '';
      let retryAfter = 0;
      try {
        const parsed = JSON.parse(detail);
        msg = parsed.error || detail;
        code = parsed.code || parsed.reason || '';
        retryAfter = parsed.retry_after_seconds || 0;
      } catch (_) {}
      // A 401 here means the session is gone even after a refresh attempt, so
      // say so instead of leaking the raw status.
      if (res.status === 401 || res.status === 403) {
        const err = new Error('Your session expired. Please sign in again.');
        err.code = 'session_expired';
        err.status = res.status;
        throw err;
      }
      const err = new Error(`Error ${res.status}: ${String(msg).slice(0, 300)}${code ? ' [' + code + ']' : ''}`);
      err.code = code;
      err.retryAfter = retryAfter;
      err.status = res.status;
      throw err;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      throw new Error(data.error || 'Edge function returned an error');
    }

    const reader = res.body.getReader();

    // Per-attempt timeout: a hung provider aborts so streamChat can fail
    // over to the next provider instead of hanging forever. 90s is generous
    // for slow coding models but still bounds the worst case.
    timeoutId = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, 90000);
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            receivedDone = true;
            return;
          }

          try {
            const json = JSON.parse(data);
            // Yield streak events directly (for chatbot to parse)
            if (json.type === 'streak') {
              yield data;
              continue;
            }
            // Detect error responses from edge function (all models failed, etc.)
            if (json.error) {
              throw new Error(json.error);
            }
            if (json.model) this._lastStreamModel = json.model;
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) this._lastFinishReason = fr;
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              if (!this.lastServed) {
                this.lastServed = { engine: 'edge', provider: this._providerName(this.activeProvider), model: json.model || null, at: Date.now() };
              }
              yield content;
            }
          } catch (e) {
            if (e instanceof IncompleteStreamError) throw e;
            if (e.message && !e.message.startsWith('Unexpected')) throw e;
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            receivedDone = true;
          } else {
            try {
              const json = JSON.parse(data);
              if (json.type === 'streak') {
                yield data;
              } else if (json.error) {
                throw new Error(json.error);
              } else {
                if (json.model) this._lastStreamModel = json.model;
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  if (!this.lastServed) {
                    this.lastServed = { engine: 'edge', provider: this._providerName(this.activeProvider), model: json.model || null, at: Date.now() };
                  }
                  yield content;
                }
              }
            } catch (e) {
              if (e.message && !e.message.startsWith('Unexpected')) throw e;
            }
          }
        }
      }

      // Stream ended without [DONE] â€” likely truncated by token limit or error
      if (!receivedDone) {
        throw new IncompleteStreamError(
          'Response was cut off (likely hit token limit). Retrying with fallback model...'
        );
      }
    } finally {
      try { clearTimeout(timeoutId); } catch (_) {}
      reader.releaseLock();
      this._currentAbort = null;
    }
  }

  /** True unless Astra is inside its post-failure cool-down window. */
  _astraAvailable() {
    return Date.now() >= this._astraCooldownUntil;
  }

  _noteAstraSuccess() {
    this._astraFails = 0;
    console.info('[AI] Served by Muse Spark (' +
      ((this.lastServed && this.lastServed.model) || this.astraModel) + ')');
  }

  _noteAstraFailure(error) {
    this._astraFails += 1;
    console.warn('[AI] Muse Spark failed: ' + ((error && error.message) || error) +
      ' — falling back to Groq → Qwen → Mistral');
    // Two misses in a row means the tunnel is down for now: stop paying its
    // latency on every message, and try it again in a minute.
    if (this._astraFails >= 2) {
      this._astraCooldownUntil = Date.now() + 60000;
      console.warn('[AI] Muse Spark cooling down for 60s after ' + this._astraFails +
        ' consecutive failures');
    }
  }

  /**
   * Priority attempt: stream straight from Muse Spark. The tunnel is
   * OpenAI-compatible and sends CORS headers, so the browser calls it
   * directly — no edge function sits in front of it.
   *
   * The prompt never tells the model what to call itself, so when a student
   * asks "which model are you?" the answer comes from the real model.
   *
   * Any throw here means "fall back to the normal chain".
   */
  async *_streamAstra(messages) {
    const controller = new AbortController();
    this._currentAbort = controller;

    // Astra is uncapped on purpose: no `max_tokens` is sent at all, so its own
    // output length is the only ceiling. A fixed budget used to cut long
    // answers mid-file, because reasoning tokens are billed against it too
    // (verified 2026-10-09 with tests/astra-length-probe.mjs: max_tokens 50
    // produced finish_reason "length" and zero visible text, while omitting it
    // let a 500-line answer finish cleanly).
    //
    // The timers below are therefore stall-based, never duration-based: they
    // catch a dead connection, they never cut a reply that is still flowing.
    const CONNECT_TIMEOUT_MS = 60000;       // headers must arrive within this
    const STALL_TIMEOUT_MS = 180000;        // then silence between chunks is fatal
    const HARD_CEILING_MS = 30 * 60 * 1000; // absolute backstop for one attempt
    const abortNow = () => { try { controller.abort(); } catch (_) {} };

    let timeoutId = setTimeout(abortNow, CONNECT_TIMEOUT_MS);
    /** Restart the silence clock — called on every byte that arrives. */
    const armStall = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(abortNow, STALL_TIMEOUT_MS);
    };
    const hardCeilingId = setTimeout(abortNow, HARD_CEILING_MS);
    let reader = null;

    try {
      let res;
      try {
        // Via the gateway, which holds the Astra key server-side and spends
        // one unit of the 15/day free quota before any token is used.
        // _postWithAuthRetry replays once on a 401, and the shared
        // requestId makes that replay cost nothing.
        res = await this._postWithAuthRetry(this.gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this._accessToken
              ? `Bearer ${this._accessToken}`
              : `Bearer ${this.supabaseKey}`,
          },
          body: JSON.stringify({
            mode: 'astra',
            messages,
            requestId: this._currentRequestId,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError' && this._abortRequested) throw e;
        if (e && e.name === 'AbortError') throw new Error('Astra request timed out');
        throw e; // DNS / connection refused / offline — fail over right away
      }

      // Headers are in. From here on, only real silence is fatal.
      armStall();

      if (res.status === 401 || res.status === 403) {
        // The gateway meters per user_id, so a signed-out student gets 401
        // rather than unmetered chat. Say so plainly instead of failing
        // over to a chain that will refuse it the same way.
        const authErr = new Error('Please sign in to use the AI tutor.');
        authErr.code = 'session_expired';
        authErr.status = res.status;
        throw authErr;
      }

      if (res.status === 429) {
        // Daily free limit reached. This is NOT an Astra outage: failing
        // over to the edge chain would be refused the same way, so it is
        // surfaced immediately with its reset time attached.
        let payload = {};
        try { payload = JSON.parse(await res.text()); } catch (_) {}
        const limitErr = new Error(payload.error || 'Daily free limit reached.');
        limitErr.code = 'FREE_DAILY_LIMIT';
        limitErr.feature = 'chat';
        limitErr.used = payload.used;
        limitErr.limit = payload.limit;
        limitErr.remaining = 0;
        limitErr.resetsAt = payload.resetsAt || payload.resets_at || null;
        throw limitErr;
      }

      if (!res.ok) {
        let detail = 'HTTP ' + res.status;
        try {
          const text = await res.text();
          try {
            const parsed = JSON.parse(text);
            detail = (parsed.error && (parsed.error.message || parsed.error)) || detail;
          } catch (_) {
            detail = String(text).slice(0, 200) || detail;
          }
        } catch (_) {}
        throw new Error('Astra ' + res.status + ': ' + detail);
      }

      // The tunnel may ignore `stream` and answer with a single JSON body.
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.error) throw new Error('Astra: ' + (data.error.message || data.error));
        const choice = data && data.choices && data.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!content) throw new Error('Muse Spark returned an empty response');
        if (data.model) this._lastStreamModel = data.model;
        this.lastServed = { engine: 'astra', provider: 'Muse Spark', model: data.model || this.astraModel, at: Date.now() };
        yield content;
        return;
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDone = false;
      let receivedContent = false;

      while (true) {
        let read;
        try {
          read = await reader.read();
        } catch (e) {
          // Stop tapped — surface the abort so nothing continues after it.
          if (this._abortRequested) throw e;
          // Text already reached the UI, so hand the partial reply to the
          // caller's continuation path instead of restarting the whole answer
          // with another model. (A dropped socket used to restart it from
          // scratch, which is how a long file ended up half-written.)
          if (receivedContent) {
            throw new IncompleteStreamError('Muse Spark connection dropped mid-reply. Continuing where it stopped...');
          }
          throw new Error('Astra stream failed: ' + ((e && e.message) || e));
        }
        const { done, value } = read;
        if (done) break;
        armStall();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            receivedDone = true;
            break;
          }

          try {
            const json = JSON.parse(data);
            if (json.error) throw new Error('Astra: ' + (json.error.message || json.error));
            if (json.model) this._lastStreamModel = json.model;
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) this._lastFinishReason = fr;
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              receivedContent = true;
              if (!this.lastServed) {
                this.lastServed = { engine: 'astra', provider: 'Muse Spark', model: json.model || this.astraModel, at: Date.now() };
              }
              yield content;
            }
          } catch (e) {
            if (e && e.message && e.message.startsWith('Astra:')) throw e;
            // Malformed frames and keep-alive pings are ignored.
          }
        }

        if (receivedDone) break;
      }

      if (!receivedContent) {
        // The connection died before any text, or thinking tokens consumed the
        // whole budget and the reply finished empty. Either way: fall back.
        throw new Error('Muse Spark produced no usable content');
      }
      if (!receivedDone) {
        throw new IncompleteStreamError('Muse Spark response was cut off. Retrying with fallback model...');
      }
    } finally {
      try { clearTimeout(timeoutId); } catch (_) {}
      try { clearTimeout(hardCeilingId); } catch (_) {}
      try { if (reader) reader.releaseLock(); } catch (_) {}
      if (this._currentAbort === controller) this._currentAbort = null;
    }
  }

  abort() {
    this._abortRequested = true;
    if (this._currentAbort) {
      this._currentAbort.abort();
      this._currentAbort = null;
    }
  }
}

/** Thrown when stream ends without [DONE] â€” signals incomplete response. */
class IncompleteStreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IncompleteStreamError';
  }
}
window.AiApiService = AiApiService;
