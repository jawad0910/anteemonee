/**
 * Anteemonee Voice Chat — ChatGPT-style hands-free conversation
 * STT: Groq whisper-large-v3-turbo via Supabase Edge Function `voice-stt` (fallback to Web Speech API)
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
  let isListening = false;       // MediaRecorder is recording (or SpeechRecognition active)
  let isTranscribing = false;
  let isPaused = false;          // user tapped to pause conversation
  let conversationActive = false;
  let voicePhase = 'idle';       // 'idle' | 'listening' | 'transcribing' | 'sending' | 'ai-speaking'

  // SpeechRecognition fallback
  let recognition = null;
  let finalTranscript = '';

  // Whisper path
  let mediaStream = null;        // the raw mic stream shared between VAD + recorder
  let mediaRecorder = null;
  let audioChunks = [];
  let whisperMime = '';

  // VAD (Voice Activity Detection) — drives hands-free behavior
  let audioCtx = null;
  let analyser = null;
  let vadRAF = null;
  let vadData = null;
  let hasSpeechSinceStart = false;
  let lastSpeechTime = 0;
  let recordingStartTime = 0;
  let bargeSpeechStart = 0;
  // Tuning — works well on MacBook / phone mics with echoCancellation on
  const VAD_SILENCE_MS = 1300;        // silence after speech → auto send
  const VAD_MIN_SPEECH_MS = 350;      // must have at least this much speech before silence counts
  const VAD_SPEECH_THRESHOLD = 14;    // RMS volume 0-100; ~12-18 is good
  const VAD_BARGE_THRESHOLD = 18;     // slightly higher during TTS to avoid music triggering
  const VAD_BARGE_HOLD_MS = 260;      // continuous speech for this long during TTS → barge-in
  const VAD_MAX_RECORD_MS = 30000;    // safety cap: 30s per utterance
  const VAD_IDLE_POLL_MS = 60;

  // TTS state
  let lastVoiceSend = 0;
  let ttsAudio = null;
  let ttsController = null;
  let ttsVoice = 'Kore';
  const TTS_MAX_CHARS = 4000;

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
    return { url: 'https://zkuytvjeqkpexcbyoyhz.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjUwNjcyMTIsImV4cCI6MjA0MDY0MzIxMn0._VJbk4XQCnN0BxMbFQP5OqWKjAwXf8lGLgN4Lfxpmk0' };
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
    const cand = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
    ];
    for (const m of cand) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  }

  function hasMediaRecorder() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function hasSpeechRecognition() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    try { r.maxAlternatives = 1; } catch (_) {}
    return r;
  }

  function setStatus(text) { const { status } = getEls(); if (status) status.textContent = text; }
  function setTranscript(text, isInterim) {
    const { transcript } = getEls(); if (!transcript) return;
    if (!text) { transcript.textContent = ''; transcript.classList.remove('has-text','interim'); return; }
    transcript.textContent = text; transcript.classList.add('has-text'); transcript.classList.toggle('interim', !!isInterim);
  }

  function updateMicUI() {
    const { micLabel, overlay, btnVoice, micBtn } = getEls();
    if (micLabel) {
      if (isPaused) micLabel.textContent = 'Paused · tap to resume';
      else if (voicePhase === 'ai-speaking') micLabel.textContent = 'Speaking… tap to interrupt';
      else if (voicePhase === 'sending') micLabel.textContent = 'Thinking…';
      else if (isTranscribing) micLabel.textContent = 'Transcribing…';
      else if (isListening) micLabel.textContent = 'Listening… tap to pause';
      else if (conversationActive) micLabel.textContent = 'Listening…';
      else micLabel.textContent = 'Start conversation';
    }
    if (overlay) {
      overlay.classList.toggle('listening', isListening && !isPaused);
      overlay.classList.toggle('speaking', voicePhase === 'ai-speaking');
      overlay.classList.toggle('paused', !!isPaused);
    }
    if (btnVoice) btnVoice.classList.toggle('active', !!isOverlayOpen);
    if (micBtn) {
      const busy = voicePhase === 'sending' || voicePhase === 'transcribing';
      micBtn.classList.toggle('disabled', !!busy);
      micBtn.setAttribute('aria-label', isPaused ? 'Resume conversation' : isListening ? 'Pause listening' : voicePhase === 'ai-speaking' ? 'Interrupt AI' : 'Start listening');
    }
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
    // scale 0-128 → 0-100
    return (rms / 128) * 100 * 1.6; // gain 1.6 makes threshold ~14 sensitive
  }

  function ensureVADStream() {
    // kept for symmetry — actual stream is created in ensureMicAndVAD
  }

  async function ensureMicAndVAD() {
    if (mediaStream && audioCtx && analyser) return true;
    try {
      if (!mediaStream) {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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

        if (vol > VAD_SPEECH_THRESHOLD) {
          if (!hasSpeechSinceStart) {
            hasSpeechSinceStart = true;
          }
          lastSpeechTime = now;
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
          // No speech yet — keep recording, don't timeout early.
          // If user is silent for > 8s with no speech at all, we keep listening (don't auto-stop)
          // This avoids "No speech — try again" churn.
        }
      }
    };
    tick();
  }

  function stopVADLoop() {
    if (vadRAF) { try { cancelAnimationFrame(vadRAF); } catch (_) {} vadRAF = null; }
  }

  function teardownMic() {
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
  async function openVoice() {
    const { overlay, unsupported } = getEls(); if (!overlay) return;
    const canWhisper = hasMediaRecorder();
    const canWebSpeech = hasSpeechRecognition();
    if (!canWhisper && !canWebSpeech && unsupported) {
      unsupported.style.display = 'block'; unsupported.textContent = 'Mic not supported in this browser. Use Chrome/Safari 16+ and allow microphone.';
    } else if (unsupported) unsupported.style.display = 'none';

    overlay.classList.add('show'); overlay.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
    isOverlayOpen = true; conversationActive = true; isPaused = false;
    voicePhase = 'idle'; isListening = false; isTranscribing = false;
    finalTranscript=''; setTranscript('', false);
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
    try { if (recognition) recognition.abort(); } catch (_) {}
    stopSpeaking();
    teardownMic();
    if (overlay) { overlay.classList.remove('show','listening','speaking','paused'); overlay.setAttribute('aria-hidden','true'); }
    document.body.style.overflow='';
    isOverlayOpen=false; voicePhase='idle'; updateMicUI();
    if (getEls().btnVoice) getEls().btnVoice.classList.remove('active');
  }

  // --- Whisper: MediaRecorder → Groq ---
  async function getExtensionForMime(mime) {
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
    const ext = await getExtensionForMime(blob.type || whisperMime);
    const file = new File([blob], `voice.${ext}`, { type: blob.type || 'audio/webm' });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', WHISPER_MODEL);
    fd.append('language', 'en');
    fd.append('prompt', 'Hello, how are you? Assalamu alaikum, Roman Urdu, English conversation.');
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
    if (!hasMediaRecorder()) { startWebSpeechContinuous(); return; }
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
    hasSpeechSinceStart = false;
    lastSpeechTime = Date.now();
    recordingStartTime = Date.now();
    bargeSpeechStart = 0;

    // Reuse existing micStream; do not call getUserMedia again (keeps VAD alive)
    try {
      const opts = whisperMime ? { mimeType: whisperMime } : undefined;
      mediaRecorder = new MediaRecorder(mediaStream, opts);
    } catch (e) {
      try { mediaRecorder = new MediaRecorder(mediaStream); } catch (e2) {
        console.warn('[voice] MediaRecorder failed', e2);
        startWebSpeechContinuous();
        return;
      }
    }
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstart = () => {
      isListening = true; voicePhase = 'listening'; finalTranscript=''; setTranscript('', false); setStatus('Listening…'); updateMicUI();
    };
    mediaRecorder.onstop = async () => {
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
      if (!blob || blob.size < 900) {
        // Too short / silence — just restart listening automatically (don't show error unless user clearly spoke)
        voicePhase = 'idle'; updateMicUI();
        if (hasSpeechSinceStart) {
          setStatus('Didn’t catch that — listening…');
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) { setStatus('Listening…'); startAutoListening(); } }, 800);
        } else {
          // No speech at all — silently keep listening (no flash of error)
          setStatus('Listening…');
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 350);
        }
        return;
      }
      isTranscribing = true; voicePhase = 'transcribing'; setStatus('Heard you — thinking…'); setTranscript('…', true); updateMicUI();
      try {
        const text = await transcribeWithWhisper(blob);
        isTranscribing = false; setTranscript(text, false); setStatus('Got it — answering…'); updateMicUI();
        // Hand off to chat
        setTimeout(()=> sendTranscript(text), 160);
      } catch (e) {
        isTranscribing = false; voicePhase = 'idle'; updateMicUI();
        const msg = (e && e.message) || 'transcription failed';
        console.warn('[voice] whisper failed:', msg);
        if (/not deployed|404|Load failed|Failed to fetch|NetworkError/i.test(msg) && hasSpeechRecognition()) {
          setStatus('Edge not deployed — using browser STT. Listening…');
          setTimeout(() => startWebSpeechContinuous(), 600);
        } else {
          // Keep conversation going: show brief error then auto-listen again
          setStatus(msg.slice(0, 90) + ' — listening again');
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) { setStatus('Listening…'); startAutoListening(); } }, 1400);
        }
      }
    };
    try { mediaRecorder.start(100); } catch (e) {
      isListening = false; updateMicUI();
      console.warn('[voice] recorder start failed', e);
    }
  }

  function stopWhisperCapture() {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch (_) {}
    }
  }

  // --- Web Speech fallback (continuous) — also hands-free ---
  function startWebSpeechContinuous() {
    if (isListening || isTranscribing || voicePhase === 'sending' || voicePhase === 'ai-speaking' || isPaused) return;
    if (!hasSpeechRecognition()) { setStatus('Speech not supported'); return; }
    try { if (recognition) recognition.abort(); } catch (_) {}
    recognition = createRecognition(); if (!recognition) return;
    finalTranscript=''; setTranscript('', false);
    let silenceTimer = null;
    let lastResultTime = Date.now();

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        const text = (finalTranscript||'').trim() || (getEls().transcript && getEls().transcript.textContent.trim()) || '';
        if (text) {
          try { recognition.stop(); } catch (_) {}
          setStatus('Got it — answering…'); setTranscript(text, false);
          setTimeout(()=> sendTranscript(text), 160);
        } else {
          // no speech yet — keep listening (restart)
          try { recognition.stop(); } catch (_) {}
        }
      }, VAD_SILENCE_MS + 200);
    };

    recognition.onstart = () => { isListening=true; voicePhase='listening'; setStatus('Listening… (browser)'); updateMicUI(); lastResultTime = Date.now(); resetSilenceTimer(); };
    recognition.onresult = (event) => {
      let interim=''; let f=''; for(let i=event.resultIndex;i<event.results.length;i++){const r=event.results[i];const t=r[0]&&r[0].transcript?r[0].transcript:''; if(r.isFinal) f+=t+' '; else interim+=t; }
      if(f) finalTranscript+=f; const combined=(finalTranscript+interim).trim(); if(combined) { setTranscript(combined, !!interim); lastResultTime = Date.now(); resetSilenceTimer(); }
    };
    recognition.onerror = (e) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      const err=(e&&e.error)||'unknown'; if(err==='not-allowed') setStatus('Mic permission denied'); else if(err==='no-speech') setStatus('Listening…'); else if(err!=='aborted') setStatus('Error: '+err);
      isListening=false; updateMicUI();
      // Auto-restart if conversation still active
      if (conversationActive && !isPaused && isOverlayOpen && voicePhase !== 'sending' && voicePhase !== 'ai-speaking') {
        setTimeout(() => startWebSpeechContinuous(), 700);
      }
    };
    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      isListening=false; updateMicUI();
      const text=(finalTranscript||'').trim() || (getEls().transcript && getEls().transcript.textContent.trim()) || '';
      if (text && voicePhase === 'listening') {
        voicePhase='transcribing'; setStatus('Got it — answering…'); setTranscript(text,false); setTimeout(()=> sendTranscript(text), 160);
      } else if (conversationActive && !isPaused && isOverlayOpen && voicePhase !== 'sending' && voicePhase !== 'ai-speaking') {
        // Continuous loop: instantly restart listening (hands-free)
        setTimeout(() => startWebSpeechContinuous(), 320);
      }
    };
    try{ recognition.start(); }catch(e){ setStatus('Could not start mic'); isListening=false; updateMicUI(); }
  }

  function stopWebSpeech(){ if(!isListening&&!recognition) return; isListening=false; updateMicUI(); try{if(recognition) recognition.abort();}catch(_){} }

  // Unified stop (for pause / close)
  function stopListening() {
    if (isTranscribing) return;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      // For pause/close we want to abort without sending — override onstop
      try { mediaRecorder.onstop = () => { isListening=false; audioChunks=[]; updateMicUI(); }; mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    } else if (recognition && isListening) {
      stopWebSpeech();
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
    try { if (recognition) recognition.abort(); } catch (_) {}
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

  // --- TTS: Gemini 3.1 Flash TTS via Edge Function ---
  function stripForTTS(text) {
    let t = String(text || '');
    t = t.replace(/```[\s\S]*?```/g, '');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(\*|_)(.*?)\1/g, '$2');
    t = t.replace(/^[-*+]\s+/gm, '• ');
    t = t.replace(/^\|.*\|$/gm, '');
    t = t.replace(/^---$/gm, '');
    t = t.replace(/^>\s+/gm, '');
    t = t.replace(/\n---[\s\S]*$/i, '');
    t = t.replace(/\n\*\*References?:\*\*[\s\S]*$/i, '');
    t = t.replace(/\nReferences:[\s\S]*$/i, '');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    if (t.length > TTS_MAX_CHARS) t = t.slice(0, TTS_MAX_CHARS) + '…';
    return t;
  }

  async function speakText(text, voice) {
    const clean = stripForTTS(text);
    if (!clean) return;
    stopSpeaking();

    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-tts';

    ttsController = new AbortController();
    voicePhase = 'ai-speaking';
    setStatus('Speaking…');
    updateMicUI();
    document.querySelectorAll('.tts-btn').forEach(b => b.classList.add('tts-playing'));

    // While TTS is playing, VAD stays running for barge-in (handled in vadLoop)
    // Pause auto-listening recorder but keep mic stream alive
    if (isListening) stopListening();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, voice: voice || ttsVoice }),
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
        document.querySelectorAll('.tts-btn').forEach(b => b.classList.remove('tts-playing'));
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
        document.querySelectorAll('.tts-btn').forEach(b => b.classList.remove('tts-playing'));
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
      document.querySelectorAll('.tts-btn').forEach(b => b.classList.remove('tts-playing'));
      voicePhase = 'idle';
      setStatus(isPaused ? 'Paused — tap to resume' : 'TTS unavailable — listening…');
      updateMicUI();
      // keep conversation going even if TTS fails
      if (conversationActive && !isPaused && isOverlayOpen) setTimeout(startAutoListening, 700);
      try {
        if (window.speechSynthesis) {
          const utter = new SpeechSynthesisUtterance(clean);
          utter.lang = 'en-US'; utter.rate = 1.0;
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
    if (ttsController) {
      try { ttsController.abort(); } catch (_) {}
      ttsController = null;
    }
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    document.querySelectorAll('.tts-btn').forEach(b => b.classList.remove('tts-playing'));
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
    return !!(ttsAudio && !ttsAudio.paused);
  }

  /** Call from ai-chatbot.js after AI response finishes streaming */
  function onAiResponseComplete(text) {
    const elapsed = Date.now() - lastVoiceSend;
    if (elapsed < 30000 && elapsed >= 0) {
      lastVoiceSend = 0;
      speakText(text);
    } else if (conversationActive && isOverlayOpen && !isPaused) {
      // Edge case: AI responded but voice flag expired — still resume listening for conversation mode
      voicePhase = 'idle';
      setStatus('Listening…');
      updateMicUI();
      setTimeout(startAutoListening, 400);
    }
  }

  /** Toggle speak/stop for a given text (used by speaker button) */
  function toggleSpeak(text) {
    if (isSpeaking()) {
      stopSpeaking();
    } else {
      speakText(text);
    }
  }

  function sendTranscript(text) {
    const t = String(text || '').trim();
    if (!t) return;
    voicePhase = 'sending';
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
    if(elsNow.micBtn) elsNow.micBtn.addEventListener('click', ()=>{
      if (voicePhase === 'ai-speaking') { stopSpeaking(); if (conversationActive && !isPaused) setTimeout(startAutoListening, 260); return; }
      if (voicePhase === 'sending' || voicePhase === 'transcribing') return;
      if (isPaused) { resumeConversation(); return; }
      if (isListening) { pauseConversation(); return; }
      // idle → start listening
      resumeConversation();
    });
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

  function initVoice(){ bindEvents(); setTimeout(bindEvents,800);
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

  window.AnteemoneeVoice={ open: openVoice, close: closeVoice, start: startAutoListening, stop: stopListening, speak: speakText, stopSpeaking, toggleSpeak, isSpeaking, onAiResponseComplete, pause: pauseConversation, resume: resumeConversation, get isPaused(){return isPaused;}, get isConversationActive(){return conversationActive;}, get model(){return WHISPER_MODEL;} };
})();
