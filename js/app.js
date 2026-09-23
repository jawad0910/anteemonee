const SUPABASE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';

// Guarded client creation: if the Supabase CDN fails, the site must still
// boot (theme/nav/auth UI in logged-out state) instead of dying entirely.
let db = null;
try {
  if (typeof supabase === 'undefined' || !supabase.createClient) throw new Error('Supabase CDN failed to load');
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('[Anteemonee] database unavailable:', (e && e.message) || e);
}

// Rejects a hung network request so the UI can never get stuck on skeletons.
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms);
  });
  const clear = () => { if (timer) clearTimeout(timer); };
  return Promise.race([promise, timeout]).then(
    (v) => { clear(); return v; },
    (e) => { clear(); throw e; }
  );
}

let currentUser = null;
let currentProfile = null;

function getBaseUrl() {
  const scriptEl = document.currentScript;
  if (scriptEl && scriptEl.src) {
    try {
      const url = new URL(scriptEl.src);
      const path = url.pathname;
      const jsDir = path.substring(0, path.lastIndexOf('/'));
      return jsDir.substring(0, jsDir.lastIndexOf('/'));
    } catch (e) {}
  }
  const loc = window.location;
  if (loc.protocol === 'file:') {
    const href = loc.href;
    const dir = href.substring(0, href.lastIndexOf('/'));
    return dir.substring(0, dir.lastIndexOf('/'));
  }
  return loc.origin;
}
const BASE = getBaseUrl();
const REDIRECT_URL = BASE + '/';
const ONBOARDING_URL = BASE + '/pages/onboarding.html';
const RECOVERY_URL = BASE + '/pages/reset-password.html';

/* =========================
   INITIALISE
   ========================= */

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  setupTheme();
  setupNav();
  setupMobileMenu();
  if (!db) {
    // CDN failed: still render the logged-out UI instead of hanging.
    updateAuthUI();
    return;
  }
  await AccountManager.init();
  await checkAuth();
  checkCookieConsent();
  loadHomepageData();
}

/* =========================
   HOMEPAGE DYNAMIC DATA
   ========================= */

function homepageSetText(id, value) {
  if (value === null || value === undefined) return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadHomepageData() {
  const dashMock = document.getElementById('dash-mock');
  const trustCount = document.getElementById('trust-count');
  if (!dashMock && !trustCount) return;

  // Trust row - public RPC, works logged in or out. Falls back to static HTML.
  if (trustCount) {
    trustCount.classList.add('is-loading');
    try {
      const { data, error } = await db.rpc('get_homepage_stats');
      if (error) {
        console.warn('[homepage] stats RPC failed:', error.message || error, 'â€” run migration 0038_homepage_stats.sql');
      }
      if (!error && data) {
        const count = Number(data.user_count || 0);
        if (count > 0) trustCount.textContent = count.toLocaleString('en-US');
        const avatarsEl = document.getElementById('trust-avatars');
        const avatars = Array.isArray(data.avatars) ? data.avatars.filter(a => a && a.profile_image_url) : [];
        if (avatarsEl && avatars.length) {
          const colors = ['#312E81', '#1E3A5F', '#6D28D9'];
          avatarsEl.innerHTML = avatars.slice(0, 3).map((a, i) => {
            const initial = ((a.username || 'W').charAt(0) || 'W').toUpperCase();
            return `<span style="background:${colors[i % colors.length]};overflow:hidden"><img src="${a.profile_image_url}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.outerHTML='${initial}'"></span>`;
          }).join('');
        }
      }
    } catch (_) {} finally {
      trustCount.classList.remove('is-loading');
    }
  }

  if (!dashMock) return;

  // Personalized dashboard - logged-in users only.
  if (!currentUser) {
    const heroVisual = dashMock.closest('.hero-visual');
    if (heroVisual) heroVisual.style.display = 'none';
    const heroInner = dashMock.closest('.hero-inner');
    if (heroInner) heroInner.classList.add('hero-centered');
    // Remove loading skeleton for non-logged-in users
    const helloEl = document.getElementById('dash-hello');
    if (helloEl) {
      helloEl.classList.remove('is-loading');
      helloEl.innerHTML = 'Welcome to Anteemonee &#x1F44B;';
    }
    return;
  }

  // Greeting: display name first, username (no @) as fallback.
  try {
    const { fullName, username } = getDisplayUser();
    let display = '';
    if (fullName && fullName.trim()) display = fullName.trim().split(/\s+/)[0];
    else if (username) display = username;
    const helloEl = document.getElementById('dash-hello');
    if (helloEl) {
      helloEl.classList.remove('is-loading');
      if (display) helloEl.innerHTML = `Assalam o Alaikum, ${escapeHtmlAttr(display)} &#x1F44B;`;
    }
  } catch (_) {}

  const uid = currentUser.id;
  async function safe(label, promise) {
    try {
      const res = await promise;
      if (res && res.error) {
        console.warn(`[homepage] ${label} query failed:`, res.error.message || res.error);
        return null;
      }
      if (!res) return null;
      if (res.data !== null && res.data !== undefined) return res.data;
      if (typeof res.count === 'number') return res; // head-count queries carry count, not data
      return null;
    } catch (e) {
      console.warn(`[homepage] ${label} query failed:`, (e && e.message) || e);
      return null;
    }
  }

  // Skeleton loaders on while the real numbers load.
  const loaderIds = ['dash-stat-time', 'dash-stat-streak', 'dash-credits-val'];
  loaderIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('is-loading');
  });

  try {
    // Bounded wait: if the network stalls, fall back to nulls so the
    // finally block below clears the skeletons instead of hanging forever.
    const [profileRes, acad, entRes, streakRes] = await Promise.race([
      Promise.all([
        safe('profile', db.from('profiles').select('study_time_seconds').eq('id', uid).maybeSingle()),
        safe('academic_profile', db.from('student_academic_profiles').select('class_level:class_levels(label)').eq('user_id', uid).maybeSingle()),
        safe('entitlement', db.rpc('get_entitlement_snapshot')),
        safe('streak', db.rpc('get_user_streak')),
      ]),
      new Promise((resolve) => setTimeout(() => resolve([null, null, null, null]), 15000)),
    ]);

    // Study time from profiles.study_time_seconds + pending localStorage
    if (profileRes && typeof profileRes.study_time_seconds === 'number') {
      let totalSec = profileRes.study_time_seconds;
      // Add any pending seconds saved on chatbot page unload (scoped per user)
      try {
        const pendingKey = currentUser ? `Anteemonee_study_time_pending_${currentUser.id}` : 'Anteemonee_study_time_pending';
        const pending = parseInt(localStorage.getItem(pendingKey) || '0', 10);
        if (pending > 0) totalSec += pending;
      } catch (_) {}
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      let timeStr = '';
      if (h > 0) timeStr += `${h}h `;
      if (m > 0 || h > 0) timeStr += `${m}m `;
      timeStr += `${s}s`;
      homepageSetText('dash-stat-time', timeStr.trim());
      homepageSetText('dash-stat-time-sub', 'Total');
    } else {
      homepageSetText('dash-stat-time', '0s');
      homepageSetText('dash-stat-time-sub', 'Total');
    }

    // Streak: from user_streaks table via RPC (auto-detects 24h break).
    if (streakRes && typeof streakRes === 'object') {
      const s = streakRes.current_streak || 0;
      homepageSetText('dash-stat-streak', s === 1 ? '1 Day' : `${s} Days`);
      homepageSetText('dash-stat-streak-sub', s > 0 ? 'Keep it up!' : 'Start today!');
    } else {
      homepageSetText('dash-stat-streak', 'â€“');
      homepageSetText('dash-stat-streak-sub', 'Unavailable');
    }

    // Plan status: lifetime / trial countdown / expired.
    try {
      await Access.init();
      const st = Access.state;
      if (st.paid) {
        homepageSetText('dash-credits-val', 'Lifetime');
      } else if (st.reason === 'trial') {
        homepageSetText('dash-credits-val', st.daysLeft <= 1 ? 'Trial ends today' : `${st.daysLeft} trial days left`);
      } else if (st.reason === 'expired' || st.reason === 'blocked') {
        homepageSetText('dash-credits-val', 'Trial expired');
      }
    } catch (_) {}
    // Class pill from the academic profile.
    const classLabel = acad && acad.class_level && acad.class_level.label;
    const pill = document.getElementById('dash-class-pill');
    if (pill) {
      if (classLabel) pill.textContent = classLabel;
      else pill.style.display = 'none';
    }
  } finally {
    loaderIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('is-loading');
    });
  }
}

/* Theme modes: 'light' | 'dark' | 'system' (device default). Stored per
   device in localStorage; legacy per-user / generic keys migrate forward. */
