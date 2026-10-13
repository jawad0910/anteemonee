/* ==========================================
   Anteemonee - BazaarLink-direct chat service.
   Every message streams from https://api.bazaarlink.ai (model auto:free)
   via the ai-chat-gateway edge function, which holds the provider key
   server-side. There is no fallback chain: if the provider fails, the
   error surfaces so the student can retry.
   (Web search still rides the Flagship tunnel — see the gateway — because
   SearXNG only listens on localhost. That leg is search-only.)
   ========================================== */

function tunnelDisplayName(model) {
  var m = String(model || '').toLowerCase();
  if (m.indexOf('space-bunny') !== -1) return 'Space Bunny';
  if (m.indexOf('muse-spark') !== -1) return 'Muse Spark 1.3';
  if (m.indexOf('nemotron') !== -1) return m.indexOf('3.5') !== -1 ? 'Nemotron 3.5 Lightning' : 'Nemotron 3 Ultra';
  if (m.indexOf('gpt-6') !== -1 || m.indexOf('astra') !== -1 || m.indexOf('big-pickle') !== -1) return 'GPT-6 Astra';
  return null;
}

class AiApiService {
  constructor() {
    this.supabaseUrl = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
    // Every student message now goes through the gateway, which holds the
    // provider key server-side and enforces the 15/day free quota. The browser
    // no longer talks to any model provider directly, so neither the key
    // nor the cap can be bypassed from devtools.
    this.gatewayUrl = `${this.supabaseUrl}/functions/v1/ai-chat-gateway`;
    this._currentAbort = null;
    this._accessToken = null;
    this._sessionId = null;
    this._lastFinishReason = null; // finish_reason of the latest completed attempt ('stop' | 'length' | ...)
    // ── BazaarLink direct: the one and only chat route. ──
    // Any failure surfaces to the student as an error (no silent fallback),
    // except user aborts, quota refusals and dead sessions, which rethrow.
    this.astraModel = 'auto:free';
    this._astraFails = 0;         // consecutive Astra failures
    this._astraCooldownUntil = 0; // skip Astra until this timestamp
    this._abortRequested = false; // user tapped Stop — never fail over after that
    this._lastStreamModel = null; // `model` id seen on the latest streamed chunks
    this.lastServed = null;       // { engine, provider, model } of the reply in flight
    this.lastSearched = false;    // true when the gateway ran a web search for this reply
  }

