document.addEventListener('DOMContentLoaded', initPayment);

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
    if (ent && (ent.plan_type === 'premium' || ent.plan_type === 'pro') && ent.subscription_status === 'active') {
      checkoutSection.style.display = 'none';
      alreadyPremium.style.display = 'block';
    }
  } catch (e) {
    console.error('[payment] entitlement check error:', e);
  }
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
    if (!res.ok || data?.error) throw new Error(data?.error || 'Checkout failed');
    if (!data?.url) throw new Error('No checkout URL returned');

    window.location.href = data.url;
  } catch (e) {
    console.error('[payment] checkout error:', e);
    errorMsg.textContent = e.message || 'Failed to start checkout. Please try again.';
    errorMsg.style.display = 'block';
    payBtn.disabled = false;
    payBtn.innerHTML = 'Pay Now - Rs 400/mo';
  }
}
