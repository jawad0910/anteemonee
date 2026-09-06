document.addEventListener('DOMContentLoaded', initDownload);

const APK_URL = '#'; /* TODO: replace with actual APK download URL */

function initDownload() {
  checkBetaStatus();
}

/* ---- Beta Status Check ---- */

async function checkBetaStatus() {
  // Read the session directly: the shared auth check may still be resolving.
  let email = currentUser?.email;
  if (!email) {
    try {
      const { data: { session } } = await db.auth.getSession();
      email = session?.user?.email;
    } catch (_) {}
  }
  if (!email) return;
  setBetaCardLoading(true);
  try {
    const { data } = await db.rpc('is_beta_verified', { p_email: email });
    if (data?.is_verified === true) {
      updateAndroidCard('verified');
    } else if (data?.is_rejected === true) {
      updateAndroidCard('rejected');
    } else {
      const { data: row } = await db.from('beta_testers').select('id').eq('email', email).maybeSingle();
      if (row) updateAndroidCard('applied');
      else resetAndroidCard();
    }
  } catch (e) {
    console.log('[BETA] status check skipped:', e.message);
    resetAndroidCard();
  } finally {
    setBetaCardLoading(false);
  }
}

function setBetaCardLoading(on) {
  const card = document.querySelector('.platform-card');
  if (!card) return;
  const badge = card.querySelector('.status-badge');
  const btn = card.querySelector('.btn-download');
  if (badge) badge.classList.toggle('is-loading', on);
  if (btn) {
    btn.classList.toggle('is-loading', on);
    if (on) btn.disabled = true;
  }
}

function resetAndroidCard() {
  const card = document.querySelector('.platform-card');
  if (!card) return;
  const badge = card.querySelector('.status-badge');
  const btn = card.querySelector('.btn-download');
  if (badge) { badge.textContent = 'Beta Available'; badge.className = 'status-badge beta-badge'; }
  if (btn) {
    btn.textContent = 'Apply for Beta';
    btn.className = 'btn-download btn-beta';
    btn.disabled = false;
    btn.style.opacity = '';
    btn.onclick = () => openBetaModal();
  }
}

function updateAndroidCard(status) {
  const card = document.querySelector('.platform-card');
  if (!card) return;
  const badge = card.querySelector('.status-badge');
  const btn = card.querySelector('.btn-download');

  if (status === 'verified') {
    if (badge) { badge.textContent = 'Beta Access'; badge.className = 'status-badge beta-badge'; }
    if (btn) {
      btn.textContent = 'Download APK';
      btn.className = 'btn-download btn-beta';
      btn.disabled = false;
      btn.style.opacity = '';
      btn.onclick = () => openBetaDownloadModal();
    }
  } else if (status === 'applied') {
    if (badge) { badge.textContent = 'Applied'; badge.className = 'status-badge'; }
    if (btn) {
      btn.textContent = 'Application Pending';
      btn.className = 'btn-download';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.onclick = null;
    }
  } else if (status === 'rejected') {
    if (badge) { badge.textContent = 'Rejected'; badge.className = 'status-badge rejected-badge'; }
    if (btn) {
      btn.textContent = 'Apply Again';
      btn.className = 'btn-download btn-reapply';
      btn.disabled = false;
      btn.style.opacity = '';
      btn.onclick = () => openBetaModal();
    }
  }
}

/* ---- Beta Apply Modal ---- */

async function openBetaModal() {
  const card = document.querySelector('.platform-card');
  const btn = card?.querySelector('.btn-download');
  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; btn.style.opacity = '0.6'; }

  if (!currentUser) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }
    document.getElementById('beta-signin-modal').classList.add('open');
    return;
  }

  try {
    const { data: ent } = await db.rpc('get_entitlement_snapshot');
    const isPro = ent && (ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active';
    if (!isPro) {
      if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }
      document.getElementById('beta-premium-modal').classList.add('open');
      return;
    }
  } catch (e) {
    console.log('[BETA] entitlement check failed:', e.message);
  }

  if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }

  const email = currentUser?.email || '';
  const input = document.getElementById('beta-email-input');
  if (input) input.value = email;
  hideBetaMessages();
  document.getElementById('beta-apply-modal').classList.add('open');
}

