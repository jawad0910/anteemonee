/* ==========================================
   Anteemonee - xKiro chat service.
   Every message streams from xKiro (OpenAI-compatible API at
   https://api.xkiro.com/v1/chat/completions) with an automatic
   model fallback list. The browser talks to xKiro directly;
   no gateway or edge function is involved.
   ========================================== */

function tunnelDisplayName(model) {
  var m = String(model || '').toLowerCase();
  if (m.indexOf('ministral-14b') !== -1) return 'Ministral 14B';
  if (m.indexOf('mistral-small') !== -1) return 'Mistral Small 2603';
  if (m.indexOf('command-r') !== -1) return 'Command R';
  if (m.indexOf('ministral-8b') !== -1) return 'Ministral 8B';
  if (m.indexOf('ministral-3b') !== -1) return 'Ministral 3B';
  if (m.indexOf('big-pickle') !== -1) return 'Big Pickle';
  if (m.indexOf('space-bunny') !== -1) return 'Space Bunny';
  if (m.indexOf('glm-5.3-flash') !== -1) return 'Zen GLM 5.3 Flash';
  if (m.indexOf('glm') !== -1) return 'Zen GLM';
  if (m.indexOf('gpt-oss-120b') !== -1) return 'GPT-OSS 120B';
  if (m.indexOf('gpt-oss-20b') !== -1) return 'GPT-OSS 20B';
  if (m.indexOf('muse-spark') !== -1) return 'Muse Spark 1.3';
  if (m.indexOf('nemotron') !== -1) return m.indexOf('3.5') !== -1 ? 'Nemotron 3.5 Lightning' : 'Nemotron 3 Ultra';
  if (m.indexOf('gpt-6') !== -1 || m.indexOf('astra') !== -1) return 'GPT-6 Astra';
  if (m.indexOf('xkiro') !== -1 || m.indexOf('stealth') !== -1) return 'xKiro';
  return null;
}

class AiApiService {
  constructor() {
    this.supabaseUrl = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
    // xKiro via the Supabase gateway (xKiro has no CORS headers, so the
    // browser cannot call it directly). The gateway holds XKiro_API_KEY
    // as a Supabase secret; the client passes the user's Supabase JWT.
    this.gatewayUrl = `${this.supabaseUrl}/functions/v1/ai-chat-gateway`;
    this.chatModel = 'mistralai/ministral-14b';
    this.modelFallbacks = [
      'mistralai/ministral-14b',
      'mistralai/mistral-small-2603',
      'cohere/command-r-08-2024',
    ];
    this._currentAbort = null;
    this._accessToken = null;
    this._sessionId = null;
    this._lastFinishReason = null;
    this._fails = 0;
    this._cooldownUntil = 0;
    this._abortRequested = false;
    this._lastStreamModel = null;
    this.lastServed = null;
    this.lastSearched = false;
    this._gatewayModel = null;
  }

  get currentProvider() {
    return { name: tunnelDisplayName(this._lastStreamModel) || 'xKiro', model: this._lastStreamModel };
  }

  setAccessToken(token) {
    this._accessToken = token;
  }

  setSessionId(id) {
    this._sessionId = id;
  }

