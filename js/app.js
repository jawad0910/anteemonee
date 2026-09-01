const { createClient } = supabase;
const SUPABASE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
const REDIRECT_URL = BASE + '/pages/account.html';
const ONBOARDING_URL = BASE + '/pages/onboarding.html';
const RECOVERY_URL = BASE + '/pages/reset-password.html';

/* =========================
   INITIALISE
   ========================= */

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  setupNav();
  setupScrollEffects();
  setupMobileMenu();
  setupIntersectionObserver();
  await checkAuth();
}

/* =========================
   AUTH STATE
   ========================= */

async function checkAuth() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      await loadProfile();
    }
  } catch (e) {
    console.error('Auth check failed:', e);
  }
  updateAuthUI();
  setupAuthPages();
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

async function ensureProfile() {
  if (!currentUser) return null;
  if (!currentProfile) await loadProfile();
  if (currentProfile) {
    const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
    if (avatarUrl && currentProfile.profile_image_url !== avatarUrl) {
      await db.from('profiles').update({ profile_image_url: avatarUrl }).eq('id', currentUser.id);
      currentProfile.profile_image_url = avatarUrl;
    }
    return currentProfile;
  }
  const username = currentUser.user_metadata?.username || currentUser.user_metadata?.preferred_username || currentUser.email?.split('@')[0] || 'user';
  const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
  const { data, error } = await db.from('profiles').insert({
    id: currentUser.id,
    username: username.toLowerCase(),
    email: currentUser.email,
    full_name: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || null,
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
  const mobileLoggedOut = document.getElementById('mobile-auth-logged-out');
  const mobileLoggedIn = document.getElementById('mobile-auth-logged-in');

  if (currentUser) {
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'flex';
    if (mobileLoggedOut) mobileLoggedOut.style.display = 'none';
    if (mobileLoggedIn) mobileLoggedIn.style.display = 'flex';
    renderProfileAvatar();
    renderMobileProfile();

    const heroCta = document.getElementById('hero-cta');
    if (heroCta) { heroCta.textContent = 'Go to Account'; heroCta.onclick = () => window.location.href = REDIRECT_URL; }
    const ctaBtn = document.getElementById('cta-btn');
    if (ctaBtn) { ctaBtn.textContent = 'Go to Account'; ctaBtn.onclick = () => window.location.href = REDIRECT_URL; }
    const ctaLabel = document.getElementById('cta-label');
    if (ctaLabel) ctaLabel.textContent = 'Welcome Back';
    const ctaTitle = document.getElementById('cta-title');
    if (ctaTitle) ctaTitle.textContent = 'Continue Your Journey';
    const ctaDesc = document.getElementById('cta-desc');
    if (ctaDesc) ctaDesc.textContent = 'Pick up right where you left off.';
    const footerLink = document.getElementById('footer-signup-link');
    if (footerLink) { footerLink.textContent = 'Account'; footerLink.href = 'pages/account.html'; }
  } else {
    if (loggedOut) loggedOut.style.display = 'flex';
    if (loggedIn) loggedIn.style.display = 'none';
    if (mobileLoggedOut) mobileLoggedOut.style.display = 'flex';
    if (mobileLoggedIn) mobileLoggedIn.style.display = 'none';
  }
}

/* =========================
   PROFILE AVATAR
   ========================= */

function getDisplayUser() {
  const fullName = currentProfile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || '';
  const username = currentProfile?.username || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'User';
  const imgUrl = currentProfile?.profile_image_url || currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture || '';
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
      <a href="${BASE}/pages/settings.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </a>
      <a href="${BASE}/pages/ai-chatbot.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27a7 7 0 0 1-7 7v-1.27A2 2 0 0 1 13 22H4a2 2 0 0 1-2-2v-7.55A7 7 0 0 1 4 8h1V5.73C4.4 5.39 4 4.74 4 4a2 2 0 0 1 2-2h6z"/><circle cx="8.5" cy="13" r="1"/><circle cx="15.5" cy="13" r="1"/></svg>
        AI Chat
      </a>
      <a href="${BASE}/pages/download.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download App
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

  container.innerHTML = `
    <div class="mobile-profile-info">
      <div class="mobile-avatar">
        <img src="${imgUrl}" alt="${username}" class="mobile-avatar-img"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="avatar-fallback mobile-avatar-fallback" style="${imgUrl ? 'display:none' : ''}">${username.charAt(0).toUpperCase()}</div>
      </div>
      <div class="mobile-profile-text">
        <span class="mobile-username">${username}</span>
        <span class="mobile-email">${currentUser?.email || ''}</span>
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
    await db.auth.signOut();
    currentUser = null;
    currentProfile = null;
    window.location.href = BASE + '/index.html';
  } catch (e) {
    console.error('Logout failed:', e);
  }
}

/* =========================
   NAV & UI EFFECTS
   ========================= */

function setupNav() {
  const header = document.querySelector('.header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });
}

function setupScrollEffects() {
  const elements = document.querySelectorAll('.fade-in');
  if (!elements.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  elements.forEach(el => observer.observe(el));
}

function setupMobileMenu() {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const panel = document.querySelector('.mobile-menu');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open');
    toggle.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
  });
  panel.querySelectorAll('a, button').forEach(link => {
    link.addEventListener('click', () => {
      panel.classList.remove('open');
      toggle.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

function setupIntersectionObserver() {
  const sections = document.querySelectorAll('section[id]');
  if (!sections.length) return;
  const navLinks = document.querySelectorAll('.nav-links a, .mobile-menu a[href^="#"]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${id}`) link.classList.add('active');
        });
      }
    });
  }, { threshold: 0.3 });
  sections.forEach(s => observer.observe(s));
}

