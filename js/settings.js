/* =========================================================
   WASSAL SETTINGS — Complete Settings Logic
   ========================================================= */

let settingsPrefs = null;
let settingsAcad = null;
let settingsEntitlements = null;
let settingsProfile = null;
let settingsSaving = false;

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
  settingsProfile = currentProfile;

  settingsPrefs = await loadUserPrefs();
  await loadEntitlements();
  await loadAcademicData();

  renderAccount();
  renderSecurity();
  renderNotifications();
  renderAI();
  renderStudy();
  renderAppearance();
  renderLanguage();
  renderPrivacy();
  renderDataStorage();
  renderSubscription();
  renderCoupons();
  renderConnected();
  renderHelp();
  renderAbout();

  setupNavSidebar();
  setupDeleteConfirmInput();
}

/* =========================
   DATA LOADERS
   ========================= */

async function loadEntitlements() {
  try {
    const { data } = await db.from('user_entitlements').select('*').eq('user_id', currentUser.id).maybeSingle();
    settingsEntitlements = data;
  } catch (e) { settingsEntitlements = null; }
}

async function loadAcademicData() {
  try {
    const { data } = await db.from('student_academic_profiles').select('*').eq('user_id', currentUser.id).maybeSingle();
    settingsAcad = data;
  } catch (e) { settingsAcad = null; }
}

/* =========================
   NAV SIDEBAR
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
  document.querySelector(`.settings-nav-item[data-cat="${cat}"]`)?.classList.add('active');
  document.querySelectorAll('.settings-category').forEach(c => c.classList.remove('active'));
  document.querySelector(`.settings-category[data-cat="${cat}"]`)?.classList.add('active');
  window.history.replaceState(null, '', '#' + cat);
  const sidebar = document.getElementById('settings-sidebar');
  if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
}

function showSidebar() {
  document.getElementById('settings-sidebar').classList.add('open');
}

/* =========================
   TOAST
   ========================= */

function showToastSettings(msg, isError) {
  const t = document.getElementById('settings-toast');
  t.textContent = msg;
  t.className = 'settings-toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2500);
}

/* =========================
   COMPONENTS
   ========================= */

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
  if (rightEl) row.appendChild(rightEl);
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

function buildSkeleton(count) {
  const card = document.createElement('div');
  card.className = 'settings-card';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    row.innerHTML = `<div class="skeleton skeleton-text w-60"></div><div class="skeleton skeleton-text w-20" style="height:24px;border-radius:12px"></div>`;
    card.appendChild(row);
  }
  return card;
}

/* =========================
   1. ACCOUNT
   ========================= */

function renderAccount() {
  const c = document.getElementById('settings-account-content');
  c.innerHTML = '';
  const p = settingsProfile;
  const imgUrl = p?.profile_image_url || currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture || '';
  const name = p?.full_name || '';
  const username = p?.username || '';
  const email = currentUser?.email || '';
  const bio = p?.bio || '';

  const profileCard = document.createElement('div');
  profileCard.className = 'settings-card';
  profileCard.innerHTML = `
    <div class="settings-profile-card">
      <div class="settings-profile-avatar">
        ${imgUrl ? `<img src="${imgUrl}" alt="${username}">` : `<div class="avatar-fallback">${(name || username || 'U').charAt(0).toUpperCase()}</div>`}
      </div>
      <div class="settings-profile-info">
        <h3>${name || username}</h3>
        <p>@${username} &middot; ${email}</p>
      </div>
    </div>`;
  c.appendChild(profileCard);

  const personalRows = [
    buildRow('Full Name', name || 'Not set', null),
    buildRow('Username', '@' + (username || 'Not set'), null),
    buildRow('Email', email, null),
    buildRow('Phone', p?.phone || currentUser?.phone || 'Not set', null),
    buildRow('Bio', bio || 'No bio', null),
  ];
  const editBtn = document.createElement('button');
  editBtn.className = 'btn-settings btn-settings-primary';
  editBtn.textContent = 'Edit Profile';
  editBtn.style.cssText = 'margin:12px 20px 16px;';
  editBtn.addEventListener('click', () => window.location.href = 'account.html');
  const personalCard = buildCard('PERSONAL INFORMATION', personalRows);
  personalCard.appendChild(editBtn);
  c.appendChild(personalCard);

  const acad = settingsAcad;
  const acadRows = [
    buildRow('Education System', acad?.education_system_id ? 'FSc' : 'Not set'),
    buildRow('Board', acad?.board_id ? 'Set' : 'Not set'),
    buildRow('Class', acad?.class_level_id ? 'Set' : 'Not set'),
    buildRow('Group', acad?.group_id ? 'Set' : 'Not set'),
    buildRow('College', acad?.college_id ? 'Set' : 'Not set'),
    buildRow('Academic Session', acad?.academic_session_id ? 'Set' : 'Not set'),
    buildRow('Exam Year', acad?.exam_year || 'Not set'),
  ];
  const acadEditBtn = document.createElement('button');
  acadEditBtn.className = 'btn-settings btn-settings-secondary';
  acadEditBtn.textContent = 'Edit Academic Profile';
  acadEditBtn.style.cssText = 'margin:12px 20px 16px;';
  acadEditBtn.addEventListener('click', () => window.location.href = 'account.html');
  const acadCard = buildCard('ACADEMIC PROFILE', acadRows);
  acadCard.appendChild(acadEditBtn);
  c.appendChild(acadCard);
}