function getThemeMode() {
  try {
    const m = localStorage.getItem('Anteemonee_theme_mode');
    if (m === 'light' || m === 'dark' || m === 'system') return m;
    const legacy = localStorage.getItem('Anteemonee_theme');
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch (e) {}
  return 'system';
}
function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch (e) {}
  return 'dark';
}
function applyThemeMode(mode) {
  document.documentElement.setAttribute('data-theme', resolveTheme(mode));
  updateThemeIcon();
}
function updateThemeIcon() {
  var current = document.documentElement.getAttribute('data-theme');
  var btns = document.querySelectorAll('.theme-toggle');
  var sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  btns.forEach(function(btn) { btn.innerHTML = current === 'dark' ? sunSvg : moonSvg; });
}
function setThemeMode(mode) {
  if (mode !== 'light' && mode !== 'dark') mode = 'system';
  try {
    localStorage.setItem('Anteemonee_theme_mode', mode);
    localStorage.removeItem('Anteemonee_theme');
    if (typeof currentUser !== 'undefined' && currentUser?.id) {
      localStorage.removeItem(`Anteemonee_theme_${currentUser.id}`);
    }
  } catch (err) {}
  applyThemeMode(mode);
}
try {
  window.AnteemoneeTheme = { get: getThemeMode, set: setThemeMode, apply: applyThemeMode };
} catch (e) {}

function setupTheme() {
  try { applyThemeMode(getThemeMode()); updateThemeIcon(); } catch (e) {}
  // Follow device changes while in system mode.
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { try { if (getThemeMode() === 'system') applyThemeMode('system'); } catch (_) {} };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {}
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-toggle');
    if (!btn) return;
    // Header toggle is a quick light/dark switch (sets an explicit choice).
    const current = document.documentElement.getAttribute('data-theme');
    setThemeMode(current === 'dark' ? 'light' : 'dark');
  });
}

/* =========================
   COOKIE CONSENT (DB-backed)
   ========================= */

async function checkCookieConsent() {
  // Already decided in this browser?
  if (localStorage.getItem('Anteemonee_cookie_consent')) return;

  // If logged in, check DB
  if (currentUser && db) {
    try {
      const { data } = await db.from('profiles').select('cookie_consent').eq('id', currentUser.id).maybeSingle();
      if (data && data.cookie_consent) {
        localStorage.setItem('Anteemonee_cookie_consent', data.cookie_consent);
        return;
      }
    } catch (_) {}
  }

  // Not yet decided â€” show the popup
  if (typeof window.__showCookieConsent === 'function') window.__showCookieConsent();
}

/* =========================
   AUTH STATE
   ========================= */

async function checkAuth() {
  try {
    const { data: { session } } = await withTimeout(db.auth.getSession(), 10000, 'session');
    if (session?.user) {
      currentUser = session.user;
      await loadProfile();
      // Save/refresh this session in the multi-account store
      await AccountManager.saveCurrentSession(session.user, session);
    }
  } catch (e) {
    console.error('Auth check failed:', e);
  }
  // If already logged in, never land on the login/signup pages (unless adding another account).
  if (currentUser && /login\.html|signup\.html/.test(window.location.pathname)) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') !== 'add_account') {
      window.location.href = REDIRECT_URL;
      return;
    }
  }
  updateAuthUI();
  setupAuthPages();
  window.__authReady = true;
}

async function loadProfile() {
  if (!currentUser) return;
  try {
    const { data, error } = await db
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id);
    if (error) {
      console.error('Profile query error:', error);
      return;
    }
    currentProfile = data?.length ? data[0] : null;
  } catch (e) {
    console.error('Profile load failed:', e);
  }
}

function generateUsername(fullName, email) {
  if (fullName && fullName.trim()) {
    const cleaned = fullName.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .slice(0, 20);
    if (cleaned.length >= 3) return cleaned;
  }
  return (email?.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

async function ensureProfile() {
  if (!currentUser) return null;
  if (!currentProfile) await loadProfile();
  if (currentProfile) {
    // Only seed Google avatar when user never set one (null/undefined).
    // Never overwrite: '' means user explicitly removed photo, URL means custom upload.
    const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
    if (avatarUrl && currentProfile.profile_image_url == null) {
      await db.from('profiles').update({ profile_image_url: avatarUrl }).eq('id', currentUser.id);
      currentProfile.profile_image_url = avatarUrl;
    }
    return currentProfile;
  }
  const fullName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '';
  const username = generateUsername(fullName, currentUser.email);
  const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
  const { data, error } = await db.from('profiles').insert({
    id: currentUser.id,
    username: username,
    email: currentUser.email,
    full_name: fullName || null,
    profile_image_url: avatarUrl,
    personal_info_completed: false,
    academic_profile_completed: false,
    goals_completed: false
  }).select();
  if (!error && data?.length) currentProfile = data[0];
  return currentProfile;
}

function updateAuthUI() {
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn = document.getElementById('auth-logged-in');
  const authLoading = document.getElementById('auth-loading');
  const mobileLoggedOut = document.getElementById('mobile-auth-logged-out');
  const mobileLoggedIn = document.getElementById('mobile-auth-logged-in');
  const mobileAuthLoading = document.getElementById('mobile-auth-loading');
  const landingLoggedOut = document.getElementById('landing-auth');
  const landingLoggedIn = document.getElementById('landing-auth-in');

  if (authLoading) authLoading.style.display = 'none';
  if (mobileAuthLoading) mobileAuthLoading.style.display = 'none';

  if (currentUser) {
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'flex';
    if (mobileLoggedOut) mobileLoggedOut.style.display = 'none';
    if (mobileLoggedIn) mobileLoggedIn.style.display = 'block';
    if (landingLoggedOut) landingLoggedOut.style.display = 'none';
    if (landingLoggedIn) {
      // Landing page has its own dropdown rendering in index.html inline script
      // Only show the container, don't overwrite innerHTML
      landingLoggedIn.style.display = 'flex';
    }
    renderProfileAvatar();
    renderMobileProfile();

    const footerLink = document.getElementById('footer-signup-link');
    if (footerLink) { footerLink.textContent = 'Account'; footerLink.href = 'pages/account.html'; }
    // Hide footer login/signup links when logged in
    document.querySelectorAll('.footer a[href*="login.html"], .footer a[href*="signup.html"]').forEach(function(a) {
      a.style.display = 'none';
    });
  } else {
    if (loggedOut) loggedOut.style.display = 'flex';
    if (loggedIn) loggedIn.style.display = 'none';
    if (mobileLoggedOut) mobileLoggedOut.style.display = 'block';
    if (mobileLoggedIn) mobileLoggedIn.style.display = 'none';
    if (landingLoggedOut) landingLoggedOut.style.display = 'flex';
    if (landingLoggedIn) landingLoggedIn.style.display = 'none';
    // Show footer login/signup links when logged out
    document.querySelectorAll('.footer a[href*="login.html"], .footer a[href*="signup.html"]').forEach(function(a) {
      a.style.display = '';
    });
  }
}

/* =========================
   PROFILE AVATAR
   ========================= */

function getDisplayUser() {
  const fullName = currentProfile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || '';
  const username = currentProfile?.username || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'User';
  const imgUrl = currentProfile?.profile_image_url ?? currentUser?.user_metadata?.avatar_url ?? currentUser?.user_metadata?.picture ?? '';
  return { fullName, username, imgUrl };
}

function renderProfileAvatar() {
  const container = document.getElementById('profile-avatar-container');
  if (!container) return;
  const { fullName, username, imgUrl } = getDisplayUser();

  container.innerHTML = `
    <button class="profile-btn" onclick="toggleProfileDropdown()" aria-label="Profile menu">
      <div class="avatar-wrapper">
        <img src="${imgUrl}" alt="${username}" class="avatar-img"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="avatar-fallback" style="${imgUrl ? 'display:none' : ''}">${username.charAt(0).toUpperCase()}</div>
      </div>
    </button>
    <div class="profile-dropdown" id="profile-dropdown">
      <div class="dropdown-header">
        <div class="dropdown-avatar">
          <img src="${imgUrl}" alt="${username}" class="dropdown-avatar-img"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
          <div class="avatar-fallback dropdown-avatar-fallback" style="${imgUrl ? 'display:none' : ''}">${username.charAt(0).toUpperCase()}</div>
        </div>
        <div class="dropdown-info">
          <span class="dropdown-name">${fullName || username}</span>
          <span class="dropdown-email">${currentUser?.email || ''}</span>
        </div>
      </div>
      <div class="dropdown-divider"></div>
      <a href="${BASE}/pages/account.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Account
      </a>
      <a href="${BASE}/" onclick="if(window.AnteemoneeSettings&&window.AnteemoneeSettings.open){event.preventDefault();toggleProfileDropdown();window.AnteemoneeSettings.open();}" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </a>
      <a href="${BASE}/" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27a7 7 0 0 1-7 7v-1.27A2 2 0 0 1 13 22H4a2 2 0 0 1-2-2v-7.55A7 7 0 0 1 4 8h1V5.73C4.4 5.39 4 4.74 4 4a2 2 0 0 1 2-2h6z"/><circle cx="8.5" cy="13" r="1"/><circle cx="15.5" cy="13" r="1"/></svg>
        AI Chat
      </a>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item dropdown-logout" onclick="handleLogout()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Logout
      </button>
    </div>
  `;
}

function renderMobileProfile() {
  const container = document.getElementById('mobile-profile-section');
  if (!container || !currentUser) return;
  const { username, imgUrl } = getDisplayUser();
  const initial = username.charAt(0).toUpperCase();

  container.innerHTML = `
    <div class="mobile-acc-dropdown mobile-acc-single" id="mobile-acc-dropdown">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 0;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;overflow:hidden;flex-shrink:0;">
          ${imgUrl ? `<img src="${imgUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;">${initial}</div>` : initial}
        </div>
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text);">${username}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${currentUser?.email || ''}</div>
        </div>
      </div>
    </div>
  `;
}

/* =========================
   PROFILE DROPDOWN
   ========================= */

function toggleProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('profile-avatar-container');
  if (container && !container.contains(e.target)) {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }
});

