/* ==========================================
   Anteemonee - Triple API Failover Service
   Routes through Supabase Edge Function
   Detects incomplete streams and auto-falls back
   ========================================== */

class AiApiService {
  constructor() {
    this.supabaseUrl = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
    this.edgeFunctionUrl = `${this.supabaseUrl}/functions/v1/ai-chat`;
    this.activeProvider = 0;
    this._currentAbort = null;
    this._accessToken = null;
    this._sessionId = null;
    this.totalProviders = 3;
    this._lastFinishReason = null; // finish_reason of the latest completed attempt ('stop' | 'length' | ...)
  }

  get currentProvider() {
    const names = ['Groq', 'Qwen', 'Mistral'];
    return { name: names[this.activeProvider] || 'AI' };
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
    const startIndex = providerIndex !== null ? providerIndex : this.activeProvider;
    this._lastFinishReason = null;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const idx = (startIndex + attempt) % this.totalProviders;

      try {
        this.activeProvider = idx;
        yield* this._streamFromEdge(messages, idx, images);
        return; // success
      } catch (error) {
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

    const body = { messages, providerIndex };
    if (this._sessionId) body.sessionId = this._sessionId;
    if (requestId) body.requestId = requestId;
    if (images && images.length > 0) {
      body.images = images;
      console.log('[Edge] Sending', images.length, 'images, sizes:', images.map(i => i.length));
    } else {
      console.log('[Edge] No images to send');
    }

    const res = await this._postWithAuthRetry(this.edgeFunctionUrl, {
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
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) this._lastFinishReason = fr;
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
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
                const content = json.choices?.[0]?.delta?.content;
                if (content) yield content;
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

  abort() {
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
