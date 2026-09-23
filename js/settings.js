/* =========================================================
   Anteemonee SETTINGS - Complete Settings Logic
   ========================================================= */

let settingsPrefs = null;
let settingsEntitlements = null;
let savePrefTimer = null;

/* =========================
   INIT
   ========================= */

document.addEventListener('DOMContentLoaded', initSettings);

let settingsInlineReady = false;
let settingsInlineIniting = false;

/* Inline mode (main-page popup): idempotent init + refresh on open. */
async function ensureInlineSettings() {
  if (settingsInlineReady) {
    try { await refreshInlineSettings(); } catch (_) {}
    return;
  }
  if (settingsInlineIniting) return;
  settingsInlineIniting = true;
  try {
    // Wait briefly for app.js auth (main page boots async).
    for (let i = 0; i < 20; i++) {
      try {
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 250));
      try {
        if (typeof db !== 'undefined' && db) {
          const { data } = await db.auth.getSession();
          if (data && data.session && data.session.user) break;
        }
      } catch (_) {}
      if (i === 4) { try { await initSettings(); } catch (_) {} }
    }
    await initSettings();
  } finally {
    settingsInlineIniting = false;
  }
}

async function refreshInlineSettings() {
  try {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    settingsPrefs = await loadUserPrefs();
    applyReduceAnimations();
    renderSecurity();
    renderAI();
    renderAppearance();
    renderLanguage();
    renderPrivacy();
    await renderSubscription();
    await renderCoupons();
    renderConnected();
    renderVoiceCall();
    renderHelp();
    renderDangerZone();
  } catch (e) {
    console.warn('[settings] refresh failed:', e);
  }
}

async function initSettings() {
  const notAuthEl = document.getElementById('settings-not-auth');
  const pageEl = document.getElementById('settings-page');
  if (!notAuthEl && !pageEl) return; // not on this page
  if (settingsInlineReady) return;
  try {
    await checkAuth();
  } catch (_) {}
  if (typeof currentUser === 'undefined' || !currentUser) {
    if (notAuthEl) notAuthEl.style.display = 'block';
    if (pageEl) pageEl.style.display = 'none';
    return;
  }
  if (notAuthEl) notAuthEl.style.display = 'none';
  if (pageEl) pageEl.style.display = 'block';
  await ensureProfile();
  settingsPrefs = await loadUserPrefs();
  applyReduceAnimations();
  renderSecurity();
  renderAI();
  renderAppearance();
  renderLanguage();
  renderPrivacy();
  await renderSubscription();
  await renderCoupons();
  renderConnected();
  renderAccounts();
  renderVoiceCall();
  renderHelp();
  renderDangerZone();
  setupNavSidebar();
  setupDeleteConfirmInput();
  settingsInlineReady = true;
}

/* =========================
   SHARED COMPONENTS
   ========================= */

function togglePwVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

function buildToggle(id, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  label.appendChild(input);
  label.appendChild(slider);
  return label;
}

function buildSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'setting-select';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (String(opt.value) === String(value)) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function buildRow(title, desc, rightEl) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const info = document.createElement('div');
  info.className = 'setting-info';
  info.innerHTML = `<div class="setting-title">${title}</div>${desc ? `<div class="setting-desc">${desc}</div>` : ''}`;
  row.appendChild(info);
  if (rightEl) {
    if (typeof rightEl === 'string') {
      row.insertAdjacentHTML('beforeend', rightEl);
    } else {
      row.appendChild(rightEl);
    }
  }
  return row;
}

function buildCard(headerText, rows) {
  const card = document.createElement('div');
  card.className = 'settings-card';
  if (headerText) {
    const h = document.createElement('div');
    h.className = 'settings-card-header';
    h.textContent = headerText;
    card.appendChild(h);
  }
  rows.forEach(r => card.appendChild(r));
  return card;
}

function buildClickableRow(title, desc, onClick) {
  const row = document.createElement('div');
  row.className = 'setting-row clickable';
  row.innerHTML = `<div class="setting-info"><div class="setting-title">${title}</div><div class="setting-desc">${desc || ''}</div></div><span class="setting-arrow">&#8250;</span>`;
  row.addEventListener('click', onClick);
  return row;
}

function showToastSettings(msg, isError) {
  const t = document.getElementById('settings-toast');
  t.textContent = msg;
  t.className = 'settings-toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
}

let savePrefTimers = {};
function savePref(key, value) {
  settingsPrefs = { ...settingsPrefs, [key]: value };
  // Local mirror so the chatbot toggle works instantly, even before the DB column exists
  try {
    var uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : 'anon';
    if (key === 'ai_references') localStorage.setItem('Anteemonee_ai_references_' + uid, value ? '1' : '0');
  } catch (_) {}
  clearTimeout(savePrefTimers[key]);
  savePrefTimers[key] = setTimeout(async () => {
    try {
      await saveUserPrefs({ [key]: value });
      showToastSettings('Saved');
    } catch (e) {
      showToastSettings('Failed to save', true);
    }
  }, 400);
}

function badge(type, text) {
  return `<span class="status-badge ${type}">${text}</span>`;
}

function applyReduceAnimations() {
  if (settingsPrefs?.reduce_animations) {
    document.documentElement.classList.add('reduce-anim');
  } else {
    document.documentElement.classList.remove('reduce-anim');
  }
}

/* =========================
   SIDEBAR NAV (paged: one section visible at a time)
   ========================= */

function setupNavSidebar() {
  const btns = document.querySelectorAll('.settings-nav-item[data-cat]');
  btns.forEach(btn => {
    if (btn.dataset.navBound) return;
    btn.dataset.navBound = '1';
    btn.addEventListener('click', () => switchCategory(btn.dataset.cat));
  });
  const hash = window.location.hash.replace('#', '');
  if (hash && document.querySelector(`.settings-category[data-cat="${hash}"]`)) {
    switchCategory(hash);
  }
}

function switchCategory(cat) {
  document.querySelectorAll('#settings-overlay .settings-nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`#settings-overlay .settings-nav-item[data-cat="${cat}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('#settings-overlay .settings-category').forEach(c => c.classList.remove('active'));
  const target = document.querySelector(`#settings-overlay .settings-category[data-cat="${cat}"]`);
  if (target) {
    target.classList.add('active');
    try {
      const scroller = document.getElementById('settings-page');
      if (scroller) scroller.scrollTop = 0;
    } catch (_) {}
  }
  try { window.history.replaceState(null, '', '#' + cat); } catch (_) {}
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
}

function showSidebar() {
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar) sidebar.classList.add('open');
}

/* =========================
   1. LOGIN & SECURITY
   ========================= */

function renderSecurity() {
  const c = document.getElementById('settings-security-content');
  if (!c) return;
  c.innerHTML = '';

  const pwCard = document.createElement('div');
  pwCard.className = 'settings-card';
  pwCard.innerHTML = `
    <div class="settings-card-header">CHANGE PASSWORD</div>
    <div style="padding:16px 20px 20px">
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Current Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-current-pw" placeholder="Enter current password" style="max-width:100%;padding-right:40px">
          <button type="button" class="pw-toggle" onclick="togglePwVis('sec-current-pw', this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" aria-label="Toggle password visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">New Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-new-pw" placeholder="Min 8 chars, 1 uppercase, 1 number" style="max-width:100%;padding-right:40px">
          <button type="button" class="pw-toggle" onclick="togglePwVis('sec-new-pw', this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" aria-label="Toggle password visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Confirm New Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-confirm-pw" placeholder="Re-enter new password" style="max-width:100%;padding-right:40px">
          <button type="button" class="pw-toggle" onclick="togglePwVis('sec-confirm-pw', this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" aria-label="Toggle password visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div id="sec-pw-error" style="color:#FF6675;font-size:13px;margin-bottom:10px;display:none"></div>
      <div id="sec-pw-success" style="color:var(--success);font-size:13px;margin-bottom:10px;display:none"></div>
      <button class="btn-settings btn-settings-primary" id="sec-pw-btn" onclick="changePassword()">Update Password</button>
    </div>`;
  c.appendChild(pwCard);

  const tfaCard = document.createElement('div');
  tfaCard.className = 'settings-card';
  tfaCard.id = 'settings-2fa-card';
  tfaCard.innerHTML = `
    <div class="settings-card-header">TWO-FACTOR AUTHENTICATION</div>
    <div class="skeleton-row"><div class="skeleton skeleton-text w-60"></div><div class="skeleton skeleton-text w-20" style="height:24px;border-radius:12px"></div></div>`;
  c.appendChild(tfaCard);
  load2FAStatus();
}

