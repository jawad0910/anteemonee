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
    const { data } = await db
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();
    currentProfile = data;
  } catch (e) {
    console.error('Profile load failed:', e);
  }
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
  const username = currentProfile?.username || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'User';
  const imgUrl = currentProfile?.avatar_url || currentProfile?.profile_image_url || '';
  return { username, imgUrl };
}

function renderProfileAvatar() {
  const container = document.getElementById('profile-avatar-container');
  if (!container) return;
  const { username, imgUrl } = getDisplayUser();

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
          <span class="dropdown-name">${username}</span>
          <span class="dropdown-email">${currentUser?.email || ''}</span>
        </div>
      </div>
      <div class="dropdown-divider"></div>
      <a href="/pages/account.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Account
      </a>
      <a href="/pages/account.html" class="dropdown-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
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
    window.location.href = '../index.html';
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

function getStarted() {
  window.location.href = currentUser ? BASE + '/pages/account.html' : BASE + '/pages/signup.html';
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
    window.location.href = REDIRECT_URL;
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
      options: { redirectTo: REDIRECT_URL }
    });
    if (error) throw error;
  } catch (err) {
    alert(err.message || 'Google sign-in failed.');
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
    exam_year: new Date().getFullYear().toString(),
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
    db.from('provinces').select('*').eq('is_active', true).order('name'),
    db.from('academic_sessions').select('*').eq('is_active', true).order('sort_order'),
    db.from('goal_categories').select('*, goals(*)').eq('is_active', true).order('sort_order')
  ]);

  onboarding.ref.education_systems = systemsRes.data || [];
  onboarding.ref.provinces = provincesRes.data || [];
  onboarding.ref.academic_sessions = sessionsRes.data || [];

  const cats = goalsCatRes.data || [];
  onboarding.ref.goal_categories = cats;
  onboarding.ref.goals = cats.flatMap(c => (c.goals || []).map(g => ({ ...g, category_name: c.name })));
}

async function loadBoards(systemId) {
  const { data } = await db.from('education_system_boards')
    .select('board_id, boards(*)')
    .eq('education_system_id', systemId);
  onboarding.ref.boards = (data || []).map(r => r.boards).filter(Boolean);
}

async function loadClassLevels(systemId) {
  const { data } = await db.from('education_system_class_levels')
    .select('class_level_id, class_levels(*)')
    .eq('education_system_id', systemId);
  onboarding.ref.class_levels = (data || []).map(r => r.class_levels).filter(Boolean);
}

async function loadGroups(classLevelId) {
  const { data } = await db.from('class_level_groups')
    .select('group_id, groups(*)')
    .eq('class_level_id', classLevelId);
  onboarding.ref.groups = (data || []).map(r => r.groups).filter(Boolean);
}

async function loadSubjects(groupId) {
  const { data } = await db.from('group_subjects')
    .select('subject_id, subjects(*)')
    .eq('group_id', groupId);
  onboarding.ref.subjects = (data || []).map(r => r.subjects).filter(Boolean);
}

async function loadColleges(boardId) {
  const { data } = await db.from('colleges')
    .select('*')
    .eq('board_id', boardId)
    .eq('is_active', true)
    .order('name');
  onboarding.ref.colleges = data || [];
}

async function loadCities(provinceId) {
  const { data } = await db.from('cities')
    .select('*')
    .eq('province_id', provinceId)
    .eq('is_active', true)
    .order('name');
  onboarding.ref.cities = data || [];
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

  onboarding.currentStep++;
  await loadStepData(onboarding.currentStep);
  renderOnboardingStep();
}

