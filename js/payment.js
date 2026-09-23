document.addEventListener('DOMContentLoaded', initPayment);

let cryptoPollTimer = null;
let cryptoExpiresTimer = null;
let activePaymentId = null;

function getPaymentDb() {
  try {
    if (typeof db !== 'undefined' && db) return db;
  } catch (_) {}
  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      return supabase.createClient(
        'https://zkuytvjeqkpexcbyoyhz.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44'
      );
    }
  } catch (_) {}
  return null;
}

async function initPayment() {
  const notAuth = document.getElementById('payment-not-auth');
  const paymentContent = document.getElementById('payment-content');
  const checkoutSection = document.getElementById('checkout-section');
  const alreadyPremium = document.getElementById('already-premium');
  const cryptoSection = document.getElementById('crypto-section');

  paymentContent.style.display = 'flex';

  let attempts = 0;
  while (true) {
    let ready = false;
    try { ready = typeof currentUser !== 'undefined' && currentUser !== null; } catch (_) {}
    if (ready) break;
    attempts++;
    if (attempts > 50) break;
    await new Promise(r => setTimeout(r, 100));
  }

  let user = null;
  try { user = currentUser; } catch (_) {}
  if (!user) {
    paymentContent.style.display = 'none';
    notAuth.style.display = 'flex';
    return;
  }

  const pDb = getPaymentDb();
  if (!pDb) {
    console.error('[payment] Could not initialize Supabase client');
    return;
  }

  try {
    const { data: ent } = await pDb.rpc('get_entitlement_snapshot');
    const paid = (typeof Access !== 'undefined' && Access.isPaidEntitlement(ent))
      || (ent && ((ent.plan_type === 'lifetime' && ent.subscription_status !== 'refunded')
        || ((ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active')));
    if (paid) {
      checkoutSection.style.display = 'none';
      if (cryptoSection) cryptoSection.style.display = 'none';
      alreadyPremium.style.display = 'block';
      return;
    }
  } catch (e) {
    console.error('[payment] entitlement check error:', e);
  }

  // Resume an in-progress crypto payment if the user navigated back
  try {
    const savedId = sessionStorage.getItem('ae_safepay_payment_id');
    if (savedId && cryptoSection && checkoutSection) {
      activePaymentId = savedId;
      checkoutSection.style.display = 'none';
      cryptoSection.style.display = 'block';
      await refreshCryptoStatus();
      startCryptoPolling();
    }
  } catch (_) {}

  // Show trial countdown to nudge conversion.
  try {
    if (typeof Access !== 'undefined') {
      await Access.init();
      const note = document.getElementById('trial-note');
      if (note) {
        if (Access.state.reason === 'trial') {
          note.textContent = Access.state.daysLeft <= 1
            ? 'Your free trial ends today — get lifetime access before it expires.'
            : `You have ${Access.state.daysLeft} days of free trial left — lock in lifetime access now.`;
          note.style.display = 'block';
        } else if (Access.state.reason === 'expired' || Access.state.reason === 'blocked') {
          note.textContent = 'Your free trial has ended — get lifetime access to continue using Anteemonee.';
          note.style.display = 'block';
        }
      }
    }
  } catch (_) {}
}

async function handlePay() {
  const payBtn = document.getElementById('pay-btn');
  const errorMsg = document.getElementById('payment-error');

  payBtn.disabled = true;
  payBtn.innerHTML = '<span class="spinner"></span>Creating checkout...';
  errorMsg.style.display = 'none';

  try {
    const pDb = getPaymentDb();
    if (!pDb) throw new Error('Supabase client not available');

    const { data: sessionData } = await pDb.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const res = await fetch('https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/safepay-checkout', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      if (data?.error === 'rate_limited') {
        const secs = data?.retry_after_seconds || 60;
        throw new Error(`Too many checkout attempts. Please try again in about ${Math.ceil(secs / 60)} minute(s).`);
      }
      throw new Error(data?.error || 'Checkout failed');
    }

    const payment = data?.payment;
    if (!payment?.id || !payment?.wallet_address) throw new Error('No payment address returned');

    activePaymentId = payment.id;
    try { sessionStorage.setItem('ae_safepay_payment_id', payment.id); } catch (_) {}

    renderCryptoPayment(payment);
    startCryptoPolling();
  } catch (e) {
    console.error('[payment] checkout error:', e);
    errorMsg.textContent = e.message || 'Failed to start checkout. Please try again.';
    errorMsg.style.display = 'block';
    payBtn.disabled = false;
    payBtn.innerHTML = 'Pay Rs 2,499 Once';
  }
}

function renderCryptoPayment(payment) {
  const checkoutSection = document.getElementById('checkout-section');
  const cryptoSection = document.getElementById('crypto-section');
  const amountEl = document.getElementById('crypto-amount');
  const addressEl = document.getElementById('crypto-address');
  const networkEl = document.getElementById('crypto-network');
  const statusEl = document.getElementById('crypto-status');
  const expiresEl = document.getElementById('crypto-expires');
  const qrEl = document.getElementById('crypto-qr');
  const errorEl = document.getElementById('crypto-error');

  if (checkoutSection) checkoutSection.style.display = 'none';
  if (cryptoSection) cryptoSection.style.display = 'block';
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  const network = payment.pay_currency || 'USDTBSC';
  const amount = payment.pay_amount != null ? String(payment.pay_amount) : '—';
  const address = payment.wallet_address || '';

  if (networkEl) networkEl.textContent = network;
  if (amountEl) amountEl.textContent = `${amount} ${network}`;
  if (addressEl) addressEl.textContent = address;
  if (statusEl) setStatusChip(statusEl, payment.status || 'waiting');

  if (qrEl) {
    const qrData = encodeURIComponent(address || '');
    qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=${qrData}`;
    qrEl.alt = `QR for deposit address ${address}`;
  }

  startExpiryCountdown(payment.expires_at);

  const copyBtn = document.getElementById('crypto-copy');
  if (copyBtn && address) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(address);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch (_) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    };
  }
}

function setStatusChip(el, status) {
  el.textContent = status || 'waiting';
  el.classList.remove('done', 'expired');
  if (status === 'finished' || status === 'confirmed' || status === 'paid') el.classList.add('done');
  if (status === 'expired') el.classList.add('expired');
}

function startExpiryCountdown(expiresAt) {
  const el = document.getElementById('crypto-expires');
  if (!el) return;
  if (cryptoExpiresTimer) clearInterval(cryptoExpiresTimer);

  const end = expiresAt ? new Date(expiresAt).getTime() : 0;
  if (!end) {
    el.textContent = '20 minutes';
    return;
  }

  const tick = () => {
    const diff = end - Date.now();
    if (diff <= 0) {
      el.textContent = 'Expired';
      if (cryptoExpiresTimer) clearInterval(cryptoExpiresTimer);
      return;
    }
    const totalSec = Math.floor(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  };

  tick();
  cryptoExpiresTimer = setInterval(tick, 1000);
}

function startCryptoPolling() {
  if (cryptoPollTimer) clearInterval(cryptoPollTimer);
  cryptoPollTimer = setInterval(() => {
    refreshCryptoStatus(true);
  }, 5000);
}

async function refreshCryptoStatus(silent) {
  const errorMsg = document.getElementById('crypto-error');
  const confirmEl = document.getElementById('crypto-confirm');
  const statusEl = document.getElementById('crypto-status');
  const refreshBtn = document.getElementById('crypto-refresh');

  if (!activePaymentId) {
    if (errorMsg && !silent) {
      errorMsg.textContent = 'No active payment. Please start checkout again.';
      errorMsg.style.display = 'block';
    }
    return;
  }

  try {
    const pDb = getPaymentDb();
    if (!pDb) throw new Error('Supabase client not available');

    const { data: sessionData } = await pDb.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const res = await fetch('https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/safepay-verify', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_id: activePaymentId }),
    });
    const data = await res.json();
    if (!res.ok && res.status !== 403) {
      if (data?.error && !silent) {
        errorMsg.textContent = data.error;
        errorMsg.style.display = 'block';
      }
      return;
    }

    if (data?.status && statusEl) setStatusChip(statusEl, data.status);

    const waiting = !data?.paid && data?.status !== 'expired';
    if (data?.status === 'confirming' || data?.status === 'waiting') {
      if (confirmEl) confirmEl.style.display = 'block';
    }

    if (data?.paid) {
      if (cryptoPollTimer) clearInterval(cryptoPollTimer);
      if (cryptoExpiresTimer) clearInterval(cryptoExpiresTimer);
      if (confirmEl) {
        confirmEl.textContent = 'Payment confirmed. Lifetime access unlocked.';
        confirmEl.style.display = 'block';
      }
      if (refreshBtn) refreshBtn.style.display = 'none';
      try { sessionStorage.removeItem('ae_safepay_payment_id'); } catch (_) {}
      setTimeout(() => {
        window.location.href = `payment-success.html?payment_id=${encodeURIComponent(activePaymentId)}`;
      }, 900);
      return;
    }

    if (data?.status === 'expired') {
      if (cryptoPollTimer) clearInterval(cryptoPollTimer);
      if (errorMsg) {
        errorMsg.textContent = 'This payment address expired. Start a new checkout.';
        errorMsg.style.display = 'block';
      }
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Start new payment';
        refreshBtn.onclick = () => {
          try { sessionStorage.removeItem('ae_safepay_payment_id'); } catch (_) {}
          window.location.href = 'payment.html';
        };
      }
      if (waiting) return;
    }

    if (!silent && data?.status && data.status === 'waiting' && confirmEl) {
      // subtle nudge only after manual check
    }
  } catch (e) {
    console.error('[payment] status error:', e);
    if (!silent && errorMsg) {
      errorMsg.textContent = e.message || 'Could not check payment status.';
      errorMsg.style.display = 'block';
    }
  }
}
