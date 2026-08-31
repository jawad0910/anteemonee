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

const BASE = getBaseUrl();
const ACCOUNT_URL = BASE + '/pages/account.html';
const ONBOARDING_URL = BASE + '/pages/onboarding.html';
const LOGIN_URL = BASE + '/pages/login.html';

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

      const { data: { session: retrySession }, error: retryError } = await db.auth.getSession();
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
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Profile fetch error:', profileError.message);
    }

    if (!profile) {
      setStatus('Creating your profile...');
      const username = user.user_metadata?.username
        || user.user_metadata?.preferred_username
        || user.email?.split('@')[0]
        || 'user';

      const { error: insertError } = await db.from('profiles').insert({
        id: user.id,
        username: username.toLowerCase(),
        email: user.email,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        profile_image_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null
      });

      if (insertError) {
        if (insertError.message?.includes('USERNAME_TAKEN') || insertError.code === '23505') {
          const fallbackUsername = username.toLowerCase() + Math.floor(Math.random() * 9000 + 1000);
          await db.from('profiles').insert({
            id: user.id,
            username: fallbackUsername,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
            profile_image_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null
          });
        } else {
          console.error('Profile insert error:', insertError.message);
        }
      }

      showSuccess('Account created! Taking you to setup...');
      setTimeout(() => { window.location.href = ONBOARDING_URL; }, 1500);
      return;
    }

    const personalDone = profile.personal_info_completed;
    const academicDone = profile.academic_profile_completed;
    const goalsDone = profile.goals_completed;

    if (!personalDone || !academicDone || !goalsDone) {
      showSuccess('Welcome back! Continuing your setup...');
      setTimeout(() => { window.location.href = ONBOARDING_URL; }, 1500);
      return;
    }

    showSuccess('Welcome back! Taking you to Wassal...');
    setTimeout(() => { window.location.href = ACCOUNT_URL; }, 1500);
  } catch (err) {
    console.error('User handling error:', err.message);
    showSuccess('Signed in successfully! Taking you to Wassal...');
    setTimeout(() => { window.location.href = ACCOUNT_URL; }, 1500);
  }
}

document.addEventListener('DOMContentLoaded', handleCallback);