  async fetchYtVideos(query, klass) {
    const token = this._accessToken;
    const r = await fetch(`${this.supabaseUrl}/functions/v1/ai-video-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: query || '', class: klass || '' }),
    });
    if (!r.ok) throw new Error(`video search ${r.status}`);
    return r.json();
  }

  async _refreshAccessToken() {
    try {
      if (typeof db !== 'undefined' && db && db.auth) {
        if (typeof db.auth.getSession === 'function') {
          const { data } = await db.auth.getSession();
          const s = data && data.session;
          const t = s && s.access_token;
          const exp = s && s.expires_at ? s.expires_at * 1000 : 0;
          const stillFresh = !!t && (!exp || Date.now() < exp - 30000);
          const isRejectedToken = !!t && t === this._accessToken;
          if (stillFresh && !isRejectedToken) {
            this._accessToken = t;
            return t;
          }
        }
        if (typeof db.auth.refreshSession === 'function') {
          const { data, error } = await db.auth.refreshSession();
          const t = data && data.session && data.session.access_token;
          if (t && !error) {
            this._accessToken = t;
            return t;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  _newRequestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  }

  async _postWithAuthRetry(url, init) {
    const res = await fetch(url, init);
    if (res.status !== 401) return res;
    const fresh = await this._refreshAccessToken();
    if (!fresh) return res;
    return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${fresh}` } });
  }

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

  async generateImage(prompt, context) {
    const authHeader = this._accessToken
      ? `Bearer ${this._accessToken}`
      : `Bearer ${this.supabaseKey}`;

    const payload = context && context.length ? { prompt, context } : { prompt };
    const res = await this._postWithAuthRetry(`${this.supabaseUrl}/functions/v1/ai-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload),
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
   * Stream chat via xKiro. Tries each model in modelFallbacks in order;
   * a model that rate-limits (429), is unavailable (503), or is rejected
   * (403) advances to the next one. User aborts and mid-stream drops
   * (IncompleteStreamError) are never retried with another model.
   */
  async *streamChat(messages, providerIndex = null, images = null) {
    this._lastFinishReason = null;
    this._lastStreamModel = null;
    this.lastServed = null;
    this.lastSearched = false;
    this._wantsWeb = false;
    this._webtools = [];
    this._gatewayModel = null;
    this._abortRequested = false;
    this._currentRequestId = this._newRequestId();

    if (Date.now() < this._cooldownUntil) {
      throw new Error('Chat service is cooling down after failures. Please try again in a minute.');
    }

    let lastError = null;
    for (const model of this.modelFallbacks) {
      try {
        yield* this._streamOneModel(messages, model);
        this._fails = 0;
        console.info('[AI] Served by xKiro (' + ((this.lastServed && this.lastServed.model) || model) + ')');
        return;
      } catch (error) {
        if (this._abortRequested) throw error;
        if (error instanceof IncompleteStreamError) throw error;
        const retryable = error && (error.status === 429 || error.status === 503 || error.status === 403 || (error.message && error.message.startsWith('Chat ')));
        lastError = error;
        if (!retryable) break;
        // fall through to next model
      }
    }

    this._fails += 1;
    console.warn('[AI] xKiro chat failed: ' + ((lastError && lastError.message) || lastError));
    if (this._fails >= 2) {
      this._cooldownUntil = Date.now() + 60000;
      console.warn('[AI] Chat cooling down for 60s after ' + this._fails + ' consecutive failures');
    }
    if (lastError) {
      if (lastError.code === 'FREE_DAILY_LIMIT') throw lastError;
      throw new Error('Chat service failed: ' + (lastError.message || lastError) + '. Please try again.');
    }
    throw new Error('Chat service failed. Please try again.');
  }

  setWantsWeb(v) {
    this._wantsWeb = v === true;
  }

  getWebTools() {
    return Array.isArray(this._webtools) ? this._webtools.slice() : [];
  }

  async *_streamOneModel(messages, model) {
    const controller = new AbortController();
    this._currentAbort = controller;

    const CONNECT_TIMEOUT_MS = 60000;
    const STALL_TIMEOUT_MS = 180000;
    const HARD_CEILING_MS = 30 * 60 * 1000;
    const abortNow = () => { try { controller.abort(); } catch (_) {} };

    let timeoutId = setTimeout(abortNow, CONNECT_TIMEOUT_MS);
    const armStall = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(abortNow, STALL_TIMEOUT_MS);
    };
    const hardCeilingId = setTimeout(abortNow, HARD_CEILING_MS);
    let reader = null;

    try {
      let res;
      try {
        res = await fetch(this.gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this._accessToken
              ? `Bearer ${this._accessToken}`
              : `Bearer ${this.supabaseKey}`,
            'apikey': this.supabaseKey,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError' && this._abortRequested) throw e;
        if (e && e.name === 'AbortError') throw new Error('Chat request timed out');
        throw e;
      }

      armStall();

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
        const err = new Error('Chat ' + res.status + ': ' + detail);
        err.status = res.status;
        throw err;
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.error) throw new Error('Chat: ' + (data.error.message || data.error));
        const choice = data && data.choices && data.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!content) throw new Error('Chat returned an empty response');
        if (data.model) this._lastStreamModel = data.model;
        this.lastServed = { engine: 'direct', provider: tunnelDisplayName(data.model) || 'xKiro', model: data.model || model, at: Date.now() };
        this._gatewayModel = data.model || null;
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
          if (this._abortRequested) throw e;
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
            if (json.webtool) {
              if (!Array.isArray(this._webtools)) this._webtools = [];
              this._webtools.push(json.webtool);
              yield '\u0000WEBTOOL\u0001' + JSON.stringify(json.webtool);
            }
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              receivedContent = true;
              if (!this.lastServed) {
                this.lastServed = { engine: 'direct', provider: tunnelDisplayName(json.model) || 'xKiro', model: json.model || model, at: Date.now() };
              }
              this._gatewayModel = json.model || this._gatewayModel;
              yield content;
            }
          } catch (e) {
            if (e && e.message && e.message.startsWith('Chat:')) throw e;
          }
        }

        if (receivedDone) break;
      }

      if (!receivedContent) {
        throw new Error('Chat produced no usable content');
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

/** Thrown when stream ends without [DONE] — signals incomplete response. */
class IncompleteStreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IncompleteStreamError';
  }
}
window.AiApiService = AiApiService;