/* =========================
   LOGOUT
   ========================= */

async function handleLogout() {
  try {
    try { await Access.releaseSlot(); } catch (_) {}
    try { await AccountManager.logoutAll(); } catch (_) {}
    await db.auth.signOut();
    currentUser = null;
    currentProfile = null;
    window.location.href = BASE + '/index.html';
  } catch (e) {
    console.error('Logout failed:', e);
  }
}

/* =========================
   MULTI-ACCOUNT SWITCHING
   ========================= */

let _switchingAccount = false;

async function switchToAccount(userId, options = {}) {
  window.location.reload();
}

function addAnotherAccount() {}
function logoutAllAccounts() { handleLogout(); }
function showAccountSwitchOverlay() {}
function hideAccountSwitchOverlay() {}
function showAccountLimitModal() {}
function closeAccountLimitModal() {}
function showSessionExpiredModal() {}
function reAuthAccount() {}
function showAccountSwitcherModal() {}
function closeAccountSwitcherModal() {}
function handleSwitchAccount() {}
function handleLogoutAllAccounts() {}

/* =========================
   NAV & UI EFFECTS
   ========================= */

function setupNav() {
  const header = document.querySelector('.header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Notes dropdown — click-persistent (hover still works, but stays open until outside click)
  const navDrops = document.querySelectorAll('.nav-drop');
  navDrops.forEach(drop => {
    const trigger = drop.querySelector('a');
    const menu = drop.querySelector('.nav-menu');
    if (!trigger || !menu) return;
    // Click on trigger toggles .open; prevent #features jump
    trigger.addEventListener('click', (e) => {
      if (trigger.getAttribute('href') === '#features' || trigger.getAttribute('href') === '#') {
        e.preventDefault();
      }
      e.stopPropagation();
      const isOpen = drop.classList.contains('open');
      // close all others first
      document.querySelectorAll('.nav-drop.open').forEach(d => { if (d !== drop) d.classList.remove('open'); });
      if (isOpen) drop.classList.remove('open');
      else drop.classList.add('open');
    });
    // keep open when hovering menu — no extra JS needed, CSS ::before bridges the 6px gap
  });
  // Close any open nav-drop on outside click / Esc / link click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-drop')) {
      document.querySelectorAll('.nav-drop.open').forEach(d => d.classList.remove('open'));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.nav-drop.open').forEach(d => d.classList.remove('open'));
  });
  document.querySelectorAll('.nav-menu a').forEach(a => {
    a.addEventListener('click', () => {
      // close after navigation click
      document.querySelectorAll('.nav-drop.open').forEach(d => d.classList.remove('open'));
    });
  });
}

function setupMobileMenu() {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const panel = document.querySelector('.mobile-menu');
  if (!toggle || !panel) return;

  function openMenu() {
    panel.classList.add('open');
    toggle.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    panel.classList.remove('open');
    toggle.classList.remove('active');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    panel.classList.contains('open') ? closeMenu() : openMenu();
  });

  panel.querySelectorAll('a, button').forEach(link => {
    link.addEventListener('click', (e) => {
      if (e.target.closest('.mobile-acc-toggle')) return;
      closeMenu();
    });
  });
}

function setupIntersectionObserver() {}

/* =========================
   HOMEPAGE HELPERS
   ========================= */

function scrollToFeatures() {
  const el = document.getElementById('ecosystem');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

async function getStarted() {
  if (currentUser) {
    await ensureProfile();
    const step = await getOnboardingStep();
    window.location.href = step >= 0 ? ONBOARDING_URL : REDIRECT_URL;
  } else {
    window.location.href = BASE + '/pages/signup.html';
  }
}

/* =========================
   AUTH PAGES SETUP
   ========================= */

function setupAuthPages() {
  setupLoginForm();
  setupSignupForm();
  setupForgotPasswordForm();
  setupResetPasswordForm();
  setupResendVerification();
  setupPasswordRequirements();
  setupUsernameAvailability();
  setupAddAccountBanner();
}

function setupAddAccountBanner() {
  const urlParams = new URLSearchParams(window.location.search);
  const isAddMode = urlParams.get('mode') === 'add_account';

  const banner = document.getElementById('add-account-banner');

  if (isAddMode && banner) {
    // Add-account mode: show current account + back button
    const accounts = AccountManager.getSavedAccounts();
    const firstAccount = accounts[0];

    if (firstAccount) {
      const initial = (firstAccount.displayName || firstAccount.email || '?')[0].toUpperCase();
      banner.innerHTML = `
        <div class="add-account-banner-top">
          <div class="add-account-banner-avatar">
            ${firstAccount.avatarUrl ? `<img src="${firstAccount.avatarUrl}" alt="">` : `<span>${initial}</span>`}
          </div>
          <div class="add-account-banner-info">
            <span class="add-account-banner-name">Currently signed in as ${firstAccount.displayName || firstAccount.email}</span>
            <span class="add-account-banner-email">${firstAccount.email}</span>
          </div>
        </div>
        <div class="add-account-banner-back-row">
          <button class="add-account-banner-back" onclick="window.location.href='${BASE}/index.html'">&larr; Back to ${firstAccount.displayName || 'account'}</button>
        </div>
      `;
      banner.style.display = 'flex';
    }

    const title = document.getElementById('login-title') || document.getElementById('signup-title');
    const subtitle = document.getElementById('login-subtitle') || document.getElementById('signup-subtitle');
    if (title) title.textContent = 'Add another account';
    if (subtitle) subtitle.textContent = 'Sign in to another Anteemonee account';
    return;
  }

  // Single-account login: no "Continue as" quick-switch list. The banner
  // stays hidden on normal login/signup pages.
}

/* ---- LOGIN ---- */

function setupLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', handleLogin);
}

/* Friendly login errors: translate technical failures into plain language. */
async function readEdgeReason(err) {
  try {
    const ctx = err && err.context;
    if (ctx && typeof ctx.text === 'function') {
      const t = await ctx.text();
      if (t) {
        try {
          const body = JSON.parse(t);
          const msg = body && (body.error || body.message || body.msg);
          if (msg) return String(msg);
        } catch (_) {
          if (t.length < 300) return t;
        }
      }
    }
  } catch (_) {}
  try {
    if (err && err.message && !/edge function returned a non-2xx/i.test(err.message)) return err.message;
  } catch (_) {}
  return '';
}

async function friendlyUsernameError(err) {
  const reason = await readEdgeReason(err);
  if (/password|incorrect|invalid|wrong|credential/i.test(reason)) {
    return new Error('Incorrect password. Please try again.');
  }
  if (/no user|not found|unknown|no account/i.test(reason)) {
    return new Error('No account found with this username. Check the spelling or create a new account.');
  }
  const msg = (err && err.message) || '';
  if (/failed to fetch|network|timeout|timed out/i.test(msg)) {
    return new Error('Network error. Check your connection and try again.');
  }
  if (reason) return new Error(reason.length > 160 ? reason.slice(0, 160) : reason);
  return new Error("Couldn't sign you in. Please check your details and try again.");
}

