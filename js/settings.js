/* =========================================================
   WASSAL SETTINGS — Complete Settings Logic
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
    <div class="settings-card-header">DANGER ZONE</div>
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
    tfaFactors = allTotp.filter(f => f.verify?.verified);
    const unverified = allTotp.filter(f => !f.verify?.verified);
    window._tfaUnverified = unverified;
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
    info.innerHTML = `<div class="setting-title">Authenticator App</div><div class="setting-desc" style="color:#FBBF24">Setup incomplete — finish or restart setup</div>`;
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
    const unverifiedFactors = (factorsData?.totp || []).filter(f => !f.verify?.verified);

    if (unverifiedFactors.length > 0) {
      const existing = unverifiedFactors[0];
      window._tfaFactorId = existing.id;
      const qrArea = document.getElementById('tfa-qr-area');
      qrArea.innerHTML = `
        <div style="background:rgba(124,92,255,0.1);border:1px solid rgba(124,92,255,0.2);border-radius:12px;padding:12px;margin-bottom:12px;font-size:13px;color:var(--accent)">
          Resuming previous setup. Enter the code from your authenticator app.
        </div>
        <button class="btn-settings btn-settings-ghost" onclick="cancelAndRestart2FA()" style="font-size:12px;margin-top:8px">Start Fresh</button>`;
      return;
    }

    const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
    if (error) throw error;
    window._tfaFactorId = data.id;
    const qrArea = document.getElementById('tfa-qr-area');
    if (data.totp?.qr_code) {
      qrArea.innerHTML = `<img src="${data.totp.qr_code}" alt="QR Code" style="width:180px;height:180px;border-radius:12px;background:#fff;padding:8px">`;
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
    const unverifiedFactors = (factorsData?.totp || []).filter(f => !f.verify?.verified);
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
  const sessions = await fetchSessions();
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

  const currentId = sessionStorage.getItem('wassal_session_id');
  const current = sessions.find(s => s.id === currentId || s.is_current);
  const others = sessions.filter(s => s !== current);

  if (current) {
    const row = document.createElement('div');
    row.className = 'provider-row';
    const icon = document.createElement('div');
    icon.className = 'provider-icon email';
    icon.innerHTML = getDeviceIcon(current);
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.innerHTML = `<div class="setting-title">${getDeviceLabel(current)} ${badge('active', 'This device')}</div><div class="setting-desc">Active now</div>`;
    row.appendChild(icon);
    row.appendChild(info);
    card.appendChild(row);
  }

  others.forEach(s => {
    const row = document.createElement('div');
    row.className = 'provider-row';
    const icon = document.createElement('div');
    icon.className = 'provider-icon email';
    icon.innerHTML = getDeviceIcon(s);
    const info = document.createElement('div');
    info.className = 'setting-info';
    info.innerHTML = `<div class="setting-title">${getDeviceLabel(s)}</div><div class="setting-desc">${timeAgo(s.last_active_at)}</div>`;
    row.appendChild(icon);
    row.appendChild(info);
    card.appendChild(row);
  });

  if (others.length) {
    const divider = document.createElement('div');
    divider.style.padding = '8px 20px 16px';
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn-settings btn-settings-danger';
    signOutBtn.textContent = `Sign out ${others.length} other session${others.length > 1 ? 's' : ''}`;
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
   3. AI PREFERENCES
   ========================= */

