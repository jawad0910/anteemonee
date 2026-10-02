/**
 * Anteemonee Voice Chat — ChatGPT-style hands-free conversation
 * STT: Groq whisper-large-v3-turbo via Supabase Edge Function `voice-stt`
 * TTS: Gemini 3.1 Flash via `voice-tts`
 *
 * Conversation mode: auto VAD — enter overlay → auto listen → silence auto-stop → send → TTS → auto listen again.
 * No hold-to-talk. Mic button is now mute/unmute + interrupt. Barge-in supported.
 */
(function () {
  'use strict';

  const WHISPER_MODEL = 'whisper-large-v3-turbo';

  // Overlay / phase state
  let isOverlayOpen = false;
  let isListening = false;       // MediaRecorder is recording
  let isTranscribing = false;
  let isPaused = false;          // user tapped to pause conversation
  let isMuted = false;           // user muted mic — tracks disabled
  let conversationActive = false;
  let voicePhase = 'idle';       // 'idle' | 'listening' | 'transcribing' | 'sending' | 'ai-speaking'

  // Whisper path
  let mediaStream = null;        // the raw mic stream shared between VAD + recorder
  let mediaRecorder = null;
  let audioChunks = [];
  let whisperMime = '';
  let interimTimer = null;
  let interimBusy = false;

  // VAD (Voice Activity Detection) — drives hands-free behavior
  let audioCtx = null;
  let analyser = null;
  let vadRAF = null;
  let vadData = null;
  let hasSpeechSinceStart = false;
  let speechFrames = 0;            // consecutive loud frames (debounce noise pops)
  let lastSpeechTime = 0;
  let recordingStartTime = 0;
  let bargeSpeechStart = 0;
  // Tuning — don't clip word edges (clipping = misheard words)
  const VAD_SILENCE_MS = 850;            // stop 0.85s after you finish
  const VAD_MIN_SPEECH_MS = 600;         // require real speech before silence counts
  const VAD_SPEECH_THRESHOLD = 12;
  const VAD_BARGE_THRESHOLD = 24;        // higher = background noise can't cut AI replies
  const VAD_BARGE_HOLD_MS = 260;
  const VAD_MAX_RECORD_MS = 12000;
  const VAD_NO_SPEECH_TIMEOUT_MS = 4500;
  const VAD_IDLE_POLL_MS = 60;

  // TTS state
  let lastVoiceSend = 0;
  let ttsAudio = null;
  let ttsController = null;
  let ttsVoice = 'Kore';
  let localUtterance = null;
  let localTtsQueue = [];
  let localTtsToken = 0;
  let localTtsButton = null;
  const TTS_MAX_CHARS = 4000;
  let noSpeechRestarts = 0;       // count consecutive no-speech restarts
  const MAX_NO_SPEECH_RESTARTS = 3; // stop after 3 restarts

  // --- DOM ---
  let els = {};
  function getEls() {
    if (els.overlay) return els;
    els = {
      overlay: document.getElementById('voice-overlay'),
      status: document.getElementById('voice-status'),
      transcript: document.getElementById('voice-transcript'),
      btnVoice: document.getElementById('btn-voice'),
      btnClose: document.getElementById('voice-close'),
      btnExit: document.getElementById('voice-exit-btn'),
      micBtn: document.getElementById('voice-mic-btn'),
      micLabel: document.getElementById('voice-mic-label'),
      unsupported: document.getElementById('voice-unsupported'),
    };
    return els;
  }

  function supabaseCfg() {
    try {
      if (typeof AiApiService !== 'undefined') {
        const tmp = new AiApiService();
        return { url: tmp.supabaseUrl, anonKey: tmp.supabaseKey };
      }
    } catch (_) {}
    try {
      if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
        return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
      }
    } catch (_) {}
    return { url: 'https://zkuytvjeqkpexcbyoyhz.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44' };
  }

  async function getAuthHeader() {
    const { anonKey } = supabaseCfg();
    try {
      if (typeof db !== 'undefined' && db && db.auth && db.auth.getSession) {
        const { data } = await db.auth.getSession();
        const t = data && data.session && data.session.access_token;
        if (t) return 'Bearer ' + t;
      }
    } catch (_) {}
    return 'Bearer ' + anonKey;
  }

  function pickMime() {
    // Safari: prefer mp4 (native, works best with Groq). Chrome: webm.
    const cand = [
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/aac',
    ];
    for (const m of cand) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  }

  function hasMediaRecorder() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function setStatus(text) {
    const { status } = getEls(); if (!status) return;
    // Only two states shown: Listening… / Speaking… (no error spam)
    status.textContent = /speak/i.test(text || '') ? 'Speaking…' : 'Listening…';
  }
  function setTranscript(text, isInterim) {
    const { transcript } = getEls();
    // route captions into in-call chat bubbles (old box hidden in call UI)
    if (!text) { clearPendingUser(); return; }
    if (isInterim) { upsertPendingUser(text); return; }
    clearPendingUser();
    if (transcript) { transcript.textContent = ''; transcript.classList.remove('has-text', 'interim'); }
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function callMsgs() { return document.getElementById('call-messages'); }
  function stickScroll(box) {
    if (!box) return;
    try { if (box.scrollHeight - box.scrollTop - box.clientHeight < 90) box.scrollTop = box.scrollHeight; } catch (_) {}
  }
  let pendingUserEl = null;
  let aiBubbleEl = null;
  function clearPendingUser() { if (pendingUserEl) { try { pendingUserEl.remove(); } catch (_) {} pendingUserEl = null; } }
  function upsertPendingUser(text) {
    const box = callMsgs(); if (!box) return;
    if (!pendingUserEl) {
      pendingUserEl = document.createElement('div');
      pendingUserEl.className = 'call-msg user pending';
      box.appendChild(pendingUserEl);
    }
    pendingUserEl.textContent = text;
    stickScroll(box);
  }
  function appendUserBubble(text) {
    const box = callMsgs(); if (!box) return;
    clearPendingUser();
    const d = document.createElement('div');
    d.className = 'call-msg user';
    d.textContent = String(text || '');
    box.appendChild(d);
    stickScroll(box);
  }
  function beginAiBubble() {
    const box = callMsgs(); if (!box) return;
    aiBubbleEl = document.createElement('div');
    aiBubbleEl.className = 'call-msg ai pending';
    box.appendChild(aiBubbleEl);
    stickScroll(box);
  }
  function appendAiText(chunk) {
    if (!aiBubbleEl) beginAiBubble();
    if (!aiBubbleEl) return;
    aiBubbleEl.textContent = (aiBubbleEl.textContent || '') + String(chunk || '');
    stickScroll(callMsgs());
  }
  function finalizeAiBubble() {
    if (aiBubbleEl) { aiBubbleEl.classList.remove('pending'); aiBubbleEl = null; }
  }
  function clearCallChat() {
    const box = callMsgs(); if (box) box.innerHTML = '';
    pendingUserEl = null; aiBubbleEl = null;
  }

  function updateMicUI() {
    const { micLabel, overlay, btnVoice, micBtn } = getEls();
    if (micLabel) {
      if (isMuted) micLabel.textContent = 'Muted';
      else if (isPaused) micLabel.textContent = 'Paused';
      else if (voicePhase === 'ai-speaking') micLabel.textContent = 'AI speaking…';
      else if (voicePhase === 'sending') micLabel.textContent = 'Thinking…';
      else if (isTranscribing) micLabel.textContent = 'Transcribing…';
      else micLabel.textContent = 'Listening…';
    }
    if (overlay) {
      overlay.classList.toggle('listening', isListening && !isPaused && !isMuted);
      overlay.classList.toggle('speaking', voicePhase === 'ai-speaking');
      overlay.classList.toggle('paused', !!isPaused || !!isMuted);
    }
    if (btnVoice) btnVoice.classList.toggle('active', !!isOverlayOpen);
    if (micBtn) {
      const busy = voicePhase === 'sending' || voicePhase === 'transcribing';
      micBtn.classList.toggle('disabled', !!busy);
      micBtn.classList.toggle('muted', !!isMuted);
      micBtn.setAttribute('aria-label', isMuted ? 'Unmute mic' : 'Mute mic');
    }
    const callMute = document.getElementById('call-mute-btn');
    if (callMute) callMute.classList.toggle('muted', !!isMuted);
  }

  // --- VAD helpers ---
  function getVolume() {
    if (!analyser || !vadData) return 0;
    analyser.getByteTimeDomainData(vadData);
    let sum = 0;
    for (let i = 0; i < vadData.length; i++) {
      const v = vadData[i] - 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / vadData.length);
    // scale 0-128 → 0-100 (gain tuned so threshold 18 ≈ normal speaking voice)
    return (rms / 128) * 100 * 1.2;
  }

  function ensureVADStream() {
    // kept for symmetry — actual stream is created in ensureMicAndVAD
  }

  async function ensureMicAndVAD() {
    if (mediaStream && audioCtx && analyser) return true;
    try {
      if (!mediaStream) {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,   // keep raw audio for better whisper accuracy
            autoGainControl: true,
            sampleRate: 48000,
          },
        });
      }
    } catch (e) {
      setStatus('Mic permission denied — allow microphone');
      const { unsupported } = getEls();
      if (unsupported) { unsupported.style.display = 'block'; unsupported.textContent = 'Mic blocked. Allow microphone in Safari → Settings → Websites → Microphone.'; }
      return false;
    }
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (_) {} }
      if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.35;
        vadData = new Uint8Array(analyser.fftSize);
        const src = audioCtx.createMediaStreamSource(mediaStream);
        src.connect(analyser);
      }
    } catch (e) {
      console.warn('[voice] AudioContext failed', e);
      // still allow recording without VAD
    }
    if (!vadRAF) startVADLoop();
    return true;
  }

  function startVADLoop() {
    if (vadRAF) return;
    const tick = () => {
      vadRAF = requestAnimationFrame(tick);
      if (!isOverlayOpen || !conversationActive) return;

      const vol = getVolume();

      // --- Barge-in: AI is speaking, user starts talking → interrupt TTS ---
      if (voicePhase === 'ai-speaking' && !isPaused) {
        if (vol > VAD_BARGE_THRESHOLD) {
          if (!bargeSpeechStart) bargeSpeechStart = Date.now();
          if (Date.now() - bargeSpeechStart > VAD_BARGE_HOLD_MS) {
            bargeSpeechStart = 0;
            // Interrupt AI and start listening immediately
            stopSpeaking();
            // small delay to avoid picking up tail of TTS
            setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 220);
          }
        } else {
          bargeSpeechStart = 0;
        }
        return;
      }

      // --- Auto-stop: we are recording, wait for speech then silence ---
      if (isListening && !isPaused && mediaRecorder && mediaRecorder.state === 'recording') {
        const now = Date.now();
        const elapsed = now - recordingStartTime;

        // Max duration safety
        if (elapsed > VAD_MAX_RECORD_MS) {
          stopWhisperCapture();
          return;
        }

        // Debug: log volume every second
        if (Math.floor(elapsed / 1000) > Math.floor((elapsed - VAD_IDLE_POLL_MS) / 1000)) {
          console.log('[voice] vol:', vol.toFixed(1), 'threshold:', VAD_SPEECH_THRESHOLD, 'speech:', hasSpeechSinceStart, 'elapsed:', Math.round(elapsed / 1000) + 's');
        }

        if (vol > VAD_SPEECH_THRESHOLD) {
          speechFrames++;
          // Require ~120ms of CONTINUOUS loud audio before it counts as speech
          // (single noise pops don't trigger, real voice passes easily)
          if (!hasSpeechSinceStart && speechFrames >= 2) {
            hasSpeechSinceStart = true;
          }
          lastSpeechTime = now;
        } else {
          speechFrames = 0;
        }

        // Only auto-stop after we have heard some speech
        if (hasSpeechSinceStart) {
          const silence = now - lastSpeechTime;
          // Require at least MIN_SPEECH before silence counts (avoid cutting off short utterance)
          const speechDuration = lastSpeechTime - recordingStartTime;
          if (silence > VAD_SILENCE_MS && speechDuration > VAD_MIN_SPEECH_MS) {
            stopWhisperCapture();
          }
        } else {
          // No speech yet — stop after timeout so we don't record forever
          if (elapsed > VAD_NO_SPEECH_TIMEOUT_MS) {
            stopWhisperCapture();
          }
        }
      }
    };
    tick();
  }

  function stopVADLoop() {
    if (vadRAF) { try { cancelAnimationFrame(vadRAF); } catch (_) {} vadRAF = null; }
  }

  function teardownMic() {
    if (interimTimer) { clearInterval(interimTimer); interimTimer = null; }
    interimBusy = false;
    stopVADLoop();
    bargeSpeechStart = 0;
    hasSpeechSinceStart = false;
    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null; analyser = null; vadData = null;
    }
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      mediaStream = null;
    }
    // also stop any stray recorder
    if (mediaRecorder) {
      try { if (mediaRecorder.state === 'recording') { mediaRecorder.onstop = null; mediaRecorder.stop(); } } catch (_) {}
      mediaRecorder = null;
    }
    audioChunks = [];
  }

  // --- Overlay open / close (conversation lifecycle) ---
  let voiceMark = 0;
  function voiceEphemeralOn() {
    try { window.__voiceEphemeral = true; } catch (_) {}
    try { voiceMark = (window.AnteemoneeVoiceStore && window.AnteemoneeVoiceStore.mark()) || 0; } catch (_) { voiceMark = 0; }
  }
  function voiceEphemeralOff() {
    try { window.__voiceEphemeral = false; } catch (_) {}
    try { if (window.AnteemoneeVoiceStore) window.AnteemoneeVoiceStore.rewind(voiceMark); } catch (_) {}
    voiceMark = 0;
  }
  async function openVoice() {
    const { overlay, unsupported } = getEls(); if (!overlay) return;
    const canWhisper = hasMediaRecorder();
    if (!canWhisper && unsupported) {
      unsupported.style.display = 'block'; unsupported.textContent = 'Mic not supported in this browser. Use Chrome or Safari 16+ and allow microphone.';
    } else if (unsupported) unsupported.style.display = 'none';

    overlay.classList.add('show'); overlay.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
    voiceEphemeralOn(); // call chats stay out of history + database
    isOverlayOpen = true; conversationActive = true; isPaused = false; isMuted = false;
    voicePhase = 'idle'; isListening = false; isTranscribing = false;
    noSpeechRestarts = 0;
    try { clearCallChat(); } catch (_) {}
    setTranscript('', false);
    setStatus('Starting…');
    updateMicUI();

    const ok = await ensureMicAndVAD();
    if (!ok) { setStatus('Mic unavailable'); updateMicUI(); return; }
    // Small delay lets AudioContext settle and avoids picking up click
    setTimeout(() => {
      if (!isOverlayOpen || !conversationActive) return;
      setStatus('Listening… just speak');
      startAutoListening();
    }, 320);
  }

  function closeVoice() {
    const { overlay } = getEls();
    conversationActive = false;
    isPaused = false;
    // Stop recording without sending
    if (isListening) {
      try { if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.onstop = null; mediaRecorder.stop(); } } catch (_) {}
    }
    isListening = false; isTranscribing = false;
    stopSpeaking();
    teardownMic();
    try { finalizeAiBubble(); clearPendingUser(); } catch (_) {}
    voiceEphemeralOff(); // drop call turns, restore chat view
    try { clearCallChat(); } catch (_) {}
    if (overlay) { overlay.classList.remove('show','listening','speaking','paused'); overlay.setAttribute('aria-hidden','true'); }
    document.body.style.overflow='';
    isOverlayOpen=false; voicePhase='idle'; updateMicUI();
    if (getEls().btnVoice) getEls().btnVoice.classList.remove('active');
  }

  // --- Whisper: MediaRecorder → Groq ---
  // Known whisper noise-hallucinations: never send these to chat
  const WHISPER_JUNK = [
    'thank you', 'thanks for watching', 'thanks for listening', 'subscribe',
    'subtitles by', 'transcription by', 'bye', 'hello?', '...', 'caption',
    ' produced ', ' rev ', 'www.', '.com',
  ];
  function isWhisperHallucination(text) {
    const t = String(text || '').trim().toLowerCase().replace(/[.!?…\s]+$/g, '');
    if (!t || t.length < 3) return true;
    return WHISPER_JUNK.some(j => t === j || (t.length < 24 && t.includes(j)));
  }
  function getExtensionForMime(mime) {
    if (!mime) return 'webm';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('aac')) return 'm4a';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('wav')) return 'wav';
    return 'webm';
  }

  async function transcribeWithWhisper(blob) {
    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const ext = getExtensionForMime(blob.type || whisperMime);
    const fd = new FormData();
    fd.append('file', blob, `voice.${ext}`);
    fd.append('model', WHISPER_MODEL);
    fd.append('language', 'auto'); // auto-detect: handles Roman Urdu + English mix
    fd.append('prompt', 'Biology chemistry physics enzymes protein DNA cell photosynthesis exam homework study Anteemonee Pakistani student Urdu English');
    fd.append('response_format', 'json');
    fd.append('temperature', '0');

    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-stt';
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': auth }, body: fd });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      if (res.status === 404) throw new Error('voice-stt edge function not deployed — run supabase functions deploy voice-stt');
      let msg = detail;
      try { const j = JSON.parse(detail); msg = j.error || j.message || detail; } catch (_) {}
      throw new Error(`Whisper error ${res.status}: ${String(msg).slice(0,300)}`);
    }
    const data = await res.json();
    const text = (data && (data.text || data.transcript || data.data)) || '';
    if (!text || !String(text).trim()) throw new Error('Empty transcription');
    return String(text).trim();
  }

  function startAutoListening() {
    if (!isOverlayOpen || !conversationActive || isPaused) return;
    if (isListening || isTranscribing || voicePhase === 'sending' || voicePhase === 'ai-speaking') return;
    if (!hasMediaRecorder()) { setStatus('Mic not supported'); return; }
    startWhisperCaptureAuto();
  }

  async function startWhisperCaptureAuto() {
    if (isListening) return;
    // Ensure mic/VAD already set up; reuse mediaStream
    if (!mediaStream) {
      const ok = await ensureMicAndVAD();
      if (!ok) return;
    }
    whisperMime = pickMime();
    audioChunks = [];
    hasSpeechSinceStart = false; speechFrames = 0;
    lastSpeechTime = Date.now();
    recordingStartTime = Date.now();
    bargeSpeechStart = 0;

    console.log('[voice] starting capture, mime:', whisperMime, 'stream tracks:', mediaStream.getTracks().map(t => t.kind + ':' + t.enabled).join(', '));

    // Reuse existing micStream; do not call getUserMedia again (keeps VAD alive)
    try {
      const opts = whisperMime ? { mimeType: whisperMime } : undefined;
      mediaRecorder = new MediaRecorder(mediaStream, opts);
    } catch (e) {
      try { mediaRecorder = new MediaRecorder(mediaStream); } catch (e2) {
        console.warn('[voice] MediaRecorder failed', e2);
        setStatus('Mic not supported');
        return;
      }
    }
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) { audioChunks.push(e.data); if (audioChunks.length <= 3) console.log('[voice] chunk:', e.data.size, 'total chunks:', audioChunks.length); } };
    mediaRecorder.onstart = () => {
      isListening = true; voicePhase = 'listening'; setTranscript('', false); setStatus('Listening…'); updateMicUI();
      console.log('[voice] recorder started, tracks:', mediaStream.getTracks().map(t => t.kind + ':' + t.enabled + ':' + t.readyState).join(', '));
      // Live interim: every 1.2s whisper a snapshot so text appears as you speak
      if (interimTimer) clearInterval(interimTimer);
      interimTimer = setInterval(async () => {
        if (!isListening || isTranscribing || interimBusy || !hasSpeechSinceStart || audioChunks.length === 0) return;
        // need at least ~1.5s of audio
        const snapBlob = new Blob(audioChunks.slice(), { type: whisperMime || 'audio/webm' });
        if (snapBlob.size < 5000) return;
        interimBusy = true;
        try {
          const txt = await transcribeWithWhisper(snapBlob);
          if (txt && isListening && !isTranscribing) setTranscript(txt, true);
        } catch (_) {} finally { interimBusy = false; }
      }, 1200);
    };
    mediaRecorder.onstop = async () => {
      if (interimTimer) { clearInterval(interimTimer); interimTimer = null; }
      interimBusy = false;
      isListening = false; updateMicUI();
      // If conversation was paused or closed while recording, discard
      if (!isOverlayOpen || !conversationActive || isPaused) {
        audioChunks = [];
        // go idle, don't loop
        voicePhase = 'idle';
        setStatus('Paused — tap to resume');
        updateMicUI();
        return;
      }
      const blob = new Blob(audioChunks, { type: whisperMime || 'audio/webm' });
      audioChunks = [];
      console.log('[voice] blob size:', blob.size, 'hasSpeech:', hasSpeechSinceStart, 'mime:', whisperMime);
      if (!blob || blob.size < 4000 || !hasSpeechSinceStart) {
        // Too small or no real speech — discard, don't send to whisper (prevents hallucinations)
        voicePhase = 'idle'; updateMicUI();
        if (!hasSpeechSinceStart) console.log('[voice] discarded blob — no speech detected');
        noSpeechRestarts++;
        if (noSpeechRestarts >= MAX_NO_SPEECH_RESTARTS) {
          setStatus('No speech detected — speak louder or check mic');
          noSpeechRestarts = 0;
        } else {
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 350);
        }
        return;
      }
      // Got a real speech recording — transcribe
      noSpeechRestarts = 0;
      isTranscribing = true; voicePhase = 'transcribing'; setStatus('Heard you — thinking…'); setTranscript('…', true); updateMicUI();
      try {
        console.log('[voice] calling whisper, blob size:', blob.size, 'type:', blob.type);
        const text = await transcribeWithWhisper(blob);
        console.log('[voice] whisper result:', JSON.stringify(text));
        if (isWhisperHallucination(text)) {
          console.log('[voice] discarded whisper hallucination');
          isTranscribing = false; voicePhase = 'idle'; updateMicUI();
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 350);
          return;
        }
        isTranscribing = false; setTranscript(text, false); setStatus('Got it — answering…'); updateMicUI();
        // Hand off to chat
        setTimeout(()=> sendTranscript(text), 160);
      } catch (e) {
        isTranscribing = false; voicePhase = 'idle'; updateMicUI();
        const msg = (e && e.message) || 'transcription failed';
        console.warn('[voice] whisper failed:', msg);
        console.warn('[voice] whisper error:', msg);
        setStatus('Transcription failed: ' + msg.slice(0, 60));
      }
    };
    try { mediaRecorder.start(100); } catch (e) {
      isListening = false; updateMicUI();
      console.warn('[voice] recorder start failed', e);
    }
  }

  function stopWhisperCapture() {
    if (interimTimer) { clearInterval(interimTimer); interimTimer = null; }
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch (_) {}
    }
  }

  // Unified stop (for pause / close)
  function stopListening() {
    if (isTranscribing) return;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.onstop = () => { isListening=false; audioChunks=[]; updateMicUI(); }; mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
    isListening = false; updateMicUI();
  }

  function pauseConversation() {
    if (isPaused) return;
    isPaused = true;
    bargeSpeechStart = 0;
    // Abort current recording without sending
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.onstop = () => { isListening=false; audioChunks=[]; updateMicUI(); }; mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null; isListening = false;
    }
    isListening = false; isTranscribing = false;
    // Keep voicePhase idle but show paused state
    if (voicePhase !== 'ai-speaking') voicePhase = 'idle';
    setStatus('Paused — tap to resume');
    updateMicUI();
  }

  function resumeConversation() {
    if (!isOverlayOpen || !conversationActive) return;
    isPaused = false;
    bargeSpeechStart = 0;
    if (voicePhase === 'ai-speaking') {
      // let TTS finish, then auto will resume
      setStatus('Speaking… tap to interrupt');
      updateMicUI();
      return;
    }
    voicePhase = 'idle';
    setStatus('Listening…');
    updateMicUI();
    // Ensure mic/VAD still alive (stream may have ended)
    if (!mediaStream || mediaStream.getTracks().every(t => t.readyState === 'ended')) {
      teardownMic();
      ensureMicAndVAD().then(ok => { if (ok) setTimeout(startAutoListening, 300); });
    } else {
      setTimeout(startAutoListening, 220);
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (mediaStream) {
      mediaStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    }
    if (isMuted) {
      setStatus('Muted');
    } else {
      setStatus(isListening ? 'Listening…' : 'Listening… just speak');
    }
    updateMicUI();
  }

  // --- TTS: Gemini 3.1 Flash TTS via Edge Function ---
  const TTS_VOICES = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Umbriel'];
  function ttsVoiceUid() { try { if (typeof currentUser !== 'undefined' && currentUser?.id) return currentUser.id; } catch (_) {} return 'anon'; }
  function getTtsVoice() {
    try { const v = localStorage.getItem('Anteemonee_tts_voice_' + ttsVoiceUid()); if (v && TTS_VOICES.includes(v)) return v; } catch (_) {}
    return ttsVoice;
  }
  function removeEmojisForTTS(text) {
    var value = String(text || '');
    try {
      var emojiPattern = new RegExp('(?:\\p{Extended_Pictographic}|\\p{Emoji_Presentation})', 'gu');
      return value.replace(emojiPattern, '').replace(/[\uFE0F\u200D\u20E3\u2713\u2714\u2717\u2718]/g, '').replace(/[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, '');
    } catch (_) {
      return value.replace(/[\u231A-\u231B\u2328\u23CF-\u23FA\u24C2-\u24FF\u25AA-\u27BF\u2B00-\u2BFF\u3030\u303D\u3297\u3299\uFE0F\u200D\u20E3\u2713\u2714\u2717\u2718]/g, '').replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, function(pair) {
        var code = ((pair.charCodeAt(0) - 0xD800) * 0x400) + pair.charCodeAt(1) - 0xDC00 + 0x10000;
        if ((code >= 0x1F000 && code <= 0x1FAFF) || (code >= 0x1FC00 && code <= 0x1FFFD)) return '';
        return pair;
      });
    }
  }

  function stripForTTS(text) {
    let t = String(text || '');
    t = t.replace(/```[\s\S]*?```/g, ' code omitted. ');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/https?:\/\/\S+/g, '');
    // speak symbols as words (study content clarity)
    const symMap = { '→': ' gives ', '←': ' comes from ', '↔': ' is in equilibrium with ', '×': ' times ', '÷': ' divided by ', '±': ' plus or minus ', '√': ' square root of ', 'π': ' pi ', '°': ' degrees ', '²': ' squared ', '³': ' cubed ', '≈': ' is approximately ', '≠': ' is not equal to ', '≤': ' is less than or equal to ', '≥': ' is greater than or equal to ', '∞': ' infinity ', 'Δ': ' delta ', 'µ': ' micro ', 'Ω': ' ohm ', '&': ' and ', '%': ' percent ', '@': ' at ', '#': ' number ', 'H2O': 'H two O', 'CO2': 'C O two ' };
    for (const k in symMap) t = t.split(k).join(symMap[k]);
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(\*|_)(.*?)\1/g, '$2');
    t = t.replace(/^[-*+]\s+/gm, '');
    t = t.replace(/^\|.*\|$/gm, '');
    t = t.replace(/^---$/gm, '');
    t = t.replace(/^>\s+/gm, '');
    t = t.replace(/\n---[\s\S]*$/i, '');
    t = t.replace(/\n\*\*References?:\*\*[\s\S]*$/i, '');
    t = t.replace(/\nReferences:[\s\S]*$/i, '');
    t = removeEmojisForTTS(t).replace(/[ \t]{2,}/g, ' ');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    t = t.replace(/([.!?])\s*(?=[A-Z])/g, '$1 ');
    if (t.length > TTS_MAX_CHARS) t = t.slice(0, TTS_MAX_CHARS) + '…';
    return t;
  }

  function setAllTtsButtonState(playing) {
    document.querySelectorAll('.tts-btn').forEach(function(button) {
      button.classList.toggle('tts-playing', playing);
      button.setAttribute('aria-pressed', playing ? 'true' : 'false');
      button.title = playing ? 'Stop reading' : 'Listen to response';
    });
  }

  function setLocalTtsButtonState(button, playing) {
    if (playing && button) setAllTtsButtonState(false);
    var buttons = button ? [button] : Array.prototype.slice.call(document.querySelectorAll('.tts-btn'));
    buttons.forEach(function(item) {
      if (!item) return;
      item.classList.toggle('tts-playing', playing);
      item.setAttribute('aria-pressed', playing ? 'true' : 'false');
      item.title = playing ? 'Stop reading' : 'Listen to response';
    });
  }

  function getLocalSpeechLanguage(text) {
    var value = String(text || '');
    if (/[\u0600-\u06FF]/.test(value)) return 'ur-PK';
    var pageLanguage = '';
    try { pageLanguage = document.documentElement.lang || ''; } catch (_) {}
    var browserLanguage = '';
    try { browserLanguage = navigator.language || ''; } catch (_) {}
    var language = pageLanguage || browserLanguage || 'en-US';
    return /^ur\b/i.test(language) ? 'ur-PK' : language;
  }

  function getLocalSpeechVoice(language) {
    try {
      var synth = window.speechSynthesis;
      var voices = synth && synth.getVoices ? synth.getVoices() : [];
      if (!voices || !voices.length) return null;
      var localVoices = voices.filter(function(voice) { return voice.localService === true; });
      if (!localVoices.length) return null;
      var target = String(language || '').toLowerCase();
      var base = target.split('-')[0];
      return localVoices.find(function(voice) {
        return voice.lang && voice.lang.toLowerCase() === target;
      }) || localVoices.find(function(voice) {
        return voice.lang && voice.lang.toLowerCase().split('-')[0] === base;
      }) || null;
    } catch (_) { return null; }
  }

  function splitLocalSpeechText(text) {
    var parts = String(text || '').match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [String(text || '')];
    var chunks = [];
    function addWords(value) {
      var words = String(value || '').trim().split(/\s+/).filter(Boolean);
      var current = '';
      words.forEach(function(word) {
        if (current && (current.length + word.length + 1) > 240) {
          chunks.push(current);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      });
      if (current) chunks.push(current);
    }
    parts.forEach(addWords);
    return chunks;
  }

  function speakLocal(text, button) {
    var clean = stripForTTS(text);
    if (!clean) return false;
    stopSpeaking();
    var synth = window.speechSynthesis;
    var Utterance = window.SpeechSynthesisUtterance || (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
    if (!synth || !Utterance) return false;
    var chunks = splitLocalSpeechText(clean);
    if (!chunks.length) return false;
    var language = getLocalSpeechLanguage(clean);
    var voice = getLocalSpeechVoice(language);
    var token = localTtsToken;
    localTtsQueue = chunks.slice();
    localTtsButton = button || null;
    setLocalTtsButtonState(button, true);

    function finish() {
      if (token !== localTtsToken) return;
      localTtsToken++;
      localUtterance = null;
      localTtsQueue = [];
      localTtsButton = null;
      setLocalTtsButtonState(button, false);
    }

    function speakNext() {
      if (token !== localTtsToken) return;
      var chunk = localTtsQueue.shift();
      if (!chunk) {
        finish();
        return;
      }
      var utterance = new Utterance(chunk);
      utterance.lang = language;
      utterance.rate = 1.03;
      utterance.pitch = 1;
      utterance.volume = 1;
      if (voice) utterance.voice = voice;
      localUtterance = utterance;
      utterance.onstart = function() {
        if (token === localTtsToken) setLocalTtsButtonState(button, true);
      };
      utterance.onend = function() {
        if (localUtterance === utterance) localUtterance = null;
        speakNext();
      };
      utterance.onerror = finish;
      try {
        if (synth.resume) synth.resume();
        synth.speak(utterance);
      } catch (_) { finish(); }
    }

    speakNext();
    return true;
  }

  async function speakText(text, voice) {
    const clean = stripForTTS(text);
    if (!clean) return;
    stopSpeaking();
    const useVoice = voice || getTtsVoice();

    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-tts';

    ttsController = new AbortController();
    voicePhase = 'ai-speaking';
    setStatus('Speaking…');
    updateMicUI();
    setAllTtsButtonState(true);

    // While TTS is playing, VAD stays running for barge-in (handled in vadLoop)
    // Pause auto-listening recorder but keep mic stream alive
    if (isListening) stopListening();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, voice: useVoice }),
        signal: ttsController.signal,
      });

      if (!res.ok) {
        let detail = '';
        try { detail = await res.text(); } catch (_) {}
        if (res.status === 404) throw new Error('voice-tts edge not deployed');
        throw new Error(`TTS ${res.status}: ${detail.slice(0, 200)}`);
      }

      const contentType = res.headers.get('content-type') || '';

      const onPlaybackEnd = () => {
        ttsAudio = null;
        setAllTtsButtonState(false);
        if (!isOverlayOpen || !conversationActive || isPaused) {
          voicePhase = 'idle';
          setStatus(isPaused ? 'Paused — tap to resume' : 'Tap mic to resume');
          updateMicUI();
          return;
        }
        voicePhase = 'idle';
        setStatus('Listening…');
        updateMicUI();
        // Auto-resume conversation loop
        setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 520);
      };

      const onPlaybackError = () => {
        ttsAudio = null;
        setAllTtsButtonState(false);
        voicePhase = 'idle';
        setStatus(isPaused ? 'Paused — tap to resume' : 'Playback error — listening…');
        updateMicUI();
        if (conversationActive && !isPaused && isOverlayOpen) setTimeout(startAutoListening, 700);
      };

      if (contentType.includes('audio/')) {
        const audioBlob = await res.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        ttsAudio = new Audio(audioUrl);
        ttsAudio.onended = () => { try { URL.revokeObjectURL(audioUrl); } catch (_) {} onPlaybackEnd(); };
        ttsAudio.onerror = () => { try { URL.revokeObjectURL(audioUrl); } catch (_) {} onPlaybackError(); };
        await ttsAudio.play();
      } else {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const wavBase64 = data.audio;
        if (!wavBase64) throw new Error('No audio returned');
        const audioSrc = 'data:audio/wav;base64,' + wavBase64;
        ttsAudio = new Audio(audioSrc);
        ttsAudio.onended = onPlaybackEnd;
        ttsAudio.onerror = onPlaybackError;
        await ttsAudio.play();
      }

    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('[voice] TTS failed:', e.message || e);
      setAllTtsButtonState(false);
      voicePhase = 'idle';
      setStatus(isPaused ? 'Paused — tap to resume' : 'TTS unavailable — listening…');
      updateMicUI();
      // keep conversation going even if TTS fails
      if (conversationActive && !isPaused && isOverlayOpen) setTimeout(startAutoListening, 700);
      try {
        if (window.speechSynthesis) {
          const utter = new SpeechSynthesisUtterance(clean);
          utter.lang = getLocalSpeechLanguage(clean);
          var localVoice = getLocalSpeechVoice(utter.lang);
          if (localVoice) utter.voice = localVoice;
          utter.rate = 1.0;
          utter.onend = () => { if (conversationActive && !isPaused && isOverlayOpen) setTimeout(startAutoListening, 400); };
          window.speechSynthesis.speak(utter);
        }
      } catch (_) {}
    } finally {
      ttsController = null;
    }
  }

  function stopSpeaking() {
    if (ttsAudio) {
      try { ttsAudio.pause(); ttsAudio.src = ''; } catch (_) {}
      ttsAudio = null;
    }
    if (progAudio) {
      try { progAudio.pause(); progAudio.src = ''; } catch (_) {}
      progAudio = null;
    }
    progPlaying = false; progQueue = [];
    if (ttsController) {
      try { ttsController.abort(); } catch (_) {}
      ttsController = null;
    }
    localTtsToken++;
    localUtterance = null;
    localTtsQueue = [];
    localTtsButton = null;
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    setAllTtsButtonState(false);
    if (voicePhase === 'ai-speaking') {
      voicePhase = 'idle';
      // Don't auto-set status here — caller decides (barge-in vs close vs manual stop)
      if (isOverlayOpen && conversationActive && !isPaused) {
        setStatus('Listening…');
      }
      updateMicUI();
    }
  }

  function isSpeaking() {
    return !!(ttsAudio && !ttsAudio.paused) || !!(progAudio && !progAudio.paused) || !!ttsController || !!localUtterance || localTtsQueue.length > 0 || !!(window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending));
  }

  // --- Progressive speech: speak sentences WHILE the brain streams (low latency) ---
  let progBuf = '';
  let progQueue = [];
  let progPlaying = false;
  let progStreamDone = false;
  let progTurn = false;      // true once this turn spoke progressively
  let progPlayed = false;    // true once any progressive audio actually started
  let progFails = 0;
  let progAudio = null;
  let speakerOff = false;    // call UI speaker toggle — read captions, no audio
  let streamWrapped = false;

  function pullSentences() {
    const out = [];
    const re = /[\s\S]+?[.!?…](?=\s|$)/g;
    let m;
    while ((m = re.exec(progBuf))) { const s = (m[0] || '').trim(); if (s.length > 1) out.push(s); }
    if (out.length) progBuf = progBuf.slice(re.lastIndex);
    return out;
  }
  function tapChunk(c) {
    if (typeof c !== 'string' || !c) return;
    const t = c.trim();
    if (t.startsWith('{') || t.startsWith('data:')) {
      try { const j = JSON.parse(t.startsWith('data:') ? t.slice(5).trim() : t); if (j && (j.type === 'streak' || j.error)) return; }
      catch (_) { /* not JSON — treat as content */ }
    }
    try { appendAiText(c); } catch (_) {}
    progBuf += c;
    if (progBuf.length > 3000) progBuf = progBuf.slice(-3000);
    pullSentences().forEach(enqueueSentence);
  }
  function beginProgTurn() {
    try { finalizeAiBubble(); beginAiBubble(); } catch (_) {}
    progBuf = ''; progQueue = []; progPlaying = false; progStreamDone = false; progTurn = false; progPlayed = false; progFails = 0;
    if (progAudio) { try { progAudio.pause(); progAudio.src = ''; } catch (_) {} progAudio = null; }
  }
  function endProgTurn() {
    try { finalizeAiBubble(); } catch (_) {}
    pullSentences().forEach(enqueueSentence);
    const rest = progBuf.trim();
    progBuf = '';
    if (rest.length > 1) enqueueSentence(rest);
    progStreamDone = true;
    pumpProg();
  }
  async function ttsFetchSrc(clean) {
    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-tts';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, voice: getTtsVoice() }),
    });
    if (!res.ok) throw new Error('TTS ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('audio/')) {
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      return { src: u, cleanup: () => { try { URL.revokeObjectURL(u); } catch (_) {} } };
    }
    const data = await res.json();
    if (data.error || !data.audio) throw new Error(data.error || 'No audio');
    return { src: 'data:audio/wav;base64,' + data.audio, cleanup: () => {} };
  }
  function enqueueSentence(s) {
    const clean = stripForTTS(s);
    if (!clean) return;
    progTurn = true;
    progQueue.push(clean);
    if (voicePhase !== 'ai-speaking') { voicePhase = 'ai-speaking'; setStatus('Speaking…'); updateMicUI(); }
    if (isListening) stopListening();
    pumpProg();
  }
  function pumpProg() {
    if (progPlaying) return;
    const next = progQueue.shift();
    if (!next) {
      if (progStreamDone && progTurn) {
        progTurn = false;
        voicePhase = 'idle'; setStatus('Listening…'); updateMicUI();
        if (conversationActive && !isPaused && isOverlayOpen) setTimeout(startAutoListening, 350);
      }
      return;
    }
    if (speakerOff || !isOverlayOpen || !conversationActive || isPaused) { pumpProg(); return; }
    progPlaying = true;
    ttsFetchSrc(next).then(({ src, cleanup }) => {
      if (!progPlaying || !isOverlayOpen || !conversationActive || isPaused) { cleanup(); progPlaying = false; return; }
      const a = new Audio(src);
      progAudio = a;
      progFails = 0;
      a.onended = () => { cleanup(); progAudio = null; progPlaying = false; pumpProg(); };
      a.onerror = () => { cleanup(); progAudio = null; progPlaying = false; pumpProg(); };
      a.play().then(() => { progPlayed = true; }).catch(() => { cleanup(); progAudio = null; progPlaying = false; pumpProg(); });
    }).catch((e) => {
      progPlaying = false;
      progFails++;
      if (progFails === 2) { setStatus('Voice reply failing — speaking at end'); console.warn('[voice] prog TTS failing:', e && e.message); }
      pumpProg();
    });
  }
  function wrapStream() {
    if (streamWrapped) return; streamWrapped = true;
    try {
      if (typeof AiApiService === 'undefined' || !AiApiService.prototype.streamChat) return;
      const orig = AiApiService.prototype.streamChat;
      AiApiService.prototype.streamChat = function (messages, providerIndex, images) {
        const self = this;
        let live = false;
        try { live = isOverlayOpen && conversationActive && !isPaused; } catch (_) { live = false; }
        if (!live) return orig.call(self, messages, providerIndex, images);
        try { beginProgTurn(); } catch (_) {}
        let gen;
        try { gen = orig.call(self, messages, providerIndex, images); }
        catch (e) { throw e; }
        return (async function *() {
          try { for await (const ch of gen) { try { tapChunk(ch); } catch (_) {} yield ch; } }
          finally { try { endProgTurn(); } catch (_) {} }
        })();
      };
    } catch (_) {}
  }
  function micAction() {
    if (voicePhase === 'ai-speaking') { stopSpeaking(); if (conversationActive && !isPaused) setTimeout(startAutoListening, 260); return; }
    if (voicePhase === 'sending' || voicePhase === 'transcribing') return;
    if (isMuted) { toggleMute(); return; }
    if (!isListening && !isPaused) { noSpeechRestarts = 0; startAutoListening(); return; }
    toggleMute();
  }

  /** Call from ai-chatbot.js after AI response finishes streaming */
  function onAiResponseComplete(text) {
    const elapsed = Date.now() - lastVoiceSend;
    if (elapsed < 30000 && elapsed >= 0) {
      lastVoiceSend = 0;
      if ((progTurn || progQueue.length || progPlaying) && progPlayed) { pumpProg(); return; } // already speaking progressively
      progTurn = false; progQueue = []; progPlaying = false; progStreamDone = true;
      speakText(text); // full fallback (also covers broken progressive path)
    } else if (conversationActive && isOverlayOpen && !isPaused) {
      // Edge case: AI responded but voice flag expired — still resume listening for conversation mode
      voicePhase = 'idle';
      setStatus('Listening…');
      updateMicUI();
      setTimeout(startAutoListening, 400);
    }
  }

  function toggleSpeak(text, button) {
    if (isSpeaking()) {
      stopSpeaking();
      return;
    }
    speakLocal(text, button);
  }

  function sendTranscript(text) {
    const t = String(text || '').trim();
    if (!t) return;
    voicePhase = 'sending';
    try { appendUserBubble(t); } catch (_) {}
    setTranscript(t, false);
    setStatus('Thinking…');
    updateMicUI();
    lastVoiceSend = Date.now();
    // Pause VAD recorder while waiting for AI (VAD loop will ignore listening during sending)
    const input = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send');
    if (input) {
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (btnSend) btnSend.disabled = false;
      setTimeout(() => {
        if (btnSend && !btnSend.disabled) btnSend.click();
        else {
          const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          input.dispatchEvent(ev);
        }
        // If send didn't go through (e.g., auth), resume listening after a bit
        setTimeout(() => {
          if (voicePhase === 'sending' && isOverlayOpen && conversationActive) {
            voicePhase = 'idle';
            setStatus('Listening…');
            updateMicUI();
            if (!isPaused) setTimeout(startAutoListening, 400);
          }
        }, 4200);
      }, 80);
    }
  }

  function bindEvents(){
    const elsNow=getEls(); if(!elsNow.btnVoice || elsNow.btnVoice.dataset.voiceBound) return; elsNow.btnVoice.dataset.voiceBound='1';
    elsNow.btnVoice.addEventListener('click', ()=>{ if(isOverlayOpen) closeVoice(); else openVoice(); });
    if(elsNow.btnClose) elsNow.btnClose.addEventListener('click', closeVoice);
    if(elsNow.btnExit) elsNow.btnExit.addEventListener('click', closeVoice);
    if(elsNow.overlay) elsNow.overlay.addEventListener('click', (e)=>{ if(e.target===elsNow.overlay || e.target.classList.contains('voice-overlay-bg')) closeVoice(); });
    if(elsNow.micBtn) elsNow.micBtn.addEventListener('click', micAction);
    // Call UI buttons (phone layout) drive the same whisper engine
    const callMute = document.getElementById('call-mute-btn');
    if (callMute && !callMute.dataset.whisperBound) { callMute.dataset.whisperBound = '1'; callMute.addEventListener('click', micAction); }
    const callSpeaker = document.getElementById('call-speaker-btn');
    if (callSpeaker && !callSpeaker.dataset.whisperBound) {
      callSpeaker.dataset.whisperBound = '1';
      callSpeaker.addEventListener('click', () => {
        speakerOff = !speakerOff;
        callSpeaker.classList.toggle('active', !speakerOff);
        if (speakerOff) stopSpeaking();
      });
    }
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && isOverlayOpen) closeVoice(); });
  }

  // Hide voice button when input has any character (even space), like ChatGPT
  function updateVoiceVisibility() {
    const input = document.getElementById('chat-input');
    const btn = getEls().btnVoice || document.getElementById('btn-voice');
    if (!input || !btn) return;
    const hasContent = input.value.length > 0;
    btn.style.display = hasContent ? 'none' : '';
  }

  function initVoice(){ bindEvents(); wrapStream(); setTimeout(()=>{ bindEvents(); wrapStream(); },800);
    const input = document.getElementById('chat-input');
    if (input && !input.dataset.voiceVisBound) {
      input.dataset.voiceVisBound = '1';
      ['input','change','paste','keyup'].forEach(ev => input.addEventListener(ev, updateVoiceVisibility));
      const mo = new MutationObserver(updateVoiceVisibility);
      try { mo.observe(input, { attributes: true, attributeFilter: ['value'] }); } catch (_) {}
      setInterval(updateVoiceVisibility, 300);
      updateVoiceVisibility();
    } else {
      updateVoiceVisibility();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVoice);
  else initVoice();
  setTimeout(initVoice, 1200);

  // Keep listening alive across page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isOverlayOpen && conversationActive && !isPaused && voicePhase === 'idle' && !isListening && !isTranscribing) {
      setTimeout(startAutoListening, 300);
    }
  });

  window.AnteemoneeVoice={ open: openVoice, close: closeVoice, start: startAutoListening, stop: stopListening, speak: speakText, stopSpeaking, toggleSpeak, isSpeaking, onAiResponseComplete, pause: pauseConversation, resume: resumeConversation, toggleMute, get isPaused(){return isPaused;}, get isMuted(){return isMuted;}, get isConversationActive(){return conversationActive;}, get voiceMode(){return isOverlayOpen;}, get model(){return WHISPER_MODEL;} };
})();