async function friendlyEmailError(err, email) {
  const msg = (err && err.message) || '';
  if (/email not confirmed/i.test(msg)) {
    return new Error('Please verify your email first. Check your inbox for the confirmation link.');
  }
  if (/too many requests|rate limit|over.*limit/i.test(msg)) {
    return new Error('Too many attempts. Please wait a minute and try again.');
  }
  if (/invalid login credentials/i.test(msg)) {
    // Disambiguate: does this email have an account?
    try {
      const res = await db.from('profiles').select('id').eq('email', String(email).toLowerCase()).maybeSingle();
      if (!res.error) {
        return new Error(res.data
          ? 'Incorrect password. Please try again.'
          : 'No account found with this email. Check the spelling or create a new account.');
      }
    } catch (_) {}
  }
  if (/failed to fetch|network|timeout|timed out/i.test(msg)) {
    return new Error('Network error. Check your connection and try again.');
  }
  return err instanceof Error ? err : new Error(msg || 'Login failed. Please try again.');
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const identifier = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('login-error');

  setLoading(btn, true);
  hideMessage(errorEl);

  try {
    const isEmail = identifier.includes('@');

    if (isEmail) {
      try {
        const { error } = await db.auth.signInWithPassword({ email: identifier, password });
        if (error) throw error;
      } catch (loginErr) {
        throw await friendlyEmailError(loginErr, identifier);
      }
    } else {
      // Username login goes through the edge function.
      // First: does this username exist at all?
      try {
        const { data: available } = await db.rpc('is_username_available', { p_username: identifier });
        if (available === true) throw new Error('No account found with this username. Check the spelling or create a new account.');
      } catch (preErr) {
        if (preErr && /^No account found/.test(preErr.message || '')) throw preErr;
        // RPC failed — continue to the login attempt anyway.
      }
      try {
        const { data, error } = await db.functions.invoke('sign-in-with-username', {
          body: { username: identifier, password }
        });
        if (error) throw error;
        if (data?.session) {
          const { error: sessionError } = await db.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
          });
          if (sessionError) throw sessionError;
        }
      } catch (loginErr) {
        throw await friendlyUsernameError(loginErr);
      }
    }

    await checkAuth();
    await ensureProfile();

    // Check if we're in "add account" mode
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'add_account') {
      const returnTo = sessionStorage.getItem('Anteemonee_add_account_return');
      sessionStorage.removeItem('Anteemonee_add_account_return');
      sessionStorage.removeItem('Anteemonee_adding_account');
      window.location.href = returnTo || BASE + '/index.html';
      return;
    }

    const step = await getOnboardingStep();
    if (step >= 0) {
      window.location.href = ONBOARDING_URL;
    } else {
      window.location.href = REDIRECT_URL;
    }
  } catch (err) {
    showMessage(errorEl, err.message || 'Login failed. Please try again.');
  } finally {
    setLoading(btn, false);
  }
}

/* ---- SIGNUP ---- */

function setupSignupForm() {
  const form = document.getElementById('signup-form');
  if (!form) return;
  form.addEventListener('submit', handleSignup);
}

const ALLOWED_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'icloud.com', 'me.com', 'mac.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'proton.me', 'protonmail.com',
  'aol.com'
]);

function isAllowedEmailDomain(email) {
  const domain = (email || '').trim().toLowerCase().split('@')[1] || '';
  if (!domain || !domain.includes('.')) return false;
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

async function handleSignup(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('signup-confirm-password')?.value;
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('signup-error');
  const successEl = document.getElementById('signup-success');
  const confirmError = document.getElementById('signup-confirm-error');

  setLoading(btn, true);
  hideMessage(errorEl);
  hideMessage(successEl);
  if (confirmError) confirmError.style.display = 'none';

  try {
    if (!isAllowedEmailDomain(email)) throw new Error('Please use a valid email provider (e.g. Gmail, iCloud, Outlook, Yahoo).');
    if (!username || username.length < 3) throw new Error('Username must be at least 3 characters.');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new Error('Username can only contain letters, numbers, and underscores.');

    const { data: available } = await db.rpc('is_username_available', { p_username: username });
    if (available === false) throw new Error('This username is already taken.');

    if (confirmPassword !== undefined && password !== confirmPassword) {
      if (confirmError) confirmError.style.display = 'block';
      throw new Error('Passwords do not match.');
    }

    const pwResult = validatePassword(password);
    if (!pwResult.valid) throw new Error(pwResult.message);

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: REDIRECT_URL
      }
    });
    if (error) throw error;

    if (data?.user?.identities?.length === 0) {
      throw new Error('An account with this email already exists.');
    }

    if (data?.session) {
      currentUser = data.user;
      await checkAuth();
      await ensureProfile();

      // Check if we're in "add account" mode
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('mode') === 'add_account') {
        const returnTo = sessionStorage.getItem('Anteemonee_add_account_return');
        sessionStorage.removeItem('Anteemonee_add_account_return');
        sessionStorage.removeItem('Anteemonee_adding_account');
        window.location.href = returnTo || BASE + '/index.html';
        return;
      }

      const step = await getOnboardingStep();
      window.location.href = step >= 0 ? ONBOARDING_URL : REDIRECT_URL;
      return;
    }

    showMessage(successEl, 'Account created! Check your email for a verification link.');
    setTimeout(() => { window.location.href = BASE + '/pages/login.html'; }, 2500);
  } catch (err) {
    showMessage(errorEl, err.message || 'Signup failed. Please try again.');
  } finally {
    setLoading(btn, false);
  }
}

/* ---- USERNAME AVAILABILITY ---- */

function setupUsernameAvailability() {
  const input = document.getElementById('signup-username');
  if (!input) return;

  let debounceTimer = null;
  let indicator = input.parentElement.querySelector('.username-status');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'username-status';
    input.parentElement.appendChild(indicator);
  }

  input.addEventListener('input', () => {
    const val = input.value.trim();
    clearTimeout(debounceTimer);
    indicator.textContent = '';
    indicator.className = 'username-status';

    if (val.length < 3) return;

    debounceTimer = setTimeout(async () => {
      indicator.textContent = 'Checking...';
      indicator.className = 'username-status checking';

      try {
        const { data } = await db.rpc('is_username_available', { p_username: val });
        if (data === true) {
          indicator.textContent = 'Available';
          indicator.className = 'username-status available';
        } else if (data === false) {
          indicator.textContent = 'Taken';
          indicator.className = 'username-status taken';
        } else {
          indicator.textContent = '';
          indicator.className = 'username-status';
        }
      } catch {
        indicator.textContent = '';
        indicator.className = 'username-status';
      }
    }, 600);
  });
}

/* ---- PASSWORD TOGGLE ---- */

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  const eyeOpen = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');
  if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : '';
  if (eyeClosed) eyeClosed.style.display = isPassword ? '' : 'none';
}

/* ---- PASSWORD REQUIREMENTS ---- */

function setupPasswordRequirements() {
  const input = document.getElementById('signup-password');
  if (!input) return;

  let container = input.parentElement.parentElement.querySelector('.password-requirements');
  if (!container) {
    container = document.createElement('div');
    container.className = 'password-requirements';
    container.innerHTML = `
      <div class="pw-req" data-req="length">
        <span class="pw-check"><svg viewBox="0 0 16 16" fill="none"><polyline points="3 8 7 12 13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span>At least 8 characters</span>
      </div>
      <div class="pw-req" data-req="upper">
        <span class="pw-check"><svg viewBox="0 0 16 16" fill="none"><polyline points="3 8 7 12 13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span>One uppercase letter</span>
      </div>
      <div class="pw-req" data-req="number">
        <span class="pw-check"><svg viewBox="0 0 16 16" fill="none"><polyline points="3 8 7 12 13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span>One number</span>
      </div>
    `;
    input.parentElement.parentElement.appendChild(container);
  }

  const reqs = container.querySelectorAll('.pw-req');

  function checkPassword() {
    const val = input.value;
    const checks = {
      length: val.length >= 8,
      upper: /[A-Z]/.test(val),
      number: /[0-9]/.test(val)
    };
    reqs.forEach(el => {
      const key = el.dataset.req;
      el.classList.toggle('met', checks[key]);
    });
    checkConfirmMatch();
  }

  function checkConfirmMatch() {
    const confirmInput = document.getElementById('signup-confirm-password');
    const confirmError = document.getElementById('signup-confirm-error');
    if (!confirmInput || !confirmError) return;
    const val = confirmInput.value;
    if (!val) { confirmError.style.display = 'none'; return; }
    if (val !== input.value) {
      confirmError.textContent = 'Passwords do not match';
      confirmError.style.display = 'block';
    } else {
      confirmError.style.display = 'none';
    }
  }

  input.addEventListener('input', checkPassword);

  const confirmInput = document.getElementById('signup-confirm-password');
  if (confirmInput) confirmInput.addEventListener('input', checkConfirmMatch);

  checkPassword();
}

function validatePassword(pw) {
  if (pw.length < 8) return { valid: false, message: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(pw)) return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  if (!/[0-9]/.test(pw)) return { valid: false, message: 'Password must contain at least one number.' };
  return { valid: true };
}


