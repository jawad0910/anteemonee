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
    renderApi();
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
  renderConnected();
  renderAccounts();
  renderApi();
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

function togglePwCard() {
  const body = document.getElementById('sec-pw-body');
  const chev = document.getElementById('sec-pw-chev-icon');
  const btn = document.getElementById('sec-pw-chevron');
  if (!body) return;
  const willShow = body.hasAttribute('hidden');
  if (willShow) body.removeAttribute('hidden');
  else body.setAttribute('hidden', '');
  if (chev) chev.style.transform = willShow ? 'rotate(180deg)' : 'rotate(0deg)';
  if (btn) btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
}

function togglePwVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}

/* Collapsible card body (API key box). Open by default, same chevron
   behaviour as the change-password box. */
function toggleCollapseCard(prefix) {
  const body = document.getElementById(prefix + '-body');
  const chev = document.getElementById(prefix + '-chev-icon');
  const btn = document.getElementById(prefix + '-chevron');
  if (!body) return;
  const willShow = body.hasAttribute('hidden');
  if (willShow) body.removeAttribute('hidden');
  else body.setAttribute('hidden', '');
  if (chev) chev.style.transform = willShow ? 'rotate(180deg)' : 'rotate(0deg)';
  if (btn) btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
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
    <div class="settings-card-header" style="display:flex;align-items:center;justify-content:space-between">
      CHANGE PASSWORD
      <button type="button" id="sec-pw-chevron" onclick="togglePwCard()" aria-label="Expand or collapse password form" aria-expanded="false" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:2px;display:flex;transition:transform .2s">
        <svg id="sec-pw-chev-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="sec-pw-body" id="sec-pw-body" hidden style="padding:16px 20px 20px">
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Current Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-current-pw" placeholder="Enter current password" style="max-width:340px;padding-right:40px">
          <button type="button" class="pw-toggle" onclick="togglePwVis('sec-current-pw', this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" aria-label="Toggle password visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">New Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-new-pw" placeholder="Min 8 chars, 1 uppercase, 1 number" style="max-width:340px;padding-right:40px">
          <button type="button" class="pw-toggle" onclick="togglePwVis('sec-new-pw', this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px" aria-label="Toggle password visibility">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Confirm New Password</label>
        <div style="position:relative">
          <input type="password" class="setting-input" id="sec-confirm-pw" placeholder="Re-enter new password" style="max-width:340px;padding-right:40px">
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
      box-shadow:0 2px 8px var(--accent-soft);
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
    e.currentTarget.style.boxShadow = '0 4px 12px var(--accent-soft)';
  });
  knowRow.querySelector('#btn-download-ai-profile').addEventListener('mouseleave', (e) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 2px 8px var(--accent-soft)';
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

  const freeCard = document.createElement('div');
  freeCard.className = 'settings-card';
  freeCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon free">&#8734;</div>
        <div class="plan-info">
          <h4>Free forever ${badge('active', 'Active')}</h4>
          <p>Everything is free and unlimited — library, AI tutor, test builder and examiner. No plans, no payments, no card.</p>
        </div>
      </div>`;
  c.appendChild(freeCard);

  // Account stats.
  let stats = { messages: 0, images: 0, tests: 0, minutes: 0 };
  try {
    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    if (uid && typeof db !== 'undefined') {
      const msgR = db.from('ai_messages').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('role', 'user');
      const imgR = db.from('ai_generated_images').select('id', { count: 'exact', head: true }).eq('user_id', uid);
      const testR = db.from('ai_test_history').select('id', { count: 'exact', head: true }).eq('user_id', uid);
      const profR = db.from('profiles').select('study_time_seconds').eq('id', uid).maybeSingle();
      const [mr, ir, tr, pr] = await Promise.all([msgR, imgR, testR, profR]);
      stats.messages = (mr && mr.count) || 0;
      stats.images = (ir && ir.count) || 0;
      stats.tests = (tr && tr.count) || 0;
      stats.minutes = Math.floor(((pr && pr.data && pr.data.study_time_seconds) || 0) / 60);
    }
  } catch (_) {}

  // ── ACCOUNT STATS CARD ──
  const statsCard = document.createElement('div');
  statsCard.className = 'settings-card';
  statsCard.innerHTML = `
    <div class="settings-card-header">ACCOUNT STATS</div>
    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-num">${stats.messages}</div><div class="stat-label">AI messages</div></div>
      <div class="stat-tile"><div class="stat-num">${stats.images}</div><div class="stat-label">Images generated</div></div>
      <div class="stat-tile"><div class="stat-num">${stats.tests}</div><div class="stat-label">Tests built</div></div>
      <div class="stat-tile"><div class="stat-num">${stats.minutes}</div><div class="stat-label">Min on Anteemonee</div></div>
    </div>`;
  c.appendChild(statsCard);
}

/* =========================
   9. AI KEYS (bring your own Mistral key)
   ========================= */

let apiStatsTimer = null;

function stopApiStatsTimer() {
  if (apiStatsTimer) { clearInterval(apiStatsTimer); apiStatsTimer = null; }
}

function apiDefaultStats() {
  return {
    has_key: false, key_hint: null, used_today: 0, total_images: 0,
    limit: 4, remaining: 4, base_limit: 4, boosted_limit: 400, resets_at: null,
  };
}

function escApi(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function apiResetAt(stats) {
  var d = null;
  try { if (stats && stats.resets_at) d = new Date(stats.resets_at); } catch (_) {}
  if (!d || isNaN(d.getTime()) || d.getTime() <= Date.now()) d = nextUtcMidnight();
  return d;
}

/* The quota always rolls over at midnight UTC, so never print a bare "12:00".
   Show the reader's own clock time first, with UTC as the fallback reference. */
function nextUtcMidnight() {
  var now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
}

function apiCountdownText(ms) {
  var t = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(t / 3600);
  var m = Math.floor((t % 3600) / 60);
  var s = t % 60;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if (h > 0) return pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
  if (m > 0) return pad(m) + 'm ' + pad(s) + 's';
  return pad(s) + 's';
}

function apiResetLabel(d) {
  try {
    // Reader's local clock first (e.g. "5:00 AM PKT"), then the UTC rollover.
    var local = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    var offset = d.getTimezoneOffset();
    if (offset === 0) return local + ' UTC';
    var utcH = d.getUTCHours();
    var utcM = d.getUTCMinutes();
    var utc = (utcH % 12 === 0 ? 12 : utcH % 12) + ':' + (utcM < 10 ? '0' : '') + utcM + (utcH >= 12 ? ' PM' : ' AM');
    return local + ' (' + utc + ' UTC)';
  } catch (_) {
    return 'midnight UTC';
  }
}

async function renderApi() {
  const c = document.getElementById('settings-api-content');
  if (!c) return;
  stopApiStatsTimer();
  c.innerHTML = '<div class="skeleton" style="height:150px;margin:16px 0"></div><div class="skeleton" style="height:110px;margin:16px 0"></div>';

  let stats = apiDefaultStats();
  try {
    if (window.MistralKeyUI && typeof MistralKeyUI.stats === 'function') stats = await MistralKeyUI.stats();
  } catch (e) {
    console.warn('[settings] api stats failed:', e);
  }

  const used = stats.used_today || 0;
  const limit = stats.limit || (stats.has_key ? stats.boosted_limit : stats.base_limit);
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  let resetsAt = apiResetAt(stats);
  const hint = stats.key_hint || '••••••••';

  c.innerHTML = '';

  /* ── Key status card (collapsible, open by default) ── */
  const keyCard = document.createElement('div');
  keyCard.className = 'settings-card';
  keyCard.innerHTML = `
    <div class="settings-card-header" style="display:flex;align-items:center;justify-content:space-between">
      MISTRAL API KEY
      <button type="button" id="api-key-chevron" aria-label="Expand or collapse API key box" aria-expanded="true" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:2px;display:flex;transition:transform .2s">
        <svg id="api-key-chev-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(180deg)"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="settings-card-body" id="api-key-body" style="padding:16px 20px 20px">
      <div class="setting-row" style="border:none;padding:0 0 12px">
        <div class="setting-info">
          <div class="setting-title" style="color:${stats.has_key ? 'var(--success)' : 'var(--text)'}">
            ${stats.has_key ? '&#9679; Key connected' : 'No key connected'}
          </div>
          <div class="setting-desc" data-api-key-desc>${stats.has_key
            ? escApi(hint) + ' &middot; saved to your account'
            : 'Add your key to generate ' + stats.boosted_limit + ' images a day instead of ' + stats.base_limit + '.'}</div>
        </div>
        ${stats.has_key ? badge('active', 'Active') : badge('inactive', 'Not set')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <button class="btn-settings btn-settings-primary" data-action="add-mistral-key">
          ${stats.has_key ? 'Replace key' : 'Add your Mistral API key'}
        </button>
        <button class="btn-settings btn-settings-secondary" data-api-remove ${stats.has_key ? '' : 'disabled style="display:none"'}>Remove</button>
      </div>
      <div class="api-key-note">Your key is saved to your account only and is used for every image you generate.</div>
    </div>`;
  c.appendChild(keyCard);

  /* ── Usage card (collapsible, hidden by default) ── */
  const pctBar = Math.min(100, Math.round((used / Math.max(1, stats.boosted_limit)) * 100));
  const usageCard = document.createElement('div');
  usageCard.className = 'settings-card';
  usageCard.innerHTML = `
    <div class="settings-card-header" style="display:flex;align-items:center;justify-content:space-between">
      IMAGE GENERATION
      <button type="button" id="img-usage-chevron" aria-label="Expand or collapse image generation stats" aria-expanded="false" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:2px;display:flex;transition:transform .2s">
        <svg id="img-usage-chev-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="settings-card-body" id="img-usage-body" hidden>
      <div class="api-usage">
        <div class="api-usage-top">
          <div>
            <div class="api-usage-num"><span data-api-used>${used}</span><i>/ ${limit}</i></div>
            <div class="api-usage-label">images used today</div>
          </div>
          <span class="status-badge ${remaining > 0 ? 'active' : 'inactive'}">${remaining} left</span>
        </div>
        <div class="api-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" data-api-progress>
          <div class="api-progress-fill${pct >= 100 ? ' is-full' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="api-progress-foot">
          <span data-api-countdown>${escApi(apiCountdownText(resetsAt.getTime() - Date.now()))} left</span>
          <span>renews at ${escApi(apiResetLabel(resetsAt))}</span>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-num" data-api-total>${stats.total_images || 0}</div><div class="stat-label">Images generated</div></div>
        <div class="stat-tile"><div class="stat-num">${limit}</div><div class="stat-label">Daily limit</div></div>
      </div>
      <div style="padding:0 20px 18px">
        <div class="setting-desc" style="line-height:1.6">
          ${stats.has_key
            ? 'Generating with <strong>your Mistral key</strong> &mdash; ' + stats.boosted_limit + ' images per day.'
            : 'Generating with Anteemonee\'s shared key &mdash; ' + stats.base_limit + ' images per day. Add your own key for ' + stats.boosted_limit + '.'}
          ${pctBar < 20 && stats.has_key ? ' (' + (stats.boosted_limit - used) + ' of ' + stats.boosted_limit + ' left)' : ''}
        </div>
      </div>
    </div>`;
  c.appendChild(usageCard);

  /* Chevron buttons (bound here rather than via inline onclick). */
  const keyChev = c.querySelector('#api-key-chevron');
  if (keyChev) keyChev.addEventListener('click', () => toggleCollapseCard('api-key'));
  const usageChev = c.querySelector('#img-usage-chevron');
  if (usageChev) usageChev.addEventListener('click', () => toggleCollapseCard('img-usage'));

  /* Live countdown to the renewal moment. Rolls over on its own when the
     quota resets, so it never sticks on "renewing…". */
  const tick = c.querySelector('[data-api-countdown]');
  if (tick) {
    apiStatsTimer = setInterval(function () {
      var left = resetsAt.getTime() - Date.now();
      if (left <= 0) {
        resetsAt = nextUtcMidnight();
        left = resetsAt.getTime() - Date.now();
      }
      tick.textContent = apiCountdownText(left) + ' left';
    }, 1000);
  }

  /* Remove key: two-step confirm, then refresh. */
  const removeBtn = c.querySelector('[data-api-remove]');
  if (removeBtn) {
    let armed = false;
    let armTimer = null;
    removeBtn.addEventListener('click', async function () {
      if (!armed) {
        armed = true;
        removeBtn.textContent = 'Tap again to remove';
        removeBtn.classList.add('is-armed');
        armTimer = setTimeout(function () {
          armed = false;
          removeBtn.textContent = 'Remove';
          removeBtn.classList.remove('is-armed');
        }, 4000);
        return;
      }
      if (armTimer) clearTimeout(armTimer);
      if (!window.MistralKeyUI) { showToastSettings('API key manager unavailable', true); return; }
      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing…';
      const res = await MistralKeyUI.remove();
      removeBtn.disabled = false;
      if (res && res.ok) {
        showToastSettings('Key removed, back to ' + apiDefaultStats().base_limit + ' images/day');
        await renderApi();
      } else {
        removeBtn.textContent = 'Remove';
        showToastSettings((res && res.error) || 'Could not remove key', true);
      }
    });
  }

  /* The popup can be opened from anywhere on this page: stay in sync. */
  if (window.MistralKeyUI && typeof MistralKeyUI.onChange === 'function' && !renderApi._bound) {
    renderApi._bound = true;
    MistralKeyUI.onChange(function (next) {
      if (next && next.has_key) showToastSettings('Key saved: ' + next.limit + ' images/day');
      try { renderApi(); } catch (_) {}
    });
  }
}

/* =========================
   10. CONNECTED ACCOUNTS
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
  if (linkRows.length) {
    c.appendChild(buildCard('LINK ACCOUNTS', linkRows));
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
        <div style="width:48px;height:48px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:var(--on-accent);font-weight:700;font-size:18px;overflow:hidden;flex-shrink:0;">
        ${avatar ? `<img src="${avatar}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()" style="width:100%;height:100%;object-fit:cover;">` : initial}
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
      <img src="/assets/anteemonee.png" alt="Anteemonee" style="width:56px;height:56px;margin-bottom:12px;border-radius:14px">
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
    buildClickableRow('Privacy Policy', 'How we handle your data', () => { window.location.href = '/privacy/'; }),
    buildClickableRow('Terms of Service', 'Terms of use', () => { window.location.href = '/terms/'; }),
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
    sent:    { label: 'Sent',              color: 'var(--text)', bg: 'var(--accent-soft)',  border: 'var(--border)'  },
    fixed:   { label: 'Fixed',             color: 'var(--success)', bg: 'var(--accent-soft)',  border: 'var(--accent-soft)'  },
    replied: { label: 'Admin replied',     color: 'var(--text)', bg: 'var(--accent-soft)', border: 'var(--border)' },
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
    c.innerHTML = '<div class="setting-row"><span style="color:var(--error);font-size:13px">Could not load reports. Try again later.</span></div>';
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
    wrap.style.cssText = 'border-bottom:1px solid var(--border);padding:16px 0;';
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
      pBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px;">Your prompt</div>
        <div style="font-size:13px;color:var(--text-secondary);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;">${escapeHtmlSettings(r.user_prompt)}</div>`;
      expandedBody.appendChild(pBlock);
    }

    // AI message
    if (r.ai_message) {
      const aiBlock = document.createElement('div');
      aiBlock.style.cssText = 'margin-bottom:10px;';
      aiBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px;">AI message you disliked</div>
        <div style="font-size:13px;color:var(--text-secondary);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;">${escapeHtmlSettings(r.ai_message)}</div>`;
      expandedBody.appendChild(aiBlock);
    }

    // Description
    const descBlock = document.createElement('div');
    descBlock.style.cssText = 'margin-bottom:10px;';
    descBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px;">Your description</div>
      <div style="font-size:13px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;">${escapeHtmlSettings(r.description || '')}</div>`;
    expandedBody.appendChild(descBlock);

    // Admin message (only if status is 'replied' and admin_message exists)
    if (r.status === 'replied' && r.admin_message) {
      const adminBlock = document.createElement('div');
      adminBlock.style.cssText = 'margin-bottom:4px;';
      adminBlock.innerHTML = `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text);margin-bottom:4px;">Message from admin</div>
        <div style="font-size:13px;color:var(--text);background:var(--accent-soft);border:1px solid var(--border);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;">${escapeHtmlSettings(r.admin_message)}</div>`;
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