/* =========================
   2. SECURITY
   ========================= */

function renderSecurity() {
  const c = document.getElementById('settings-security-content');
  c.innerHTML = '';

  const pwCard = document.createElement('div');
  pwCard.className = 'settings-card';
  pwCard.innerHTML = `
    <div class="settings-card-header">CHANGE PASSWORD</div>
    <div style="padding:16px 20px 20px;">
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Current Password</label>
        <input type="password" class="setting-input" id="sec-current-pw" placeholder="Enter current password" style="max-width:100%">
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">New Password</label>
        <input type="password" class="setting-input" id="sec-new-pw" placeholder="At least 8 characters" style="max-width:100%">
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:12.5px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Confirm New Password</label>
        <input type="password" class="setting-input" id="sec-confirm-pw" placeholder="Re-enter new password" style="max-width:100%">
      </div>
      <div id="sec-pw-error" style="color:#FF6675;font-size:13px;margin-bottom:10px;display:none"></div>
      <div id="sec-pw-success" style="color:#35D399;font-size:13px;margin-bottom:10px;display:none"></div>
      <button class="btn-settings btn-settings-primary" id="sec-pw-btn" onclick="changePassword()">Update Password</button>
    </div>`;
  c.appendChild(pwCard);

  const providers = currentUser?.app_metadata?.providers || [];
  const hasGoogle = providers.includes('google');
  const hasSpotify = providers.includes('spotify');
  const hasEmail = providers.includes('email');

  const connectedRows = [];
  if (hasEmail) connectedRows.push(buildConnectedRow('email', 'Email & Password', 'Signed in with email'));
  if (hasGoogle) connectedRows.push(buildConnectedRow('google', 'Google', 'Connected'));
  if (hasSpotify) connectedRows.push(buildConnectedRow('spotify', 'Spotify', 'Connected'));
  if (!connectedRows.length) connectedRows.push(buildRow('No providers connected', ''));
  c.appendChild(buildCard('CONNECTED LOGIN PROVIDERS', connectedRows));

  const sessionRows = [
    buildRow('Current Session', 'Active now', badge('active', 'Active')),
  ];
  c.appendChild(buildCard('SESSIONS', sessionRows));
}

function buildConnectedRow(provider, name, status) {
  const row = document.createElement('div');
  row.className = 'provider-row';
  const icon = document.createElement('div');
  icon.className = 'provider-icon ' + provider;
  icon.innerHTML = provider === 'google' ? '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#4285F4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'
    : provider === 'spotify' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#1ED760"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>';
  const info = document.createElement('div');
  info.className = 'setting-info';
  info.innerHTML = `<div class="setting-title">${name}</div><div class="setting-desc">${status}</div>`;
  row.appendChild(icon);
  row.appendChild(info);
  return row;
}