function renderAI() {
  const c = document.getElementById('settings-ai-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const responseRows = [
    buildRow('Response Style', 'How detailed the AI responds', buildSelect([
      { value: 'concise', label: 'Concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
    ], p.ai_response_style, v => savePref('ai_response_style', v))),
  ];
  c.appendChild(buildCard('RESPONSE STYLE', responseRows));

  const explanationLevel = localStorage.getItem('ai_explanation_level') || 'standard';
  const explRows = [
    buildRow('Explanation Level', 'Depth of concept explanations', buildSelect([
      { value: 'simple', label: 'Simple' },
      { value: 'standard', label: 'Standard' },
      { value: 'advanced', label: 'Advanced' },
    ], explanationLevel, v => {
      localStorage.setItem('ai_explanation_level', v);
      showToastSettings('Explanation level saved');
    })),
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

  const voiceRows = [
    buildRow('Voice Speed', 'Default speaking speed', buildSelect([
      { value: 75, label: '0.75x' },
      { value: 100, label: '1x (Normal)' },
      { value: 125, label: '1.25x' },
      { value: 150, label: '1.5x' },
    ], p.ai_voice_speed, v => savePref('ai_voice_speed', parseInt(v)))),
    buildRow('Voice Enabled', 'Enable voice responses', buildToggle('t-ai_voice', p.ai_voice_enabled, v => savePref('ai_voice_enabled', v))),
    buildRow('Autoplay Voice', 'Auto-play AI voice responses', buildToggle('t-ai_autoplay', p.ai_autoplay_voice, v => savePref('ai_autoplay_voice', v))),
  ];
  c.appendChild(buildCard('VOICE', voiceRows));

  const prefRows = [
    buildRow('Study Suggestions', 'Show AI study recommendations', buildToggle('t-ai_suggest', p.ai_study_recommendations, v => savePref('ai_study_recommendations', v))),
  ];
  c.appendChild(buildCard('SUGGESTIONS', prefRows));
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

  const newPlanCard = document.createElement('div');
  newPlanCard.className = 'settings-card';
  if (isPro) {
    const expires = ent.expires_at || ent.premium_expires_at;
    const expiresStr = expires ? new Date(expires).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No expiry';
    newPlanCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon pro">&#10024;</div>
        <div class="plan-info">
          <h4>Wassal Pro ${badge('premium', 'Active')}</h4>
          <p>Expires ${expiresStr}</p>
        </div>
      </div>`;
  } else {
    newPlanCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#128218;</div>
        <div class="plan-info">
          <h4>Free Plan</h4>
          <p>Limited AI sessions and features</p>
        </div>
      </div>`;
    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'btn-settings btn-settings-primary';
    upgradeBtn.textContent = 'Join Premium Waitlist';
    upgradeBtn.style.cssText = 'margin:0 20px 16px;';
    upgradeBtn.addEventListener('click', joinWaitlist);
    newPlanCard.appendChild(upgradeBtn);
  }
  container.appendChild(newPlanCard);

  const aiUsed = ent?.ai_sessions_used ?? '—';
  const aiLimit = ent?.ai_sessions_limit ?? '—';
  const scansUsed = ent?.scans_used ?? '—';
  const scansLimit = ent?.scans_limit ?? '—';
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

async function joinWaitlist() {
  try {
    const { error } = await db.from('premium_waitlist').insert({ user_id: currentUser.id });
    if (error && error.code !== '23505') throw error;
    showToastSettings('You have been added to the premium waitlist!');
  } catch (e) {
    showToastSettings(e.message || 'Failed to join waitlist', true);
  }
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
            <div class="setting-desc">Premium active from ${start} — expires ${expiry}</div>
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
      // Edge Function not deployed — fall back to RPC
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
    rows.push(buildProviderRow('google', 'Google', googleIdentity ? (googleIdentity.identity_data?.email || 'Connected') : 'Not linked', hasGoogle, canDisconnectAny, googleIdentity?.id));
  }
  if (hasSpotify) {
    const spotIdentity = identities.find(i => i.provider === 'spotify');
    rows.push(buildProviderRow('spotify', 'Spotify', spotIdentity ? (spotIdentity.identity_data?.email || 'Connected') : 'Not linked', hasSpotify, canDisconnectAny, spotIdentity?.id));
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

  if (hasGoogle || hasSpotify) {
    const securityRows = [
      buildRow('One account per provider', 'Each Google or Spotify account can only be linked to one Wassal account.'),
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
      showToastSettings(`This ${providerName} account is already linked to another Wassal account. Please use a different ${providerName} account.`, true);
    } else if (msg.includes('provider_disabled')) {
      showToastSettings(`${providerName} sign-in is not enabled. Please contact support.`, true);
    } else {
      showToastSettings(`Failed to link ${providerName}: ${msg || 'Unknown error'}`, true);
    }
  }
}

function buildProviderRow(provider, name, status, isConnected, canDisconnect, identityId) {
  const row = document.createElement('div');
  row.className = 'provider-row';
  const icon = document.createElement('div');
  icon.className = 'provider-icon ' + provider;
  const icons = {
    google: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#4285F4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    spotify: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#1ED760"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
    email: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>'
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

  if (canDisconnect && isConnected && provider !== 'email' && identityId) {
    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'btn-settings btn-settings-danger';
    disconnectBtn.style.cssText = 'padding:6px 12px;font-size:12px;flex-shrink:0';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.onclick = () => disconnectProvider(provider, identityId);
    row.appendChild(disconnectBtn);
  }

  return row;
}

async function disconnectProvider(provider, identityId) {
  const providerName = provider === 'google' ? 'Google' : 'Spotify';

  const providers = currentUser?.app_metadata?.providers || [];
  if (providers.length <= 1) {
    showToastSettings(`Cannot disconnect ${providerName}. It is your only login method. Add another method first.`, true);
    return;
  }

  const confirmed = confirm(`Disconnect ${providerName}? You will no longer be able to sign in with this ${providerName} account.`);
  if (!confirmed) return;

  try {
    const { error } = await db.auth.unlinkIdentity(identityId);
    if (error) throw error;
    showToastSettings(`${providerName} disconnected successfully`);
    await refreshUser();
    renderConnected();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('last_identity') || msg.includes('Cannot unlink')) {
      showToastSettings(`Cannot disconnect ${providerName}. It is your only login method. Add another method first.`, true);
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
   10. HELP & SUPPORT
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
   11. ABOUT
   ========================= */

function renderAbout() {
  const c = document.getElementById('settings-about-content');
  c.innerHTML = '';

  const aboutCard = document.createElement('div');
  aboutCard.className = 'settings-card';
  aboutCard.innerHTML = `
    <div class="settings-profile-card" style="flex-direction:column;text-align:center;padding:28px 20px">
      <img src="../assets/wassal.png" alt="Wassal" style="width:56px;height:56px;margin-bottom:12px;border-radius:14px">
      <h3 style="font-size:20px;font-weight:700;margin-bottom:4px">Wassal</h3>
      <p style="font-size:13px;color:var(--text-secondary)">The Student OS for Pakistan</p>
    </div>`;
  c.appendChild(aboutCard);

  const infoRows = [
    buildRow('Version', '1.0.0'),
    buildRow('Website', 'wassalpk.vercel.app'),
    buildRow('Platform', 'Web Application'),
  ];
  c.appendChild(buildCard('APP INFORMATION', infoRows));

  const legalRows = [
    buildClickableRow('Privacy Policy', 'How we handle your data', () => showToastSettings('Privacy Policy page coming soon')),
    buildClickableRow('Terms of Service', 'Terms of use', () => showToastSettings('Terms page coming soon')),
  ];
  c.appendChild(buildCard('LEGAL', legalRows));
}

/* =========================
   12. LOGOUT
   ========================= */

function settingsLogout() {
  db.auth.signOut().then(() => {
    window.location.href = '../index.html';
  }).catch(() => {
    window.location.href = '../index.html';
  });
}

/* =========================
   13. DELETE ACCOUNT
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