/* ---- FORGOT PASSWORD ---- */

function setupForgotPasswordForm() {
  const form = document.getElementById('forgot-password-form');
  if (!form) return;
  form.addEventListener('submit', handleForgotPassword);
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('forgot-error');
  const successEl = document.getElementById('forgot-success');

  setLoading(btn, true);
  hideMessage(errorEl);
  hideMessage(successEl);

  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: RECOVERY_URL
    });
    if (error) throw error;
    showMessage(successEl, 'Password reset link sent! Check your email.');
  } catch (err) {
    showMessage(errorEl, err.message || 'Failed to send reset email.');
  } finally {
    setLoading(btn, false);
  }
}

/* ---- RESET PASSWORD (recovery mode) ---- */

function setupResetPasswordForm() {
  const form = document.getElementById('reset-password-form');
  if (!form) return;

  const hash = window.location.hash;
  if (hash.includes('type=recovery')) {
    form.closest('.auth-card')?.querySelector('.auth-header p')?.setAttribute('textContent', 'Set your new password');
    form.addEventListener('submit', handleResetPassword);
  } else {
    form.closest('.auth-card')?.querySelector('.auth-header')?.insertAdjacentHTML('afterend',
      '<div class="auth-error" style="display:block">Invalid or expired reset link. Please request a new one.</div>'
    );
    form.style.display = 'none';
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-password-confirm').value;
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('reset-error');
  const successEl = document.getElementById('reset-success');

  setLoading(btn, true);
  hideMessage(errorEl);
  hideMessage(successEl);

  try {
    if (password !== confirm) throw new Error('Passwords do not match.');

    const pwResult = validatePassword(password);
    if (!pwResult.valid) throw new Error(pwResult.message);

    const { error } = await db.auth.updateUser({ password });
    if (error) throw error;

    showMessage(successEl, 'Password updated! Redirecting to login...');
    setTimeout(() => { window.location.href = BASE + '/pages/login.html'; }, 2000);
  } catch (err) {
    showMessage(errorEl, err.message || 'Failed to reset password.');
  } finally {
    setLoading(btn, false);
  }
}

/* ---- EMAIL VERIFICATION RESEND ---- */

function setupResendVerification() {
  const btn = document.getElementById('resend-verification-btn');
  if (!btn) return;
  btn.addEventListener('click', handleResendVerification);
}

async function handleResendVerification(e) {
  const btn = e.currentTarget;
  const email = btn.dataset.email || currentUser?.email;
  if (!email) return;

  btn.disabled = true;
  let countdown = 60;
  btn.textContent = `Resend in ${countdown}s`;

  const interval = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(interval);
      btn.disabled = false;
      btn.textContent = 'Resend verification email';
    } else {
      btn.textContent = `Resend in ${countdown}s`;
    }
  }, 1000);

  try {
    const { error } = await db.auth.resend({ type: 'signup', email });
    if (error) throw error;
  } catch (err) {
    clearInterval(interval);
    btn.disabled = false;
    btn.textContent = 'Resend verification email';
    alert(err.message || 'Failed to resend.');
  }
}

/* ---- GOOGLE OAUTH ---- */

async function signInWithGoogle() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: BASE + '/pages/auth/callback/google.html' }
    });
    if (error) throw error;
  } catch (err) {
    alert(err.message || 'Google sign-in failed.');
  }
}

async function signInWithSpotify() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'spotify',
      options: { redirectTo: BASE + '/pages/auth/callback/spotify.html' }
    });
    if (error) throw error;
  } catch (err) {
    alert(err.message || 'Spotify sign-in failed.');
  }
}

/* =========================
   ONBOARDING STEP DETECTION
   ========================= */

async function getOnboardingStep() {
  if (!currentUser) { console.log('[getOnboardingStep] no currentUser â†’ -1'); return -1; }
  try {
    if (!currentProfile) await loadProfile();
    const profile = currentProfile;
    if (!profile) { console.log('[getOnboardingStep] no profile â†’ 0'); return 0; }
    if (!profile.date_of_birth || !profile.province_id) { console.log('[getOnboardingStep] missing dob/province â†’ 0', profile.date_of_birth, profile.province_id); return 0; }
    if (!profile.city_id) { console.log('[getOnboardingStep] missing city â†’ 1'); return 1; }
    const { data: acads, error: acadErr } = await db.from('student_academic_profiles')
      .select('id, education_system_id, board_id, class_level_id, group_id')
      .eq('user_id', currentUser.id);
    if (acadErr) { console.error('[getOnboardingStep] SAP query error:', acadErr); return -1; }
    const acad = acads?.length ? acads[0] : null;
    console.log('[getOnboardingStep] SAP row:', acad);
    if (!acad || !acad.education_system_id) { console.log('[getOnboardingStep] no SAP or no edu_system â†’ 2'); return 2; }
    if (!acad.board_id) { console.log('[getOnboardingStep] no board â†’ 3'); return 3; }
    if (!acad.class_level_id) { console.log('[getOnboardingStep] no class_level â†’ 4'); return 4; }

    // For ICS: no group step — academic profile is complete after class
    const isIcsSystem = await db.from('education_systems').select('code').eq('id', acad.education_system_id).maybeSingle();
    const icsMode = isIcsSystem?.data?.code === 'ics';

    if (!icsMode && !acad.group_id) { console.log('[getOnboardingStep] no group → 5'); return 5; }

    console.log('[getOnboardingStep] all complete → -1');
    return -1;
  } catch (e) {
    console.error('[getOnboardingStep] error:', e);
    return -1;
  }
}

/* =========================
   ONBOARDING FLOW
   ========================= */

const onboarding = {
  currentStep: 0,
  totalSteps: 6,
  data: {
    dob: '',
    province_id: null,
    city_id: null,
    education_system_id: null,
    board_id: null,
    class_level_id: null,
    group_id: null,
    selected_goals: [],
    primary_goal_id: null
  },
  ref: {
    provinces: [],
    cities: [],
    education_systems: [],
    boards: [],
    class_levels: [],
    groups: [],
    goal_categories: [],
    goals: []
  }
};

function setupOnboarding() {
  if (!document.getElementById('onboarding-container')) return;
  renderOnboardingStep();
  setupOnboardingNav();
}

async function loadOnboardingRefData() {
  const [systemsRes, provincesRes, goalsCatRes] = await Promise.all([
    db.from('education_systems').select('*').eq('is_active', true).order('sort_order'),
    db.from('provinces').select('*').order('name'),
    db.from('goal_categories').select('*').order('sort_order')
  ]);

  onboarding.ref.education_systems = systemsRes.data || [];
  onboarding.ref.provinces = provincesRes.data || [];

  const cats = goalsCatRes.data || [];
  onboarding.ref.goal_categories = cats;

  const goalsResults = await Promise.all(cats.map(c => db.from('goals').select('*').eq('category_id', c.id).order('sort_order')));
  onboarding.ref.goals = cats.flatMap((c, i) => (goalsResults[i].data || []).map(g => ({ ...g, category_name: c.name })));
}

async function loadBoards(systemId, region) {
  const { data } = await db.from('education_system_boards')
    .select('board_id, boards(*)')
    .eq('education_system_id', systemId);
  let boards = (data || []).map(r => r.boards).filter(Boolean);
  if (region) {
    boards = boards.filter(b => b.region === region || b.region === 'Federal');
  }
  onboarding.ref.boards = boards;
}

async function loadClassLevels(systemId) {
  const { data } = await db.from('class_levels')
    .select('*')
    .eq('education_system_id', systemId)
    .order('sort_order');
  onboarding.ref.class_levels = data || [];
}

async function loadGroups(systemId) {
  const { data } = await db.from('groups')
    .select('*')
    .eq('education_system_id', systemId)
    .order('name');
  onboarding.ref.groups = data || [];
}

async function loadCities(provinceId) {
  const { data } = await db.from('cities')
    .select('*')
    .eq('province_id', provinceId)
    .order('name');
  onboarding.ref.cities = data || [];
}

async function loadOnboardingData() {
  if (!currentUser) return;
  try {
    if (!currentProfile) await loadProfile();
    const profile = currentProfile;
    if (profile) {
      onboarding.data.dob = profile.date_of_birth || '';
      onboarding.data.province_id = profile.province_id || null;
      onboarding.data.city_id = profile.city_id || null;
    }
    const { data: acads } = await db.from('student_academic_profiles').select('*').eq('user_id', currentUser.id);
    const acad = acads?.length ? acads[0] : null;
    if (acad) {
      onboarding.data.education_system_id = acad.education_system_id || null;
      onboarding.data.board_id = acad.board_id || null;
      onboarding.data.class_level_id = acad.class_level_id || null;
      onboarding.data.group_id = acad.group_id || null;
    }
  } catch (e) {
    console.error('loadOnboardingData error:', e);
  }
}

