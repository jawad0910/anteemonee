/* ==========================================
   Wassal AI - Dual API Failover Service
   Routes through Supabase Edge Function
   Detects incomplete streams and auto-falls back
   ========================================== */

class AiApiService {
  constructor() {
    this.supabaseUrl = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjUwNjcyMTIsImV4cCI6MjA0MDY0MzIxMn0._VJbk4XQCnN0BxMbFQP5OqWKjAwXf8lGLgN4Lfxpmk0';
    this.edgeFunctionUrl = `${this.supabaseUrl}/functions/v1/ai-chat`;
    this.activeProvider = 0;
    this._currentAbort = null;
    this._accessToken = null;
    this._sessionId = null;
  }

  get currentProvider() {
    const names = ['Groq', 'Qwen'];
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
   * Stream chat with auto-failover.
   * If the primary provider's stream cuts off mid-response (no [DONE]),
   * it throws an IncompleteStreamError so the caller can retry with fallback.
   */
  async *streamChat(messages, providerIndex = null) {
    const startIndex = providerIndex !== null ? providerIndex : this.activeProvider;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const idx = (startIndex + attempt) % 2;

      try {
        this.activeProvider = idx;
        yield* this._streamFromEdge(messages, idx);
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

  async *_streamFromEdge(messages, providerIndex) {
    const controller = new AbortController();
    this._currentAbort = controller;

    // Use user's JWT if available, fall back to anon key
    const authHeader = this._accessToken
      ? `Bearer ${this._accessToken}`
      : `Bearer ${this.supabaseKey}`;

    const body = { messages, providerIndex };
    if (this._sessionId) body.sessionId = this._sessionId;

    const res = await fetch(this.edgeFunctionUrl, {
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
      try { const parsed = JSON.parse(detail); msg = parsed.error || detail; code = parsed.code || ''; } catch (_) {}
      throw new Error(`Error ${res.status}: ${String(msg).slice(0, 300)}${code ? ' [' + code + ']' : ''}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      throw new Error(data.error || 'Edge function returned an error');
    }

    const reader = res.body.getReader();
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
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch (_) {}
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
              } else {
                const content = json.choices?.[0]?.delta?.content;
                if (content) yield content;
              }
            } catch (_) {}
          }
        }
      }

      // Stream ended without [DONE] — likely truncated by token limit or error
      if (!receivedDone) {
        throw new IncompleteStreamError(
          'Response was cut off (likely hit token limit). Retrying with fallback model...'
        );
      }
    } finally {
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

/** Thrown when stream ends without [DONE] — signals incomplete response. */
class IncompleteStreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IncompleteStreamError';
  }
}

window.AiApiService = AiApiService;
window.IncompleteStreamError = IncompleteStreamError;
