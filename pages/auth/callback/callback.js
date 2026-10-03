const { createClient } = supabase;
const SUPABASE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getBaseUrl() {
  try {
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      const src = s.getAttribute('src');
      if (src && src.includes('callback.js')) {
        const url = new URL(src, window.location.href);
        const path = url.pathname;
        const cbDir = path.substring(0, path.lastIndexOf('/'));
        const authPagesDir = cbDir.substring(0, cbDir.lastIndexOf('/'));
        return authPagesDir.substring(0, authPagesDir.lastIndexOf('/'));
      }
    }
  } catch (e) {}
  const loc = window.location;
  if (loc.protocol === 'file:') {
    const href = loc.href;
    const dir1 = href.substring(0, href.lastIndexOf('/'));
    const dir2 = dir1.substring(0, dir1.lastIndexOf('/'));
    return dir2.substring(0, dir2.lastIndexOf('/'));
  }
  return loc.origin;
}

const ORIGIN = window.location.origin;
const ACCOUNT_URL = ORIGIN + '/';
const ONBOARDING_URL = ORIGIN + '/pages/onboarding.html';

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

// OAuth providers never return a username (Google sends only name/email/picture), and
// the auth.users trigger that creates the profiles row copies those fields but leaves
// `username` NULL. So the profile row already exists and the insert path above never
// runs — which is why these users had to press "Save changes" once to get a username.
// Derive one here instead, and let the unique constraint arbitrate collisions.
async function ensureUsername(user, profile) {
  const existing = profile?.username == null ? '' : String(profile.username).trim();
  if (existing) return existing;

  const meta = user?.user_metadata || {};
  const base = generateUsername(meta.full_name || meta.name || '', user?.email);

  // Deterministic suffix first so a collision resolves the same way on every retry,
  // then one random attempt as a last resort.
  const seed = String(user?.id || '');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9000;
  const candidates = [
    base,
    base.slice(0, 16) + (1000 + h),
    base.slice(0, 14) + Math.floor(Math.random() * 9000 + 1000),
  ];

  for (const cand of candidates) {
    if (!cand || cand.length < 3) continue;
    const { error, data } = await db.from('profiles')
      .update({ username: cand })
      .eq('id', user.id)
      .select('username')
      .maybeSingle();
    if (!error && data?.username) {
      if (profile) profile.username = data.username;
      return data.username;
    }
  }
  console.warn('Could not auto-assign a username; user will set it on the account page.');
  return '';
}

function setStatus(text) {
  const el = document.getElementById('callback-status');
  if (el) el.textContent = text;
}

function showError(message) {
  const loadingEl = document.getElementById('callback-loading');
  const errorEl = document.getElementById('callback-error');
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) {
    errorEl.style.display = 'block';
    errorEl.querySelector('.error-message').textContent = message;
  }
}

function showSuccess(message) {
  const loadingEl = document.getElementById('callback-loading');
  const successEl = document.getElementById('callback-success');
  if (loadingEl) loadingEl.style.display = 'none';
  if (successEl) {
    successEl.style.display = 'flex';
    successEl.querySelector('.success-message').textContent = message;
  }
}

async function getOnboardingStep(userId) {
  try {
    const { data: profiles } = await db.from('profiles').select('*').eq('id', userId);
    const profile = profiles?.length ? profiles[0] : null;
    if (!profile) return 0;
    if (!profile.date_of_birth || !profile.province_id) return 0;
    if (!profile.city_id) return 1;
    const { data: acads } = await db.from('student_academic_profiles').select('*').eq('user_id', userId);
    const acad = acads?.length ? acads[0] : null;
    if (!acad || !acad.education_system_id) return 2;
    if (!acad.board_id) return 3;
    if (!acad.class_level_id) return 4;
    if (!acad.group_id) return 5;
    if (!profile.goals_completed) {
      const { count } = await db.from('academic_goals').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (!count) return 10;
      return 11;
    }
    return -1;
  } catch (e) {
    console.error('getOnboardingStep error:', e);
    return 0;
  }
}