async function saveStepData(step) {
  const d = onboarding.data;
  async function sapExists() {
    const { data } = await db.from('student_academic_profiles').select('id').eq('user_id', currentUser.id).maybeSingle();
    return data;
  }
  switch (step) {
    case 0:
      await db.from('profiles').update({ date_of_birth: d.dob || null, province_id: d.province_id || null }).eq('id', currentUser.id);
      break;
    case 1:
      await db.from('profiles').update({ city_id: d.city_id || null }).eq('id', currentUser.id);
      break;
    case 2: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ education_system_id: d.education_system_id }).eq('user_id', currentUser.id);
      break;
    }
    case 3: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ board_id: d.board_id }).eq('user_id', currentUser.id);
      break;
    }
    case 4: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ class_level_id: d.class_level_id }).eq('user_id', currentUser.id);
      break;
    }
    case 5: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ group_id: d.group_id }).eq('user_id', currentUser.id);
      break;
    }
  }
}

/* ---- ONBOARDING NAVIGATION ---- */

function setupOnboardingNav() {
  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');
  if (prevBtn) prevBtn.addEventListener('click', onboardingPrev);
  if (nextBtn) nextBtn.addEventListener('click', onboardingNext);
}

function showOnboardingLoading() {
  const container = document.getElementById('onboarding-container');
  if (container) {
    container.innerHTML = '<div class="onboarding-loading"><div class="spinner"></div></div>';
  }
}

async function onboardingNext() {
  const valid = await validateOnboardingStep(onboarding.currentStep);
  if (!valid) return;

  if (onboarding.currentStep === onboarding.totalSteps - 1) {
    await saveOnboarding();
    return;
  }

  await saveStepData(onboarding.currentStep);
  onboarding.currentStep++;
  showOnboardingLoading();
  await loadStepData(onboarding.currentStep);
  renderOnboardingStep();
}

async function onboardingPrev() {
  if (onboarding.currentStep <= 0) return;
  onboarding.currentStep--;
  showOnboardingLoading();
  await loadStepData(onboarding.currentStep);
  renderOnboardingStep();
}

function updateOnboardingProgress() {
  const bar = document.getElementById('onboarding-progress-bar');
  const label = document.getElementById('onboarding-step-label');
  if (bar) {
    const pct = ((onboarding.currentStep + 1) / onboarding.totalSteps) * 100;
    bar.style.width = pct + '%';
  }
  if (label) label.textContent = `Step ${onboarding.currentStep + 1} of ${onboarding.totalSteps}`;
}

/* ---- LOAD STEP DATA ---- */

async function loadStepData(step) {
  const d = onboarding.data;
  const r = onboarding.ref;

  switch (step) {
    case 0:
      if (!r.provinces.length) await loadOnboardingRefData();
      break;
    case 1:
      if (d.province_id) await loadCities(d.province_id);
      break;
    case 2:
      if (!r.education_systems.length) await loadOnboardingRefData();
      if (d.education_system_id) {
        const province = r.provinces.find(p => p.id == d.province_id);
        await loadBoards(d.education_system_id, province?.name);
        await loadClassLevels(d.education_system_id);
      }
      break;
    case 3:
      if (!r.education_systems.length) await loadOnboardingRefData();
      if (d.education_system_id) {
        const province = r.provinces.find(p => p.id == d.province_id);
        await loadBoards(d.education_system_id, province?.name);
      }
      break;
    case 4:
      if (d.education_system_id) await loadClassLevels(d.education_system_id);
      break;
    case 5:
      if (d.education_system_id) await loadGroups(d.education_system_id);
      break;
  }
}

/* ---- VALIDATE STEP ---- */