async function changePassword() {
  const current = document.getElementById('sec-current-pw').value;
  const newPw = document.getElementById('sec-new-pw').value;
  const confirm = document.getElementById('sec-confirm-pw').value;
  const errEl = document.getElementById('sec-pw-error');
  const okEl = document.getElementById('sec-pw-success');
  const btn = document.getElementById('sec-pw-btn');

  errEl.style.display = 'none';
  okEl.style.display = 'none';

  if (!current || !newPw || !confirm) {
    errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return;
  }
  if (newPw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display = 'block'; return;
  }
  if (!/[A-Z]/.test(newPw)) {
    errEl.textContent = 'Password must contain an uppercase letter.'; errEl.style.display = 'block'; return;
  }
  if (!/[0-9]/.test(newPw)) {
    errEl.textContent = 'Password must contain a number.'; errEl.style.display = 'block'; return;
  }
  if (newPw !== confirm) {
    errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return;
  }

  setLoading(btn, true);
  try {
    const { error } = await db.auth.updateUser({ password: newPw });
    if (error) throw error;
    okEl.textContent = 'Password updated successfully.';
    okEl.style.display = 'block';
    document.getElementById('sec-current-pw').value = '';
    document.getElementById('sec-new-pw').value = '';
    document.getElementById('sec-confirm-pw').value = '';
    await recordSecurityEvent('password_changed');
    showToastSettings('Password updated');
  } catch (err) {
    errEl.textContent = err.message || 'Failed to update password.';
    errEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

/* ---- Two-Factor Authentication ---- */

let tfaFactors = [];

async function load2FAStatus() {
  const card = document.getElementById('settings-2fa-card');
  try {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    const allTotp = data?.totp || [];
    tfaFactors = allTotp.filter(f => f.status === 'verified');
    window._tfaUnverified = allTotp.filter(f => f.status === 'unverified');
  } catch {
    tfaFactors = [];
    window._tfaUnverified = [];
  }
  render2FA(card);
}

function render2FA(card) {
  const enabled = tfaFactors.length > 0;
  const hasUnverified = (window._tfaUnverified || []).length > 0;
  card.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'settings-card-header';
  header.textContent = 'TWO-FACTOR AUTHENTICATION';
  card.appendChild(header);

  const row = document.createElement('div');
  row.className = 'setting-row';
  const info = document.createElement('div');
  info.className = 'setting-info';
  if (enabled) {
    info.innerHTML = `<div class="setting-title">Authenticator App</div><div class="setting-desc">Protects your account with a TOTP code</div>`;
  } else if (hasUnverified) {
    info.innerHTML = `<div class="setting-title">Authenticator App</div><div class="setting-desc" style="color:#FBBF24">Setup incomplete - finish or restart setup</div>`;
  } else {
    info.innerHTML = `<div class="setting-title">Authenticator App</div><div class="setting-desc">Add an extra layer of security</div>`;
  }
  row.appendChild(info);

  if (enabled) {
    const badgeEl = document.createElement('span');
    badgeEl.innerHTML = badge('active', 'Enabled');
    const disableBtn = document.createElement('button');
    disableBtn.className = 'btn-settings btn-settings-danger';
    disableBtn.textContent = 'Disable';
    disableBtn.style.marginLeft = '8px';
    disableBtn.addEventListener('click', disable2FA);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
    wrap.appendChild(badgeEl);
    wrap.appendChild(disableBtn);
    row.appendChild(wrap);
  } else {
    const enableBtn = document.createElement('button');
    enableBtn.className = 'btn-settings btn-settings-primary';
    enableBtn.textContent = hasUnverified ? 'Continue Setup' : 'Enable';
    enableBtn.addEventListener('click', startEnable2FA);
    row.appendChild(enableBtn);
  }
  card.appendChild(row);
}

async function startEnable2FA() {
  const card = document.getElementById('settings-2fa-card');
  card.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'settings-card-header';
  header.textContent = 'SET UP AUTHENTICATOR';
  card.appendChild(header);

  const body = document.createElement('div');
  body.style.padding = '16px 20px 20px';
  body.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">Scanning the QR code with your authenticator app (Google Authenticator, Authy, etc.)</p><div id="tfa-qr-area" style="text-align:center;margin-bottom:16px"></div><div style="margin-bottom:12px"><label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Enter the 6-digit code from your app</label><input type="text" class="setting-input" id="tfa-code" placeholder="000000" maxlength="6" style="max-width:200px;text-align:center;font-size:18px;letter-spacing:4px"></div><div id="tfa-error" style="color:#FF6675;font-size:13px;margin-bottom:10px;display:none"></div><div style="display:flex;gap:8px"><button class="btn-settings btn-settings-primary" id="tfa-verify-btn" onclick="verify2FASetup()">Verify & Enable</button><button class="btn-settings btn-settings-ghost" onclick="load2FAStatus()">Cancel</button></div>';
  card.appendChild(body);

  try {
    const { data: factorsData } = await db.auth.mfa.listFactors();
    const allTotp = factorsData?.totp || [];
    const unverifiedFactors = allTotp.filter(f => f.status === 'unverified');
    const verifiedFactors = allTotp.filter(f => f.status === 'verified');

    if (verifiedFactors.length > 0) {
      const errEl = document.getElementById('tfa-error');
      if (errEl) { errEl.textContent = 'Authenticator is already enabled. Disable it first to set up a new one.'; errEl.style.display = 'block'; }
      return;
    }

    if (unverifiedFactors.length > 0) {
      const existing = unverifiedFactors[0];
      window._tfaFactorId = existing.id;
      try {
        const { data: reenrollData, error: reenrollErr } = await db.auth.mfa.unenroll({ factorId: existing.id });
      } catch (_) {}
      const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
      if (error) throw error;
      window._tfaFactorId = data.id;
      const qrArea = document.getElementById('tfa-qr-area');
      if (data.totp?.qr_code) {
        qrArea.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'background:#fff;padding:16px;border-radius:12px;display:inline-block';
        const img = document.createElement('img');
        img.src = data.totp.qr_code;
        img.alt = 'QR Code';
        img.style.cssText = 'width:180px;height:180px;display:block';
        wrap.appendChild(img);
        qrArea.appendChild(wrap);
      } else if (data.totp?.uri) {
        qrArea.innerHTML = `<div style="background:#fff;padding:16px;border-radius:12px;display:inline-block"><canvas id="tfa-qr-canvas"></canvas></div>`;
        drawQR(data.totp.uri);
      } else {
        qrArea.innerHTML = `<p style="color:var(--text-secondary);font-size:13px">Enter this secret manually:<br><code style="background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:6px;font-size:14px">${data.totp?.secret || 'Unknown'}</code></p>`;
      }
      return;
    }

    const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
    if (error) throw error;
    window._tfaFactorId = data.id;
    const qrArea = document.getElementById('tfa-qr-area');
    if (data.totp?.qr_code) {
      qrArea.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'background:#fff;padding:16px;border-radius:12px;display:inline-block';
      const img = document.createElement('img');
      img.src = data.totp.qr_code;
      img.alt = 'QR Code';
      img.style.cssText = 'width:180px;height:180px;display:block';
      img.onerror = () => { wrap.innerHTML = '<p style="color:#888;font-size:13px">QR code failed to load. Use the secret below.</p>'; };
      wrap.appendChild(img);
      qrArea.appendChild(wrap);
    } else if (data.totp?.uri) {
      qrArea.innerHTML = `<div style="background:#fff;padding:16px;border-radius:12px;display:inline-block"><canvas id="tfa-qr-canvas"></canvas></div>`;
      drawQR(data.totp.uri);
    } else {
      qrArea.innerHTML = `<p style="color:var(--text-secondary);font-size:13px">If you cannot scan the QR code, enter this secret manually:<br><code style="background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:6px;font-size:14px">${data.totp?.secret || 'Unknown'}</code></p>`;
    }
  } catch (err) {
    const errEl = document.getElementById('tfa-error');
    if (errEl) { errEl.textContent = err.message || 'Failed to start 2FA setup.'; errEl.style.display = 'block'; }
  }
}

async function cancelAndRestart2FA() {
  try {
    const { data: factorsData } = await db.auth.mfa.listFactors();
    const unverifiedFactors = (factorsData?.totp || []).filter(f => f.status === 'unverified');
    for (const f of unverifiedFactors) {
      await db.auth.mfa.unenroll({ factorId: f.id });
    }
  } catch (e) {}
  startEnable2FA();
}

function drawQR(uri) {
  try {
    const canvas = document.getElementById('tfa-qr-canvas');
    if (!canvas) return;
    canvas.width = 164; canvas.height = 164;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 164, 164);
    ctx.fillStyle = '#000';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Scan this URI:', 82, 80);
    ctx.fillText(uri.substring(0, 40) + '...', 82, 100);
  } catch (e) {}
}

async function verify2FASetup() {
  const code = document.getElementById('tfa-code').value.trim();
  const errEl = document.getElementById('tfa-error');
  const btn = document.getElementById('tfa-verify-btn');
  errEl.style.display = 'none';

  if (!code || code.length !== 6) {
    errEl.textContent = 'Please enter a 6-digit code.'; errEl.style.display = 'block'; return;
  }

  setLoading(btn, true);
  try {
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: window._tfaFactorId, code });
    if (error) throw error;
    await recordSecurityEvent('2fa_enabled');
    showToastSettings('Two-factor authentication enabled');
    await load2FAStatus();
  } catch (err) {
    errEl.textContent = err.message || 'Invalid code. Please try again.';
    errEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

async function disable2FA() {
  if (!tfaFactors.length) return;
  if (!confirm('Disable two-factor authentication? This makes your account less secure.')) return;

  const factor = tfaFactors[0];
  try {
    const { error: challengeErr } = await db.auth.mfa.challenge({ factorId: factor.id });
    if (challengeErr) throw challengeErr;
    const { error: unenrollErr } = await db.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollErr) throw unenrollErr;
    await recordSecurityEvent('2fa_disabled');
    showToastSettings('Two-factor authentication disabled');
    tfaFactors = [];
    render2FA(document.getElementById('settings-2fa-card'));
  } catch (err) {
    showToastSettings(err.message || 'Failed to disable 2FA', true);
  }
}