async function handleCallback() {
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.substring(1));
  const errorParam = params.get('error');
  const errorDescription = params.get('error_description');

  if (errorParam) {
    if (errorParam === 'access_denied') {
      showError('Login was cancelled. You can try again.');
    } else {
      showError(errorDescription || 'Authentication failed. Please try again.');
    }
    return;
  }

  if (!hash || !hash.includes('access_token')) {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (!code) {
      showError('No authentication data received. Please try again.');
      return;
    }
  }

  setStatus('Signing you in...');

  try {
    const { data: { session }, error: sessionError } = await db.auth.getSession();

    if (sessionError) {
      console.error('Session error:', sessionError.message);
      showError('Failed to restore session. Please try again.');
      return;
    }

    if (!session || !session.user) {
      setStatus('Waiting for authentication...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const { data: { session: retrySession } } = await db.auth.getSession();
      if (retrySession && retrySession.user) {
        await handleUser(retrySession.user);
        return;
      }
      showError('Authentication timed out. Please try again.');
      return;
    }

    await handleUser(session.user);
  } catch (err) {
    console.error('Callback error:', err.message);
    showError('Something went wrong. Please try again.');
  }
}

async function handleUser(user) {
  setStatus('Setting up your account...');

  try {
    const { data: profiles } = await db.from('profiles').select('*').eq('id', user.id);
    const profile = profiles?.length ? profiles[0] : null;

    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

    // Check if we're in "add account" mode
    const isAddingAccount = sessionStorage.getItem('Anteemonee_adding_account') === 'true';

    if (!profile) {
      setStatus('Creating your profile...');
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || '';
      const username = generateUsername(fullName, user.email);

      const { error: insertError } = await db.from('profiles').insert({
        id: user.id,
        username: username,
        email: user.email,
        full_name: fullName || null,
        profile_image_url: avatarUrl,
        personal_info_completed: false,
        academic_profile_completed: false,
        goals_completed: false
      });

      if (insertError) {
        if (insertError.message?.includes('USERNAME_TAKEN') || insertError.code === '23505') {
          const fallbackUsername = username.slice(0, 16) + Math.floor(Math.random() * 9000 + 1000);
          const { error: retryError } = await db.from('profiles').insert({
            id: user.id,
            username: fallbackUsername,
            email: user.email,
            full_name: fullName || null,
            profile_image_url: avatarUrl,
            personal_info_completed: false,
            academic_profile_completed: false,
            goals_completed: false
          });
          if (retryError) console.error('Profile insert retry failed:', retryError.message);
        } else {
          console.error('Profile insert error:', insertError.message);
        }
      }

      if (isAddingAccount) {
        // Save session to AccountManager and return
        const { data: { session } } = await db.auth.getSession();
        if (session) {
          // Load profile for AccountManager metadata
          const { data: newProfiles } = await db.from('profiles').select('*').eq('id', user.id);
          window._currentProfile = newProfiles?.length ? newProfiles[0] : null;
          await AccountManager.saveCurrentSession(user, session);
        }
        const returnTo = sessionStorage.getItem('Anteemonee_add_account_return') || ACCOUNT_URL;
        sessionStorage.removeItem('Anteemonee_add_account_return');
        sessionStorage.removeItem('Anteemonee_adding_account');
        showSuccess('Account added!');
        setTimeout(() => { window.location.href = returnTo; }, 1000);
        return;
      }

      showSuccess('Account created! Taking you to setup...');
      setTimeout(() => { window.location.href = ONBOARDING_URL; }, 1500);
      return;
    }

    // Google signups land here with a trigger-created row whose username is NULL.
    // Persist one now so the account page never has to be saved by hand.
    await ensureUsername(user, profile);

    // Only seed Google avatar when user never set one. Never overwrite custom upload or explicit removal ('').
    if (avatarUrl && profile.profile_image_url == null) {
      await db.from('profiles').update({ profile_image_url: avatarUrl }).eq('id', user.id);
    }

    if (isAddingAccount) {
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        window._currentProfile = profile;
        await AccountManager.saveCurrentSession(user, session);
      }
      const returnTo = sessionStorage.getItem('Anteemonee_add_account_return') || ACCOUNT_URL;
      sessionStorage.removeItem('Anteemonee_add_account_return');
      sessionStorage.removeItem('Anteemonee_adding_account');
      showSuccess('Account added!');
      setTimeout(() => { window.location.href = returnTo; }, 1000);
      return;
    }

    const step = await getOnboardingStep(user.id);

    if (step >= 0) {
      showSuccess('Welcome back! Continuing your setup...');
      setTimeout(() => { window.location.href = ONBOARDING_URL; }, 1500);
      return;
    }

    showSuccess('Welcome back! Taking you to Anteemonee...');
    setTimeout(() => { window.location.href = ACCOUNT_URL; }, 1500);
  } catch (err) {
    console.error('User handling error:', err.message);
    showSuccess('Signed in successfully! Taking you to Anteemonee...');
    setTimeout(() => { window.location.href = ACCOUNT_URL; }, 1500);
  }
}

document.addEventListener('DOMContentLoaded', handleCallback);