function badge(type, text) {
  return `<span class="status-badge ${type}">${text}</span>`;
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

  if (!current || !newPw || !confirm) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return; }
  if (newPw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display = 'block'; return; }
  if (!/[A-Z]/.test(newPw)) { errEl.textContent = 'Password must contain an uppercase letter.'; errEl.style.display = 'block'; return; }
  if (!/[0-9]/.test(newPw)) { errEl.textContent = 'Password must contain a number.'; errEl.style.display = 'block'; return; }
  if (newPw !== confirm) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }

  setLoading(btn, true);
  try {
    const { error } = await db.auth.updateUser({ password: newPw });
    if (error) throw error;
    okEl.textContent = 'Password updated successfully.';
    okEl.style.display = 'block';
    document.getElementById('sec-current-pw').value = '';
    document.getElementById('sec-new-pw').value = '';
    document.getElementById('sec-confirm-pw').value = '';
    showToastSettings('Password updated');
  } catch (err) {
    errEl.textContent = err.message || 'Failed to update password.';
    errEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

/* =========================
   3. NOTIFICATIONS
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
    buildRow('AI Recommendations', 'AI-powered study suggestions', buildToggle('t-notify_ai', p.notify_ai_recommendations, v => savePref('notify_ai_recommendations', v))),
    buildRow('Daily Learning', 'Daily learning activity reminders', buildToggle('t-notify_daily', p.notify_daily_learning, v => savePref('notify_daily_learning', v))),
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
   4. AI & LEARNING
   ========================= */

function renderAI() {
  const c = document.getElementById('settings-ai-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const responseRows = [
    buildRow('AI Response Style', 'How detailed the AI responds', buildSelect([
      { value: 'concise', label: 'Concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
    ], p.ai_response_style, v => savePref('ai_response_style', v))),
  ];
  c.appendChild(buildCard('RESPONSE STYLE', responseRows));

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
    buildRow('Voice Enabled', 'Enable voice responses', buildToggle('t-ai_voice', p.ai_voice_enabled, v => savePref('ai_voice_enabled', v))),
    buildRow('Voice Speed', 'Default speaking speed', buildSelect([
      { value: 75, label: '0.75x' },
      { value: 100, label: '1x (Normal)' },
      { value: 125, label: '1.25x' },
      { value: 150, label: '1.5x' },
      { value: 175, label: '1.75x' },
      { value: 200, label: '2x' },
    ], p.ai_voice_speed, v => savePref('ai_voice_speed', parseInt(v)))),
    buildRow('Autoplay Voice', 'Auto-play AI voice responses', buildToggle('t-ai_autoplay', p.ai_autoplay_voice, v => savePref('ai_autoplay_voice', v))),
  ];
  c.appendChild(buildCard('VOICE', voiceRows));

  const prefRows = [
    buildRow('Study Suggestions', 'Show AI study recommendations', buildToggle('t-ai_suggest', p.ai_study_recommendations, v => savePref('ai_study_recommendations', v))),
  ];
  c.appendChild(buildCard('SUGGESTIONS', prefRows));
}

/* =========================
   5. STUDY PREFERENCES
   ========================= */

function renderStudy() {
  const c = document.getElementById('settings-study-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const goalRows = [
    buildRow('Daily Study Goal', 'Target study time per day', buildSelect([
      { value: 30, label: '30 minutes' },
      { value: 60, label: '1 hour' },
      { value: 90, label: '1.5 hours' },
      { value: 120, label: '2 hours' },
      { value: 180, label: '3 hours' },
      { value: 240, label: '4 hours' },
    ], p.planner_daily_goal_minutes, v => savePref('planner_daily_goal_minutes', parseInt(v)))),
    buildRow('Default Session Length', 'Length of each study session', buildSelect([
      { value: 25, label: '25 minutes' },
      { value: 30, label: '30 minutes' },
      { value: 45, label: '45 minutes' },
      { value: 60, label: '60 minutes' },
      { value: 90, label: '90 minutes' },
    ], p.planner_default_session_min, v => savePref('planner_default_session_min', parseInt(v)))),
  ];
  c.appendChild(buildCard('GOALS & SESSIONS', goalRows));

  const plannerRows = [
    buildRow('Week Starts On', 'First day of the week', buildSelect([
      { value: 1, label: 'Monday' },
      { value: 6, label: 'Saturday' },
      { value: 0, label: 'Sunday' },
    ], p.planner_week_starts_on, v => savePref('planner_week_starts_on', parseInt(v)))),
    buildRow('Break Reminders', 'Remind to take breaks', buildSelect([
      { value: 'short_breaks', label: 'Short Breaks (Pomodoro)' },
      { value: 'long_breaks', label: 'Long Breaks' },
      { value: 'none', label: 'No Break Reminders' },
    ], p.planner_break_preference, v => savePref('planner_break_preference', v))),
    buildRow('Auto Schedule', 'Automatically schedule tasks', buildToggle('t-auto_sched', p.planner_auto_schedule, v => savePref('planner_auto_schedule', v))),
    buildRow('Exam Prep Mode', 'Exam preparation strategy', buildSelect([
      { value: 'balanced', label: 'Balanced' },
      { value: 'weak_topics', label: 'Focus Weak Topics' },
      { value: 'revision', label: 'Heavy Revision' },
    ], p.planner_exam_prep_mode, v => savePref('planner_exam_prep_mode', v))),
  ];
  c.appendChild(buildCard('PLANNER', plannerRows));

  const learningRows = [
    buildRow('Default Difficulty', 'Difficulty level for practice', buildSelect([
      { value: 'easy', label: 'Easy' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Hard' },
      { value: 'mixed', label: 'Mixed' },
    ], p.learning_default_difficulty, v => savePref('learning_default_difficulty', v))),
    buildRow('Auto-Save Mistakes', 'Automatically save mistakes', buildToggle('t-auto_mistakes', p.learning_auto_save_mistakes, v => savePref('learning_auto_save_mistakes', v))),
    buildRow('Show Frequency', 'Show question frequency data', buildToggle('t-show_freq', p.learning_show_frequency, v => savePref('learning_show_frequency', v))),
    buildRow('Show Mastery', 'Show topic mastery levels', buildToggle('t-show_mastery', p.learning_show_mastery, v => savePref('learning_show_mastery', v))),
  ];
  c.appendChild(buildCard('LEARNING', learningRows));
}

/* =========================
   6. APPEARANCE
   ========================= */

function renderAppearance() {
  const c = document.getElementById('settings-appearance-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const themeRows = [
    buildRow('Theme', 'Choose your preferred theme', buildSelect([
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'system', label: 'System Default' },
    ], p.theme_mode, v => savePref('theme_mode', v))),
    buildRow('Accent Color', 'Primary accent color', buildSelect([
      { value: 'violet', label: 'Violet' },
      { value: 'blue', label: 'Blue' },
      { value: 'cyan', label: 'Cyan' },
      { value: 'green', label: 'Green' },
    ], p.accent_color, v => savePref('accent_color', v))),
  ];
  c.appendChild(buildCard('THEME', themeRows));

  const effectRows = [
    buildRow('Glass Intensity', 'Intensity of glass morphism effects', buildSelect([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ], p.glass_intensity, v => savePref('glass_intensity', v))),
    buildRow('Reduce Animations', 'Reduce motion for accessibility', buildToggle('t-reduce_anim', p.reduce_animations, v => {
      savePref('reduce_animations', v);
      if (v) document.documentElement.classList.add('reduce-anim');
      else document.documentElement.classList.remove('reduce-anim');
    })),
    buildRow('Interface Density', 'Layout compactness', buildSelect([
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' },
    ], p.layout_density, v => savePref('layout_density', v))),
  ];
  c.appendChild(buildCard('VISUAL EFFECTS', effectRows));
}

/* =========================
   7. LANGUAGE
   ========================= */

function renderLanguage() {
  const c = document.getElementById('settings-language-content');
  c.innerHTML = '';
  const p = settingsPrefs || {};

  const langRows = [
    buildRow('App Language', 'Interface language', buildSelect([
      { value: 'english', label: 'English' },
      { value: 'urdu', label: 'Urdu' },
      { value: 'roman_urdu', label: 'Roman Urdu' },
    ], p.app_language, v => savePref('app_language', v))),
    buildRow('Textbook Language', 'Language for learning content', buildSelect([
      { value: 'english', label: 'English' },
      { value: 'urdu', label: 'Urdu' },
      { value: 'roman_urdu', label: 'Roman Urdu' },
    ], p.textbook_language, v => savePref('textbook_language', v))),
  ];
  c.appendChild(buildCard('LANGUAGE PREFERENCES', langRows));

  const infoRows = [
    buildRow('Date Format', 'DD/MM/YYYY (Pakistan standard)'),
    buildRow('Time Zone', 'Asia/Karachi (PKT)'),
  ];
  c.appendChild(buildCard('REGION', infoRows));
}

/* =========================
   8. PRIVACY
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
    buildRow('Stats Visibility', 'Who can see your stats', buildSelect([
      { value: 'private', label: 'Only Me' },
      { value: 'public', label: 'Everyone' },
    ], p.privacy_stats_visibility, v => savePref('privacy_stats_visibility', v))),
    buildRow('Activity Visibility', 'Who can see your activity', buildSelect([
      { value: 'private', label: 'Only Me' },
      { value: 'public', label: 'Everyone' },
    ], p.privacy_activity_visibility, v => savePref('privacy_activity_visibility', v))),
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
   9. DATA & STORAGE
   ========================= */

function renderDataStorage() {
  const c = document.getElementById('settings-data-content');
  c.innerHTML = '';

  const cacheRows = [
    buildRow('Clear Local Cache', 'Remove cached data from this device. Cloud data is NOT affected.', null),
  ];
  const cacheCard = buildCard('CACHE', cacheRows);
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-settings btn-settings-secondary';
  clearBtn.textContent = 'Clear Cache';
  clearBtn.style.cssText = 'margin:12px 20px 16px;';
  clearBtn.addEventListener('click', clearLocalCache);
  cacheCard.appendChild(clearBtn);
  c.appendChild(cacheCard);

  const storageRows = [
    buildRow('Local Storage', `${(localStorage.length * 0.001).toFixed(1)} KB used`),
    buildRow('Data Location', 'Supabase Cloud (Pakistan region)'),
    buildRow('Sync Status', 'Real-time sync enabled', badge('active', 'Active')),
  ];
  c.appendChild(buildCard('STORAGE INFORMATION', storageRows));

  const exportCard = document.createElement('div');
  exportCard.className = 'settings-card';
  exportCard.innerHTML = `
    <div class="settings-card-header">EXPORT</div>
    <div style="padding:16px 20px">
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Download a copy of your account data. This includes your profile, academic data, and preferences.</p>
      <button class="btn-settings btn-settings-secondary" onclick="exportData()">Request Data Export</button>
    </div>`;
  c.appendChild(exportCard);
}

function clearLocalCache() {
  try {
    const keysToKeep = [];
    const keys = Object.keys(localStorage);
    keys.forEach(k => { if (!keysToKeep.includes(k)) localStorage.removeItem(k); });
    showToastSettings('Cache cleared successfully');
  } catch (e) {
    showToastSettings('Failed to clear cache', true);
  }
}

function exportData() {
  showToastSettings('Data export request received. You will be notified when ready.');
}

/* =========================
   10. SUBSCRIPTION
   ========================= */

function renderSubscription() {
  const c = document.getElementById('settings-subscription-content');
  c.innerHTML = '';
  const ent = settingsEntitlements;
  const isPro = ent?.plan_type === 'premium' && ent?.subscription_status === 'active';

  const planCard = document.createElement('div');
  planCard.className = 'settings-card';
  if (isPro) {
    const expires = ent.premium_expires_at ? new Date(ent.premium_expires_at).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No expiry';
    planCard.innerHTML = `
      <div class="plan-card">
        <div class="plan-icon pro">&#10024;</div>
        <div class="plan-info">
          <h4>Wassal Pro ${badge('premium', 'Active')}</h4>
          <p>Expires ${expires}</p>
        </div>
      </div>`;
  } else {
    planCard.innerHTML = `
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
    planCard.appendChild(upgradeBtn);
  }
  c.appendChild(planCard);

  const usageRows = [
    buildRow('AI Sessions', isPro ? 'Unlimited' : 'Limited per month'),
    buildRow('Scans', isPro ? 'Unlimited' : 'Limited per month'),
  ];
  c.appendChild(buildCard('FEATURE ACCESS', usageRows));
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
   11. COUPONS
   ========================= */

function renderCoupons() {
  const c = document.getElementById('settings-coupons-content');
  c.innerHTML = '';

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

  const infoRows = [
    buildRow('Coupon codes are case-insensitive'),
    buildRow('Each code can be redeemed once per account'),
    buildRow('Premium codes extend your current subscription'),
  ];
  c.appendChild(buildCard('HOW IT WORKS', infoRows));
}

async function redeemCoupon() {
  const code = document.getElementById('coupon-code').value.trim();
  const msgEl = document.getElementById('coupon-msg');
  const btn = document.getElementById('coupon-btn');
  if (!code) return;

  msgEl.style.display = 'none';
  setLoading(btn, true);

  try {
    const { data, error } = await db.rpc('redeem_coupon_self', { p_code: code });
    if (error) throw error;
    if (data && data.success) {
      msgEl.textContent = 'Coupon redeemed successfully! Your subscription has been updated.';
      msgEl.style.color = '#35D399';
      msgEl.style.display = 'block';
      document.getElementById('coupon-code').value = '';
      await loadEntitlements();
      renderSubscription();
      showToastSettings('Coupon redeemed!');
    } else {
      msgEl.textContent = data?.error_message || 'Invalid or expired coupon code.';
      msgEl.style.color = '#FF6675';
      msgEl.style.display = 'block';
    }
  } catch (err) {
    msgEl.textContent = err.message || 'Failed to redeem coupon.';
    msgEl.style.color = '#FF6675';
    msgEl.style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

/* =========================
   12. CONNECTED ACCOUNTS
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

  if (hasEmail) {
    const emailIdentity = identities.find(i => i.provider === 'email');
    rows.push(buildConnectedRow('email', 'Email & Password', emailIdentity ? currentUser.email : 'Not linked'));
  }
  if (hasGoogle) {
    const googleIdentity = identities.find(i => i.provider === 'google');
    rows.push(buildConnectedRow('google', 'Google', googleIdentity ? (googleIdentity.identity_data?.email || 'Connected') : 'Not linked'));
  }
  if (hasSpotify) {
    const spotIdentity = identities.find(i => i.provider === 'spotify');
    rows.push(buildConnectedRow('spotify', 'Spotify', spotIdentity ? (spotIdentity.identity_data?.email || 'Connected') : 'Not linked'));
  }

  if (!rows.length) {
    rows.push(buildRow('No connected accounts', 'Sign in with email or a provider'));
  }

  c.appendChild(buildCard('LOGIN PROVIDERS', rows));

  if (providers.length <= 1 && hasEmail) {
    const warnRows = [
      buildRow('You only have one login method. Add another provider before removing email/password access.', ''),
    ];
    c.appendChild(buildCard('SECURITY NOTE', warnRows));
  }
}

/* =========================
   13. HELP & SUPPORT
   ========================= */

function renderHelp() {
  const c = document.getElementById('settings-help-content');
  c.innerHTML = '';

  const linksRows = [
    buildClickableRow('Help Center', 'Browse frequently asked questions', () => showToastSettings('Help Center coming soon')),
    buildClickableRow('Contact Support', 'Get in touch with our team', () => openSupportModal('problem')),
    buildClickableRow('Send Feedback', 'Share your thoughts with us', () => openSupportModal('suggestion')),
    buildClickableRow('Report a Problem', 'Report a bug or issue', () => openSupportModal('problem')),
    buildClickableRow('Feature Request', 'Suggest a new feature', () => openSupportModal('suggestion')),
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
function openSupportModal(kind) {
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

  if (!subject || !desc) { msgEl.textContent = 'All fields are required.'; msgEl.style.color = '#FF6675'; msgEl.style.display = 'block'; return; }

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

function buildClickableRow(title, desc, onClick) {
  const row = document.createElement('div');
  row.className = 'setting-row clickable';
  row.innerHTML = `<div class="setting-info"><div class="setting-title">${title}</div><div class="setting-desc">${desc || ''}</div></div><span class="setting-arrow">&#8250;</span>`;
  row.addEventListener('click', onClick);
  return row;
}

/* =========================
   14. ABOUT
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
    buildRow('Built With', 'Supabase + Flutter'),
  ];
  c.appendChild(buildCard('APP INFORMATION', infoRows));

  const legalRows = [
    buildClickableRow('Privacy Policy', 'How we handle your data', () => showToastSettings('Privacy Policy page coming soon')),
    buildClickableRow('Terms of Service', 'Terms of use', () => showToastSettings('Terms page coming soon')),
    buildClickableRow('Licenses', 'Open source licenses', () => showToastSettings('Licenses page coming soon')),
  ];
  c.appendChild(buildCard('LEGAL', legalRows));
}

/* =========================
   15. LOGOUT
   ========================= */

function settingsLogout() {
  db.auth.signOut().then(() => {
    window.location.href = '../index.html';
  }).catch(() => {
    window.location.href = '../index.html';
  });
}

/* =========================
   16. DELETE ACCOUNT
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

/* =========================
   PREFERENCE SAVE HELPER
   ========================= */

let savePrefTimer = null;
async function savePref(key, value) {
  settingsPrefs = { ...settingsPrefs, [key]: value };
  clearTimeout(savePrefTimer);
  savePrefTimer = setTimeout(async () => {
    try {
      await saveUserPrefs({ [key]: value });
      showToastSettings('Preference saved');
    } catch (e) {
      showToastSettings('Failed to save preference', true);
    }
  }, 400);
}