async function validateOnboardingStep(step) {
  const d = onboarding.data;
  const errorEl = document.getElementById('onboarding-error');
  hideMessage(errorEl);

  switch (step) {
    case 0:
      if (!d.dob) { showMessage(errorEl, 'Please enter your date of birth.'); return false; }
      {
        const birthDate = new Date(d.dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
        if (age < 15) { showMessage(errorEl, 'You must be at least 15 years old to use Anteemonee.'); return false; }
      }
      if (!d.province_id) { showMessage(errorEl, 'Please select your province.'); return false; }
      return true;
    case 1:
      if (!d.city_id) { showMessage(errorEl, 'Please select your city.'); return false; }
      return true;
    case 2:
      if (!d.education_system_id) { showMessage(errorEl, 'Please select your education system.'); return false; }
      return true;
    case 3:
      if (!d.board_id) { showMessage(errorEl, 'Please select your board.'); return false; }
      return true;
    case 4:
      if (!d.class_level_id) { showMessage(errorEl, 'Please select your class.'); return false; }
      return true;
    case 5:
      if (!d.group_id) { showMessage(errorEl, 'Please select your group.'); return false; }
      return true;
    default:
      return true;
  }
}

/* ---- RENDER STEPS ---- */

function renderOnboardingStep() {
  const container = document.getElementById('onboarding-container');
  if (!container) return;

  updateOnboardingProgress();

  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');
  if (prevBtn) prevBtn.style.display = onboarding.currentStep === 0 ? 'none' : '';
  if (nextBtn) nextBtn.textContent = onboarding.currentStep === onboarding.totalSteps - 1 ? 'Complete' : 'Continue';

  const d = onboarding.data;
  const r = onboarding.ref;

  switch (onboarding.currentStep) {
    case 0:
      container.innerHTML = `
        <h2 class="onboarding-title">Personal Information</h2>
        <p class="onboarding-subtitle">Tell us a bit about yourself.</p>
        <div class="form-group">
          <label for="onb-dob">Date of Birth</label>
          <input type="date" id="onb-dob" class="form-input" value="${d.dob}" max="${new Date(new Date().setFullYear(new Date().getFullYear() - 15)).toISOString().split('T')[0]}" lang="en-GB">
          <p style="font-size:12px;color:var(--text-muted);margin-top:6px">You must be at least 15 years old.</p>
        </div>
        <div class="form-group">
          <label for="onb-province">Province</label>
          <select id="onb-province" class="form-input">
            <option value="">Select province</option>
            ${r.provinces.filter(p => String(p.name).toLowerCase() === 'punjab').map(p => `<option value="${p.id}" ${d.province_id === p.id || !d.province_id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
      `;
      document.getElementById('onb-dob')?.addEventListener('change', e => { d.dob = e.target.value; });
      document.getElementById('onb-province')?.addEventListener('change', async e => {
        d.province_id = e.target.value || null;
        d.city_id = null;
        if (d.province_id) await loadCities(d.province_id);
      });
      break;

    case 1:
      container.innerHTML = `
        <h2 class="onboarding-title">Your City</h2>
        <p class="onboarding-subtitle">Select the city you live in.</p>
        <div class="form-group">
          <label for="onb-city">City</label>
          <select id="onb-city" class="form-input">
            <option value="">Select city</option>
            ${r.cities.map(c => `<option value="${c.id}" ${d.city_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
      `;
      document.getElementById('onb-city')?.addEventListener('change', e => { d.city_id = e.target.value || null; });
      break;

    case 2:
      container.innerHTML = `
        <h2 class="onboarding-title">Education System</h2>
        <p class="onboarding-subtitle">Which education system are you in?</p>
        <div class="onboarding-options">
          ${r.education_systems.map(s => `
            <button class="onboarding-option ${d.education_system_id === s.id ? 'selected' : ''}" data-id="${s.id}">
              <span class="option-name">${s.name}</span>
              ${s.description ? `<span class="option-desc">${s.description}</span>` : ''}
            </button>
          `).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          d.education_system_id = btn.dataset.id;
          d.board_id = null;
          d.class_level_id = null;
          d.group_id = null;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const province = r.provinces.find(p => p.id == d.province_id);
          await loadBoards(d.education_system_id, province?.name);
          await loadClassLevels(d.education_system_id);
        });
      });
      break;

    case 3:
      container.innerHTML = `
        <h2 class="onboarding-title">Board</h2>
        <p class="onboarding-subtitle">Which board do you study under?</p>
        <div class="onboarding-options">
          ${r.boards.map(b => `
            <button class="onboarding-option ${d.board_id === b.id ? 'selected' : ''}" data-id="${b.id}">
              <span class="option-name">${b.name}</span>
              ${b.short_name ? `<span class="option-desc">${b.short_name}</span>` : ''}
            </button>
          `).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          d.board_id = btn.dataset.id;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      break;

    case 4:
      container.innerHTML = `
        <h2 class="onboarding-title">Class</h2>
        <p class="onboarding-subtitle">Which class are you in?</p>
        <div class="onboarding-options">
          ${r.class_levels.map(cl => `
            <button class="onboarding-option ${d.class_level_id === cl.id ? 'selected' : ''}" data-id="${cl.id}">
              <span class="option-name">${cl.label}</span>
              ${cl.value ? `<span class="option-desc">Year ${cl.value}</span>` : ''}
            </button>
          `).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          d.class_level_id = btn.dataset.id;
          d.group_id = null;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          await loadGroups(d.education_system_id);
        });
      });
      break;

    case 5:
      container.innerHTML = `
        <h2 class="onboarding-title">Group</h2>
        <p class="onboarding-subtitle">What is your group / stream?</p>
        <div class="onboarding-options">
          ${r.groups.map(g => `
            <button class="onboarding-option ${d.group_id === g.id ? 'selected' : ''}" data-id="${g.id}">
              <span class="option-name">${g.name}</span>
              ${g.description ? `<span class="option-desc">${g.description}</span>` : ''}
            </button>
          `).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          d.group_id = btn.dataset.id;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      break;
  }
}

async function saveOnboarding() {
  const nextBtn = document.getElementById('onboarding-next');
  const errorEl = document.getElementById('onboarding-error');
  setLoading(nextBtn, true);
  hideMessage(errorEl);

  try {
    if (!currentUser) throw new Error('Not authenticated. Please log in again.');

    const d = onboarding.data;

    const sapPayload = {
      user_id: currentUser.id,
      education_system_id: d.education_system_id ? Number(d.education_system_id) : null,
      board_id: d.board_id ? Number(d.board_id) : null,
      class_level_id: d.class_level_id ? Number(d.class_level_id) : null,
      group_id: d.group_id ? Number(d.group_id) : null
    };

    console.log('[saveOnboarding] SAP payload:', JSON.stringify(sapPayload));

    const { error: profileErr } = await db.from('profiles').update({
      date_of_birth: d.dob || null,
      province_id: d.province_id ? Number(d.province_id) : null,
      city_id: d.city_id ? Number(d.city_id) : null,
      personal_info_completed: true,
      academic_profile_completed: true
    }).eq('id', currentUser.id);
    if (profileErr) {
      console.error('[saveOnboarding] Profile update error:', profileErr);
      throw profileErr;
    }
    console.log('[saveOnboarding] Profile updated OK');

    const { data: acadProfileRes, error: acadErr } = await db.from('student_academic_profiles').upsert(sapPayload, { onConflict: 'user_id' }).select('id');
    if (acadErr) {
      console.error('[saveOnboarding] SAP upsert error:', acadErr);
      throw acadErr;
    }
    console.log('[saveOnboarding] SAP upsert result:', acadProfileRes);

    await loadProfile();
    console.log('[saveOnboarding] All saved. Profile after reload:', JSON.stringify(currentProfile));
    window.location.href = REDIRECT_URL;
  } catch (err) {
    console.error('[saveOnboarding] CAUGHT:', err);
    showMessage(errorEl, err.message || 'Failed to save. Please try again.');
  } finally {
    setLoading(nextBtn, false);
  }
}

/* =========================
   UTILITY HELPERS
   ========================= */

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showMessage(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideMessage(el) {
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

/* =========================
   USER PREFERENCES
   ========================= */

let userPrefs = null;

const DEFAULT_PREFS = {
  notify_study_reminders: true, notify_planner_reminders: true,
  notify_exam_reminders: true, notify_revision_reminders: true,
  notify_daily_learning: false, notify_ai_recommendations: true,
  notify_new_content: false, notify_past_paper_updates: false,
  notify_system: true, quiet_hours_enabled: false,
  quiet_start: '22:00', quiet_end: '07:00',
  theme_mode: 'dark', accent_color: 'violet',
  glass_intensity: 'medium', reduce_animations: false,
  layout_density: 'comfortable',
  ai_response_style: 'balanced', ai_language: 'english',
  ai_voice_enabled: true, ai_voice_speed: 100,
  ai_study_recommendations: true, ai_autoplay_voice: false,
  ai_memory_enabled: true, ai_personalization: '', ai_references: false,
  planner_daily_goal_minutes: 120, planner_default_session_min: 45,
  planner_week_starts_on: 1, planner_break_preference: 'short_breaks',
  planner_auto_schedule: true, planner_exam_prep_mode: 'balanced',
  learning_default_difficulty: 'mixed', learning_auto_save_mistakes: true,
  learning_show_frequency: true, learning_show_mastery: true,
  wifi_only_downloads: true,
  app_language: 'english', textbook_language: 'english',
  privacy_profile_visibility: 'private', privacy_stats_visibility: 'private',
  privacy_activity_visibility: 'private', privacy_ai_history: true,
  privacy_personalization: true, privacy_learning_history: true
};

async function loadUserPrefs() {
  if (!currentUser) return DEFAULT_PREFS;
  try {
    const { data, error } = await db.from('user_preferences').select('*').eq('user_id', currentUser.id).maybeSingle();
    if (error) { console.error('loadUserPrefs error:', error); return { ...DEFAULT_PREFS }; }
    if (!data) {
      const { error: insErr } = await db.from('user_preferences').insert({ user_id: currentUser.id });
      if (insErr) console.error('loadUserPrefs insert error:', insErr);
      return { ...DEFAULT_PREFS };
    }
    userPrefs = { ...DEFAULT_PREFS, ...data };
    return userPrefs;
  } catch (e) {
    console.error('loadUserPrefs exception:', e);
    return { ...DEFAULT_PREFS };
  }
}

async function saveUserPrefs(updates) {
  if (!currentUser) throw new Error('Not authenticated');
  const { error } = await db.from('user_preferences').update(updates).eq('user_id', currentUser.id);
  if (error) throw error;
  userPrefs = { ...userPrefs || DEFAULT_PREFS, ...updates };
  applyPrefsToUI();
}

function applyPrefsToUI() {
  if (!userPrefs) return;
  if (userPrefs.reduce_animations) document.documentElement.classList.add('reduce-anim');
  else document.documentElement.classList.remove('reduce-anim');
}


async function fetchSecurityEvents(limit = 10) {
  if (!currentUser) return [];
  try {
    const { data } = await db.from('security_events')
      .select('id, kind, detail, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) { return []; }
}

async function recordSecurityEvent(kind, detail) {
  if (!currentUser) return;
  try {
    await db.from('security_events').insert({ user_id: currentUser.id, kind, detail: detail || null });
  } catch (e) { /* best-effort */ }
}

/* =========================================================
   LIFETIME ACCESS — 3-day trial, device lock, single session
   Model: Rs 2,499 one-time lifetime. 3-day free trial (one per
   device). One active session per account (second login kicks
   the first with notice). Hard paywall after trial expiry.

   Requires Supabase tables (run ACCESS_TABLES.sql once):
     trials(user_id PK, started_at, ends_at)
     trial_devices(device_hash PK, user_id, claimed_at)
     active_devices(user_id PK, device_id, last_seen)
   ========================================================= */

const TRIAL_DAYS = 3;
const LIFETIME_PRICE = 'Rs 2,499';

const Access = {
  state: { ready: false, paid: false, trial: 'unknown', trialEndsAt: null, daysLeft: 0, access: false, reason: 'guest' },
  _deviceId: null,
  _heartbeat: null,
  _inited: false,

  // Paid = lifetime plan (new model) or legacy active premium/pro.
  isPaidEntitlement(ent) {
    if (!ent) return false;
    if (ent.plan_type === 'lifetime' && ent.subscription_status !== 'refunded') return true;
    if ((ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active') return true;
    return false;
  },

  // Stable per-browser id for the single-session slot.
  getDeviceId() {
    try {
      let id = localStorage.getItem('Anteemonee_device_id');
      if (!id) {
        id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('Anteemonee_device_id', id);
      }
      return id;
    } catch (_) {
      return 'd_fallback_' + Math.random().toString(36).slice(2, 10);
    }
  },

  // Best-effort device fingerprint for the one-trial-per-device lock.
  async getDeviceHash() {
    try {
      const parts = [navigator.userAgent || '', navigator.platform || '', screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || ''),
        Intl.DateTimeFormat().resolvedOptions().timeZone || '', (navigator.language || '')];
      try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.textBaseline = 'top'; ctx.font = '14px Arial';
        ctx.fillText('anteemonee-device-fp', 2, 2);
        parts.push(c.toDataURL().slice(-120));
      } catch (_) {}
      const raw = parts.join('|');
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      let h = 5381;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
      return 'fb_' + h.toString(16);
    } catch (_) {
      return 'fb_unknown';
    }
  },

  _missingTable(err) {
    if (!err) return false;
    if (err.code === '42P01') return true;
    const msg = String((err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || ''));
    return /relation .* does not exist|table .* does not exist|schema cache/i.test(msg);
  },

  // Main entry: call after checkAuth(). Computes + caches Access.state.
  async init() {
    if (this._inited) return this.state;
    this._inited = true;
    const st = this.state;
    try {
      if (!currentUser || !db) { st.ready = true; st.reason = 'guest'; return st; }
      let ent = null;
      try {
        const res = await db.rpc('get_entitlement_snapshot');
        ent = res.data || null;
      } catch (_) { ent = null; }
      if (this.isPaidEntitlement(ent)) {
        st.paid = true; st.access = true; st.reason = 'lifetime'; st.ready = true;
        this.claimDeviceSlot();
        return st;
      }
      const trial = await this.ensureTrial();
      st.trial = trial.status;
      st.trialEndsAt = trial.endsAt || null;
      st.daysLeft = trial.daysLeft || 0;
      if (trial.status === 'active') {
        st.access = true; st.reason = 'trial';
        this.claimDeviceSlot();
      } else if (trial.status === 'unavailable') {
        // Access tables not created yet (run ACCESS_TABLES.sql) — fail open so the app keeps working.
        st.access = true; st.reason = 'trial';
      } else {
        st.access = false;
        st.reason = trial.status === 'blocked' ? 'blocked' : 'expired';
      }
      st.ready = true;
      return st;
    } catch (e) {
      console.warn('[Access] init failed:', e);
      st.ready = true; st.reason = 'error'; st.access = false;
      return st;
    }
  },

  // 3-day trial with one-per-device lock. Auto-claims on first use.
  async ensureTrial() {
    const out = { status: 'none', endsAt: null, daysLeft: 0 };
    try {
      if (!currentUser || !db) return out;
      const now = Date.now();
      let row = null;
      try {
        const res = await db.from('trials').select('started_at, ends_at').eq('user_id', currentUser.id).maybeSingle();
        if (res.error) throw res.error;
        row = res.data || null;
      } catch (e) {
        if (this._missingTable(e)) { console.warn('[Access] trials table missing — run ACCESS_TABLES.sql'); return { status: 'unavailable', endsAt: null, daysLeft: 0 }; }
        throw e;
      }
      if (row && row.ends_at) {
        const ends = new Date(row.ends_at).getTime();
        if (now < ends) {
          out.status = 'active'; out.endsAt = row.ends_at;
          out.daysLeft = Math.max(1, Math.ceil((ends - now) / 86400000));
        } else {
          out.status = 'expired'; out.endsAt = row.ends_at; out.daysLeft = 0;
        }
        return out;
      }
      // No trial yet — claim one, locked to this device.
      const hash = await this.getDeviceHash();
      try {
        const ins = await db.from('trial_devices').insert({ device_hash: hash, user_id: currentUser.id });
        if (ins.error) throw ins.error;
      } catch (e) {
        if (e && (e.code === '23505' || /duplicate|already exists/i.test(e.message || ''))) {
          out.status = 'blocked'; // this device already claimed a trial
          return out;
        }
        if (this._missingTable(e)) { console.warn('[Access] trial_devices table missing — run ACCESS_TABLES.sql'); return { status: 'unavailable', endsAt: null, daysLeft: 0 }; }
        throw e;
      }
      const started = new Date().toISOString();
      const ends = new Date(now + TRIAL_DAYS * 86400000).toISOString();
      try {
        const t = await db.from('trials').insert({ user_id: currentUser.id, started_at: started, ends_at: ends });
        if (t.error) throw t.error;
      } catch (e) {
        if (!(e && (e.code === '23505' || /duplicate|already exists/i.test(e.message || '')))) throw e;
        // Race: trial row appeared concurrently — re-read it.
        return this.ensureTrial();
      }
      out.status = 'active'; out.endsAt = ends; out.daysLeft = TRIAL_DAYS;
      return out;
    } catch (e) {
      console.warn('[Access] trial check failed:', e);
      return out;
    }
  },

  // Single-session slot: this device takes over; others get kicked.
  async claimDeviceSlot() {
    try {
      if (!currentUser || !db) return;
      this._deviceId = this.getDeviceId();
      await db.from('active_devices').upsert(
        { user_id: currentUser.id, device_id: this._deviceId, last_seen: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      this.startHeartbeat();
    } catch (e) {
      if (this._missingTable(e)) console.warn('[Access] active_devices table missing — run ACCESS_TABLES.sql');
    }
  },

  startHeartbeat() {
    try {
      if (this._heartbeat) clearInterval(this._heartbeat);
      this._heartbeat = setInterval(() => this.verifySlot(), 60000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.verifySlot();
      });
    } catch (_) {}
  },

  async verifySlot() {
    try {
      if (!currentUser || !db || !this._deviceId) return;
      await db.from('active_devices').update({ last_seen: new Date().toISOString() }).eq('user_id', currentUser.id).eq('device_id', this._deviceId);
      const { data } = await db.from('active_devices').select('device_id').eq('user_id', currentUser.id).maybeSingle();
      if (data && data.device_id && data.device_id !== this._deviceId) this.kickedOut();
    } catch (_) { /* transient — next beat retries */ }
  },

  // Best-effort cleanup so a clean logout frees the slot instantly.
  async releaseSlot() {
    try {
      if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
      if (currentUser && db) await db.from('active_devices').delete().eq('user_id', currentUser.id);
    } catch (_) {}
  },

  kickedOut() {
    try { if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; } } catch (_) {}
    this.state.access = false; this.state.reason = 'kicked';
    try { if (db) db.auth.signOut().catch(() => {}); } catch (_) {}
    try { if (typeof AccountManager !== 'undefined') AccountManager.removeAccount(currentUser?.id).catch(() => {}); } catch (_) {}
    currentUser = null; currentProfile = null;
    let modal = document.getElementById('access-kicked-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'access-kicked-modal';
      modal.innerHTML = `
        <div style="position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);padding:20px">
          <div style="width:100%;max-width:380px;background:var(--bg-secondary,#14181d);border:1px solid var(--border-glass,rgba(255,255,255,0.12));border-radius:16px;padding:32px 28px;text-align:center">
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px">Signed in on another device</h3>
            <p style="font-size:0.85rem;opacity:0.75;line-height:1.5;margin:0 0 24px">Your account was signed in elsewhere. Lifetime accounts allow one active session at a time — this device has been signed out.</p>
            <button id="access-kicked-ok" style="width:100%;padding:12px 20px;border:none;border-radius:12px;background:var(--accent,#6366F1);color:#fff;font-size:0.9rem;font-weight:700;cursor:pointer">Sign In Again</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('access-kicked-ok')?.addEventListener('click', () => {
        window.location.href = (typeof BASE !== 'undefined' ? BASE : '') + '/pages/login.html';
      });
    }
    modal.style.display = 'block';
  },

  trialDaysText() {
    const st = this.state;
    if (st.reason === 'trial') return st.daysLeft <= 1 ? 'Trial ends today' : `${st.daysLeft} trial days left`;
    return '';
  },

  // Shows/removes the hard-paywall banner above the chat input.
  // Returns true when the user is locked (signed in, no access).
  applyChatPaywall() {
    const st = this.state;
    const locked = !!(st.ready && !st.access && st.reason !== 'guest' && st.reason !== 'error');
    try { document.body.classList.toggle('locked', locked); } catch (_) {}
    try {
      const area = document.querySelector('.chat-input-area');
      let bar = document.getElementById('access-paywall');
      if (locked && area) {
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'access-paywall';
          area.prepend(bar);
        }
        const payHref = (typeof BASE !== 'undefined' ? BASE : '') + '/pages/payment.html';
        const title = st.reason === 'blocked' ? 'Free trial already used on this device' : 'Your 3-day free trial has ended';
        bar.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:10px;border-radius:14px;background:var(--accent-soft,rgba(99,102,241,0.12));border:1px solid var(--accent,rgba(99,102,241,0.4))">
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:700">${title}</div>
              <div style="font-size:12px;opacity:0.75">Get lifetime access for ${typeof LIFETIME_PRICE !== 'undefined' ? LIFETIME_PRICE : 'Rs 2,499'} — pay once, yours forever.</div>
            </div>
            <a href="${payHref}" style="flex-shrink:0;padding:10px 18px;border-radius:10px;background:var(--accent,#6366F1);color:#fff;font-size:13px;font-weight:700;text-decoration:none">Get Access</a>
          </div>`;
        bar.style.display = '';
      } else if (bar) {
        bar.style.display = 'none';
      }
    } catch (_) {}
    try {
      if (locked) {
        const wa = document.querySelectorAll('.welcome-action-btn');
        for (let i = 0; i < wa.length; i++) wa[i].disabled = true;
      }
    } catch (_) {}
    return locked;
  },
};
