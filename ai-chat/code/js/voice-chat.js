/**
 * Anteemonee Voice Chat — ChatGPT-style hands-free conversation
 * STT: Groq whisper-large-v3-turbo via Supabase Edge Function `voice-stt`
 * TTS: on-device speechSynthesis (primary). The `voice-tts` edge function is
 *      only a fallback for browsers with no local voices.
 * Flow: tap to talk, tap again to send. VAD runs on a timer (not rAF, which is
 *      suspended in background tabs) with a watchdog, so a capture can never
 *      hang, and mic failures say what happened and offer a retry.
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
  let vadData = null;
  let hasSpeechSinceStart = false;
  let lastSpeechTime = 0;
  let recordingStartTime = 0;
  let capturePeak = 0;             // loudest sample seen during this capture
  let roomFloor = Infinity;        // the room's own level, measured while idle
  let levelTimer = null;           // fast peak sampler, only while recording
  let floorTimer = null;           // slow room sampler, runs whenever the mic is live
  // Local metering. Deciding "was that speech?" on the device means no network
  // round trip and no dependence on a fixed number, so a quiet mic and a loud
  // mic both work without retuning.
  const LEVEL_POLL_MS = 25;             // ~40Hz; windows overlap so nothing is missed
  const FLOOR_POLL_MS = 250;            // room tracking, no need to be fast
  // Whisper is far more sensitive than any threshold, so this only has to
  // separate a voice from room noise, not decide whether a word is intelligible.
  // Tuned so a quiet voice in a mildly noisy room still passes: too strict here
  // is what makes the mic claim "no words" while someone is clearly speaking.
  const SPEECH_NOISE_MULT = 1.5;        // speech is this far above the room
  const SPEECH_NOISE_MARGIN = 3;        // ...and at least this much above it
  const SPEECH_ABS_FLOOR = 5;           // never amplify pure digital silence
  const FLOOR_RISE_PER_SAMPLE = 0.4;    // floor drops at once, creeps up slowly

  // The room floor is tracked continuously while the mic is live but idle, so it
  // is already known before the student starts talking. Measuring it from the
  // first moments of a recording meant that talking immediately made the floor
  // equal the voice, which pushed the threshold out of reach and reported
  // "no words detected" to someone who was plainly speaking.
  function sampleFloor() {
    // Never learn the room from a recording: that is the student talking, and it
    // would drag the reference up until the speech test could never be passed.
    if (isListening || isTranscribing) return 0;
    const v = getVolume();
    if (!isFinite(roomFloor)) { roomFloor = v; return v; }
    if (v < roomFloor) roomFloor = v;
    else roomFloor = Math.min(v, roomFloor + FLOOR_RISE_PER_SAMPLE);
    return v;
  }
  function startFloorMeter() {
    if (floorTimer) return;
    sampleFloor();
    floorTimer = setInterval(sampleFloor, FLOOR_POLL_MS);
  }
  function stopFloorMeter() {
    if (floorTimer) { clearInterval(floorTimer); floorTimer = null; }
  }

  function sampleLevel() {
    const v = getVolume();
    if (v > capturePeak) capturePeak = v;
    // Ten samples per tick, so this is the reliable "you are talking" signal.
    if (v > VAD_SPEECH_THRESHOLD) lastSpeechTime = Date.now();
    return v;
  }
  function startLevelMeter() {
    stopLevelMeter();
    capturePeak = 0;
    levelTimer = setInterval(sampleLevel, LEVEL_POLL_MS);
  }
  function stopLevelMeter() {
    if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
  }
  function speechThresholdNow() {
    if (!isFinite(roomFloor)) return SPEECH_ABS_FLOOR;
    return Math.max(roomFloor * SPEECH_NOISE_MULT, roomFloor + SPEECH_NOISE_MARGIN, SPEECH_ABS_FLOOR);
  }
  // True when this capture contained something that could plausibly be a voice.
  function hasRealSpeech() {
    return capturePeak >= speechThresholdNow();
  }
  // Tuning — don't clip word edges (clipping = misheard words)
  // How long the mic stays open after you stop talking. This has to cover a
  // natural pause *inside* a sentence: at 850ms, "what is ... what is
  // Anteemonee" was cut off after "what is", because the half-second pause
  // looked like the end of the turn. Two seconds is comfortable for thinking
  // pauses while still feeling responsive, and VAD_MAX_RECORD_MS caps the worst
  // case so the mic can never be left open indefinitely.
  const VAD_SILENCE_MS = 2000;           // stop 2s after you finish
  const VAD_SPEECH_THRESHOLD = 12;
  const VAD_BARGE_THRESHOLD = 17;        // a normal word should still cut through
  // How long the level must stay above the gate before it counts. This used to
  // be a frame count, which made sensitivity depend on the loop cadence and left
  // the mic twitchy: one or two noisy samples could cut the AI off mid-sentence.
  // Measuring in milliseconds keeps the response predictable at any cadence.
  const VAD_LATENCY_MS = 260;
  const VAD_MAX_RECORD_MS = 12000;
  const VAD_NO_SPEECH_TIMEOUT_MS = 4500;
  const VAD_IDLE_POLL_MS = 60;
  const VAD_TICK_MS = VAD_LATENCY_MS;    // loop cadence, timer based, not rAF
  // How far apart two loud samples may be and still count as one phrase. It has
  // to be at least a full tick, because at this cadence the shortest quiet
  // stretch we can observe is one whole tick; anything smaller would be a
  // tolerance that can never trigger. Lower the tick and sub-tick pauses inside
  // a word get tolerated for free.
  const VAD_GAP_TOLERANCE_MS = VAD_TICK_MS;
  let vadTimer = null;               // interval handle for the VAD loop
  let vadWatchdog = null;            // last-resort stop, independent of the loop
  let lastSttError = '';             // surfaced in the status line on failure
  // Lightweight VAD counters. Cheap to keep and the only practical way to
  // confirm the gate latency without a human in front of a real microphone.
  const stats = { speechOnsets: 0, bargeTriggers: 0, detectLatencyMs: [], lastStopSilenceMs: null };
  function vadStats() {
    var d = stats.detectLatencyMs;
    var sum = 0;
    for (var i = 0; i < d.length; i++) sum += d[i];
    return {
      speechOnsets: stats.speechOnsets,
      bargeTriggers: stats.bargeTriggers,
      lastDetectLatencyMs: d.length ? d[d.length - 1] : null,
      avgDetectLatencyMs: d.length ? Math.round(sum / d.length) : null,
      samples: d.length,
      lastStopSilenceMs: stats.lastStopSilenceMs,
      silenceWindowMs: VAD_SILENCE_MS,
      capturePeak: Math.round(capturePeak * 10) / 10,
      roomFloor: isFinite(roomFloor) ? Math.round(roomFloor * 10) / 10 : null,
      // Two different things, so they need two names: the noise-relative bar the
      // local meter uses, and the fixed level the 260ms gate uses.
      adaptiveSpeechThreshold: Math.round(speechThresholdNow() * 10) / 10,
      latencyMs: VAD_LATENCY_MS,
      tickMs: VAD_TICK_MS,
      vadGateThreshold: VAD_SPEECH_THRESHOLD,
      bargeThreshold: VAD_BARGE_THRESHOLD,
    };
  }
  function resetVadStats() { stats.speechOnsets = 0; stats.bargeTriggers = 0; stats.detectLatencyMs = []; stats.lastStopSilenceMs = null; }
  let micLevel = 0;                   // smoothed 0..1 input level for the UI
  let meterRAF = null;                // level meter animation handle

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
    // This used to collapse every message to "Listening…", which threw away
    // errors and progress and made the mic look dead. Pass real messages
    // through, and mirror the short form into the phase pill.
    var t = String(text == null ? '' : text).trim();
    // #voice-status is a leaf span inside the phase pill, so writing
    // textContent here cannot wipe the pill's dot.
    status.textContent = t || 'Ready';
  }
  function setTranscript(text, isInterim) {
    const { transcript } = getEls();
    if (transcript) transcript.classList.toggle('is-interim', !!isInterim);
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

  function overlayIsOpen() {
    var o = document.getElementById('voice-overlay');
    return !!(o && o.classList.contains('show'));
  }

  function updateMicUI() {
    const { micLabel, overlay, btnVoice, micBtn } = getEls();
    // Trust the DOM, not a flag: another voice script may close the overlay,
    // and a stale "listening" class then blocks every tap behind it.
    if (overlay) isOverlayOpen = overlay.classList.contains('show');
    if (micLabel) {
      if (isMuted) micLabel.textContent = 'Muted';
      else if (isPaused) micLabel.textContent = 'Paused';
      else if (voicePhase === 'ai-speaking') micLabel.textContent = 'AI speaking…';
      else if (voicePhase === 'sending') micLabel.textContent = 'Thinking…';
      else if (isTranscribing) micLabel.textContent = 'Transcribing…';
      else micLabel.textContent = 'Listening…';
    }
    const phase = micErrorMsg ? 'error'
      : isPaused ? 'paused'
      : isMuted ? 'paused'
      : voicePhase === 'ai-speaking' ? 'speaking'
      : isTranscribing ? 'transcribing'
      : voicePhase === 'sending' ? 'thinking'
      : isListening ? 'listening'
      : 'idle';
    if (overlay) {
      if (!isOverlayOpen) {
        // Closed: make sure no phase class can survive a re-render.
        overlay.classList.remove('show', 'listening', 'speaking', 'paused', 'transcribing', 'thinking');
      } else {
        overlay.classList.toggle('listening', isListening && !isPaused && !isMuted);
        overlay.classList.toggle('speaking', voicePhase === 'ai-speaking');
        overlay.classList.toggle('paused', !!isPaused || !!isMuted);
        overlay.classList.toggle('transcribing', !!isTranscribing);
        overlay.classList.toggle('thinking', voicePhase === 'sending');
      }
    }
    // The pill carries the phase for anyone who cannot see the orb animation.
    const pill = document.getElementById('voice-phase');
    if (pill) pill.setAttribute('data-phase', phase);
    if (btnVoice) btnVoice.classList.toggle('active', !!isOverlayOpen);
    if (micBtn) {
      const busy = voicePhase === 'sending' || voicePhase === 'transcribing';
      micBtn.classList.toggle('disabled', !!busy);
      micBtn.classList.toggle('muted', !!isMuted);
      micBtn.setAttribute('aria-label', isMuted ? 'Unmute mic' : 'Mute mic');
    }
    const callMute = document.getElementById('call-mute-btn');
    if (callMute) callMute.classList.toggle('muted', !!isMuted);

    // Hint text mirrors the state so the next action is never a guess.
    const hint = document.getElementById('voice-hint');
    if (hint) {
      let h = 'Tap the orb to talk. Tap again to send.';
      if (micErrorMsg) h = micErrorMsg + ' — use Try again';
      else if (isPaused) h = 'Paused. Tap the orb to resume.';
      else if (isMuted) h = 'Mic muted. Tap the mute button to unmute.';
      else if (isTranscribing) h = 'Turning your speech into text…';
      else if (voicePhase === 'sending') h = 'Waiting for the reply…';
      else if (voicePhase === 'ai-speaking') h = 'Talking. Tap the orb to interrupt.';
      else if (isListening) h = 'Listening. Tap the orb to send now.';
      if (hint.textContent !== h) hint.textContent = h;
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
    // scale 0-128 → 0-100 (gain tuned so threshold 18 ≈ normal speaking voice)
    return (rms / 128) * 100 * 1.2;
  }

  // Sustained-level gate. Returns true once the level has been above
  // `threshold` for VAD_LATENCY_MS. A dip shorter than VAD_GAP_TOLERANCE_MS is
  // tolerated so the natural pause inside a word does not restart the count.
  const speechGate = { start: 0, lastLoud: 0 };
  const bargeGate = { start: 0, lastLoud: 0 };
  let speechHeldSince = 0;      // when the current phrase crossed the gate

  function resetGates() {
    speechGate.start = 0; speechGate.lastLoud = 0;
    bargeGate.start = 0; bargeGate.lastLoud = 0;
    speechHeldSince = 0;
  }
  function resetBargeGate() {
    bargeGate.start = 0; bargeGate.lastLoud = 0;
  }
  // Returns true once the level has been above the gate for VAD_LATENCY_MS.
  // The run restarts whenever consecutive loud samples are further apart than
  // VAD_GAP_TOLERANCE_MS. Deciding that on the loud path (rather than counting
  // quiet time) is what keeps two short bursts from being added together into
  // one long "utterance".
  function gateHeld(loud, gate) {
    if (!loud) return false;
    const now = Date.now();
    const stale = gate.lastLoud && (now - gate.lastLoud) > VAD_GAP_TOLERANCE_MS;
    if (!gate.start || stale) gate.start = now;
    gate.lastLoud = now;
    return (now - gate.start) >= VAD_LATENCY_MS;
  }

  function ensureVADStream() {
    // kept for symmetry — actual stream is created in ensureMicAndVAD
  }

  const MIC_TIMEOUT_MS = 9000;   // getUserMedia must answer within this
  let micTimer = null;

  let micErrorMsg = '';
  let hasCapturedOnce = false;       // a turn was captured in this session
  let orbTapped = false;             // the orb was used at least once
  function micFailed(reason) {
    // A dead mic used to leave the overlay on "Listening..." forever with no
    // way out. Say what happened and offer a retry instead.
    micErrorMsg = String(reason || 'Microphone unavailable');
    voicePhase = 'idle';
    isListening = false;
    isTranscribing = false;
    setStatus(reason);
    updateMicUI();
    try { showVoiceError(reason); } catch (_) {}
    try {
      const btn = document.getElementById('voice-retry');
      if (btn) btn.style.display = '';
    } catch (_) {}
  }

  function retryMic() {
    try {
      const btn = document.getElementById('voice-retry');
      if (btn) btn.style.display = 'none';
    } catch (_) {}
    micErrorMsg = '';
    setStatus('Requesting microphone…');
    updateMicUI();
    teardownMic();
    startAutoListening();
  }

  async function ensureMicAndVAD() {
    if (mediaStream && audioCtx && analyser) return true;
    try {
      if (!mediaStream) {
        const ask = navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,   // keep raw audio for better whisper accuracy
            autoGainControl: true,
            sampleRate: 48000,
          },
        });
        // Some browsers never settle this promise (no device, or a permission
        // prompt that is dismissed by navigating away). Cap the wait.
        const guard = new Promise(function (resolve) {
          if (micTimer) clearTimeout(micTimer);
          micTimer = setTimeout(function () { resolve(null); }, MIC_TIMEOUT_MS);
        });
        mediaStream = await Promise.race([ask, guard]);
        if (micTimer) { clearTimeout(micTimer); micTimer = null; }
        if (!mediaStream) {
          micFailed('Microphone did not respond');
          try { await ask; } catch (_) {}   // let the late rejection settle quietly
          return false;
        }
      }
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      micFailed(denied ? 'Microphone blocked' : 'No microphone found');
      return false;
    }
    if (!analyser && audioCtx && mediaStream) {
      try {
        analyser = audioCtx.createAnalyser();
        // 2048 samples is ~43ms at 48kHz. At 512 (~10ms) the peak meter only
        // ever saw a sliver of each 260ms tick, which is why real speech was
        // being reported as "no words".
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.3;
        vadData = new Uint8Array(analyser.fftSize);
        audioCtx.createMediaStreamSource(mediaStream).connect(analyser);
        // Learn the room's level as soon as the mic is live, so the speech test
        // has a reference before anyone starts talking.
        roomFloor = Infinity;
        startFloorMeter();
      } catch (e) { console.warn('[voice] analyser unavailable', e); }
    }
    setupLevelMeter();
    // Keep nudging the context awake; browsers suspend it on their own.
    if (audioCtx && audioCtx.state !== 'running') { try { await audioCtx.resume(); } catch (_) {} }
    if (!vadTimer) startVADLoop();
    return true;
  }

  // Level meter for the UI. Runs whether or not the browser gives us a
  // working analyser, so the orb is never frozen.
  function setupLevelMeter() {
    try {
      if (!audioCtx || !analyser || !vadData || meterRAF) return;
      let smoothed = 0;
      const tick = () => {
        meterRAF = requestAnimationFrame(tick);
        const raw = getVolume();
        smoothed = raw > smoothed ? raw : smoothed * 0.86 + raw * 0.14;
        micLevel = Math.max(0, Math.min(1, smoothed / 60));
        paintLevel();
      };
      meterRAF = requestAnimationFrame(tick);
    } catch (e) {
      // No analyser: the UI falls back to a CSS animation.
    }
  }

  function paintLevel() {
    try {
      const orb = document.getElementById('voice-orb');
      if (orb) orb.style.setProperty('--level', micLevel.toFixed(3));
      const bars = document.querySelectorAll('#voice-wave span');
      for (let i = 0; i < bars.length; i++) {
        // A gentle arc so the centre bars react most.
        const weight = 1 - Math.abs(i - (bars.length - 1) / 2) / ((bars.length - 1) / 2 + 0.6);
        const h = 4 + micLevel * 20 * weight;
        bars[i].style.height = h.toFixed(1) + 'px';
        bars[i].style.opacity = (0.35 + micLevel * 0.65 * weight).toFixed(2);
      }
    } catch (_) {}
  }

  function startVADLoop() {
    if (vadTimer) return;
    // A timer, not requestAnimationFrame: rAF is suspended in background tabs
    // and under reduced-motion, which used to leave the mic stuck on
    // "Listening..." forever because every stop condition lived in this loop.
    const tick = () => {
      // Self-heal: if another script closed the overlay, finish the teardown
      // ourselves so no phase class or timer is left behind.
      if (isOverlayOpen && !overlayIsOpen()) { closeVoice(); return; }
      if (!isOverlayOpen || !conversationActive) { stopVADLoop(); return; }

      const vol = getVolume();

      // --- Barge-in: AI is speaking, user starts talking → interrupt TTS ---
      if (voicePhase === 'ai-speaking' && !isPaused) {
        // Barge-in: the user has to hold a real word for VAD_LATENCY_MS before
        // the reply is cut off, so a cough or a desk bump no longer interrupts.
        if (gateHeld(vol > VAD_BARGE_THRESHOLD, bargeGate)) {
          resetBargeGate();
          stats.bargeTriggers++;
          stopSpeaking();
          setStatus('Interrupted');
          updateMicUI();
          // Start capturing straight away so the interrupting words are kept.
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 180);
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
          lastSpeechTime = now;
          if (gateHeld(true, speechGate)) {
            if (!hasSpeechSinceStart) {
              hasSpeechSinceStart = true;
              hasCapturedOnce = true;
              speechHeldSince = now;
              stats.speechOnsets++;
              stats.detectLatencyMs.push(now - speechGate.start);
            }
          }
        }

        // Only auto-stop after we have heard some speech
        // Stop on silence once something has been heard, otherwise on a timer.
        // `heardSomething` also counts real audio arriving, so a deaf meter
        // cannot keep the recorder open forever.
        // hasRealSpeech() comes from the 25ms meter, which sees far more of the
        // audio than this tick, so a turn is never held open by a missed sample
        // and never cut short by one either.
        if (hasSpeechSinceStart || hasRealSpeech() || elapsed > 1500 && vol > VAD_SPEECH_THRESHOLD * 0.55) {
          const silence = now - lastSpeechTime;
          if (silence > VAD_SILENCE_MS) {
            // Recorded so the effective pause can be checked rather than guessed.
            stats.lastStopSilenceMs = Math.round(silence);
            stopWhisperCapture();
          }
        }
        // Hard stop so a silent room can never hold the mic open. The 25ms local
        // meter gets the final say: it sees far more of the audio than this
        // 260ms tick can, so a voice the tick happened to miss still keeps the
        // recording alive instead of being cut off as "no speech".
        if (elapsed > VAD_NO_SPEECH_TIMEOUT_MS && !hasSpeechSinceStart && !hasRealSpeech()) {
          stopWhisperCapture();
        }
      }
    };
    tick();
    vadTimer = setInterval(tick, VAD_TICK_MS);
  }

  function stopVADLoop() {
    if (vadTimer) { try { clearInterval(vadTimer); } catch (_) {} vadTimer = null; }
    if (vadWatchdog) { try { clearTimeout(vadWatchdog); } catch (_) {} vadWatchdog = null; }
  }

  function teardownMic() {
    if (interimTimer) { clearInterval(interimTimer); interimTimer = null; }
    interimBusy = false;
    stopLevelMeter();
    stopFloorMeter();
    roomFloor = Infinity;
    stopVADLoop();
    resetGates();
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
    // Build the AudioContext now, while we are still inside the tap gesture:
    // Safari refuses to resume a context created after an await.
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
    voiceEphemeralOn(); // call chats stay out of history + database
    isOverlayOpen = true; conversationActive = true; isPaused = false; isMuted = false; hasCapturedOnce = false; orbTapped = false;
    voicePhase = 'idle'; isListening = false; isTranscribing = false;
    noSpeechRestarts = 0;
    try { clearCallChat(); } catch (_) {}
    setTranscript('', false);
    setStatus('Starting…');
    updateMicUI();

    const ok = await ensureMicAndVAD();
    if (!ok) { updateMicUI(); return; }   // micFailed() already explained it
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
    isOverlayOpen=false; voicePhase='idle'; micErrorMsg=''; micLevel=0;
    try { paintLevel(); } catch (_) {}
    updateMicUI();
    if (getEls().btnVoice) getEls().btnVoice.classList.remove('active');
  }

  // --- Whisper: MediaRecorder → Groq ---
  // Known whisper noise-hallucinations: never send these to chat
  // Markers that cannot appear in a genuine study question, so they reject a
  // transcript of any length.
  const WHISPER_JUNK_STRONG = [
    'subtitles by', 'transcription by', 'thanks for watching', 'thanks for listening',
    'subscribe', 'amara.org', 'www.', '.com', '♪', '(music)', '[music]',
    '(silence)', '[silence]', 'blank audio', 'inaudible',
  ];
  // Phrases that are only junk when they are the whole thing said.
  const WHISPER_JUNK_EXACT = [
    'thank you', 'thank you.', 'thanks', 'bye', 'bye.', 'bye bye', 'hello?',
    'caption', 'you', 'blank_', 'foreign', 'okay', 'yeah', 'hmm', 'uh', 'um',
    'oh', 'ah', 'so', 'well', 'nothing', 'silence', 'quiet', 'test', 'testing',
  ];
  // Vocabulary from the study prompt this feature used to send to Whisper. On
  // silence Whisper simply completed that prompt, so a transcript made up
  // entirely of these words is an echo, not something the student said.
  const PROMPT_ECHO_WORDS = new Set([
    'biology', 'chemistry', 'physics', 'enzymes', 'enzyme', 'protein', 'dna',
    'cell', 'photosynthesis', 'exam', 'homework', 'study', 'anteemonee',
    'pakistani', 'pakistan', 'student', 'urdu', 'english',
  ]);
  // Count real words: runs of letters or digits. Punctuation, emoji and stray
  // symbols do not count, so "!!!" and "..." come back as zero words.
  function countWords(text) {
    var m = String(text || '').match(/[\p{L}\p{N}]+/gu);
    return m ? m.length : 0;
  }
  // Whisper misspells the prompt vocabulary ("Aneeemonee" for "Anteemonee"), so
  // an exact set lookup is not enough. Allow a couple of edits.
  function withinEditDistance(a, b, max) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > max) return false;
    var prev = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      var best = i;
      for (var jj = 1; jj <= b.length; jj++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(jj - 1) ? 0 : 1;
        cur[jj] = Math.min(cur[jj - 1] + 1, prev[jj] + 1, prev[jj - 1] + cost);
        if (cur[jj] < best) best = cur[jj];
      }
      if (best > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }
  var PROMPT_ECHO_LIST = Array.from(PROMPT_ECHO_WORDS);
  function isPromptEchoWord(word) {
    for (var i = 0; i < PROMPT_ECHO_LIST.length; i++) {
      if (withinEditDistance(word, PROMPT_ECHO_LIST[i], 2)) return true;
    }
    return false;
  }

  function isWhisperHallucination(text) {
    var t = String(text || '').trim().toLowerCase().replace(/[.!?…\s]+$/g, '');
    // Nothing said at all. This is the case that used to create a chat.
    if (countWords(t) === 0) return true;
    if (t.length < 3) return true;
    if (WHISPER_JUNK_STRONG.some(function (j) { return t.indexOf(j) !== -1; })) return true;
    // A single repeated token ("yeah yeah yeah") is never a real question.
    var words = t.match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length >= 4) {
      var uniq = {};
      for (var i = 0; i < words.length; i++) uniq[words[i]] = 1;
      if (Object.keys(uniq).length === 1) return true;
    }
    // Every word came from the retired study prompt, so this is Whisper echoing
    // its own bias rather than transcribing anything.
    var allEcho = true;
    for (var k = 0; k < words.length; k++) {
      if (!isPromptEchoWord(words[k])) { allEcho = false; break; }
    }
    if (allEcho) return true;
    // The whole utterance was one of the short filler phrases.
    if (WHISPER_JUNK_EXACT.indexOf(t) !== -1) return true;
    // Short and made only of filler words.
    if (words.length <= 3) {
      var allFiller = true;
      for (var f = 0; f < words.length; f++) {
        if (WHISPER_JUNK_EXACT.indexOf(words[f]) === -1) { allFiller = false; break; }
      }
      if (allFiller) return true;
    }
    return false;
  }
  function showVoiceError(message) {
    const { unsupported } = getEls();
    if (!unsupported) return;
    unsupported.style.display = 'block';
    unsupported.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = String(message || 'Voice is unavailable') + '. ';
    const btn = document.createElement('button');
    btn.id = 'voice-retry';
    btn.type = 'button';
    btn.className = 'voice-retry-btn';
    btn.textContent = 'Try again';
    btn.addEventListener('click', function (e) { e.stopPropagation(); retryMic(); });
    unsupported.appendChild(text);
    unsupported.appendChild(btn);
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
    // Deliberately no `prompt`. A study-vocabulary prompt is a continuation
    // hint; given silence or a cough, Whisper completed it instead of
    // returning nothing, which is how "Anteemonee Pakistani student Urdu
    // English" ended up as a real chat message.
    fd.append('response_format', 'json');
    fd.append('temperature', '0');

    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-stt';
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': auth }, body: fd });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      if (res.status === 404) throw new Error('Voice typing is not set up yet (voice-stt missing).');
      let msg = detail;
      try { const j = JSON.parse(detail); msg = j.error || j.message || detail; } catch (_) {}
      if (res.status === 401 || res.status === 403) throw new Error('Sign in to use voice.');
      if (res.status === 429) throw new Error('Too many voice requests, try again in a moment.');
      throw new Error(`Groq ${res.status}: ${String(msg).slice(0,160)}`);
    }
    const data = await res.json();
    const text = (data && (data.text || data.transcript || data.data)) || '';
    // An empty result is a normal outcome for silence, not a failure, so it is
    // returned rather than thrown and handled by the caller's zero-word gate.
    return String(text || '').trim();
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
    hasSpeechSinceStart = false;
    speechGate.start = 0; speechGate.lastLoud = 0;
    stats.detectLatencyMs = [];
    lastSpeechTime = Date.now();
    recordingStartTime = Date.now();
    startLevelMeter();
    resetBargeGate();

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
      micErrorMsg = '';
      try { const u = getEls().unsupported; if (u) { u.style.display = 'none'; u.innerHTML = ''; } } catch (_) {}
      // Safety net: even if the loop is starved, a recording can never run
      // past its cap. Voice mode is push to talk, so cutting and sending is
      // always better than hanging.
      if (vadWatchdog) clearTimeout(vadWatchdog);
      vadWatchdog = setTimeout(function () {
        vadWatchdog = null;
        if (isListening && mediaRecorder && mediaRecorder.state === 'recording') stopWhisperCapture();
      }, VAD_MAX_RECORD_MS);
      console.log('[voice] recorder started, tracks:', mediaStream.getTracks().map(t => t.kind + ':' + t.enabled + ':' + t.readyState).join(', '));
      // Live interim: every 1.2s whisper a snapshot so text appears as you speak
      if (interimTimer) clearInterval(interimTimer);
      interimTimer = setInterval(async () => {
        if (!isListening || isTranscribing || interimBusy || audioChunks.length === 0) return;
        // Show text as soon as there is real audio. This deliberately does not
        // wait for the VAD: a silent analyser used to block text forever.
        // Never transcribe a snapshot that never held a real speaking level.
        // This is the path that painted phantom bubbles: a breath or a passing
        // bus was enough to trip the gate, and Whisper answered it with a
        // sentence that was then shown as if the student had said it.
        if (!hasRealSpeech()) return;
        const snapBlob = new Blob(audioChunks.slice(), { type: whisperMime || 'audio/webm' });
        if (snapBlob.size < 5000) return;
        interimBusy = true;
        try {
          const txt = await transcribeWithWhisper(snapBlob);
          if (txt && isListening && !isTranscribing) {
            // Same gate as the final result: zero words or a known hallucination
            // must not appear on screen either.
            if (countWords(txt) === 0 || isWhisperHallucination(txt)) return;
            setTranscript(txt, true);
            lastSttError = '';
          }
        } catch (e) {
          // Keep the last error so the final attempt (and the status line) can
          // explain a failure instead of appearing to hang.
          lastSttError = (e && e.message) || 'transcription failed';
        } finally { interimBusy = false; }
      }, 1200);
    };
    mediaRecorder.onstop = async () => {
      if (interimTimer) { clearInterval(interimTimer); interimTimer = null; }
      interimBusy = false;
      stopLevelMeter();
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
      // Only a genuinely tiny clip is discarded. Whisper is cheap and the
      // hallucination filter below already cleans up empty audio, so gating on
      // the VAD here just swallowed every utterance when the meter was deaf.
      if (!blob || blob.size < 2500) {
        voicePhase = 'idle'; updateMicUI();
        noSpeechRestarts++;
        if (noSpeechRestarts >= MAX_NO_SPEECH_RESTARTS) {
          setStatus('No sound picked up — check your mic');
          noSpeechRestarts = 0;
        } else {
          setTimeout(() => { if (conversationActive && !isPaused && isOverlayOpen) startAutoListening(); }, 350);
        }
        return;
      }
      stopLevelMeter();
      console.log('[voice] capture peak:', capturePeak.toFixed(1),
        'room floor:', isFinite(roomFloor) ? roomFloor.toFixed(1) : 'n/a',
        'needed:', speechThresholdNow().toFixed(1));
      // Decided locally, with no network call. The gate above only proves
      // something was audible; if it never cleared the room's own noise floor by
      // a margin it was a breath or a noise burst, and Whisper would answer it
      // with an invented sentence.
      if (!hasRealSpeech()) {
        console.log('[voice] skipped whisper, peak too low to be speech');
        isTranscribing = false;
        voicePhase = 'idle';
        try { clearPendingUser(); } catch (_) {}
        setStatus('No words detected');
        updateMicUI();
        noSpeechRestarts++;
        if (noSpeechRestarts >= MAX_NO_SPEECH_RESTARTS) {
          setStatus('No sound picked up — check your mic');
          noSpeechRestarts = 0;
        } else {
          setTimeout(function () {
            if (conversationActive && !isPaused && isOverlayOpen) startAutoListening();
          }, 350);
        }
        return;
      }
      hasSpeechSinceStart = true;
      // Got a real speech recording — transcribe
      noSpeechRestarts = 0;
      isTranscribing = true; voicePhase = 'transcribing'; setStatus('Heard you — thinking…'); setTranscript('…', true); updateMicUI();

      // Nothing was said, so nothing should reach chat. Discard quietly: drop
      // the pending bubble, say so in the status line, and go back to listening
      // instead of creating a message the student never spoke.
      function discardEmptyTranscript(reason) {
        try { clearPendingUser(); } catch (_) {}
        try {
          var cap = getEls().transcript;
          if (cap) { cap.textContent = ''; cap.classList.remove('has-text', 'is-interim'); }
        } catch (_) {}
        isTranscribing = false;
        voicePhase = 'idle';
        setStatus(reason || "Didn't catch that");
        updateMicUI();
        setTimeout(function () {
          if (conversationActive && !isPaused && isOverlayOpen) startAutoListening();
        }, 350);
      }

      try {
        console.log('[voice] calling whisper, blob size:', blob.size, 'type:', blob.type);
        const text = await transcribeWithWhisper(blob);
        var wordCount = countWords(text);
        console.log('[voice] whisper result:', JSON.stringify(text), 'words:', wordCount);
        if (wordCount === 0) {
          console.log('[voice] discarded: transcription had 0 words');
          discardEmptyTranscript('No words detected');
          return;
        }
        if (isWhisperHallucination(text)) {
          console.log('[voice] discarded whisper hallucination');
          discardEmptyTranscript("Didn't catch that");
          return;
        }
        isTranscribing = false; setTranscript(text, false); setStatus('Got it — answering…'); updateMicUI();
        // Hand off to chat
        setTimeout(()=> sendTranscript(text), 160);
      } catch (e) {
        isTranscribing = false; voicePhase = 'idle'; updateMicUI();
        const msg = (e && e.message) || 'transcription failed';
        console.warn('[voice] transcription failed:', msg);
        setStatus('Heard nothing — ' + msg.slice(0, 48));
        // Recover by listening again instead of leaving a dead overlay.
        setTimeout(function () {
          if (!conversationActive || isPaused || !isOverlayOpen) return;
          if (voicePhase === 'idle') { setStatus('Listening…'); updateMicUI(); startAutoListening(); }
        }, 1400);
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
    resetBargeGate();
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
    resetBargeGate();
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

  function speakLocal(text, button, onDone) {
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
      if (token !== localTtsToken) return;   // superseded by stopSpeaking()
      localTtsToken++;
      localUtterance = null;
      localTtsQueue = [];
      localTtsButton = null;
      setLocalTtsButtonState(button, false);
      // Hand control back to the conversation loop. Without this the phase
      // stays 'ai-speaking' and the mic never listens again.
      if (typeof onDone === 'function') { try { onDone(); } catch (_) {} }
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
        if (token !== localTtsToken) return;
        setLocalTtsButtonState(button, true);
        // Keep the speaking phase pinned for as long as audio is actually
        // playing, so barge-in stays armed.
        voicePhase = 'ai-speaking';
        updateMicUI();
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

  // Local (on-device) TTS is the primary path: no network, no latency, no
  // server bill. The voice-tts edge function stays only as a fallback for
  // browsers without speech synthesis voices.
  function hasLocalVoices() {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      const vs = window.speechSynthesis.getVoices() || [];
      return vs.length > 0;
    } catch (_) { return false; }
  }

  // What happens when the reply finishes playing, whichever engine spoke it.
  function onLocalSpeechDone() {
    setAllTtsButtonState(false);
    if (!isOverlayOpen || !conversationActive || isPaused) {
      voicePhase = 'idle';
      setStatus(isPaused ? 'Paused — tap to resume' : 'Tap the orb to talk');
      updateMicUI();
      return;
    }
    voicePhase = 'idle';
    setStatus('Tap the orb to talk');
    updateMicUI();
    setTimeout(function () {
      if (conversationActive && !isPaused && isOverlayOpen) startAutoListening();
    }, 420);
  }

  async function speakText(text, voice) {
    const clean = stripForTTS(text);
    if (!clean) return;
    stopSpeaking();

    voicePhase = 'ai-speaking';
    setStatus('Speaking…');
    updateMicUI();
    setAllTtsButtonState(true);
    if (isListening) stopListening();

    // On-device first.
    if (hasLocalVoices()) {
      const started = speakLocal(clean, null, onLocalSpeechDone);
      if (started) {
        // speakLocal() tears down any previous playback, and stopSpeaking()
        // clears the phase back to idle. Re-claim it here, otherwise the phase
        // never reaches 'ai-speaking' on the local path and the barge-in branch
        // in the VAD loop can never fire, so talking over the reply does
        // nothing on devices that have local voices.
        voicePhase = 'ai-speaking';
        setStatus('Speaking…');
        updateMicUI();
        return;
      }
    }

    const useVoice = voice || getTtsVoice();
    const { url } = supabaseCfg();
    const auth = await getAuthHeader();
    const endpoint = url.replace(/\/$/, '') + '/functions/v1/voice-tts';

    ttsController = new AbortController();

    // While audio plays, the VAD loop stays alive for barge-in
    // (interrupting the reply by talking).

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
    // Zero words must never become a chat message, whatever produced it.
    if (!t || countWords(t) === 0) {
      console.log('[voice] sendTranscript blocked, 0 words:', JSON.stringify(text));
      try { clearPendingUser(); } catch (_) {}
      voicePhase = 'idle';
      setStatus("Didn't catch that");
      updateMicUI();
      setTimeout(function () {
        if (conversationActive && !isPaused && isOverlayOpen) startAutoListening();
      }, 350);
      return;
    }
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
    elsNow.btnVoice.addEventListener('click', ()=>{
      if (!isOverlayOpen) { openVoice(); return; }
      // Push to talk: tapping the mic again while it is listening stops the
      // recording and sends it, instead of silently closing the overlay.
      if (isListening || isTranscribing) {
        if (isTranscribing) return;
        stopWhisperCapture();
        return;
      }
      // Idle inside voice mode: first tap restarts listening. Once a turn has
      // been sent, the mic button closes voice mode instead, so you can
      // never get stuck in a loop of taps.
      if (voicePhase === 'idle' && !isPaused && conversationActive && !orbTapped) {
        startAutoListening();
        return;
      }
      closeVoice();
    });
    if(elsNow.btnClose) elsNow.btnClose.addEventListener('click', closeVoice);
    // The orb doubles as push to talk: tap to start, tap again to send.
    var micTap = document.getElementById('voice-orb-wrap');
    if (micTap && !micTap.dataset.tapBound) {
      micTap.dataset.tapBound = '1';
      var onOrbTap = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (!isOverlayOpen || !conversationActive) return;
        if (isTranscribing) return;
        if (isListening) { stopWhisperCapture(); return; }
        if (isPaused) { resumeConversation(); return; }
        orbTapped = true;
        if (voicePhase === 'idle') startAutoListening();
      };
      micTap.addEventListener('click', onOrbTap);
      micTap.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') onOrbTap(e);
      });
    }
    if(elsNow.btnExit) elsNow.btnExit.addEventListener('click', closeVoice);
    if(elsNow.overlay) elsNow.overlay.addEventListener('click', (e)=>{
      var t = e.target;
      if(t===elsNow.overlay || (t && t.classList && t.classList.contains('voice-overlay-bg'))) closeVoice();
    });
    var bg = document.querySelector('#voice-overlay .voice-overlay-bg');
    if(bg && !bg.dataset.vcBgBound){ bg.dataset.vcBgBound='1'; bg.addEventListener('click', closeVoice); }
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

  window.AnteemoneeVoice={ open: openVoice, close: closeVoice, start: startAutoListening, stop: stopListening, speak: speakText, stopSpeaking, toggleSpeak, isSpeaking, onAiResponseComplete, pause: pauseConversation, resume: resumeConversation, toggleMute, vadStats: vadStats, resetVadStats: resetVadStats, get isPaused(){return isPaused;}, get isMuted(){return isMuted;}, get isConversationActive(){return conversationActive;}, get voiceMode(){return isOverlayOpen;}, get model(){return WHISPER_MODEL;} };
})();
