/**
 * Anteemonee Realtime Call — true phone-call voice via OpenAI Realtime WebRTC
 * Falls back to whisper voice-chat if OPENAI_API_KEY not configured.
 */
(function () {
  'use strict';

  let pc = null;
  let dc = null;
  let localStream = null;
  let remoteAudio = null;
  let callTimer = null;
  let callStartTs = 0;
  let muted = false;
  let speakerOn = true;
  let isCallActive = false;
  let connWatchdog = null;

  function supabaseCfg() {
    try { if (typeof AiApiService !== 'undefined') { const t = new AiApiService(); return { url: t.supabaseUrl, anonKey: t.supabaseKey }; } } catch (_) {}
    try { if (typeof SUPABASE_URL !== 'undefined') return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }; } catch (_) {}
    return { url: 'https://zkuytvjeqkpexcbyoyhz.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44' };
  }
  async function getAuthHeader() {
    const { anonKey } = supabaseCfg();
    try { if (typeof db !== 'undefined' && db.auth && db.auth.getSession) { const { data } = await db.auth.getSession(); const t = data && data.session && data.session.access_token; if (t) return 'Bearer ' + t; } } catch (_) {}
    return 'Bearer ' + anonKey;
  }

  function els() {
    return {
      overlay: document.getElementById('voice-overlay'),
      timer: document.getElementById('call-timer'),
      status: document.getElementById('voice-status'),
      transcript: document.getElementById('voice-transcript'),
      muteBtn: document.getElementById('call-mute-btn'),
      speakerBtn: document.getElementById('call-speaker-btn'),
      endBtn: document.getElementById('voice-exit-btn'),
      orb: document.getElementById('voice-orb'),
    };
  }

  function fmtTimer(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }
  function startTimer() {
    callStartTs = Date.now();
    const { timer } = els();
    if (timer) timer.textContent = '00:00';
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - callStartTs) / 1000);
      const t = els().timer;
      if (t) t.textContent = fmtTimer(sec);
    }, 1000);
  }
  function stopTimer() { if (callTimer) clearInterval(callTimer); callTimer = null; }

  function setStatus(text) { const { status } = els(); if (status) status.textContent = text; }
  function setTranscript(text, isInterim) {
    const { transcript } = els(); if (!transcript) return;
    if (!text) { transcript.textContent = ''; transcript.classList.remove('has-text', 'interim'); return; }
    transcript.textContent = text; transcript.classList.add('has-text'); transcript.classList.toggle('interim', !!isInterim);
  }
  function setCallState(state) {
    const { overlay } = els();
    if (!overlay) return;
    overlay.classList.toggle('listening', state === 'listening');
    overlay.classList.toggle('speaking', state === 'ai-speaking');
  }

  // --- Hybrid: Anteemonee brain + OpenAI voice ---
  let originalVoiceComplete = null;
  function stripForRealtime(text) {
    let t = String(text || '');
    t = t.replace(/```[\s\S]*?```/g, '');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(\*|_)(.*?)\1/g, '$2');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    if (t.length > 4000) t = t.slice(0, 4000) + '…';
    return t;
  }
  function speakViaRealtime(text) {
    const clean = stripForRealtime(text);
    if (!clean || !dc || dc.readyState !== 'open') { console.warn('[hybrid] dc not open for speak'); return; }
    setCallState('ai-speaking'); setStatus('Speaking…');
    // Use instructions to make OpenAI say exactly our brain's answer verbatim
    const instructions = `Repeat verbatim, exactly as written, without paraphrasing or adding anything. Say:\n\n${clean}`;
    try {
      dc.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['audio', 'text'], instructions, voice: 'alloy' }
      }));
    } catch (e) { console.warn('[hybrid] send failed', e); }
  }
  function sendToAnteemoneeBrain(transcript) {
    const t = String(transcript || '').trim();
    if (!t) return;
    // Use existing chat input pipeline so all Anteemonee context (persona, RAG, memories) is applied
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('btn-send');
    if (input && btn) {
      input.value = t;
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      // Ensure send button enabled
      try { btn.disabled = false; } catch (_) {}
      setTimeout(() => {
        try {
          if (!btn.disabled) btn.click();
          else {
            const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
            input.dispatchEvent(ev);
          }
        } catch (_) {}
      }, 80);
      setStatus('Thinking…'); setCallState('listening');
    } else {
      // Fallback: direct API call if chat UI not ready
      try {
        const api = new AiApiService();
        const token = (() => { try { return db?.auth ? null : null; } catch (_) { return null; } })();
        // Get token async
        (async () => {
          let tok = null;
          try { const { data } = await db.auth.getSession(); tok = data?.session?.access_token || null; } catch (_) {}
          if (tok) api.setAccessToken(tok);
          const msgs = [{ role: 'user', content: t }];
          let full = '';
          for await (const chunk of api.streamChat(msgs)) full += chunk;
          if (full) speakViaRealtime(full);
        })();
      } catch (e) { console.warn('[hybrid] direct brain call failed', e); }
    }
  }
  function enableHybridVoice() {
    if (originalVoiceComplete) return;
    try { originalVoiceComplete = window.AnteemoneeVoice && window.AnteemoneeVoice.onAiResponseComplete; } catch (_) { originalVoiceComplete = null; }
    if (window.AnteemoneeVoice) {
      window.AnteemoneeVoice.onAiResponseComplete = function(text) {
        // Called after Anteemonee brain finishes streaming
        const full = String(text || '').trim();
        if (!full) {
          setStatus('On call — speak naturally'); setCallState('listening');
          return;
        }
        // Show caption
        setTranscript(full, false);
        // Speak via OpenAI realtime voice (hybrid)
        if (isCallActive && dc && dc.readyState === 'open') {
          speakViaRealtime(full);
        } else if (originalVoiceComplete) {
          try { originalVoiceComplete(full); } catch (_) {}
        }
      };
    }
  }
  function disableHybridVoice() {
    if (window.AnteemoneeVoice && originalVoiceComplete) {
      window.AnteemoneeVoice.onAiResponseComplete = originalVoiceComplete;
    }
    originalVoiceComplete = null;
  }

  function getVoiceKeyLocal() {
    try {
      let uid = 'anon';
      try { if (typeof currentUser !== 'undefined' && currentUser?.id) uid = currentUser.id; } catch (_) {}
      return localStorage.getItem('Anteemonee_openai_key_' + uid) || '';
    } catch (_) { return ''; }
  }
  function setVoiceKeyLocal(k) {
    try {
      let uid = 'anon';
      try { if (typeof currentUser !== 'undefined' && currentUser?.id) uid = currentUser.id; } catch (_) {}
      if (k) localStorage.setItem('Anteemonee_openai_key_' + uid, k); else localStorage.removeItem('Anteemonee_openai_key_' + uid);
    } catch (_) {}
  }
  async function promptForKey() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,6,16,0.92)';
      overlay.innerHTML = `
        <div style="width:100%;max-width:420px;background:var(--liquid-bg-strong, var(--bg-secondary));border:1px solid var(--liquid-border, var(--border));border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:6px">Add your OpenAI API key</h3>
          <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:14px">Live call needs your own OpenAI key. Get it at <a href="https://platform.openai.com/api-keys" target="_blank" style="color:var(--accent);text-decoration:underline">platform.openai.com/api-keys</a>. We store it only on your device.</p>
          <input type="password" id="rt-key-input" placeholder="sk-proj-..." style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid var(--liquid-border-soft, var(--border));background:var(--surface-recessed, var(--bg));color:var(--text);font-size:13px;box-sizing:border-box;margin-bottom:8px">
          <div id="rt-key-err" style="font-size:12px;color:#FF6675;display:none;margin-bottom:8px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
            <button id="rt-key-cancel" style="padding:8px 16px;border-radius:999px;border:1px solid var(--liquid-border-soft);background:transparent;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
            <button id="rt-key-save" style="padding:8px 18px;border-radius:999px;border:none;background:var(--accent);color:var(--on-accent);font-size:13px;font-weight:700;cursor:pointer">Save & Call</button>
          </div>
          <p style="font-size:11px;color:var(--text-tertiary);margin-top:10px">You can edit or remove it anytime in Settings → Voice Call</p>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#rt-key-input');
      const err = overlay.querySelector('#rt-key-err');
      const save = overlay.querySelector('#rt-key-save');
      const cancel = overlay.querySelector('#rt-key-cancel');
      const close = (val) => { try { overlay.remove(); } catch (_) {} resolve(val); };
      cancel.addEventListener('click', () => close(''));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(''); });
      save.addEventListener('click', () => {
        const v = (input.value || '').trim();
        if (!v || !v.startsWith('sk-')) { err.textContent = 'Key should start with sk-'; err.style.display='block'; return; }
        setVoiceKeyLocal(v);
        // try save to DB too
        try { if (typeof db !== 'undefined' && typeof currentUser !== 'undefined' && currentUser?.id) db.from('user_call_keys').upsert({ user_id: currentUser.id, openai_key: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(()=>{}).catch(()=>{}); } catch (_) {}
        close(v);
      });
      setTimeout(() => input.focus(), 100);
    });
  }

  async function fetchEphemeralToken() {
    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/realtime-session';

    let userKey = getVoiceKeyLocal();
    // Try DB fallback if no local key
    if (!userKey) {
      try {
        if (typeof db !== 'undefined' && typeof currentUser !== 'undefined' && currentUser?.id) {
          const { data } = await db.from('user_call_keys').select('openai_key').eq('user_id', currentUser.id).maybeSingle();
          if (data?.openai_key) { userKey = data.openai_key; setVoiceKeyLocal(userKey); }
        }
      } catch (_) {}
    }

    // First try without user key (server env fallback) — hybrid: Anteemonee brain + OpenAI voice
    const tryFetch = async (key) => {
      const headers = { 'Authorization': auth, 'Content-Type': 'application/json' };
      if (key) headers['X-OpenAI-Key'] = key;
      const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ voice: 'alloy', hybrid: true }) });
      const data = await r.json().catch(() => ({}));
      return { r, data };
    };

    let { r, data } = await tryFetch(userKey || '');
    if (!r.ok && r.status === 401 && /No API key/i.test(data.error || '') && !userKey) {
      // No server key and no user key — prompt user
      const entered = await promptForKey();
      if (!entered) throw new Error('API key required — add it in Settings → Voice Call');
      userKey = entered;
      ({ r, data } = await tryFetch(userKey));
    }
    if (!r.ok) {
      if (r.status === 401 && data.error && /No API key/i.test(data.error)) {
        setVoiceKeyLocal('');
        try { if (typeof db !== 'undefined' && currentUser?.id) db.from('user_call_keys').delete().eq('user_id', currentUser.id).then(()=>{}).catch(()=>{}); } catch (_) {}
      }
      throw new Error(data.error || `realtime-session ${r.status}`);
    }
    // New shape: { value: "ek_...", expires_at, session } — old shape had client_secret.value
    const token = data.value || data.client_secret?.value || data.client_secret || data.token;
    if (!token) throw new Error('No ephemeral token — is your OpenAI key valid?');
    return { token, model: data.model || data.session?.model || 'gpt-4o-realtime-preview-2024-12-17' };
  }

  async function startRealtimeCall() {
    if (isCallActive) return;
    const { overlay } = els();
    if (!overlay) return;
    overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    isCallActive = true; muted = false; speakerOn = true;
    setStatus('Connecting…'); setTranscript('', false); setCallState('listening');
    startTimer();

    let ephemeral, model;
    try {
      const tok = await fetchEphemeralToken();
      ephemeral = tok.token; model = tok.model;
    } catch (e) {
      const msg = (e && e.message) || '';
      console.warn('[realtime] token failed', msg);
      // If user dismissed key prompt, just close — don't fallback to whisper
      if (/API key required/i.test(msg)) { endRealtimeCall(); return; }
      // If OpenAI key invalid, show error and close
      if (/401|No ephemeral|valid/i.test(msg)) { setStatus(msg.slice(0,60)); setTimeout(endRealtimeCall, 2200); return; }
      // Otherwise fallback to whisper (server missing env, network)
      setStatus('Live call unavailable — switching…');
      endRealtimeCall();
      if (window.AnteemoneeVoice && window.AnteemoneeVoice.open) {
        setTimeout(() => window.AnteemoneeVoice.open(), 300);
      }
      return;
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setStatus('Mic permission denied'); stopTimer();
      setTimeout(endRealtimeCall, 2200);
      return;
    }

    // Watchdog: if still "Connecting…" after 25s, surface failure instead of hanging
    if (connWatchdog) clearTimeout(connWatchdog);
    connWatchdog = setTimeout(() => {
      if (!isCallActive) return;
      const st = (els().status && els().status.textContent) || '';
      if (/Connecting/i.test(st)) {
        console.warn('[realtime] connect watchdog fired, pc state:', pc && pc.connectionState);
        setStatus('Connection timed out — check key & network');
        setTimeout(endRealtimeCall, 2500);
      }
    }, 25000);

    try {
    pc = new RTCPeerConnection();
    // Play remote audio
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true; remoteAudio.playsInline = true;
    pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; setCallState('ai-speaking'); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      console.log('[realtime] pc state:', s);
      if (s === 'connected') { if (connWatchdog) clearTimeout(connWatchdog); setStatus('On call — speak naturally'); setCallState('listening'); }
      else if (s === 'failed') { if (connWatchdog) clearTimeout(connWatchdog); setStatus('Connection failed — try again'); setTimeout(endRealtimeCall, 2500); }
    };
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus('On call — speak naturally');
      setCallState('listening');
      enableHybridVoice();
    };
    dc.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        // console.log('[realtime evt]', evt.type);
        if (evt.type === 'input_audio_buffer.speech_started') {
          setCallState('listening'); setStatus('Listening…');
          // barge-in: interrupt realtime audio
          try { remoteAudio.pause(); } catch (_) {}
          // Also abort Anteemonee streaming if in progress
          try { if (typeof AiApiService !== 'undefined') new AiApiService().abort(); } catch (_) {}
        } else if (evt.type === 'input_audio_buffer.speech_stopped') {
          setStatus('Thinking…');
        } else if (evt.type === 'conversation.item.input_audio_transcription.completed') {
          const t = evt.transcript || '';
          if (t) { setTranscript(t, false); setStatus('Thinking…'); sendToAnteemoneeBrain(t); }
        } else if (evt.type === 'response.audio_transcript.delta') {
          // AI transcript streaming
          const d = evt.delta || '';
          if (d) {
            const cur = els().transcript.textContent || '';
            // if we were showing user transcript, replace
            if (cur && !cur.startsWith('AI:')) setTranscript('', false);
            const next = (els().transcript.textContent || '') + d;
            setTranscript(next, true);
          }
        } else if (evt.type === 'response.audio_transcript.done') {
          const t = evt.transcript || els().transcript.textContent || '';
          if (t) setTranscript(t, false);
        } else if (evt.type === 'response.done') {
          setStatus('On call — speak naturally');
          setCallState('listening');
          const txt = els().transcript.textContent || '';
          if (txt) { setTranscript(txt, false); setTimeout(() => setTranscript('', false), 4200); }
        } else if (evt.type === 'response.audio.delta') {
          setCallState('ai-speaking'); setStatus('Speaking…');
        } else if (evt.type === 'error') {
          console.warn('[realtime error]', evt.error);
          setStatus(evt.error?.message?.slice(0, 60) || 'Error');
        }
      } catch (_) {}
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // New endpoint: POST /v1/realtime/calls with SDP body + ephemeral key (no ?model= — model is bound to the token)
    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    const answerSdp = await sdpRes.text();
    if (!sdpRes.ok) throw new Error(`SDP ${sdpRes.status}: ${answerSdp.slice(0,300)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    setStatus('On call — speak naturally');
    } catch (e) {
      const msg = (e && e.message) || 'connection failed';
      console.warn('[realtime] connect failed:', msg);
      if (connWatchdog) clearTimeout(connWatchdog);
      setStatus(msg.slice(0, 80));
      setTimeout(endRealtimeCall, 3000);
      return;
    }
  }

  function endRealtimeCall() {
    isCallActive = false;
    if (connWatchdog) { clearTimeout(connWatchdog); connWatchdog = null; }
    disableHybridVoice();
    stopTimer();
    try { if (dc) dc.close(); } catch (_) {}
    try { if (pc) pc.close(); } catch (_) {}
    dc = null; pc = null;
    if (localStream) { try { localStream.getTracks().forEach(t => t.stop()); } catch (_) {} localStream = null; }
    if (remoteAudio) { try { remoteAudio.pause(); remoteAudio.srcObject = null; } catch (_) {} remoteAudio = null; }
    const { overlay } = els();
    if (overlay) { overlay.classList.remove('show','listening','speaking'); overlay.setAttribute('aria-hidden','true'); }
    document.body.style.overflow = '';
    setStatus('Connecting…'); setCallState('listening');
  }

  function toggleMute() {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !muted);
    const { muteBtn } = els();
    if (muteBtn) muteBtn.classList.toggle('muted', muted);
    if (muteBtn) muteBtn.classList.toggle('active', muted);
    setStatus(muted ? 'Muted' : 'On call — speak naturally');
  }
  function toggleSpeaker() {
    speakerOn = !speakerOn;
    const { speakerBtn } = els();
    if (speakerBtn) speakerBtn.classList.toggle('active', !speakerOn);
    if (remoteAudio) remoteAudio.muted = !speakerOn;
    // Note: true speaker vs earpiece only on mobile native; web just mute/unmute
  }

  function bindCallButtons() {
    const { muteBtn, speakerBtn, endBtn } = els();
    const closeBtn = document.getElementById('voice-close');
    if (muteBtn && !muteBtn.dataset.bound) { muteBtn.dataset.bound = '1'; muteBtn.addEventListener('click', toggleMute); }
    if (speakerBtn && !speakerBtn.dataset.bound) { speakerBtn.dataset.bound = '1'; speakerBtn.addEventListener('click', toggleSpeaker); }
    if (endBtn && !endBtn.dataset.rtBound) { endBtn.dataset.rtBound = '1'; endBtn.addEventListener('click', endRealtimeCall); }
    if (closeBtn && !closeBtn.dataset.rtBound) { closeBtn.dataset.rtBound = '1'; closeBtn.addEventListener('click', endRealtimeCall); }
    const overlay = document.getElementById('voice-overlay');
    if (overlay && !overlay.dataset.rtBgBound) {
      overlay.dataset.rtBgBound = '1';
      overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('voice-overlay-bg')) endRealtimeCall(); });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isCallActive) endRealtimeCall(); });
  }

  // Intercept voice button — DISABLED: Gemini Live (gemini-live-call.js) owns the button now
  function hookVoiceButton() {
    return;
    const btn = document.getElementById('btn-voice');
    if (!btn || btn.dataset.rtHook) return;
    btn.dataset.rtHook = '1';
    btn.addEventListener('click', (e) => {
      const overlay = document.getElementById('voice-overlay');
      const isOpen = overlay && overlay.classList.contains('show');
      if (isOpen && isCallActive) { e.stopImmediatePropagation(); e.preventDefault(); endRealtimeCall(); return; }
      if (!isOpen) {
        e.stopImmediatePropagation(); e.preventDefault();
        // Try realtime; if it falls back, it will open whisper
        startRealtimeCall();
      }
    }, true);
  }

  function init() { bindCallButtons(); hookVoiceButton(); setTimeout(() => { bindCallButtons(); hookVoiceButton(); }, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setTimeout(init, 1200);

  window.AnteemoneeRealtimeCall = { start: startRealtimeCall, end: endRealtimeCall, get isActive() { return isCallActive; } };
})();