/* =========================
   HOMEPAGE HELPERS
   ========================= */

function scrollToFeatures() {
  const el = document.getElementById('features');
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
}

/* ---- LOGIN ---- */

function setupLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', handleLogin);
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
      const { error } = await db.auth.signInWithPassword({ email: identifier, password });
      if (error) throw error;
    } else {
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
    }

    await checkAuth();
    await ensureProfile();
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
      <div class="pw-req" data-req="length"><span class="pw-icon"></span>At least 8 characters</div>
      <div class="pw-req" data-req="upper"><span class="pw-icon"></span>One uppercase letter</div>
      <div class="pw-req" data-req="number"><span class="pw-icon"></span>One number</div>
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
  if (!currentUser) { console.log('[getOnboardingStep] no currentUser → -1'); return -1; }
  try {
    if (!currentProfile) await loadProfile();
    const profile = currentProfile;
    if (!profile) { console.log('[getOnboardingStep] no profile → 0'); return 0; }
    if (!profile.date_of_birth || !profile.province_id) { console.log('[getOnboardingStep] missing dob/province → 0', profile.date_of_birth, profile.province_id); return 0; }
    if (!profile.city_id) { console.log('[getOnboardingStep] missing city → 1'); return 1; }
    const { data: acads, error: acadErr } = await db.from('student_academic_profiles')
      .select('id, education_system_id, board_id, class_level_id, group_id, college_id, academic_session_id, exam_year')
      .eq('user_id', currentUser.id);
    if (acadErr) { console.error('[getOnboardingStep] SAP query error:', acadErr); return -1; }
    const acad = acads?.length ? acads[0] : null;
    console.log('[getOnboardingStep] SAP row:', acad);
    if (!acad || !acad.education_system_id) { console.log('[getOnboardingStep] no SAP or no edu_system → 2'); return 2; }
    if (!acad.board_id) { console.log('[getOnboardingStep] no board → 3'); return 3; }
    if (!acad.class_level_id) { console.log('[getOnboardingStep] no class_level → 4'); return 4; }
    if (!acad.group_id) { console.log('[getOnboardingStep] no group → 5'); return 5; }
    if (acad.id) {
      const { count, error: countErr } = await db.from('student_subjects')
        .select('id', { count: 'exact', head: true })
        .eq('academic_profile_id', acad.id);
      if (countErr) { console.error('[getOnboardingStep] subjects query error:', countErr); return -1; }
      console.log('[getOnboardingStep] subject count:', count);
      if (!count) return 6;
    } else {
      return 6;
    }
    if (!acad.academic_session_id) { console.log('[getOnboardingStep] no session → 8'); return 8; }
    if (!profile.goals_completed) {
      const { count, error: goalsErr } = await db.from('academic_goals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.id);
      if (goalsErr) { console.error('[getOnboardingStep] goals query error:', goalsErr); return -1; }
      console.log('[getOnboardingStep] goals count:', count, 'goals_completed:', profile.goals_completed);
      if (!count) return 10;
      return 11;
    }
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
  totalSteps: 12,
  data: {
    dob: '',
    province_id: null,
    city_id: null,
    education_system_id: null,
    board_id: null,
    class_level_id: null,
    group_id: null,
    exam_year: '',
    college_id: null,
    academic_session_id: null,
    selected_subjects: [],
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
    subjects: [],
    colleges: [],
    academic_sessions: [],
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
  const [systemsRes, provincesRes, sessionsRes, goalsCatRes] = await Promise.all([
    db.from('education_systems').select('*').eq('is_active', true).order('sort_order'),
    db.from('provinces').select('*').order('name'),
    db.from('academic_sessions').select('*').order('start_year'),
    db.from('goal_categories').select('*').order('sort_order')
  ]);

  onboarding.ref.education_systems = systemsRes.data || [];
  onboarding.ref.provinces = provincesRes.data || [];
  onboarding.ref.academic_sessions = sessionsRes.data || [];

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

async function loadSubjects(systemId, groupId) {
  let query = db.from('subjects')
    .select('*')
    .eq('education_system_id', systemId);
  if (groupId) {
    query = query.or('group_id.is.null,group_id.eq.' + groupId);
  } else {
    query = query.is('group_id', null);
  }
  const { data } = await query.order('is_compulsory', { ascending: false }).order('name');
  onboarding.ref.subjects = data || [];
}

function getClassYearValue() {
  const cl = onboarding.ref.class_levels.find(c => c.id == onboarding.data.class_level_id);
  return cl?.value || 0;
}

function isSecondYear() {
  return getClassYearValue() === 12;
}

function getOnboardingSubjects() {
  const secondYear = isSecondYear();
  const suffix = secondYear ? '-II' : '-I';
  return onboarding.ref.subjects
    .filter(s => {
      const name = (s.name || '').toLowerCase();
      if (name.includes('pakistan studies')) return secondYear;
      if (name.includes('islamiat') || name.includes('islamiyat')) return !secondYear;
      return true;
    })
    .map(s => {
      const name = (s.name || '').toLowerCase();
      const noSuffix = name.includes('pakistan studies') || name.includes('islamiat') || name.includes('islamiyat');
      return { ...s, displayName: noSuffix ? s.name : `${s.name} ${suffix}` };
    });
}

async function loadAllColleges() {
  const { data } = await db.from('colleges')
    .select('id,name,city_id')
    .order('name')
    .limit(500);
  onboarding.ref.colleges = data || [];
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
      onboarding.data.college_id = acad.college_id || null;
      onboarding.data.academic_session_id = acad.academic_session_id || null;
      onboarding.data.exam_year = acad.exam_year || new Date().getFullYear().toString();
      if (acad.id) {
        const { data: subjects } = await db.from('student_subjects').select('subject_id').eq('academic_profile_id', acad.id);
        onboarding.data.selected_subjects = subjects?.map(s => s.subject_id) || [];
      }
    }
    const { data: goals } = await db.from('academic_goals').select('goal_id, is_primary').eq('user_id', currentUser.id);
    if (goals?.length) {
      onboarding.data.selected_goals = goals.map(g => g.goal_id);
      const primary = goals.find(g => g.is_primary);
      onboarding.data.primary_goal_id = primary?.goal_id || null;
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
    case 6: {
      const row = await sapExists();
      if (row) {
        await db.from('student_subjects').delete().eq('academic_profile_id', row.id);
        if (d.selected_subjects.length) {
          await db.from('student_subjects').insert(d.selected_subjects.map(sid => ({ academic_profile_id: row.id, subject_id: sid })));
        }
      }
      break;
    }
    case 7: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ college_id: d.college_id }).eq('user_id', currentUser.id);
      break;
    }
    case 8: {
      const row = await sapExists();
      if (row) await db.from('student_academic_profiles').update({ academic_session_id: d.academic_session_id, exam_year: parseInt(d.exam_year) || new Date().getFullYear() }).eq('user_id', currentUser.id);
      break;
    }
    case 10:
      await db.from('academic_goals').delete().eq('user_id', currentUser.id);
      if (d.selected_goals.length) {
        await db.from('academic_goals').insert(d.selected_goals.map(gid => ({ user_id: currentUser.id, goal_id: gid, is_primary: gid === d.primary_goal_id })));
      }
      break;
  }
}

