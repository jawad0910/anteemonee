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

async function initSettings() {
  await checkAuth();
  if (!currentUser) {
    document.getElementById('settings-not-auth').style.display = 'block';
    return;
  }
  document.getElementById('settings-page').style.display = 'block';
  await ensureProfile();
  settingsPrefs = await loadUserPrefs();
  applyReduceAnimations();
  renderSecurity();
  renderNotifications();
  renderAI();
  renderAppearance();
  renderLanguage();
  renderPrivacy();
  await renderSubscription();
  await renderCoupons();
  renderConnected();
  renderAccounts();
  renderAds();
  renderHelp();
  renderAbout();
  setupNavSidebar();
  setupDeleteConfirmInput();
  recordSessionActivity();
  startActivityTracking();
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
   SIDEBAR NAV
   ========================= */

function setupNavSidebar() {
  const btns = document.querySelectorAll('.settings-nav-item[data-cat]');
  btns.forEach(btn => {
    btn.addEventListener('click', () => switchCategory(btn.dataset.cat));
  });
  const hash = window.location.hash.replace('#', '');
  if (hash && document.querySelector(`.settings-category[data-cat="${hash}"]`)) {
    switchCategory(hash);
  }
}

function switchCategory(cat) {
  document.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.settings-nav-item[data-cat="${cat}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('.settings-category').forEach(c => c.classList.remove('active'));
  const target = document.querySelector(`.settings-category[data-cat="${cat}"]`);
  if (target) target.classList.add('active');
  window.history.replaceState(null, '', '#' + cat);
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
}

function showSidebar() {
  document.getElementById('settings-sidebar').classList.add('open');
}

/* =========================
   1. LOGIN & SECURITY
   ========================= */

function renderSecurity() {
  const c = document.getElementById('settings-security-content');
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
      <div id="sec-pw-success" style="color:#35D399;font-size:13px;margin-bottom:10px;display:none"></div>
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

  const sessionsCard = document.createElement('div');
  sessionsCard.className = 'settings-card';
  sessionsCard.id = 'settings-sessions-card';
  sessionsCard.innerHTML = `
    <div class="settings-card-header">ACTIVE SESSIONS</div>
    <div class="skeleton-row"><div class="skeleton skeleton-text w-60"></div><div class="skeleton skeleton-text w-20" style="height:24px;border-radius:12px"></div></div>`;
  c.appendChild(sessionsCard);
  loadSessions();

  const eventsCard = document.createElement('div');
  eventsCard.className = 'settings-card';
  eventsCard.id = 'settings-events-card';
  eventsCard.innerHTML = `
    <div class="settings-card-header">SECURITY EVENTS</div>
    <div class="skeleton-row"><div class="skeleton skeleton-text w-60"></div><div class="skeleton skeleton-text w-20" style="height:24px;border-radius:12px"></div></div>`;
  c.appendChild(eventsCard);
  loadSecurityEvents();

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

/* ---- Active Sessions ---- */

async function loadSessions() {
  const card = document.getElementById('settings-sessions-card');
  // Reconcile first: merges duplicates, backfills missing locations, fixes
  // flags â€” so the list below always reflects the healed state.
  try { if (typeof reconcileSessionRows === 'function') await reconcileSessionRows(); } catch (_) {}
  const sessions = (await fetchSessions()).filter(s => !s.logged_out_at);
  card.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'settings-card-header';
  header.textContent = 'ACTIVE SESSIONS';
  card.appendChild(header);

  if (!sessions.length) {
    const row = buildRow('No sessions found', '');
    card.appendChild(row);
    return;
  }

  // "This device": match by row id (string-safe) first, then by live device
  // fingerprint as fallback (covers new tabs before reconcile runs).
  const currentId = sessionStorage.getItem('Anteemonee_session_id');
  let info = { browser: '', os: '', device_type: '' };
  try { if (typeof parseUserAgent === 'function') info = parseUserAgent(); } catch (_) {}
  const isMine = (s) => !s.logged_out_at && (
    String(s.id) === String(currentId) ||
    (s.browser === info.browser && s.os === info.os && s.device_type === info.device_type)
  );
  const byRecent = (a, b) => new Date(b.last_active_at) - new Date(a.last_active_at);
  const current = sessions.filter(isMine).sort(byRecent)[0] || null;
  const activeOthers = sessions.filter(s => s !== current).sort(byRecent);

  const locOf = (s) => [s.city, s.country].filter(Boolean).join(', ');
  const descFor = (s, forceActive) => {
    const fresh = (Date.now() - new Date(s.last_active_at).getTime()) < 5 * 60 * 1000;
    const when = s.logged_out_at
      ? `Logged out ${timeAgo(s.logged_out_at)}`
      : (forceActive || fresh ? 'Active now' : timeAgo(s.last_active_at));
    const loc = locOf(s);
    return loc ? `${when} â€¢ ${loc}` : when;
  };
  const rowFor = (s, badgeHtml, dim, forceActive) => {
    const row = document.createElement('div');
    row.className = 'provider-row';
    if (dim) row.style.opacity = '0.55';
    const icon = document.createElement('div');
    icon.className = 'provider-icon email';
    icon.innerHTML = getDeviceIcon(s);
    const infoEl = document.createElement('div');
    infoEl.className = 'setting-info';
    const title = document.createElement('div');
    title.className = 'setting-title';
    title.textContent = getDeviceLabel(s);
    if (badgeHtml) title.insertAdjacentHTML('beforeend', ' ' + badgeHtml);
    const desc = document.createElement('div');
    desc.className = 'setting-desc';
    desc.textContent = descFor(s, forceActive);
    infoEl.appendChild(title);
    infoEl.appendChild(desc);
    row.appendChild(icon);
    row.appendChild(infoEl);
    card.appendChild(row);
  };

  if (current) rowFor(current, badge('active', 'This device'), false, true);
  activeOthers.forEach(s => rowFor(s, '', false, false));

  if (activeOthers.length) {
    const divider = document.createElement('div');
    divider.style.padding = '8px 20px 16px';
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn-settings btn-settings-danger';
    signOutBtn.textContent = `Sign out ${activeOthers.length} other session${activeOthers.length > 1 ? 's' : ''}`;
    signOutBtn.addEventListener('click', async () => {
      if (!confirm('Sign out all other devices?')) return;
      setLoading(signOutBtn, true);
      await signOutOtherSessions();
      showToastSettings('Other sessions signed out');
      await loadSessions();
      setLoading(signOutBtn, false);
    });
    divider.appendChild(signOutBtn);
    card.appendChild(divider);
  }
}

/* ---- Security Events ---- */

const SECURITY_EVENT_LABELS = {
  password_changed: 'Password changed',
  new_signin: 'New sign-in',
  '2fa_enabled': '2FA enabled',
  '2fa_disabled': '2FA disabled',
  signed_out_others: 'Signed out other devices',
  email_changed: 'Email changed'
};

async function loadSecurityEvents() {
  const card = document.getElementById('settings-events-card');
  const events = await fetchSecurityEvents(10);
  card.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'settings-card-header';
  header.textContent = 'SECURITY EVENTS';
  card.appendChild(header);

  if (!events.length) {
    card.appendChild(buildRow('No recent events', ''));
    return;
  }

  events.forEach(ev => {
    const label = SECURITY_EVENT_LABELS[ev.kind] || ev.kind;
    const row = buildRow(label, timeAgo(ev.created_at));
    card.appendChild(row);
  });
}

/* =========================
   2. NOTIFICATIONS
   ========================= */

function renderNotifications() {
  const c = document.getElementById('settings-notifications-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const studyRows = [
    buildRow('Study Reminders', 'Reminders to study', buildToggle('t-notify_study', p.notify_study_reminders, v => savePref('notify_study_reminders', v))),
    buildRow('Planner Reminders', 'Upcoming task reminders', buildToggle('t-notify_planner', p.notify_planner_reminders, v => savePref('notify_planner_reminders', v))),
    buildRow('Exam Reminders', 'Exam date reminders', buildToggle('t-notify_exam', p.notify_exam_reminders, v => savePref('notify_exam_reminders', v))),
    buildRow('Revision Reminders', 'Spaced repetition reminders', buildToggle('t-notify_revision', p.notify_revision_reminders, v => savePref('notify_revision_reminders', v))),
  ];
  c.appendChild(buildCard('STUDY', studyRows));

  const aiRows = [
    buildRow('Daily Learning', 'Daily learning activity reminders', buildToggle('t-notify_daily', p.notify_daily_learning, v => savePref('notify_daily_learning', v))),
    buildRow('AI Recommendations', 'AI-powered study suggestions', buildToggle('t-notify_ai', p.notify_ai_recommendations, v => savePref('notify_ai_recommendations', v))),
  ];
  c.appendChild(buildCard('AI & LEARNING', aiRows));

  const otherRows = [
    buildRow('New Content', 'When new content is available', buildToggle('t-notify_new', p.notify_new_content, v => savePref('notify_new_content', v))),
    buildRow('Past Paper Updates', 'Past paper additions', buildToggle('t-notify_pp', p.notify_past_paper_updates, v => savePref('notify_past_paper_updates', v))),
    buildRow('System Notifications', 'Important system updates', buildToggle('t-notify_sys', p.notify_system, v => savePref('notify_system', v))),
  ];
  c.appendChild(buildCard('OTHER', otherRows));
}

/* =========================
   3. AI PERSONALIZATION
   ========================= */

function renderAI() {
  const c = document.getElementById('settings-ai-content');
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

  const langRows = [
    buildRow('AI Language', 'Language for AI responses', buildSelect([
      { value: 'english', label: 'English' },
      { value: 'urdu', label: 'Urdu' },
      { value: 'roman_urdu', label: 'Roman Urdu' },
      { value: 'mixed', label: 'Mixed / Auto' },
    ], p.ai_language, v => savePref('ai_language', v))),
  ];
  c.appendChild(buildCard('LANGUAGE', langRows));

  // Voice controls are hidden for now (voice responses stay on by default).
  // const voiceRows = [...] (removed from UI)

  const prefRows = [
    buildRow('Study Suggestions', 'Show AI study recommendations', buildToggle('t-ai_suggest', p.ai_study_recommendations, v => savePref('ai_study_recommendations', v))),
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
      background:var(--accent);color:#fff;font-size:12px;font-weight:600;
      cursor:pointer;transition:all .2s;white-space:nowrap;
      box-shadow:0 2px 8px rgba(31,160,85,.3);
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
    e.currentTarget.style.boxShadow = '0 4px 12px rgba(31,160,85,.4)';
  });
  knowRow.querySelector('#btn-download-ai-profile').addEventListener('mouseleave', (e) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 2px 8px rgba(31,160,85,.3)';
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
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const rows = [
    buildRow('Reduce Animations', 'Minimize motion for accessibility', buildToggle('t-reduce_anim', p.reduce_animations, v => {
      savePref('reduce_animations', v);
      if (v) document.documentElement.classList.add('reduce-anim');
      else document.documentElement.classList.remove('reduce-anim');
    })),
    buildRow('Visual Effects', 'Intensity of glass morphism effects', buildSelect([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ], p.glass_intensity, v => savePref('glass_intensity', v))),
    buildRow('Layout Density', 'Interface compactness', buildSelect([
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' },
    ], p.layout_density, v => savePref('layout_density', v))),
  ];
  c.appendChild(buildCard('APPEARANCE', rows));
}

/* =========================
   5. LANGUAGE
   ========================= */

function renderLanguage() {
  const c = document.getElementById('settings-language-content');
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

  renderSubscriptionContent(c, planCard);
}

function renderSubscriptionContent(container, planCard) {
  container.removeChild(planCard);
  const ent = settingsEntitlements;
  const isPro = ent && (ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active';

  const currentCard = document.createElement('div');
  currentCard.className = 'settings-card';
  if (isPro) {
    const expires = ent.expires_at || ent.premium_expires_at;
    const expiresStr = expires ? new Date(expires).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No expiry';
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon pro">&#10024;</div>
        <div class="plan-info">
          <h4>Anteemonee Pro ${badge('premium', 'Active')}</h4>
          <p>Expires ${expiresStr}</p>
        </div>
      </div>`;
  } else {
    currentCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#128218;</div>
        <div class="plan-info">
          <h4>Free Plan</h4>
          <p>Limited AI sessions and features</p>
        </div>
      </div>`;
  }
  container.appendChild(currentCard);

  if (!isPro) {
    const upgradeCard = document.createElement('div');
    upgradeCard.className = 'settings-card';
    upgradeCard.innerHTML = `
      <div style="padding:16px 20px 0">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-secondary);margin-bottom:8px">Anteemonee Premium</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:16px">Unlock the full power of your Student OS</div>
      </div>
      <div style="padding:0 20px 20px">
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:20px">
          <span style="font-family:var(--font-display);font-size:32px;font-weight:700;color:var(--accent)">Rs 400</span>
          <span style="font-size:14px;color:var(--text-secondary)">/month</span>
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 20px;font-size:14px">
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>250 AI Tutor sessions per month</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>200 AI Question Scans per month</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>Unlimited AI session extensions via ads</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>Priority access to new features</span></li>
          <li style="padding:6px 0;display:flex;align-items:center;gap:10px"><span style="width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700">&#10003;</span><span>Ad-free experience</span></li>
        </ul>
        <a href="payment.html" class="btn-settings btn-settings-primary" style="display:inline-block;text-decoration:none;text-align:center;width:100%;box-sizing:border-box">Get Premium - Rs 400/mo</a>
      </div>`;
    container.appendChild(upgradeCard);
  }

  const aiUsed = ent?.ai_used ?? 'â€”';
  const aiLimit = ent?.ai_limit ?? 'â€”';
  const scansUsed = ent?.scan_used ?? 'â€”';
  const scansLimit = ent?.scan_limit ?? 'â€”';
  const statusLabel = ent?.subscription_status || 'free';

  const usageRows = [
    buildRow('Plan Type', isPro ? 'Premium' : 'Free', isPro ? badge('premium', 'Pro') : badge('inactive', 'Free')),
    buildRow('Status', statusLabel, badge(isPro ? 'active' : 'inactive', statusLabel)),
    buildRow('AI Sessions', `${aiUsed} / ${aiLimit}`, null),
    buildRow('Scans', `${scansUsed} / ${scansLimit}`, null),
  ];
  if (isPro && (ent?.expires_at || ent?.premium_expires_at)) {
    const exp = ent.expires_at || ent.premium_expires_at;
    usageRows.push(buildRow('Expiry Date', new Date(exp).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })));
  }
  container.appendChild(buildCard('USAGE', usageRows));
}

/* =========================
   8. COUPONS
   ========================= */

async function renderCoupons() {
  const c = document.getElementById('settings-coupons-content');
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
      const start = new Date(r.premium_start_at).toLocaleDateString('en-GB');
      const expiry = new Date(r.premium_expiry_at).toLocaleDateString('en-GB');

      const statusCard = document.createElement('div');
      statusCard.className = 'settings-card';
      statusCard.innerHTML = `
        <div class="settings-card-header">COUPON STATUS</div>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-title" style="color:#35D399">Coupon Redeemed</div>
            <div class="setting-desc">Premium active from ${start} - expires ${expiry}</div>
          </div>
          <span class="status-badge premium">Premium</span>
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

    const infoRows = [
      buildRow('Coupon codes are case-insensitive'),
      buildRow('Each code can be redeemed once per account'),
      buildRow('Premium codes extend your current subscription'),
    ];
    c.appendChild(buildCard('HOW IT WORKS', infoRows));
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
    msgEl.textContent = 'Coupon redeemed successfully! Your subscription has been updated.';
    msgEl.style.color = '#35D399';
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

  renderGithubCard(c);

  if (!canDisconnectAny && providerCount === 1) {
    const warnRows = [
      buildRow('Cannot disconnect your only login method', 'Add another provider (Google, Spotify, or Email) before disconnecting to avoid being locked out.'),
    ];
    c.appendChild(buildCard('SECURITY NOTE', warnRows));
  }

  if (hasGoogle || hasSpotify) {
    const securityRows = [
      buildRow('One account per provider', 'Each Google or Spotify account can only be linked to one Anteemonee account.'),
      buildRow('Email & username are unique', 'No two accounts can share the same email or username.'),
      buildRow('Always need one login', 'You must have at least one login method active at all times.'),
    ];
    c.appendChild(buildCard('SECURITY POLICY', securityRows));
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
    ? '<span style="color:#35D399;font-size:11px;font-weight:600;margin-left:8px">CONNECTED</span>'
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

async function renderGithubCard(c) {
  let gh = null;
  try {
    const res = await db.from('github_connections').select('github_username').maybeSingle();
    gh = res.data || null;
  } catch (_) { return; }
  if (!gh) return;
  const row = buildProviderRow('github', 'GitHub', '@' + gh.github_username + ' · used by Zardari', true, false, null);
  const btn = document.createElement('button');
  btn.className = 'btn-settings btn-settings-danger';
  btn.style.cssText = 'padding:6px 12px;font-size:12px;flex-shrink:0';
  btn.textContent = 'Disconnect';
  btn.onclick = disconnectGithub;
  row.appendChild(btn);
  const card = document.createElement('div');
  card.className = 'settings-card';
  const h = document.createElement('div');
  h.className = 'settings-card-header';
  h.textContent = 'GITHUB (ZARDARI)';
  card.appendChild(h);
  card.appendChild(row);
  c.appendChild(card);
}

async function disconnectGithub() {
  if (!confirm('Disconnect GitHub from Anteemonee? Zardari will lose access to your repositories.')) return;
  try {
    const { error } = await db.from('github_connections').delete().eq('user_id', currentUser.id);
    if (error) throw error;
    showToastSettings('GitHub disconnected successfully');
    renderConnected();
  } catch (err) {
    showToastSettings('Failed to disconnect GitHub: ' + (err.message || 'unknown error'), true);
  }
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
   9b. ACCOUNTS (Multi-Account)
   ========================= */

function renderAccounts() {
  const c = document.getElementById('settings-accounts-content');
  if (!c) return;
  c.innerHTML = '';

  const accounts = AccountManager.getSavedAccounts();
  const activeId = AccountManager.getActiveUserId();

  // Accounts list card
  const listCard = document.createElement('div');
  listCard.className = 'settings-card';

  let accountsHtml = '<div class="settings-card-header">SIGNED IN ACCOUNTS</div>';

  accounts.forEach(acc => {
    const isActive = acc.userId === activeId;
    const initial = (acc.displayName || acc.email || '?')[0].toUpperCase();
    accountsHtml += `
      <div class="setting-row" style="gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
          <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;">
            ${acc.avatarUrl ? `<img src="${acc.avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">` : `<span>${initial}</span>`}
          </div>
          <div style="min-width:0;">
            <div style="font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px;">
              ${acc.displayName || acc.email}
              ${isActive ? '<span style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(31,160,85,0.1);padding:1px 6px;border-radius:6px;">Active</span>' : ''}
              ${acc.sessionStatus === 'expired' ? '<span style="font-size:11px;font-weight:600;color:#ff6675;background:rgba(255,102,117,0.1);padding:1px 6px;border-radius:6px;">Expired</span>' : ''}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${acc.email}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${!isActive ? `<button class="btn-settings btn-settings-secondary" style="font-size:12px;padding:6px 12px;" onclick="settingsSwitchAccount('${acc.userId}')">Switch</button>` : ''}
          ${!isActive ? `<button class="btn-settings btn-settings-danger" style="font-size:12px;padding:6px 12px;" onclick="settingsRemoveAccount('${acc.userId}')">Remove</button>` : ''}
        </div>
      </div>`;
  });

  listCard.innerHTML = accountsHtml;
  c.appendChild(listCard);

  // Actions card
  const actionsCard = document.createElement('div');
  actionsCard.className = 'settings-card';
  let actionsHtml = '<div class="settings-card-header">ACTIONS</div>';

  if (AccountManager.hasAvailableSlot()) {
    actionsHtml += `
      <div class="setting-row clickable" onclick="settingsAddAccount()">
        <div class="setting-info">
          <div class="setting-title" style="color:var(--accent);">+ Add another account</div>
          <div class="setting-desc">Sign in to another Anteemonee account on this browser</div>
        </div>
      </div>`;
  } else {
    actionsHtml += `
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-title" style="color:var(--text-secondary);">Account limit reached</div>
          <div class="setting-desc">Maximum 3 accounts per browser. Remove an account to add a new one.</div>
        </div>
      </div>`;
  }

  actionsHtml += `
    <div class="setting-row clickable" onclick="settingsLogoutCurrent()">
      <div class="setting-info">
        <div class="setting-title">Log out current account</div>
        <div class="setting-desc">Sign out of ${accounts.find(a => a.userId === activeId)?.displayName || accounts.find(a => a.userId === activeId)?.email || 'this account'}</div>
      </div>
    </div>
    <div class="setting-row clickable" onclick="settingsLogoutAll()">
      <div class="setting-info">
        <div class="setting-title" style="color:#ff6675;">Log out of all accounts</div>
        <div class="setting-desc">Remove all saved accounts from this browser</div>
      </div>
    </div>`;

  actionsCard.innerHTML = actionsHtml;
  c.appendChild(actionsCard);
}

async function settingsSwitchAccount(userId) {
  const modal = document.createElement('div');
  modal.className = 'account-modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="account-modal">
      <div class="account-modal-header">
        <h3>Switch account</h3>
        <button class="account-modal-close" onclick="this.closest('.account-modal-overlay').remove()">&times;</button>
      </div>
      <div class="account-modal-body">
        <p>Switching will reload the page with the selected account's data.</p>
      </div>
      <div class="account-modal-footer">
        <button class="btn-settings btn-settings-secondary" onclick="this.closest('.account-modal-overlay').remove()">Cancel</button>
        <button class="btn-settings btn-settings-primary" onclick="this.closest('.account-modal-overlay').remove(); switchToAccount('${userId}')">Switch</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function settingsRemoveAccount(userId) {
  const accounts = AccountManager.getSavedAccounts();
  const acc = accounts.find(a => a.userId === userId);
  if (!acc) return;

  const modal = document.createElement('div');
  modal.className = 'account-modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="account-modal">
      <div class="account-modal-header">
        <h3>Remove account</h3>
        <button class="account-modal-close" onclick="this.closest('.account-modal-overlay').remove()">&times;</button>
      </div>
      <div class="account-modal-body">
        <p>Remove <strong>${acc.displayName || acc.email}</strong> from this browser?</p>
        <p style="margin-top:8px;font-size:12px;color:var(--text-secondary);">This only removes the saved login from this browser. the Anteemonee account and all its data remain untouched.</p>
      </div>
      <div class="account-modal-footer">
        <button class="btn-settings btn-settings-secondary" onclick="this.closest('.account-modal-overlay').remove()">Cancel</button>
        <button class="btn-settings btn-settings-danger" onclick="this.closest('.account-modal-overlay').remove(); doRemoveAccount('${userId}')">Remove</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function doRemoveAccount(userId) {
  const result = await AccountManager.removeAccount(userId);
  if (result.removedActive && result.nextAccount) {
    await switchToAccount(result.nextAccount.userId);
  } else {
    renderAccounts();
    showToastSettings('Account removed from this browser');
  }
}

function settingsAddAccount() {
  addAnotherAccount();
}

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
   10. ADS
   ========================= */

let adsWatched = 0;
let adsBonusSessions = 0;
let adTimerInterval = null;
let adCooldownInterval = null;

async function renderAds() {
  const c = document.getElementById('settings-ads-content');
  c.innerHTML = '';

  // Load bonus sessions from entitlements
  try {
    const { data: ent } = await db.rpc('get_entitlement_snapshot');
    if (ent) {
      adsBonusSessions = ent.bonus_sessions || 0;
    }
  } catch {}

  // Count today's ad views to determine position in current round
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: views } = await db.from('ad_views')
      .select('id, ad_number')
      .eq('user_id', currentUser.id)
      .gte('watched_at', today + 'T00:00:00')
      .lte('watched_at', today + 'T23:59:59');

    adsWatched = views ? views.length : 0;
  } catch {
    adsWatched = 0;
  }

  const roundPos = adsWatched % 3; // 0, 1, or 2 â€” position in current round
  const roundsCompleted = Math.floor(adsWatched / 3);
  const nextAd = roundPos + 1; // which ad user needs to watch next (1, 2, or 3)

  // Main card
  const mainCard = document.createElement('div');
  mainCard.className = 'settings-card';
  mainCard.id = 'ads-main-card';
  mainCard.innerHTML = `
    <div style="padding:20px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-secondary);margin-bottom:8px">EARN FREE AI SESSIONS</div>
      <div style="font-size:14px;color:var(--text-secondary);margin-bottom:20px">Watch 3 ads to unlock 1 free AI session. Unlimited.</div>

      <div id="ads-progress" style="display:flex;gap:12px;margin-bottom:20px">
        ${[1,2,3].map(n => {
          const done = n <= roundPos;
          return `
          <div style="flex:1;text-align:center">
            <div id="ad-circle-${n}" style="width:56px;height:56px;border-radius:50%;border:3px solid ${done ? 'var(--accent)' : 'var(--border)'};display:flex;align-items:center;justify-content:center;margin:0 auto 8px;background:${done ? 'var(--accent)' : 'transparent'};transition:all 0.3s">
              ${done
                ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
                : `<span style="font-size:18px;font-weight:700;color:var(--text-secondary)">${n}</span>`
              }
            </div>
            <div style="font-size:12px;color:var(--text-secondary)">${done ? 'Done' : 'Ad ' + n}</div>
          </div>`;
        }).join('')}
      </div>

      <div id="ads-counter" style="text-align:center;font-size:14px;color:var(--text-secondary);margin-bottom:16px">
        ${roundPos === 0 && roundsCompleted > 0
          ? `<span style="color:#35D399;font-weight:600">${roundsCompleted} session${roundsCompleted > 1 ? 's' : ''} earned today! Start new round.</span>`
          : roundPos === 0
            ? 'Watch 3 ads to earn a free AI session'
            : `${roundPos}/3 ads in this round`
        }
      </div>

      <div id="ads-timer-area" style="text-align:center;display:none">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Watching ad...</div>
        <div id="ads-timer-display" style="font-family:var(--font-display);font-size:32px;font-weight:700;color:var(--accent)">15s</div>
        <div style="width:100%;height:4px;background:var(--border);border-radius:2px;margin-top:12px;overflow:hidden">
          <div id="ads-timer-bar" style="height:100%;background:var(--accent);border-radius:2px;width:0%;transition:width 1s linear"></div>
        </div>
      </div>

      <div id="ads-btn-area" style="text-align:center">
        <button class="btn-settings btn-settings-primary" id="ads-watch-btn" onclick="startAdWatch()">Watch Ad ${nextAd}</button>
      </div>

      ${adsBonusSessions > 0 ? `
        <div style="text-align:center;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <span style="font-size:13px;color:#35D399;font-weight:600">${adsBonusSessions} bonus session${adsBonusSessions > 1 ? 's' : ''} available</span>
        </div>
      ` : ''}
    </div>`;
  c.appendChild(mainCard);

  // Info card
  const infoCard = document.createElement('div');
  infoCard.className = 'settings-card';
  infoCard.innerHTML = `
    <div class="settings-card-header">HOW IT WORKS</div>
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-title">Watch 3 ads</div>
        <div class="setting-desc">Each ad takes about 15 seconds</div>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-title">Earn 1 free AI session</div>
        <div class="setting-desc">Session added instantly to your quota</div>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-info">
            <div class="setting-title">Unlimited - no daily cap</div>
        <div class="setting-desc">Keep watching, keep earning</div>
      </div>
    </div>`;
  c.appendChild(infoCard);
}

function startAdWatch() {
  const btn = document.getElementById('ads-watch-btn');
  const timerArea = document.getElementById('ads-timer-area');
  const timerDisplay = document.getElementById('ads-timer-display');
  const timerBar = document.getElementById('ads-timer-bar');

  if (!btn || adsWatched >= 3) return;

  btn.style.display = 'none';
  timerArea.style.display = 'block';

  // Trigger popunder ad
  triggerPopunder();

  let seconds = 15;
  let elapsed = 0;
  timerDisplay.textContent = seconds + 's';
  timerBar.style.width = '0%';

  adTimerInterval = setInterval(() => {
    seconds--;
    elapsed++;
    timerDisplay.textContent = seconds + 's';
    timerBar.style.width = ((elapsed / 15) * 100) + '%';

    if (seconds <= 0) {
      clearInterval(adTimerInterval);
      adTimerInterval = null;
      completeAdWatch();
    }
  }, 1000);
}

async function completeAdWatch() {
  const timerArea = document.getElementById('ads-timer-area');
  const nextAd = (adsWatched % 3) + 1;

  try {
    const { data, error } = await db.rpc('award_ad_session', { p_ad_number: nextAd });
    if (error) throw error;

    if (data?.ok) {
      adsWatched = data.ads_watched || (adsWatched + 1);
      if (data.session_earned) {
        adsBonusSessions = data.bonus_sessions || (adsBonusSessions + 1);
        showToastSettings('Free AI session earned!');
      } else {
        showToastSettings(`Ad ${nextAd} watched! ${data.ads_in_round}/3 in this round`);
      }
    } else if (data?.error === 'RATE_LIMITED') {
      const secs = data?.retry_after_seconds || 60;
      showToastSettings(`Too many requests. Try again in about ${Math.ceil(secs / 60)} minute(s).`, true);
    } else {
      showToastSettings(data?.error || 'Failed to record ad', true);
    }
  } catch (err) {
    showToastSettings(err.message || 'Failed to record ad', true);
  }

  timerArea.style.display = 'none';
  renderAds();
}

const ADSTERRA_SMARTLINK = 'https://www.profitableratecpmnetwork.com/rtnup6w1?key=6cf320c4d4cc97bfb228efe455c2a411';

function triggerPopunder() {
  try {
    window.open(ADSTERRA_SMARTLINK, '_blank', 'noopener,noreferrer,width=800,height=600');
  } catch (e) {
    // Popup blocked â€” try direct navigation fallback
    window.open(ADSTERRA_SMARTLINK, '_blank');
  }
}

/* =========================
   11. HELP & SUPPORT
   ========================= */

function renderHelp() {
  const c = document.getElementById('settings-help-content');
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
    msgEl.style.color = '#35D399';
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
      <img src="../assets/anteemonee.png" alt="Anteemonee" style="width:56px;height:56px;margin-bottom:12px;border-radius:14px">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:4px">Anteemonee</h3>
      <p style="font-size:13px;color:var(--text-secondary)">The Student OS for Pakistan</p>
    </div>`;
  c.appendChild(aboutCard);

  const infoRows = [
    buildRow('Version', '1.0.0'),
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
  db.auth.signOut().then(() => {
    window.location.href = '../index.html';
  }).catch(() => {
    window.location.href = '../index.html';
  });
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
    window.location.href = '../index.html';
  } catch (err) {
    showToastSettings(err.message || 'Failed to delete account.', true);
    setLoading(btn, false);
  }
}