function closeBetaModal() {
  document.getElementById('beta-apply-modal').classList.remove('open');
  hideBetaMessages();
}

function hideBetaMessages() {
  const err = document.getElementById('beta-error');
  const suc = document.getElementById('beta-success');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  if (suc) { suc.style.display = 'none'; suc.textContent = ''; }
}

async function submitBetaApplication() {
  const input = document.getElementById('beta-email-input');
  const btn = document.getElementById('beta-submit-btn');
  const errEl = document.getElementById('beta-error');
  const sucEl = document.getElementById('beta-success');

  const email = (input?.value || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block';
    return;
  }

  btn.classList.add('loading');
  btn.disabled = true;
  hideBetaMessages();

  try {
    const { data: existing } = await db.from('beta_testers').select('id, is_verified, is_rejected').eq('email', email).maybeSingle();

    if (existing) {
      if (existing.is_verified) {
        sucEl.textContent = 'You are already verified! You can download the APK.';
        sucEl.style.display = 'block';
        updateAndroidCard('verified');
        setTimeout(closeBetaModal, 2000);
      } else if (existing.is_rejected) {
        const { error: updateErr } = await db.from('beta_testers').update({
          is_rejected: false,
          user_id: currentUser?.id || existing.user_id
        }).eq('id', existing.id);
        if (updateErr) throw updateErr;
        sucEl.textContent = 'Re-application submitted! We\'ll review your request again.';
        sucEl.style.display = 'block';
        updateAndroidCard('applied');
        setTimeout(closeBetaModal, 2500);
      } else {
        errEl.textContent = 'You have already applied. Your application is under review.';
        errEl.style.display = 'block';
        updateAndroidCard('applied');
      }
      return;
    }

    const { error } = await db.from('beta_testers').insert({
      email: email,
      user_id: currentUser?.id || null
    });

    if (error) throw error;

    sucEl.textContent = 'Application submitted! We\'ll notify you once you\'re verified.';
    sucEl.style.display = 'block';
    updateAndroidCard('applied');

    setTimeout(closeBetaModal, 2500);
  } catch (e) {
    errEl.textContent = e.message || 'Something went wrong. Please try again.';
    errEl.style.display = 'block';
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/* ---- Beta Download Modal (verified) ---- */

function openBetaDownloadModal() {
  const link = document.getElementById('beta-download-link');
  if (link) link.href = APK_URL;
  document.getElementById('beta-download-modal').classList.add('open');
}

function closeBetaDownloadModal() {
  document.getElementById('beta-download-modal').classList.remove('open');
}

/* ---- Beta Not Verified Modal ---- */

function openBetaNotVerifiedModal() {
  document.getElementById('beta-notverified-modal').classList.add('open');
}

function closeBetaNotVerifiedModal() {
  document.getElementById('beta-notverified-modal').classList.remove('open');
}

/* ---- Beta Sign-In Required Modal ---- */

function closeBetaSigninModal() {
  document.getElementById('beta-signin-modal').classList.remove('open');
}

/* ---- Beta Premium Required Modal ---- */

function closeBetaPremiumModal() {
  document.getElementById('beta-premium-modal').classList.remove('open');
}

/* ---- Close modals on overlay click / Escape ---- */

function closeDownloadModal() {
  const modal = document.getElementById('download-modal');
  if (modal) modal.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeDownloadModal();
    closeBetaModal();
    closeBetaDownloadModal();
    closeBetaNotVerifiedModal();
    closeBetaSigninModal();
    closeBetaPremiumModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDownloadModal();
    closeBetaModal();
    closeBetaDownloadModal();
    closeBetaNotVerifiedModal();
    closeBetaSigninModal();
    closeBetaPremiumModal();
  }
});