  get currentProvider() {
    return { name: tunnelDisplayName(this._lastStreamModel) || 'BazaarLink', model: this._lastStreamModel };
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
   *
   * getSession() on its own is not enough: it can hand back the very token
   * the gateway just rejected, so the retry would fail identically and the
   * student would be told to sign in when their session is perfectly
   * recoverable. Only a genuinely fresh token short-circuits; anything else
   * (expired, or the token we were just refused on) forces a real refresh.
   */
  async _refreshAccessToken() {
    try {
      if (typeof db === 'undefined' || !db || !db.auth) return null;

      if (typeof db.auth.getSession === 'function') {
        const { data } = await db.auth.getSession();
        const s = data && data.session;
        const t = s && s.access_token;
        const exp = s && s.expires_at ? s.expires_at * 1000 : 0;
        // 30s of slack so a token cannot expire mid-flight.
        const stillFresh = !!t && (!exp || Date.now() < exp - 30000);
        const isRejectedToken = !!t && t === this._accessToken;
        if (stillFresh && !isRejectedToken) {
          this._accessToken = t;
          return t;
        }
      }

      // Expired, missing, or the same token that just 401'd. Force the
      // refresh round-trip so the replay carries something the gateway will
      // actually accept.
      if (typeof db.auth.refreshSession === 'function') {
        const { data, error } = await db.auth.refreshSession();
        const t = data && data.session && data.session.access_token;
        if (t && !error) {
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
   * Stream chat via BazaarLink direct only. There is no fallback chain:
   * if the provider fails, the error surfaces so the student can retry.
   * A mid-stream drop still throws IncompleteStreamError so the caller can
   * retry from the partial text it already showed.
   */
  async *streamChat(messages, providerIndex = null, images = null) {
    this._lastFinishReason = null;
    this._lastStreamModel = null;
    this.lastServed = null;
    this.lastSearched = false;
    this._abortRequested = false;

    // One id for this message; the gateway treats it as an idempotency key.
    this._currentRequestId = this._newRequestId();

    if (!this._astraAvailable()) {
      throw new Error('Chat service is cooling down after failures. Please try again in a minute.');
    }
    try {
      yield* this._streamAstra(messages);
      this._noteAstraSuccess();
      return;
    } catch (error) {
      if (this._abortRequested) throw error;
      if (error && error.code === 'FREE_DAILY_LIMIT') throw error;
      if (error && error.code === 'session_expired') throw error;
      this._noteAstraFailure(error);
      if (error instanceof IncompleteStreamError) throw error;
      throw new Error('Chat service failed: ' + ((error && error.message) || error) + '. Please try again.');
    }
  }

  /** True unless Astra is inside its post-failure cool-down window. */
  _astraAvailable() {
    return Date.now() >= this._astraCooldownUntil;
  }

  _noteAstraSuccess() {
    this._astraFails = 0;
    console.info('[AI] Served by BazaarLink (' +
      ((this.lastServed && this.lastServed.model) || this.astraModel) + ')');
  }

  _noteAstraFailure(error) {
    this._astraFails += 1;
    console.warn('[AI] BazaarLink chat failed: ' + ((error && error.message) || error) +
      ' — no fallback configured; surfacing the error.');
    // Two misses in a row means the provider is down for now: stop paying its
    // latency on every message, and try it again in a minute.
    if (this._astraFails >= 2) {
      this._astraCooldownUntil = Date.now() + 60000;
      console.warn('[AI] Chat cooling down for 60s after ' + this._astraFails +
        ' consecutive failures');
    }
  }

  /**
   * Priority attempt: stream straight from BazaarLink via the gateway
   * (OpenAI-compatible). The browser never touches the provider directly —
   * the edge function holds the key and streams the response through.
   *
   * The prompt never tells the model what to call itself, so when a student
   * asks "which model are you?" the answer comes from the real model.
   *
   * Any throw here means "fall back to the normal chain".
   */
  async *_streamAstra(messages) {
    const controller = new AbortController();
    this._currentAbort = controller;

    // The chat route is uncapped on purpose: no `max_tokens` is sent at all, so its own
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
        // Via the gateway, which holds the provider key server-side and spends
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
        if (e && e.name === 'AbortError') throw new Error('Chat request timed out');
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
        // Daily free limit reached. This is NOT a provider outage: failing
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
        throw new Error('Chat ' + res.status + ': ' + detail);
      }

      // Whether the gateway grounded this reply with a live web search. The
      // chatbot reads it when finalizing so the reply can wear its badge.
      try { this.lastSearched = res.headers.get('X-Web-Searched') === '1'; } catch (_) {}

      // The tunnel may ignore `stream` and answer with a single JSON body.
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.error) throw new Error('Chat: ' + (data.error.message || data.error));
        const choice = data && data.choices && data.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!content) throw new Error('Chat returned an empty response');
        if (data.model) this._lastStreamModel = data.model;
        this.lastServed = { engine: 'astra', provider: tunnelDisplayName(data.model) || 'BazaarLink', model: data.model || this.astraModel, at: Date.now() };
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
            throw new IncompleteStreamError('Chat connection dropped mid-reply. Continuing where it stopped...');
          }
          throw new Error('Chat stream failed: ' + ((e && e.message) || e));
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
            if (json.error) throw new Error('Chat: ' + (json.error.message || json.error));
            if (json.model) this._lastStreamModel = json.model;
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) this._lastFinishReason = fr;
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              receivedContent = true;
              if (!this.lastServed) {
                this.lastServed = { engine: 'astra', provider: tunnelDisplayName(json.model) || 'BazaarLink', model: json.model || this.astraModel, at: Date.now() };
              }
              yield content;
            }
          } catch (e) {
            if (e && e.message && e.message.startsWith('Chat:')) throw e;
            // Malformed frames and keep-alive pings are ignored.
          }
        }

        if (receivedDone) break;
      }

      if (!receivedContent) {
        // The connection died before any text, or thinking tokens consumed the
        // whole budget and the reply finished empty. Either way: fall back.
        throw new Error('Chat produced no usable content');
      }
      // NOTE: this tunnel ends a clean, complete reply by simply closing the
      // stream — it never sends OpenAI's [DONE] marker (and reports
      // finish_reason "in_progress" instead of "stop"). A clean close with
      // content is therefore a COMPLETE reply, not a truncation: only a
      // mid-stream read error (thrown above) means cut off. A "length"
      // finish is still honored by the continuation logic downstream.
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
