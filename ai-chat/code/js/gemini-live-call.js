/**
 * Anteemonee Live Call — Gemini Live API true duplex voice.
 * Server key only: browser fetches a short-lived ephemeral token from
 * `gemini-live-token` edge function, then connects directly to Google.
 * No user key needed.
 */
(function () {
  'use strict';

  const LIVE_MODELS = ['gemini-3.1-flash-live-preview', 'gemini-2.0-flash-live-001'];
  let liveModelIdx = 0;
  let savedInstructions = '';
  function tryModelFallback() {
    if (liveModelIdx + 1 >= LIVE_MODELS.length) return false;
    liveModelIdx++;
    console.log('[live] retrying with fallback model', LIVE_MODELS[liveModelIdx]);
    setStatus('Retrying…');
    openSocket();
    return true;
  }
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

  let ws = null;
  let mediaStream = null;
  let audioCtx = null;        // shared ctx for capture + playback
  let captureNode = null;
  let captureSrc = null;
  let masterGain = null;
  let playCursor = 0;
  let playGen = 0;            // bump to cancel scheduled audio (barge-in)
  let activeSources = [];
  let callTimer = null;
  let callStartTs = 0;
  let connWatchdog = null;
  let muted = false;
  let speakerOn = true;
  let sendingMuted = false;
  let isCallActive = false;
  let setupDone = false;
  let userCaption = '';
  let aiCaption = '';

  function els() {
    return {
      overlay: document.getElementById('voice-overlay'),
      timer: document.getElementById('call-timer'),
      status: document.getElementById('voice-status'),
      transcript: document.getElementById('voice-transcript'),
      muteBtn: document.getElementById('call-mute-btn'),
      speakerBtn: document.getElementById('call-speaker-btn'),
      endBtn: document.getElementById('voice-exit-btn'),
    };
  }
  function fmtTimer(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function startTimer() {
    callStartTs = Date.now();
    const { timer } = els();
    if (timer) timer.textContent = '00:00';
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      const t = els().timer;
      if (t) t.textContent = fmtTimer(Math.floor((Date.now() - callStartTs) / 1000));
    }, 1000);
  }
  function stopTimer() { if (callTimer) clearInterval(callTimer); callTimer = null; }
  function setStatus(t) { const { status } = els(); if (status) status.textContent = t; }
  function setCallState(s) {
    const { overlay } = els(); if (!overlay) return;
    overlay.classList.toggle('listening', s === 'listening');
    overlay.classList.toggle('speaking', s === 'ai-speaking');
  }
  function showCaption(text, interim) {
    const { transcript } = els(); if (!transcript) return;
    if (!text) { transcript.textContent = ''; transcript.classList.remove('has-text', 'interim'); return; }
    transcript.textContent = text; transcript.classList.add('has-text'); transcript.classList.toggle('interim', !!interim);
  }

  // --- ephemeral token from our server (server Gemini key never leaves backend) ---
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
  async function fetchEphemeralToken() {
    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/gemini-live-token';
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Sign in required for live call');
    if (!r.ok || !data.token) throw new Error(data.error || 'Voice service unavailable');
    return data.token;
  }

  // --- student context for system prompt (best-effort) ---
  async function buildSystemPrompt() {
    let ctx = '';
    try {
      if (typeof db !== 'undefined' && typeof currentUser !== 'undefined' && currentUser?.id) {
        const p = await Promise.race([
          (async () => {
            let s = '';
            try {
              const { data: ac } = await db.from('student_academic_profiles').select('class_level:class_levels(label), group:groups(name)').eq('user_id', currentUser.id).maybeSingle();
              if (ac?.class_level?.label) s += ` Student is in ${ac.class_level.label}${ac?.group?.name ? ' (' + ac.group.name + ')' : ''}.`;
            } catch (_) {}
            try {
              const { data: mem } = await db.from('user_ai_memories').select('fact').eq('user_id', currentUser.id).order('updated_at', { ascending: false }).limit(8);
              if (mem && mem.length) s += ' Known about student: ' + mem.map(m => m.fact).join(' | ');
            } catch (_) {}
            return s;
          })(),
          new Promise(r => setTimeout(() => r(''), 2500)),
        ]);
        ctx = p || '';
      }
    } catch (_) {}
    return `You are Anteemonee, a warm Pakistani study tutor on a live voice call. Help with FSc, matric, biology, chemistry, physics, math. Keep spoken answers SHORT — 1 to 3 sentences unless asked for detail. No filler words, no markdown, no lists unless asked. Speak English, or Roman Urdu if the student uses it. Be encouraging.${ctx ? '\n' + ctx : ''}`;
  }

  // --- audio helpers ---
  function floatTo16PCM(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }
  function b64encode(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function b64decode(b64) {
    const s = atob(b64);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  // resample Float32 mono from→to rate (linear)
  function resample(f32, fromRate, toRate) {
    if (fromRate === toRate) return f32;
    const ratio = fromRate / toRate;
    const len = Math.floor(f32.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, f32.length - 1);
      out[i] = f32[i0] + (f32[i1] - f32[i0]) * (pos - i0);
    }
    return out;
  }

  function queuePlayback(pcm16, sampleRate) {
    if (!audioCtx || !masterGain) return;
    const gen = playGen;
    const f32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
    const rs = resample(f32, sampleRate, audioCtx.sampleRate);
    const buf = audioCtx.createBuffer(1, rs.length, audioCtx.sampleRate);
    buf.getChannelData(0).set(rs);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(masterGain);
    const now = audioCtx.currentTime;
    if (playCursor < now) playCursor = now + 0.02;
    try { src.start(playCursor); } catch (_) { return; }
    playCursor += buf.duration;
    activeSources.push(src);
    src.onended = () => { const i = activeSources.indexOf(src); if (i >= 0) activeSources.splice(i, 1); };
    // safety: drop refs
    if (gen !== playGen) { try { src.stop(); } catch (_) {} }
  }
  function stopPlayback() {
    playGen++;
    playCursor = 0;
    activeSources.slice().forEach(s => { try { s.stop(); } catch (_) {} });
    activeSources = [];
  }

  async function startCall() {
    if (isCallActive) return;
    const { overlay } = els();
    if (!overlay) return;
    overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    isCallActive = true; muted = false; speakerOn = true; sendingMuted = false;
    setupDone = false; userCaption = ''; aiCaption = '';
    setStatus('Connecting…'); showCaption('', false); setCallState('listening');
    startTimer();

    // ephemeral token from our server (no user key needed)
    let token;
    try {
      setStatus('Connecting…');
      token = await fetchEphemeralToken();
    } catch (e) {
      setStatus((e && e.message) || 'Voice unavailable');
      stopTimer();
      setTimeout(endCall, 2500);
      return;
    }

    // mic
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setStatus('Mic permission denied'); stopTimer();
      setTimeout(endCall, 2200);
      return;
    }

    // watchdog
    if (connWatchdog) clearTimeout(connWatchdog);
    connWatchdog = setTimeout(() => {
      if (!isCallActive || setupDone) return;
      setStatus('Connection timed out — try again');
      setTimeout(endCall, 2500);
    }, 25000);

    // audio ctx
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      setStatus('Audio not supported'); setTimeout(endCall, 2200);
      return;
    }

    savedInstructions = await buildSystemPrompt();
    savedToken = token;
    liveModelIdx = 0;
    openSocket();
  }

  let savedToken = '';
  function openSocket() {
    const token = savedToken;
    // socket (ephemeral token as access_token on Constrained endpoint)
    try {
      ws = new WebSocket(WS_URL + '?access_token=' + encodeURIComponent(token));
    } catch (e) {
      setStatus('Could not connect'); setTimeout(endCall, 2200);
      return;
    }
    ws.onopen = () => {
      const setup = {
        setup: {
          model: 'models/' + LIVE_MODELS[liveModelIdx],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          },
          systemInstruction: { parts: [{ text: savedInstructions }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      try { ws.send(JSON.stringify(setup)); } catch (e) { setStatus('Setup failed'); setTimeout(endCall, 2200); }
    };
    ws.onerror = () => {
      if (!setupDone) { setStatus('Connection failed — try again'); if (connWatchdog) clearTimeout(connWatchdog); setTimeout(endCall, 2500); }
    };
    ws.onclose = (ev) => {
      if (!isCallActive) return;
      console.warn('[live] ws closed', ev.code, ev.reason);
      if (!setupDone) {
        const reason = (ev && ev.reason ? String(ev.reason) : '').slice(0, 90);
        if (connWatchdog) clearTimeout(connWatchdog);
        // Model invalid? retry once with fallback model before giving up
        if (/model/i.test(reason) && tryModelFallback()) return;
        setStatus(reason ? 'Failed: ' + reason : 'Connection failed (' + ev.code + ') — try again');
        setTimeout(endCall, 4500);
      } else {
        setStatus('Call ended');
        setTimeout(endCall, 800);
      }
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.setupComplete) {
        setupDone = true;
        if (connWatchdog) clearTimeout(connWatchdog);
        setStatus('On call — speak naturally'); setCallState('listening');
        startCapture();
        return;
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.interrupted) {
        stopPlayback();
        aiCaption = '';
        setCallState('listening'); setStatus('Listening…');
      }
      if (sc.inputTranscription && sc.inputTranscription.text) {
        userCaption = (userCaption ? userCaption + ' ' : '') + sc.inputTranscription.text;
        showCaption(userCaption, true);
        setCallState('listening'); setStatus('Listening…');
      }
      const turn = sc.modelTurn;
      if (turn && turn.parts) {
        for (const p of turn.parts) {
          if (p.inlineData && p.inlineData.data) {
            try {
              const bytes = b64decode(p.inlineData.data);
              const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
              setCallState('ai-speaking'); setStatus('Speaking…');
              queuePlayback(pcm, 24000);
            } catch (_) {}
          }
          if (p.text) {
            aiCaption += p.text;
            showCaption(aiCaption, true);
          }
        }
      }
      if (sc.outputTranscription && sc.outputTranscription.text) {
        aiCaption = (aiCaption ? aiCaption + ' ' : '') + sc.outputTranscription.text;
        showCaption(aiCaption, true);
        setCallState('ai-speaking'); setStatus('Speaking…');
      }
      if (sc.turnComplete) {
        userCaption = ''; aiCaption = '';
        setStatus('On call — speak naturally'); setCallState('listening');
        setTimeout(() => { if (isCallActive && !userCaption && !aiCaption) showCaption('', false); }, 3500);
      }
    };
  }

  function startCapture() {
    if (!audioCtx || !mediaStream || !ws) return;
    try {
      captureSrc = audioCtx.createMediaStreamSource(mediaStream);
      const bufSize = 4096;
      captureNode = audioCtx.createScriptProcessor(bufSize, 1, 1);
      const inRate = audioCtx.sampleRate;
      captureNode.onaudioprocess = (e) => {
        if (!isCallActive || !setupDone || !ws || ws.readyState !== 1 || sendingMuted || muted) return;
        try {
          const ch = e.inputBuffer.getChannelData(0);
          const rs = resample(ch, inRate, 16000);
          const i16 = floatTo16PCM(rs);
          // skip near-silent frames to save quota
          let energy = 0;
          for (let i = 0; i < i16.length; i += 4) energy += Math.abs(i16[i]);
          if (energy / (i16.length / 4) < 60) return;
          const b64 = b64encode(new Uint8Array(i16.buffer));
          ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } }));
        } catch (_) {}
      };
      captureSrc.connect(captureNode);
      // connect to destination via zero-gain to keep Safari/Chrome running
      const zero = audioCtx.createGain(); zero.gain.value = 0;
      captureNode.connect(zero); zero.connect(audioCtx.destination);
    } catch (e) {
      console.warn('[live] capture failed', e);
      setStatus('Mic capture failed');
    }
  }

  function endCall() {
    isCallActive = false;
    if (connWatchdog) { clearTimeout(connWatchdog); connWatchdog = null; }
    sendingMuted = true;
    stopPlayback();
    try { if (ws && ws.readyState <= 1) ws.close(); } catch (_) {}
    ws = null;
    try { if (captureNode) { captureNode.onaudioprocess = null; captureNode.disconnect(); } } catch (_) {}
    try { if (captureSrc) captureSrc.disconnect(); } catch (_) {}
    captureNode = null; captureSrc = null;
    if (mediaStream) { try { mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {} mediaStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; masterGain = null; }
    stopTimer();
    const { overlay } = els();
    if (overlay) { overlay.classList.remove('show', 'listening', 'speaking'); overlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
    setStatus('Connecting…'); setCallState('listening');
  }

  function toggleMute() {
    muted = !muted;
    const { muteBtn } = els();
    if (muteBtn) { muteBtn.classList.toggle('muted', muted); muteBtn.classList.toggle('active', muted); }
    setStatus(muted ? 'Muted' : 'On call — speak naturally');
  }
  function toggleSpeaker() {
    speakerOn = !speakerOn;
    const { speakerBtn } = els();
    if (speakerBtn) speakerBtn.classList.toggle('active', !speakerOn);
    if (masterGain && audioCtx) masterGain.gain.value = speakerOn ? 1 : 0;
  }

  function bindCallButtons() {
    const { muteBtn, speakerBtn, endBtn } = els();
    const closeBtn = document.getElementById('voice-close');
    // voice-chat.js owns the overlay when it is present: its handlers already
    // cover mute/end/close, and binding here as well left stale state behind.
    if (window.AnteemoneeVoice) return;
    if (muteBtn && !muteBtn.dataset.glBound) { muteBtn.dataset.glBound = '1'; muteBtn.addEventListener('click', toggleMute); }
    if (speakerBtn && !speakerBtn.dataset.glBound) { speakerBtn.dataset.glBound = '1'; speakerBtn.addEventListener('click', toggleSpeaker); }
    if (endBtn && !endBtn.dataset.glBound) { endBtn.dataset.glBound = '1'; endBtn.addEventListener('click', endCall); }
    if (closeBtn && !closeBtn.dataset.glBound) { closeBtn.dataset.glBound = '1'; closeBtn.addEventListener('click', endCall); }
    const overlay = document.getElementById('voice-overlay');
    if (overlay && !overlay.dataset.glBgBound) {
      overlay.dataset.glBgBound = '1';
      overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('voice-overlay-bg')) endCall(); });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isCallActive) endCall(); });
  }

  function hookVoiceButton() {
    return; // DISABLED: whisper+TTS path (voice-chat.js) owns the button — no billing needed
    const btn = document.getElementById('btn-voice');
    if (!btn || btn.dataset.glHook) return;
    btn.dataset.glHook = '1';
    btn.addEventListener('click', (e) => {
      const overlay = document.getElementById('voice-overlay');
      const isOpen = overlay && overlay.classList.contains('show');
      if (isOpen && isCallActive) { e.stopImmediatePropagation(); e.preventDefault(); endCall(); return; }
      if (!isOpen) { e.stopImmediatePropagation(); e.preventDefault(); startCall(); }
    }, true);
  }

  function init() { bindCallButtons(); hookVoiceButton(); setTimeout(() => { bindCallButtons(); hookVoiceButton(); }, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setTimeout(init, 1200);

  window.AnteemoneeLiveCall = { start: startCall, end: endCall, get isActive() { return isCallActive; } };
})();