/* ---- ONBOARDING NAVIGATION ---- */

function setupOnboardingNav() {
  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');
  if (prevBtn) prevBtn.addEventListener('click', onboardingPrev);
  if (nextBtn) nextBtn.addEventListener('click', onboardingNext);
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
  await loadStepData(onboarding.currentStep);
  renderOnboardingStep();
}

async function onboardingPrev() {
  if (onboarding.currentStep <= 0) return;
  onboarding.currentStep--;
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
    case 6:
      if (d.education_system_id) await loadSubjects(d.education_system_id, d.group_id);
      d.selected_subjects = getOnboardingSubjects().map(s => s.id);
      break;
    case 7:
      await loadAllColleges();
      break;
    case 8:
      break;
    case 9:
      if (!r.education_systems.length) await loadOnboardingRefData();
      if (d.province_id && !r.cities.length) await loadCities(d.province_id);
      if (d.education_system_id) {
        if (!r.boards.length) {
          const province = r.provinces.find(p => p.id == d.province_id);
          await loadBoards(d.education_system_id, province?.name);
        }
        if (!r.class_levels.length) await loadClassLevels(d.education_system_id);
        if (!r.groups.length) await loadGroups(d.education_system_id);
        if (!r.subjects.length) await loadSubjects(d.education_system_id, d.group_id);
      }
      if (!r.colleges.length) await loadAllColleges();
      break;
    case 10:
    case 11:
      if (!r.goal_categories.length) await loadOnboardingRefData();
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
        if (age < 15) { showMessage(errorEl, 'You must be at least 15 years old to use Wassal.'); return false; }
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
    case 6:
      return true;
    case 7:
      if (!d.college_id) { showMessage(errorEl, 'Please select your college.'); return false; }
      return true;
    case 8:
      if (!d.academic_session_id) { showMessage(errorEl, 'Please select your academic session.'); return false; }
      return true;
    case 9:
      return true;
    case 10:
      if (!d.selected_goals.length) { showMessage(errorEl, 'Please select at least one goal.'); return false; }
      return true;
    case 11:
      if (!d.primary_goal_id) { showMessage(errorEl, 'Please select your primary goal.'); return false; }
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
            ${r.provinces.map(p => `<option value="${p.id}" ${d.province_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
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
          d.selected_subjects = [];
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
          d.selected_subjects = [];
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
        btn.addEventListener('click', async () => {
          d.group_id = btn.dataset.id;
          d.selected_subjects = [];
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          await loadSubjects(d.education_system_id, d.group_id);
        });
      });
      break;

    case 6: {
      const secondYear = isSecondYear();
      const subjectList = getOnboardingSubjects();
      container.innerHTML = `
        <h2 class="onboarding-title">Confirm Your Subjects</h2>
        <p class="onboarding-subtitle">These are your subjects based on your group selection.</p>
        <div class="onboarding-review">
          ${subjectList.map(s => `
            <div class="review-row">
              <span class="review-label">${s.is_compulsory ? 'Compulsory' : 'Group Subject'}</span>
              <span class="review-value">${s.displayName}</span>
            </div>
          `).join('')}
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:14px">${secondYear ? 'Per Govt. of Pakistan notification, 2nd Year students study Pakistan Studies only.' : 'Per Govt. of Pakistan notification, 1st Year students study Islamiyat only.'}</p>
      `;
      break;
    }

    case 7:
      container.innerHTML = `
        <h2 class="onboarding-title">College</h2>
        <p class="onboarding-subtitle">Which college do you attend?</p>
        <div class="form-group">
          <label for="onb-college">College</label>
          <select id="onb-college" class="form-input">
            <option value="">Select college</option>
            ${r.colleges.map(c => `<option value="${c.id}" ${d.college_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
      `;
      document.getElementById('onb-college')?.addEventListener('change', e => { d.college_id = e.target.value || null; });
      break;

    case 8: {
      const classLevel = r.class_levels.find(c => c.id == d.class_level_id);
      const classValue = classLevel?.value || 0;
      const isFirstYear = classValue === 11;
      const filteredSessions = isFirstYear
        ? r.academic_sessions.filter(s => s.end_year !== 2027)
        : r.academic_sessions;
      container.innerHTML = `
        <h2 class="onboarding-title">Academic Session</h2>
        <p class="onboarding-subtitle">Select your current academic session.</p>
        <div class="onboarding-options">
          ${filteredSessions.map(s => `
            <button class="onboarding-option ${d.academic_session_id == s.id ? 'selected' : ''}" data-id="${s.id}" data-start="${s.start_year}" data-end="${s.end_year}">
              <span class="option-name">${s.label}</span>
              <span class="option-desc">${s.start_year} — ${s.end_year}</span>
            </button>
          `).join('')}
        </div>
        <div id="exam-year-msg"></div>
      `;
      function renderExamMsg() {
        const wrap = document.getElementById('exam-year-msg');
        if (!wrap) return;
        if (d.academic_session_id) {
          const sess = r.academic_sessions.find(s => s.id == d.academic_session_id);
          if (sess) {
            const examYear = isFirstYear ? Math.floor((sess.start_year + sess.end_year) / 2) : sess.end_year;
            d.exam_year = examYear.toString();
            wrap.innerHTML = `<div style="margin-top:20px;padding:16px;border-radius:var(--radius-md);background:var(--accent-soft);border:1px solid rgba(124,92,255,0.15);text-align:center"><span style="font-size:15px;font-weight:600;color:var(--accent)">So your exam year is ${examYear}. Good Luck!</span></div>`;
            return;
          }
        }
        d.exam_year = '';
        wrap.innerHTML = '';
      }
      renderExamMsg();
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          d.academic_session_id = btn.dataset.id;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          renderExamMsg();
        });
      });
      break;
    }

    case 9:
      container.innerHTML = `
        <h2 class="onboarding-title">Review Your Profile</h2>
        <p class="onboarding-subtitle">Check that everything looks correct.</p>
        <div class="onboarding-review">
          <div class="review-row"><span class="review-label">Date of Birth</span><span class="review-value">${d.dob || '—'}</span></div>
          <div class="review-row"><span class="review-label">Province</span><span class="review-value">${r.provinces.find(p => p.id == d.province_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">City</span><span class="review-value">${r.cities.find(c => c.id == d.city_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Education System</span><span class="review-value">${r.education_systems.find(s => s.id == d.education_system_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Board</span><span class="review-value">${r.boards.find(b => b.id == d.board_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Class</span><span class="review-value">${r.class_levels.find(c => c.id == d.class_level_id)?.label || '—'}</span></div>
          <div class="review-row"><span class="review-label">Group</span><span class="review-value">${r.groups.find(g => g.id == d.group_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Subjects</span><span class="review-value">${d.selected_subjects.map(id => { const s = r.subjects.find(s => s.id == id); return s ? getOnboardingSubjects().find(x => x.id === id)?.displayName || s.name : ''; }).filter(Boolean).join(', ') || '—'}</span></div>
          <div class="review-row"><span class="review-label">College</span><span class="review-value">${r.colleges.find(c => c.id == d.college_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Academic Session</span><span class="review-value">${r.academic_sessions.find(s => s.id == d.academic_session_id)?.label || '—'}</span></div>
          <div class="review-row"><span class="review-label">Exam Year</span><span class="review-value">${d.exam_year || '—'}</span></div>
        </div>
      `;
      break;

    case 10:
      const goalsByCategory = {};
      r.goal_categories.forEach(cat => {
        goalsByCategory[cat.id] = r.goals.filter(g => g.category_id === cat.id);
      });

      container.innerHTML = `
        <h2 class="onboarding-title">Your Goals</h2>
        <p class="onboarding-subtitle">Select what you want to achieve.</p>
        ${r.goal_categories.map(cat => {
          const goals = goalsByCategory[cat.id] || [];
          if (!goals.length) return '';
          return `
            <div class="onboarding-goal-category">
              <h3 class="goal-category-name">${cat.name}</h3>
              <div class="onboarding-options onboarding-options-multi">
                ${goals.map(g => `
                  <button class="onboarding-option ${d.selected_goals.includes(g.id) ? 'selected' : ''}" data-id="${g.id}">
                    <span class="option-name">${g.label}</span>
                    ${g.description ? `<span class="option-desc">${g.description}</span>` : ''}
                  </button>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if (d.selected_goals.includes(id)) {
            d.selected_goals = d.selected_goals.filter(g => g !== id);
            btn.classList.remove('selected');
          } else {
            d.selected_goals.push(id);
            btn.classList.add('selected');
          }
        });
      });
      break;

    case 11:
      container.innerHTML = `
        <h2 class="onboarding-title">Primary Goal</h2>
        <p class="onboarding-subtitle">Which one matters most to you right now?</p>
        <div class="onboarding-options">
          ${d.selected_goals.map(id => {
            const goal = r.goals.find(g => g.id == id);
            if (!goal) return '';
            return `
              <button class="onboarding-option ${d.primary_goal_id === id ? 'selected' : ''}" data-id="${id}">
                <span class="option-name">${goal.label}</span>
                ${goal.description ? `<span class="option-desc">${goal.description}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          d.primary_goal_id = btn.dataset.id;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      break;
  }
}

/* ---- SAVE ONBOARDING ---- */

async function saveOnboarding() {
  const nextBtn = document.getElementById('onboarding-next');
  const errorEl = document.getElementById('onboarding-error');
  setLoading(nextBtn, true);
  hideMessage(errorEl);

  try {
    if (!currentUser) throw new Error('Not authenticated. Please log in again.');

    const d = onboarding.data;

    const examYearInt = parseInt(d.exam_year, 10);
    const finalExamYear = Number.isFinite(examYearInt) ? examYearInt : new Date().getFullYear();

    const sapPayload = {
      user_id: currentUser.id,
      education_system_id: d.education_system_id ? Number(d.education_system_id) : null,
      board_id: d.board_id ? Number(d.board_id) : null,
      class_level_id: d.class_level_id ? Number(d.class_level_id) : null,
      exam_year: finalExamYear,
      group_id: d.group_id ? Number(d.group_id) : null,
      college_id: d.college_id ? Number(d.college_id) : null,
      academic_session_id: d.academic_session_id ? Number(d.academic_session_id) : null
    };

    console.log('[saveOnboarding] SAP payload:', JSON.stringify(sapPayload));

    const { error: profileErr } = await db.from('profiles').update({
      date_of_birth: d.dob || null,
      province_id: d.province_id ? Number(d.province_id) : null,
      city_id: d.city_id ? Number(d.city_id) : null,
      personal_info_completed: true,
      academic_profile_completed: true,
      goals_completed: true
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

    const acadProfile = acadProfileRes?.length ? acadProfileRes[0] : null;

    if (acadProfile?.id && d.selected_subjects.length) {
      await db.from('student_subjects').delete().eq('academic_profile_id', acadProfile.id);
      const subjectRows = d.selected_subjects.map(sid => ({
        academic_profile_id: acadProfile.id,
        subject_id: Number(sid)
      }));
      const { error: subErr } = await db.from('student_subjects').insert(subjectRows);
      if (subErr) {
        console.error('[saveOnboarding] Subjects insert error:', subErr);
        throw subErr;
      }
      console.log('[saveOnboarding] Subjects saved:', subjectRows.length);
    }

    await db.from('academic_goals').delete().eq('user_id', currentUser.id);
    if (d.selected_goals.length) {
      const goalRows = d.selected_goals.map(gid => ({
        user_id: currentUser.id,
        goal_id: Number(gid),
        is_primary: gid === d.primary_goal_id
      }));
      const { error: goalErr } = await db.from('academic_goals').insert(goalRows);
      if (goalErr) {
        console.error('[saveOnboarding] Goals insert error:', goalErr);
        throw goalErr;
      }
      console.log('[saveOnboarding] Goals saved:', goalRows.length);
    }

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

/* =========================
   SESSION ACTIVITY TRACKING
   ========================= */

function parseUserAgent() {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  let deviceType = 'desktop';
  if (ua.includes('Mobile') || ua.includes('Android')) deviceType = 'mobile';
  else if (ua.includes('iPad') || ua.includes('Tablet')) deviceType = 'tablet';

  return { browser, os, device_type: deviceType };
}

function getDeviceLabel(session) {
  return `${session.browser} on ${session.os}`;
}

function getDeviceIcon(session) {
  if (session.device_type === 'mobile') return '&#128241;';
  if (session.device_type === 'tablet') return '&#128195;';
  return '&#128187;';
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' });
}

let _activityTimer = null;

async function recordSessionActivity() {
  if (!currentUser) return;
  try {
    const info = parseUserAgent();
    const sessionId = sessionStorage.getItem('wassal_session_id');
    if (sessionId) {
      await db.from('session_activity').update({ last_active_at: new Date().toISOString(), is_current: true }).eq('id', sessionId);
      return;
    }
    const { data: existing } = await db.from('session_activity')
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('browser', info.browser)
      .eq('os', info.os)
      .eq('device_type', info.device_type)
      .eq('is_current', true)
      .limit(1);
    if (existing?.length) {
      sessionStorage.setItem('wassal_session_id', existing[0].id);
      await db.from('session_activity').update({ last_active_at: new Date().toISOString() }).eq('id', existing[0].id);
      return;
    }
    await db.from('session_activity').update({ is_current: false }).eq('user_id', currentUser.id).eq('is_current', true);
    const { data: inserted } = await db.from('session_activity').insert({
      user_id: currentUser.id,
      browser: info.browser,
      os: info.os,
      device_type: info.device_type,
      is_current: true,
      last_active_at: new Date().toISOString()
    }).select('id').single();
    if (inserted?.id) sessionStorage.setItem('wassal_session_id', inserted.id);
  } catch (e) {
    console.error('recordSessionActivity error:', e);
  }
}

function startActivityTracking() {
  recordSessionActivity();
  _activityTimer = setInterval(recordSessionActivity, 5 * 60 * 1000);
}

function stopActivityTracking() {
  if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
}

async function fetchSessions() {
  if (!currentUser) return [];
  try {
    const { data } = await db.from('session_activity')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('last_active_at', { ascending: false });
    return data || [];
  } catch (e) { return []; }
}

async function signOutOtherSessions() {
  if (!currentUser) return;
  try {
    const currentSessionId = sessionStorage.getItem('wassal_session_id');
    await db.from('session_activity').delete()
      .eq('user_id', currentUser.id)
      .neq('id', currentSessionId || -1);
    await db.auth.signOut({ scope: 'others' });
    await db.from('security_events').insert({ user_id: currentUser.id, kind: 'signed_out_others' });
  } catch (e) { console.error('signOutOtherSessions error:', e); }
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