/* =========================
   3. AI PERSONALIZATION
   ========================= */

function renderAI() {
  const c = document.getElementById('settings-ai-content');
  if (!c) return;
  c.innerHTML = '';
  const p = settingsPrefs || {};

  // Personalization card â€” custom instructions textarea
  const personalCard = document.createElement('div');
  personalCard.className = 'settings-card';
  personalCard.innerHTML = `
    <div class="settings-card-header">PERSONALIZE YOUR AI</div>
    <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="setting-info">
        <div class="setting-title">Tell the AI how you want it to behave</div>
        <div class="setting-desc">E.g. "I'm a visual learner, use diagrams. Be friendly. Speak simply. I prefer Roman Urdu for chemistry terms."</div>
      </div>
      <textarea id="ai-personalization-input" class="setting-input" rows="6" placeholder="Type how you want your AI to respond, teach, explain..." style="font-size:13px;min-height:120px;width:100%;max-width:none;"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span id="ai-personalization-status" style="font-size:11px;color:var(--text-muted);"></span>
        <button id="btn-save-personalization" class="btn-settings btn-settings-primary">Save</button>
      </div>
    </div>`;
  c.appendChild(personalCard);

  const ta = personalCard.querySelector('#ai-personalization-input');
  const statusEl = personalCard.querySelector('#ai-personalization-status');
  const saveBtn = personalCard.querySelector('#btn-save-personalization');

  // Load saved value
  ta.value = p.ai_personalization || '';
  if (p.ai_personalization) {
    statusEl.textContent = 'Saved';
    statusEl.style.color = 'var(--accent)';
  }

  // Debounced auto-save on typing
  let personalTimer;
  ta.addEventListener('input', () => {
    statusEl.textContent = 'Unsaved';
    statusEl.style.color = 'var(--text-muted)';
    clearTimeout(personalTimer);
    personalTimer = setTimeout(() => savePersonalization(ta.value), 800);
  });

  // Save button
  saveBtn.addEventListener('click', () => savePersonalization(ta.value));

  async function savePersonalization(value) {
    try {
      await saveUserPrefs({ ai_personalization: value });
      statusEl.textContent = 'Saved';
      statusEl.style.color = 'var(--accent)';
      showToastSettings('Personalization saved');
    } catch (e) {
      showToastSettings('Failed to save', true);
    }
  }

  const responseRows = [
    buildRow('Response Style', 'How detailed the AI responds', buildSelect([
      { value: 'concise', label: 'Concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
    ], p.ai_response_style, v => savePref('ai_response_style', v))),
  ];
  c.appendChild(buildCard('RESPONSE STYLE', responseRows));

  const explRows = [
    buildRow('Explanation Level', 'Depth of concept explanations', buildSelect([
      { value: 'simple', label: 'Simple' },
      { value: 'standard', label: 'Standard' },
      { value: 'advanced', label: 'Advanced' },
    ], p.ai_explanation_level || 'standard', v => savePref('ai_explanation_level', v))),
  ];
  c.appendChild(buildCard('EXPLANATION', explRows));

  // Voice controls are hidden for now (voice responses stay on by default).
  // const voiceRows = [...] (removed from UI)

  const prefRows = [
    buildRow('Study Suggestions', 'Show AI study recommendations', buildToggle('t-ai_suggest', p.ai_study_recommendations, v => savePref('ai_study_recommendations', v))),
    buildRow('Emojis', 'Use emojis in AI responses', buildToggle('t-ai_emojis', p.ai_emojis === true, v => savePref('ai_emojis', v))),
    buildRow('References', 'Show book pages + website sources after every AI response (off by default)', buildToggle('t-ai_references', p.ai_references === true, v => savePref('ai_references', v))),
  ];
  c.appendChild(buildCard('SUGGESTIONS', prefRows));

  const memRows = [
    buildRow('AI Memory', 'Remember details from chats to personalize answers', buildToggle('t-ai_memory', p.ai_memory_enabled !== false, v => savePref('ai_memory_enabled', v))),
    buildClickableRow('Clear AI Memory', 'Delete everything the AI remembers about you', clearAiMemory),
  ];

  // What AI knows about me â€” custom row with download button
  const knowRow = document.createElement('div');
  knowRow.className = 'setting-row';
  knowRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-title">What AI knows about me</div>
      <div class="setting-desc" id="memory-last-updated">Loading...</div>
    </div>
    <button id="btn-download-ai-profile" style="
      display:flex;align-items:center;gap:6px;
      padding:7px 16px;border-radius:8px;border:none;
      background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:600;
      cursor:pointer;transition:all .2s;white-space:nowrap;
      box-shadow:0 2px 8px rgba(99,102,241,.3);
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download
    </button>`;
  knowRow.querySelector('#btn-download-ai-profile').addEventListener('click', (e) => {
    e.stopPropagation();
    downloadAiMemoryProfile();
  });
  knowRow.querySelector('#btn-download-ai-profile').addEventListener('mouseenter', (e) => {
    e.currentTarget.style.transform = 'translateY(-1px)';
    e.currentTarget.style.boxShadow = '0 4px 12px rgba(99,102,241,.4)';
  });
  knowRow.querySelector('#btn-download-ai-profile').addEventListener('mouseleave', (e) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,.3)';
  });
  memRows.push(knowRow);

  const memCard = buildCard('MEMORY', memRows);
  memCard.id = 'memory-card';
  c.appendChild(memCard);

  loadMemoryLastUpdated();
}

async function clearAiMemory() {
  if (!currentUser) return;
  if (!confirm('Delete all AI memories? The tutor will forget everything it learned about you. This cannot be undone.')) return;
  try {
    const { error } = await db.from('user_ai_memories').delete().eq('user_id', currentUser.id);
    if (error) throw error;
    showToastSettings('AI memory cleared');
    const el = document.getElementById('memory-last-updated');
    if (el) el.textContent = 'No memories stored yet';
  } catch (e) {
    showToastSettings('Failed to clear memory', true);
  }
}

async function downloadAiMemoryProfile() {
  if (!currentUser) return;
  try {
    const { data, error } = await db.from('user_ai_memories')
      .select('category, fact, created_at, updated_at')
      .eq('user_id', currentUser.id)
      .order('category');
    if (error) throw error;
    if (!data || data.length === 0) {
      showToastSettings('No memories stored yet. Start chatting with the AI!');
      return;
    }

    const categoryLabels = {
      identity: 'Identity',
      academic: 'Academic Info',
      goals: 'Goals',
      strengths: 'Strengths',
      weaknesses: 'Weaknesses',
      preferences: 'Preferences',
      exams: 'Exams',
      friends: 'Friends',
      crush: 'Crush',
      family: 'Family',
      behavior: 'Behavior',
      habits: 'Habits',
      struggles: 'Struggles',
      interests: 'Interests',
      personality: 'Personality',
      fact: 'Other Facts',
    };

    const grouped = {};
    data.forEach(m => {
      const cat = m.category || 'fact';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m);
    });

    const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
    let txt = '=====================================\n';
    txt += '       Anteemonee - USER PROFILE\n';
    txt += '=====================================\n\n';
    txt += 'User: ' + (currentUser.email || 'Unknown') + '\n';
    txt += 'Generated: ' + now + '\n';
    txt += 'Total facts: ' + data.length + '\n\n';
    txt += '-------------------------------------\n\n';

    const catOrder = [
      'identity', 'academic', 'goals', 'friends', 'crush', 'family',
      'personality', 'behavior', 'habits', 'interests', 'strengths',
      'weaknesses', 'struggles', 'exams', 'preferences', 'fact'
    ];

    catOrder.forEach(cat => {
      if (!grouped[cat] || grouped[cat].length === 0) return;
      const label = categoryLabels[cat] || cat;
      txt += '--- ' + label.toUpperCase() + ' ---\n\n';
      grouped[cat].forEach(m => {
        const ts = m.updated_at ? new Date(m.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        txt += '  * ' + m.fact;
        if (ts) txt += '  [' + ts + ']';
        txt += '\n';
      });
      txt += '\n';
      delete grouped[cat];
    });

    // Any remaining uncategorized
    Object.keys(grouped).forEach(cat => {
      if (grouped[cat].length === 0) return;
      const label = categoryLabels[cat] || cat;
      txt += '--- ' + label.toUpperCase() + ' ---\n\n';
      grouped[cat].forEach(m => {
        const ts = m.updated_at ? new Date(m.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        txt += '  * ' + m.fact;
        if (ts) txt += '  [' + ts + ']';
        txt += '\n';
      });
      txt += '\n';
    });

    txt += '=====================================\n';
    txt += 'Generated by Anteemonee - Your Student OS\n';
    txt += '=====================================\n';

    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Anteemonee-ai-profile-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToastSettings('Profile downloaded!');
  } catch (e) {
    console.error('[Settings] Download AI profile failed:', e);
    showToastSettings('Failed to download profile', true);
  }
}

async function loadMemoryLastUpdated() {
  if (!currentUser) return;
  const el = document.getElementById('memory-last-updated');
  try {
    const { data } = await db.from('user_ai_memories')
      .select('updated_at')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.updated_at) {
      const ts = new Date(data.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      if (el) el.textContent = 'Last updated: ' + ts;
    } else if (el) {
      el.textContent = 'No memories stored yet';
    }
  } catch (_) {
    if (el) el.textContent = '';
  }
}

/* =========================
   4. APPEARANCE
   ========================= */

function renderAppearance() {
  const c = document.getElementById('settings-appearance-content');
  if (!c) return;
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const rows = [
    buildRow('Theme', 'Light, dark, or follow your device', buildSelect([
      { value: 'system', label: 'Device default' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ], (window.AnteemoneeTheme ? window.AnteemoneeTheme.get() : 'system'), v => {
      if (window.AnteemoneeTheme) window.AnteemoneeTheme.set(v);
      // Embedded popup (iframe): apply to the parent page too (same origin).
      try {
        if (window.top && window.top !== window.self && window.top.AnteemoneeTheme) {
          window.top.AnteemoneeTheme.set(v);
        }
      } catch (_) {}
    })),
  ];
  c.appendChild(buildCard('APPEARANCE', rows));
}

/* =========================
   5. LANGUAGE
   ========================= */

function renderLanguage() {
  const c = document.getElementById('settings-language-content');
  if (!c) return;
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const rows = [
    buildRow('App Language', 'Interface language', buildSelect([
      { value: 'english', label: 'English' },
      { value: 'urdu', label: 'Urdu' },
    ], p.app_language, v => savePref('app_language', v))),
    buildRow('Textbook Language', 'Language for learning content', buildSelect([
      { value: 'english', label: 'English' },
      { value: 'urdu', label: 'Urdu' },
    ], p.textbook_language, v => savePref('textbook_language', v))),
  ];
  c.appendChild(buildCard('LANGUAGE', rows));
}

/* =========================
   6. PRIVACY
   ========================= */

function renderPrivacy() {
  const c = document.getElementById('settings-privacy-content');
  if (!c) return;
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const visRows = [
    buildRow('Profile Visibility', 'Who can see your profile', buildSelect([
      { value: 'private', label: 'Only Me' },
      { value: 'public', label: 'Everyone' },
    ], p.privacy_profile_visibility, v => savePref('privacy_profile_visibility', v))),
  ];
  c.appendChild(buildCard('VISIBILITY', visRows));

  const dataRows = [
    buildRow('AI History', 'Save AI conversation history', buildToggle('t-priv_ai', p.privacy_ai_history, v => savePref('privacy_ai_history', v))),
    buildRow('Personalization', 'Use activity for personalized recommendations', buildToggle('t-priv_personal', p.privacy_personalization, v => savePref('privacy_personalization', v))),
    buildRow('Learning History', 'Track learning activity for progress', buildToggle('t-priv_learn', p.privacy_learning_history, v => savePref('privacy_learning_history', v))),
  ];
  c.appendChild(buildCard('DATA & PERSONALIZATION', dataRows));
}

/* =========================
   7. SUBSCRIPTION
   ========================= */

async function renderSubscription() {
  const c = document.getElementById('settings-subscription-content');
  if (!c) return;
  c.innerHTML = '';

  const planCard = document.createElement('div');
  planCard.className = 'settings-card';
  planCard.innerHTML = '<div class="skeleton-row"><div class="skeleton skeleton-text w-60"></div><div class="skeleton skeleton-text w-20" style="height:24px;border-radius:12px"></div></div>';
  c.appendChild(planCard);

  try {
    const { data, error } = await db.rpc('get_entitlement_snapshot');
    if (error) throw error;
    settingsEntitlements = data;
  } catch {
    settingsEntitlements = null;
  }
  try { if (typeof Access !== 'undefined') await Access.init(); } catch (_) {}

  renderSubscriptionContent(c, planCard);
}

function renderSubscriptionContent(container, planCard) {
  container.removeChild(planCard);
  const ent = settingsEntitlements;
  const paid = (typeof Access !== 'undefined' && Access.isPaidEntitlement(ent))
    || (ent && (ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active');
  const trial = (typeof Access !== 'undefined' && Access.state.ready) ? Access.state : { reason: 'unknown', daysLeft: 0, trialEndsAt: null };

  const currentCard = document.createElement('div');
  currentCard.className = 'settings-card';
  if (paid) {
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon pro">&#10024;</div>
        <div class="plan-info">
          <h4>Anteemonee Lifetime ${badge('premium', 'Active')}</h4>
          <p>One-time payment · Yours forever</p>
        </div>
      </div>`;
  } else if (trial.reason === 'trial') {
    const endStr = trial.trialEndsAt ? new Date(trial.trialEndsAt).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#9201;</div>
        <div class="plan-info">
          <h4>Free Trial ${badge('active', trial.daysLeft <= 1 ? 'Ends today' : trial.daysLeft + ' days left')}</h4>
          <p>Full access until ${endStr}. Get lifetime access before it ends.</p>
        </div>
      </div>`;
  } else if (trial.reason === 'blocked') {
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#128218;</div>
        <div class="plan-info">
          <h4>Trial Unavailable</h4>
          <p>This device has already used its free trial. Get lifetime access to continue.</p>
        </div>
      </div>`;
  } else {
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#128218;</div>
        <div class="plan-info">
          <h4>Trial Expired</h4>
          <p>Your 3-day free trial has ended. Get lifetime access to continue.</p>
        </div>
      </div>`;
  }
  container.appendChild(currentCard);

  if (!paid) {
    const upgradeCard = document.createElement('div');
    upgradeCard.className = 'settings-card';
    upgradeCard.innerHTML = `
      <div style="padding:16px 20px 0">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-secondary);margin-bottom:8px">Anteemonee Lifetime</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:16px">Pay once. Yours forever. No subscriptions.</div>
      </div>
      <div style="padding:0 20px 20px">
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:20px">
          <span style="font-family:var(--font-display);font-size:32px;font-weight:700;color:var(--accent)">Rs 2,499</span>
          <span style="font-size:14px;color:var(--text-secondary)">one-time</span>
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 20px;font-size:14px">
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>Full AI Tutor access, forever</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>All flashcards, eBooks &amp; study tools</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>All future features included</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>One active session per account</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>7-day money-back guarantee</span></li>
        </ul>
        <a href="payment.html" class="btn-settings btn-settings-primary" style="display:inline-block;text-decoration:none;text-align:center;width:100%;box-sizing:border-box">Get Lifetime Access - Rs 2,499</a>
      </div>`;
    container.appendChild(upgradeCard);
  }

  const planLabel = paid ? 'Lifetime' : trial.reason === 'trial' ? 'Free Trial' : trial.reason === 'blocked' ? 'Trial Unavailable' : 'Expired';
  const statusLabel = paid ? 'active' : trial.reason === 'trial' ? 'trial' : 'expired';

  const usageRows = [
    buildRow('Plan Type', planLabel, paid ? badge('premium', 'Lifetime') : trial.reason === 'trial' ? badge('active', 'Trial') : badge('inactive', 'Expired')),
    buildRow('Status', statusLabel, badge(paid ? 'active' : trial.reason === 'trial' ? 'active' : 'inactive', statusLabel)),
  ];
  container.appendChild(buildCard('USAGE', usageRows));
}

/* =========================
   8. COUPONS
   ========================= */

async function renderCoupons() {
  const c = document.getElementById('settings-coupons-content');
  if (!c) return;
  c.innerHTML = '<div class="skeleton" style="height:120px;margin:16px 0"></div>';

  try {
    const { data: redemptions } = await db.from('coupon_redemptions')
      .select('id, coupon_id, redeemed_at, premium_start_at, premium_expiry_at')
      .eq('user_id', currentUser.id)
      .order('redeemed_at', { ascending: false });

    const hasRedeemed = redemptions && redemptions.length > 0;

    c.innerHTML = '';

    if (hasRedeemed) {
      const r = redemptions[0];

      const statusCard = document.createElement('div');
      statusCard.className = 'settings-card';
      statusCard.innerHTML = `
        <div class="settings-card-header">COUPON STATUS</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-title" style="color:var(--success)">Coupon Redeemed</div>
            <div class="setting-desc">Lifetime access granted — no expiry</div>
          </div>
          <span class="status-badge premium">Lifetime</span>
        </div>`;
      c.appendChild(statusCard);
    } else {
      const inputCard = document.createElement('div');
      inputCard.className = 'settings-card';
      inputCard.innerHTML = `
        <div class="settings-card-header">REDEEM COUPON</div>
        <div class="coupon-input-group">
          <input type="text" class="setting-input" id="coupon-code" placeholder="Enter coupon code" style="text-transform:uppercase" maxlength="20">
          <button class="btn-settings btn-settings-primary" id="coupon-btn" onclick="redeemCoupon()">Redeem</button>
        </div>
        <div id="coupon-msg" style="padding:0 20px 16px;font-size:13px;display:none"></div>`;
      c.appendChild(inputCard);
    }


  } catch (e) {
    c.innerHTML = '<div class="settings-card"><div class="setting-row"><div class="setting-info"><div class="setting-title">Unable to load coupon info</div></div></div></div>';
  }
}

async function redeemCoupon() {
  const code = document.getElementById('coupon-code').value.trim();
  const msgEl = document.getElementById('coupon-msg');
  const btn = document.getElementById('coupon-btn');
  if (!code) return;

  const ERRORS = {
    INVALID: 'That coupon code isn\'t valid.',
    INACTIVE: 'This coupon is no longer active.',
    LIMIT_REACHED: 'This coupon has reached its redemption limit.',
    ALREADY_USED: 'You\'ve already used this coupon.',
    IP_USED: 'This coupon has already been redeemed from this network.',
    NOT_AUTHENTICATED: 'Please sign in first.',
    RATE_LIMITED: 'Too many attempts. Please wait a little and try again.',
    REDEEM_FAILED: 'Couldn\'t redeem the coupon. Please try again.',
  };

  msgEl.style.display = 'none';
  setLoading(btn, true);

  try {
    let result = null;

    // Try Edge Function first, fall back to RPC if not deployed
    try {
      const { data, error } = await db.functions.invoke('redeem-coupon', { body: { code } });
      if (error) throw error;
      result = data;
      // Edge Function returns {ok: true, months, premium_expires_at} or {ok: false, error: machine_code}
      if (result && !result.ok) {
        const msg = ERRORS[result.error] || ERRORS.REDEEM_FAILED;
        msgEl.textContent = msg;
        msgEl.style.color = '#FF6675';
        msgEl.style.display = 'block';
        return;
      }
    } catch (fnErr) {
      // Edge Function not deployed â€” fall back to RPC
      const { data, error } = await db.rpc('redeem_coupon_self', { p_code: code });
      if (error) throw error;
      result = data;
      // RPC returns jsonb: {ok: true, months, ...} or {ok: false, error: 'CODE'}
      if (result && !result.ok) {
        const msg = ERRORS[result.error] || ERRORS.REDEEM_FAILED;
        msgEl.textContent = msg;
        msgEl.style.color = '#FF6675';
        msgEl.style.display = 'block';
        return;
      }
    }

    // Success
    msgEl.textContent = 'Coupon redeemed! Lifetime access is now active.';
    msgEl.style.color = 'var(--success)';
    msgEl.style.display = 'block';
    document.getElementById('coupon-code').value = '';
    showToastSettings('Coupon redeemed!');
    // Refresh both subscription and coupon status
    await Promise.all([renderSubscription(), renderCoupons()]);
  } catch (err) {
    msgEl.textContent = err.message || 'Failed to redeem coupon.';
    msgEl.style.color = '#FF6675';
    msgEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

/* =========================
   9. CONNECTED ACCOUNTS
   ========================= */

function renderConnected() {
  const c = document.getElementById('settings-connected-content');
  if (!c) return;
  c.innerHTML = '';
  const providers = currentUser?.app_metadata?.providers || [];
  const identities = currentUser?.identities || [];
  const rows = [];

  const hasEmail = providers.includes('email');
  const hasGoogle = providers.includes('google');
  const hasSpotify = providers.includes('spotify');
  const providerCount = providers.length;
  const canDisconnectAny = providerCount > 1;

  if (hasEmail) {
    const emailIdentity = identities.find(i => i.provider === 'email');
    rows.push(buildProviderRow('email', 'Email & Password', emailIdentity ? currentUser.email : 'Not linked', true, false));
  }
  if (hasGoogle) {
    const googleIdentity = identities.find(i => i.provider === 'google');
    rows.push(buildProviderRow('google', 'Google', googleIdentity ? (googleIdentity.identity_data?.email || 'Connected') : 'Not linked', hasGoogle, canDisconnectAny, googleIdentity));
  }
  if (hasSpotify) {
    const spotIdentity = identities.find(i => i.provider === 'spotify');
    rows.push(buildProviderRow('spotify', 'Spotify', spotIdentity ? (spotIdentity.identity_data?.email || 'Connected') : 'Not linked', hasSpotify, canDisconnectAny, spotIdentity));
  }

  if (!rows.length) {
    rows.push(buildRow('No connected accounts', 'Sign in with email or a provider'));
  }

  c.appendChild(buildCard('LOGIN PROVIDERS', rows));

  const linkRows = [];
  if (!hasGoogle) {
    linkRows.push(buildClickableRow('Link Google', 'Connect your Google account for easier sign-in', async () => {
      await linkProvider('google');
    }));
  }
  if (!hasSpotify) {
    linkRows.push(buildClickableRow('Link Spotify', 'Connect your Spotify account', async () => {
      await linkProvider('spotify');
    }));
  }
  if (linkRows.length) {
    c.appendChild(buildCard('LINK ACCOUNTS', linkRows));
  }

  if (!canDisconnectAny && providerCount === 1) {
    const warnRows = [
      buildRow('Cannot disconnect your only login method', 'Add another provider (Google, Spotify, or Email) before disconnecting to avoid being locked out.'),
    ];
    c.appendChild(buildCard('SECURITY NOTE', warnRows));
  }
}

async function linkProvider(provider) {
  const providerName = provider === 'google' ? 'Google' : 'Spotify';

  try {
    const { data: profile, error: profileErr } = await db.from('profiles')
      .select('id')
      .neq('id', currentUser.id)
      .limit(1);

    if (profileErr) {
      console.warn('Pre-link check failed, proceeding anyway:', profileErr);
    }

    const { error } = await db.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/pages/auth/callback/' + provider + '.html',
        queryParams: { prompt: 'consent' }
      }
    });
    if (error) throw error;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('already linked') || msg.includes('identity_already_exists')) {
      showToastSettings(`This ${providerName} account is already linked to another Anteemonee account. Please use a different ${providerName} account.`, true);
    } else if (msg.includes('provider_disabled')) {
      showToastSettings(`${providerName} sign-in is not enabled. Please contact support.`, true);
    } else {
      showToastSettings(`Failed to link ${providerName}: ${msg || 'Unknown error'}`, true);
    }
  }
}

function buildProviderRow(provider, name, status, isConnected, canDisconnect, identity) {
  const row = document.createElement('div');
  row.className = 'provider-row';
  const icon = document.createElement('div');
  icon.className = 'provider-icon ' + provider;
  const icons = {
    google: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#4285F4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    spotify: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#1ED760"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
    email: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>',
    github: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>'
  };
  icon.innerHTML = icons[provider] || icons.email;

  const info = document.createElement('div');
  info.className = 'setting-info';
  const badge = isConnected
    ? '<span style="color:var(--success);font-size:11px;font-weight:600;margin-left:8px">CONNECTED</span>'
    : '';
  info.innerHTML = `<div class="setting-title">${name}${badge}</div><div class="setting-desc">${status}</div>`;

  row.appendChild(icon);
  row.appendChild(info);

  if (canDisconnect && isConnected && provider !== 'email' && identity) {
    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'btn-settings btn-settings-danger';
    disconnectBtn.style.cssText = 'padding:6px 12px;font-size:12px;flex-shrink:0';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.onclick = () => disconnectProvider(provider, identity);
    row.appendChild(disconnectBtn);
  }

  return row;
}

async function disconnectProvider(provider, identity) {  const providerName = provider === 'google' ? 'Google' : 'Spotify';

  const providers = currentUser?.app_metadata?.providers || [];
  if (providers.length <= 1) {
    showToastSettings(`Cannot disconnect ${providerName}. It is your only login method. Add another method first.`, true);
    return;
  }

  const confirmed = confirm(`Disconnect ${providerName}? You will no longer be able to sign in with this ${providerName} account.`);
  if (!confirmed) return;

  try {
    const { error } = await db.auth.unlinkIdentity(identity);
    if (error) throw error;
    showToastSettings(`${providerName} disconnected successfully`);
    await refreshUser();
    renderConnected();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('last_identity') || msg.includes('Cannot unlink')) {
      showToastSettings(`Cannot disconnect ${providerName}. It is your only login method. Add another method first.`, true);
    } else if (msg.includes('Manual linking')) {
      showToastSettings(`Manual linking is not enabled. Please enable it in your Supabase dashboard under Authentication â†’ Settings.`, true);
    } else {
      showToastSettings(`Failed to disconnect ${providerName}: ${msg || 'Unknown error'}`, true);
    }
  }
}

async function refreshUser() {
  const { data: { user } } = await db.auth.getUser();
  if (user) currentUser = user;
}

/* =========================
   9a. VOICE CALL (included — no key needed)
   ========================= */

function renderVoiceCall() {
  const c = document.getElementById('settings-voice-content');
  if (!c) return;
  c.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'settings-card';
  card.innerHTML = `
    <div class="settings-card-header">LIVE VOICE CALL</div>
    <div style="padding:16px 20px">
      <div class="setting-row" style="border:none;padding:4px 0">
        <div class="setting-info">
          <div class="setting-title" style="color:var(--success)">● Included — no setup needed</div>
          <div class="setting-desc">Tap the voice button in chat to start a live call. Just sign in and speak.</div>
        </div>
      </div>
    </div>`;
  c.appendChild(card);
  const infoCard = document.createElement('div');
  infoCard.className = 'settings-card';
  infoCard.innerHTML = `
    <div class="settings-card-header">HOW IT WORKS</div>
    <div class="setting-row"><div class="setting-info"><div class="setting-title">1. Start a call</div><div class="setting-desc">Tap the voice button — live duplex call, interrupt anytime</div></div></div>
    <div class="setting-row"><div class="setting-info"><div class="setting-title">2. Speak naturally</div><div class="setting-desc">Ask about FSc, matric, biology, chemistry, physics, math</div></div></div>`;
  c.appendChild(infoCard);

  // Voice picker + preview
  const voices = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Umbriel'];
  let uid = 'anon';
  try { if (typeof currentUser !== 'undefined' && currentUser?.id) uid = currentUser.id; } catch (_) {}
  const vkey = 'Anteemonee_tts_voice_' + uid;
  let cur = 'Kore';
  try { const s = localStorage.getItem(vkey); if (s && voices.includes(s)) cur = s; } catch (_) {}
  const vCard = document.createElement('div');
  vCard.className = 'settings-card';
  vCard.innerHTML = `
    <div class="settings-card-header">AI VOICE</div>
    <div style="padding:16px 20px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="tts-voice-select" class="setting-select" style="flex:1;min-width:160px">
          ${voices.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button class="btn-settings btn-settings-secondary" id="tts-voice-preview">Preview</button>
      </div>
      <div id="tts-voice-msg" style="font-size:12px;margin-top:8px;display:none"></div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">Pick the clearest voice for you. Preview plays a sample.</div>
    </div>`;
  c.appendChild(vCard);
  const sel = vCard.querySelector('#tts-voice-select');
  sel.addEventListener('change', () => {
    try { localStorage.setItem(vkey, sel.value); } catch (_) {}
    showToastSettings('Voice set to ' + sel.value);
  });
  vCard.querySelector('#tts-voice-preview').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = vCard.querySelector('#tts-voice-msg');
    btn.disabled = true; btn.textContent = 'Playing…'; msg.style.display = 'none';
    try {
      let url = 'https://zkuytvjeqkpexcbyoyhz.supabase.co', anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
      try { if (typeof db !== 'undefined' && db.auth) { const { data } = await db.auth.getSession(); var tok = data?.session?.access_token; } } catch (_) {}
      const res = await fetch(url + '/functions/v1/voice-tts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (tok || anon), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Assalamu alaikum! I am Anteemonee, your study tutor. How clear is my voice?', voice: sel.value }),
      });
      if (!res.ok) { const d = await res.text().catch(() => ''); throw new Error(d.slice(0, 120) || ('TTS ' + res.status)); }
      const ct = res.headers.get('content-type') || '';
      let src = '';
      if (ct.includes('audio/')) src = URL.createObjectURL(await res.blob());
      else { const j = await res.json(); if (j.error || !j.audio) throw new Error(j.error || 'No audio'); src = 'data:audio/wav;base64,' + j.audio; }
      const a = new Audio(src);
      a.onended = () => { btn.disabled = false; btn.textContent = 'Preview'; };
      a.onerror = () => { btn.disabled = false; btn.textContent = 'Preview'; };
      await a.play();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Preview';
      msg.textContent = 'Preview failed: ' + ((err && err.message) || 'error');
      msg.style.color = '#FF6675'; msg.style.display = 'block';
    }
  });
}

/* =========================
   9b. ACCOUNTS (Multi-Account)
   ========================= */

function renderAccounts() {
  const container = document.getElementById('settings-accounts-content');
  if (!container) return;
  if (!currentUser) {
    container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;">Sign in to manage your account.</p>';
    return;
  }
  const name = currentUser.displayName || currentUser.email || 'User';
  const email = currentUser.email || '';
  const initial = name.charAt(0).toUpperCase();
  const avatar = currentUser.photoURL;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:8px 0;">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;overflow:hidden;flex-shrink:0;">
        ${avatar ? `<img src="${avatar}" alt="" style="width:100%;height:100%;object-fit:cover;">` : initial}
      </div>
      <div>
        <div style="font-size:15px;font-weight:600;color:var(--text);">${name}</div>
        <div style="font-size:13px;color:var(--text-secondary);">${email}</div>
      </div>
    </div>
  `;
}

function settingsSwitchAccount() {}

function settingsRemoveAccount() {}

function doRemoveAccount() {}

function settingsAddAccount() {}

async function settingsLogoutCurrent() {
  const accounts = AccountManager.getSavedAccounts();
  const activeId = AccountManager.getActiveUserId();
  const active = accounts.find(a => a.userId === activeId);

  const modal = document.createElement('div');
  modal.className = 'account-modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="account-modal">
      <div class="account-modal-header">
        <h3>Log out</h3>
        <button class="account-modal-close" onclick="this.closest('.account-modal-overlay').remove()">&times;</button>
      </div>
      <div class="account-modal-body">
        <p>Log out of <strong>${active?.displayName || active?.email || 'this account'}</strong>?</p>
        ${accounts.length > 1 ? `<p style="margin-top:8px;font-size:13px;color:var(--text-secondary);">Other saved accounts will remain available.</p>` : ''}
      </div>
      <div class="account-modal-footer">
        <button class="btn-settings btn-settings-secondary" onclick="this.closest('.account-modal-overlay').remove()">Cancel</button>
        <button class="btn-settings btn-settings-primary" onclick="this.closest('.account-modal-overlay').remove(); handleLogout()">Log out</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function settingsLogoutAll() {
  const modal = document.createElement('div');
  modal.className = 'account-modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="account-modal">
      <div class="account-modal-header">
        <h3>Log out of all accounts</h3>
        <button class="account-modal-close" onclick="this.closest('.account-modal-overlay').remove()">&times;</button>
      </div>
      <div class="account-modal-body">
        <p>Log out of all accounts on this browser?</p>
        <p style="margin-top:8px;font-size:13px;color:var(--text-secondary);">This will remove all saved accounts. You'll need to sign in again.</p>
      </div>
      <div class="account-modal-footer">
        <button class="btn-settings btn-settings-secondary" onclick="this.closest('.account-modal-overlay').remove()">Cancel</button>
        <button class="btn-settings btn-settings-danger" onclick="this.closest('.account-modal-overlay').remove(); handleLogoutAllAccounts()">Log out all</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/* =========================
   11. HELP & SUPPORT
   ========================= */

function renderHelp() {
  const c = document.getElementById('settings-help-content');
  if (!c) return;
  c.innerHTML = '';

  const linksRows = [
    buildClickableRow('Report a Problem', 'Report a bug or issue', () => openSupportForm('problem')),
    buildClickableRow('Send Feedback', 'Share your thoughts with us', () => openSupportForm('suggestion')),
    buildClickableRow('Feature Request', 'Suggest a new feature', () => openSupportForm('suggestion')),
  ];
  c.appendChild(buildCard('GET HELP', linksRows));

  const supportCard = document.createElement('div');
  supportCard.className = 'settings-card';
  supportCard.style.display = 'none';
  supportCard.id = 'support-form-card';
  supportCard.innerHTML = `
    <div class="settings-card-header">SEND MESSAGE</div>
    <div class="support-form">
      <div class="form-group">
        <label>Subject</label>
        <input type="text" class="setting-input" id="support-subject" placeholder="Brief description" style="max-width:100%">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="setting-input" id="support-desc" placeholder="Tell us more..." style="max-width:100%;min-height:100px"></textarea>
      </div>
      <div id="support-msg" style="font-size:13px;margin-bottom:10px;display:none"></div>
      <div style="display:flex;gap:8px">
        <button class="btn-settings btn-settings-primary" id="support-submit-btn" onclick="submitSupport()">Send</button>
        <button class="btn-settings btn-settings-ghost" onclick="document.getElementById('support-form-card').style.display='none'">Cancel</button>
      </div>
    </div>`;
  c.appendChild(supportCard);
}

let supportKind = 'problem';
function openSupportForm(kind) {
  supportKind = kind;
  document.getElementById('support-form-card').style.display = 'block';
  document.getElementById('support-subject').value = '';
  document.getElementById('support-desc').value = '';
  document.getElementById('support-msg').style.display = 'none';
  document.getElementById('support-form-card').scrollIntoView({ behavior: 'smooth' });
}

async function submitSupport() {
  const subject = document.getElementById('support-subject').value.trim();
  const desc = document.getElementById('support-desc').value.trim();
  const msgEl = document.getElementById('support-msg');
  const btn = document.getElementById('support-submit-btn');

  if (!subject || !desc) {
    msgEl.textContent = 'All fields are required.'; msgEl.style.color = '#FF6675'; msgEl.style.display = 'block'; return;
  }

  setLoading(btn, true);
  try {
    const { error } = await db.from('support_requests').insert({
      user_id: currentUser.id,
      kind: supportKind,
      subject,
      description: desc
    });
    if (error) throw error;
    msgEl.textContent = 'Message sent successfully! We will get back to you.';
    msgEl.style.color = 'var(--success)';
    msgEl.style.display = 'block';
    document.getElementById('support-subject').value = '';
    document.getElementById('support-desc').value = '';
    showToastSettings('Message sent');
  } catch (err) {
    msgEl.textContent = err.message || 'Failed to send message.';
    msgEl.style.color = '#FF6675';
    msgEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

/* =========================
   12. ABOUT
   ========================= */

function renderAbout() {
  const c = document.getElementById('settings-about-content');
  c.innerHTML = '';

  const aboutCard = document.createElement('div');
  aboutCard.className = 'settings-card';
  aboutCard.innerHTML = `
    <div class="settings-profile-card" style="flex-direction:column;text-align:center;padding:28px 20px">
      <img src="assets/anteemonee.png" alt="Anteemonee" style="width:56px;height:56px;margin-bottom:12px;border-radius:14px">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:4px">Anteemonee</h3>
      <p style="font-size:13px;color:var(--text-secondary)">The Student OS for Pakistan</p>
    </div>`;
  c.appendChild(aboutCard);

  const infoRows = [
    buildRow('Version', '1.0.5'),
    buildRow('Website', 'Anteemoneepk.vercel.app'),
    buildRow('Platform', 'Web Application'),
  ];
  c.appendChild(buildCard('APP INFORMATION', infoRows));

  const legalRows = [
    buildClickableRow('Privacy Policy', 'How we handle your data', () => { window.location.href = 'privacy.html'; }),
    buildClickableRow('Terms of Service', 'Terms of use', () => { window.location.href = 'terms.html'; }),
  ];
  c.appendChild(buildCard('LEGAL', legalRows));
}

/* =========================
   13. LOGOUT
   ========================= */

function settingsLogout() {
  try {
    if (window.AnteemoneeSettings && window.AnteemoneeSettings.close) window.AnteemoneeSettings.close();
  } catch (_) {}
  try {
    if (typeof handleLogout === 'function') { handleLogout(); return; }
  } catch (_) {}
  db.auth.signOut().then(() => {
    window.location.href = '/index.html';
  }).catch(() => {
    window.location.href = '/index.html';
  });
}

/* =========================
   DANGER ZONE (bottom of page)
   ========================= */

function renderDangerZone() {
  const c = document.getElementById('settings-danger-content');
  if (!c) return;
  c.innerHTML = '';
  const dangerCard = document.createElement('div');
  dangerCard.className = 'settings-danger-zone';
  dangerCard.innerHTML = `
    <div class="settings-card-header">DELETE ACCOUNT</div>
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-title">Delete Account</div>
        <div class="setting-desc">Permanently delete your account and all data</div>
      </div>
      <button class="btn-settings btn-settings-danger" onclick="openDeleteModal()">Delete</button>
    </div>`;
  c.appendChild(dangerCard);
}

/* =========================
   14. DELETE ACCOUNT
   ========================= */

function openDeleteModal() {
  document.getElementById('delete-account-modal').classList.add('show');
  document.getElementById('delete-confirm-input').value = '';
  document.getElementById('delete-account-btn').disabled = true;
}

function closeDeleteModal() {
  document.getElementById('delete-account-modal').classList.remove('show');
}

function setupDeleteConfirmInput() {
  const input = document.getElementById('delete-confirm-input');
  if (input) {
    if (input.dataset.deleteBound) return;
    input.dataset.deleteBound = '1';
    input.addEventListener('input', () => {
      document.getElementById('delete-account-btn').disabled = input.value !== 'DELETE';
    });
  }
}

async function confirmDeleteAccount() {
  const btn = document.getElementById('delete-account-btn');
  setLoading(btn, true);
  try {
    const { error } = await db.rpc('delete_own_account');
    if (error) throw error;
    await db.auth.signOut();
    window.location.href = '/index.html';
  } catch (err) {
    showToastSettings(err.message || 'Failed to delete account.', true);
    setLoading(btn, false);
  }
}

/* =========================
   15. MY REPORTS
   ========================= */

async function renderReports() {
  const c = document.getElementById('settings-reports-content');
  if (!c) return;

  const STATUS_META = {
    sent:    { label: 'Sent',              color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.3)'  },
    fixed:   { label: 'Fixed',             color: 'var(--success)', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.3)'  },
    replied: { label: 'Admin replied',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  };

  // Loading state
  c.innerHTML = '<div class="setting-row" style="justify-content:center;padding:24px 0"><span style="color:var(--text-secondary);font-size:13px">Loading your reports...</span></div>';

  let reports = [];
  try {
    const { data, error } = await db
      .from('ai_reports')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    reports = data || [];
  } catch (err) {
    console.error("Error loading reports:", err);
    c.innerHTML = '<div class="setting-row"><span style="color:var(--error,#f87171);font-size:13px">Could not load reports. Try again later.</span></div>';
    return;
  }

  if (reports.length === 0) {
    c.innerHTML = `
      <div class="settings-card">
        <div style="text-align:center;padding:32px 16px;color:var(--text-secondary)">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px;display:block;opacity:0.35"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          <div style="font-size:14px;font-weight:600;color:var(--text)">No reports yet</div>
          <div style="font-size:13px;margin-top:4px">When you dislike an AI response and submit a report, it'll appear here.</div>
        </div>
      </div>`;
    return;
  }

  const card = document.createElement('div');
  card.className = 'settings-card';

  reports.forEach((r, i) => {
    const meta   = STATUS_META[r.status] || STATUS_META.sent;
    const date   = new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const itemId = 'report-item-' + i;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-bottom:1px solid var(--border,#1e231d);padding:16px 0;';
    if (i === reports.length - 1) wrap.style.borderBottom = 'none';

    // Header row: status pill + date
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;';
    headerRow.innerHTML = `
      <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;
        color:${meta.color};background:${meta.bg};border:1px solid ${meta.border};
        padding:3px 12px;border-radius:20px;">${meta.label}</span>
      <span style="font-size:12px;color:var(--text-secondary);margin-left:auto;">${date}</span>`;
    wrap.appendChild(headerRow);

    // Collapsible body
    const bodyId = 'report-body-' + i;
    const toggle = document.createElement('button');
    toggle.style.cssText = 'width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:0;';
    toggle.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtmlSettings(r.description || 'No description')}</div>`;

    const expandedBody = document.createElement('div');
    expandedBody.id = bodyId;
    expandedBody.style.display = 'none';
    expandedBody.style.marginTop = '12px';

    // Prompt
    if (r.user_prompt) {
      const pBlock = document.createElement('div');
      pBlock.style.cssText = 'margin-bottom:10px;';
      pBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,#6f7971);margin-bottom:4px;">Your prompt</div>
        <div style="font-size:13px;color:var(--text-secondary);background:var(--surface,#10130f);border:1px solid var(--border,#1e231d);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;">${escapeHtmlSettings(r.user_prompt)}</div>`;
      expandedBody.appendChild(pBlock);
    }

    // AI message
    if (r.ai_message) {
      const aiBlock = document.createElement('div');
      aiBlock.style.cssText = 'margin-bottom:10px;';
      aiBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,#6f7971);margin-bottom:4px;">AI message you disliked</div>
        <div style="font-size:13px;color:var(--text-secondary);background:var(--surface,#10130f);border:1px solid var(--border,#1e231d);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;">${escapeHtmlSettings(r.ai_message)}</div>`;
      expandedBody.appendChild(aiBlock);
    }

    // Description
    const descBlock = document.createElement('div');
    descBlock.style.cssText = 'margin-bottom:10px;';
    descBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,#6f7971);margin-bottom:4px;">Your description</div>
      <div style="font-size:13px;color:var(--text);background:var(--surface,#10130f);border:1px solid var(--border,#1e231d);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;">${escapeHtmlSettings(r.description || '')}</div>`;
    expandedBody.appendChild(descBlock);

    // Admin message (only if status is 'replied' and admin_message exists)
    if (r.status === 'replied' && r.admin_message) {
      const adminBlock = document.createElement('div');
      adminBlock.style.cssText = 'margin-bottom:4px;';
      adminBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#a78bfa;margin-bottom:4px;">Message from admin</div>
        <div style="font-size:13px;color:var(--text);background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.2);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;">${escapeHtmlSettings(r.admin_message)}</div>`;
      expandedBody.appendChild(adminBlock);
    }

    let open = false;
    toggle.addEventListener('click', () => {
      open = !open;
      expandedBody.style.display = open ? 'block' : 'none';
    });

    wrap.appendChild(toggle);
    wrap.appendChild(expandedBody);
    card.appendChild(wrap);
  });

  c.innerHTML = '';
  c.appendChild(card);
}

function escapeHtmlSettings(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