function onboardingPrev() {
  if (onboarding.currentStep <= 0) return;
  onboarding.currentStep--;
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
    case 1:
      if (!r.provinces.length) await loadOnboardingRefData();
      break;
    case 2:
      if (d.province_id) await loadCities(d.province_id);
      break;
    case 3:
      if (!r.education_systems.length) await loadOnboardingRefData();
      break;
    case 4:
      if (d.education_system_id) await loadBoards(d.education_system_id);
      break;
    case 5:
      if (d.education_system_id) await loadClassLevels(d.education_system_id);
      break;
    case 6:
      if (d.class_level_id) await loadGroups(d.class_level_id);
      break;
    case 7:
      if (d.group_id) await loadSubjects(d.group_id);
      break;
    case 8:
      if (d.board_id) await loadColleges(d.board_id);
      break;
    case 9:
      break;
    case 10:
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
      if (!d.selected_subjects.length) { showMessage(errorEl, 'Please select at least one subject.'); return false; }
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
          <input type="date" id="onb-dob" class="form-input" value="${d.dob}" max="${new Date().toISOString().split('T')[0]}">
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
          await loadBoards(d.education_system_id);
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
              <span class="option-name">${cl.name}</span>
              ${cl.sort_order ? `<span class="option-desc">Year ${cl.sort_order}</span>` : ''}
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
          await loadGroups(d.class_level_id);
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
          await loadSubjects(d.group_id);
        });
      });
      break;

    case 6:
      container.innerHTML = `
        <h2 class="onboarding-title">Subjects</h2>
        <p class="onboarding-subtitle">Select all your subjects.</p>
        <div class="onboarding-options onboarding-options-multi">
          ${r.subjects.map(s => `
            <button class="onboarding-option ${d.selected_subjects.includes(s.id) ? 'selected' : ''}" data-id="${s.id}">
              <span class="option-name">${s.name}</span>
              ${s.code ? `<span class="option-desc">${s.code}</span>` : ''}
            </button>
          `).join('')}
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if (d.selected_subjects.includes(id)) {
            d.selected_subjects = d.selected_subjects.filter(s => s !== id);
            btn.classList.remove('selected');
          } else {
            d.selected_subjects.push(id);
            btn.classList.add('selected');
          }
        });
      });
      break;

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

    case 8:
      container.innerHTML = `
        <h2 class="onboarding-title">Academic Session</h2>
        <p class="onboarding-subtitle">Select your current academic session.</p>
        <div class="onboarding-options">
          ${r.academic_sessions.map(s => `
            <button class="onboarding-option ${d.academic_session_id === s.id ? 'selected' : ''}" data-id="${s.id}">
              <span class="option-name">${s.name}</span>
              ${s.start_date ? `<span class="option-desc">${s.start_date} — ${s.end_date || 'Ongoing'}</span>` : ''}
            </button>
          `).join('')}
        </div>
        <div class="form-group" style="margin-top:16px">
          <label for="onb-exam-year">Exam Year</label>
          <input type="text" id="onb-exam-year" class="form-input" value="${d.exam_year}" placeholder="e.g. 2027" maxlength="4">
        </div>
      `;
      container.querySelectorAll('.onboarding-option').forEach(btn => {
        btn.addEventListener('click', () => {
          d.academic_session_id = btn.dataset.id;
          container.querySelectorAll('.onboarding-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      document.getElementById('onb-exam-year')?.addEventListener('input', e => { d.exam_year = e.target.value; });
      break;

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
          <div class="review-row"><span class="review-label">Class</span><span class="review-value">${r.class_levels.find(c => c.id == d.class_level_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Group</span><span class="review-value">${r.groups.find(g => g.id == d.group_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Subjects</span><span class="review-value">${d.selected_subjects.map(id => r.subjects.find(s => s.id == id)?.name).filter(Boolean).join(', ') || '—'}</span></div>
          <div class="review-row"><span class="review-label">College</span><span class="review-value">${r.colleges.find(c => c.id == d.college_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Academic Session</span><span class="review-value">${r.academic_sessions.find(s => s.id == d.academic_session_id)?.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Exam Year</span><span class="review-value">${d.exam_year || '—'}</span></div>
        </div>
      `;
      break;

    case 10:
      const goalsByCategory = {};
      r.goal_categories.forEach(cat => {
        goalsByCategory[cat.id] = r.goals.filter(g => g.goal_category_id === cat.id);
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
                    <span class="option-name">${g.title || g.name}</span>
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
                <span class="option-name">${goal.title || goal.name}</span>
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

    const { error: profileErr } = await db.from('profiles').update({
      date_of_birth: d.dob || null,
      province_id: d.province_id || null,
      city_id: d.city_id || null,
      personal_info_completed: true,
      academic_profile_completed: true,
      goals_completed: true
    }).eq('id', currentUser.id);
    if (profileErr) throw profileErr;

    const { data: acadProfile, error: acadErr } = await db.from('student_academic_profiles').upsert({
      user_id: currentUser.id,
      education_system_id: d.education_system_id,
      board_id: d.board_id,
      class_level_id: d.class_level_id,
      exam_year: d.exam_year || null,
      group_id: d.group_id,
      college_id: d.college_id,
      academic_session_id: d.academic_session_id
    }, { onConflict: 'user_id' }).select('id').single();
    if (acadErr) throw acadErr;

    if (acadProfile?.id && d.selected_subjects.length) {
      await db.from('student_subjects').delete().eq('academic_profile_id', acadProfile.id);
      const subjectRows = d.selected_subjects.map(sid => ({
        academic_profile_id: acadProfile.id,
        subject_id: sid
      }));
      const { error: subErr } = await db.from('student_subjects').insert(subjectRows);
      if (subErr) throw subErr;
    }

    await db.from('academic_goals').delete().eq('user_id', currentUser.id);
    if (d.selected_goals.length) {
      const goalRows = d.selected_goals.map(gid => ({
        user_id: currentUser.id,
        goal_id: gid,
        is_primary: gid === d.primary_goal_id
      }));
      const { error: goalErr } = await db.from('academic_goals').insert(goalRows);
      if (goalErr) throw goalErr;
    }

    await loadProfile();
    window.location.href = REDIRECT_URL;
  } catch (err) {
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
