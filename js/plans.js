/* =========================================================
   Anteemonee PLANS — single source of truth for pricing.
   Free (forever) · Monthly · Yearly.
   Legacy (still honoured everywhere): Exam (per exam period) · Lifetime.
   ========================================================= */
(function () {
  'use strict';

  window.ANTEEM_PLANS = {
    trialDays: 7,
    lifetimePrice: 4999,

    /* ---- Current subscription plans (Rs, per billing period) ---- */
    plans: {
      free:    { id: 'free',    label: 'Free',    price: 0,    interval: null,      days: 0,   tagline: 'Start learning — free forever' },
      monthly: { id: 'monthly', label: 'Monthly', price: 299,  interval: 'month',   days: 30,  tagline: 'Premium, billed every month' },
      yearly:  { id: 'yearly',  label: 'Yearly',  price: 2499, interval: 'year',    days: 365, tagline: 'Premium, billed once a year' },
    },
    planOrder: ['free', 'monthly', 'yearly'],

    /* ---- Promo codes moved SERVER-SIDE (supabase/functions/payment-promo).
       The browser never sees the catalog; /payment/ asks the server ---- */

    /* ---- Where students send manual payments (Easypaisa/JazzCash).
       PLACEHOLDERS — replace with the real accounts before launch.
       The /payment/ page reads these, so one edit updates checkout. ---- */
    paymentAccounts: {
      easypaisa: { label: 'Easypaisa', number: '+923096976634', title: 'Jawad Shafaqat' },
      jazzcash:  { label: 'JazzCash',  number: '+923096976634', title: 'Jawad Shafaqat' },
    },

    // The only 6 exam periods on sale. Access lasts until the
    // end of the selected period (Pakistan time).
    examPeriods: [
      { id: 'may-jun-2027', label: 'May / June 2027', short: 'May–Jun 2027', price: 999, endsAt: '2027-06-30T23:59:59+05:00' },
      { id: 'oct-nov-2027', label: 'Oct / Nov 2027', short: 'Oct–Nov 2027', price: 1199, endsAt: '2027-11-30T23:59:59+05:00' },
      { id: 'may-jun-2028', label: 'May / June 2028', short: 'May–Jun 2028', price: 1399, endsAt: '2028-06-30T23:59:59+05:00' },
      { id: 'oct-nov-2028', label: 'Oct / Nov 2028', short: 'Oct–Nov 2028', price: 1599, endsAt: '2028-11-30T23:59:59+05:00' },
      { id: 'may-jun-2029', label: 'May / June 2029', short: 'May–Jun 2029', price: 1799, endsAt: '2029-06-30T23:59:59+05:00' },
      { id: 'oct-nov-2029', label: 'Oct / Nov 2029', short: 'Oct–Nov 2029', price: 1999, endsAt: '2029-11-30T23:59:59+05:00' }
    ],

    fmt: function (n) {
      try { return 'Rs ' + Number(n).toLocaleString('en-PK'); } catch (_) { return 'Rs ' + n; }
    },

    periodById: function (id) {
      var list = (window.ANTEEM_PLANS && window.ANTEEM_PLANS.examPeriods) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
      }
      return null;
    },

    /* ---- Subscription-plan helpers (new Free/Monthly/Yearly model) ---- */
    planById: function (id) {
      var plans = (window.ANTEEM_PLANS && window.ANTEEM_PLANS.plans) || {};
      return plans[id] || null;
    },

    priceFor: function (id) {
      var p = window.ANTEEM_PLANS.planById(id);
      if (p) return p.price;
      if (id === 'lifetime') return window.ANTEEM_PLANS.lifetimePrice;
      return 0;
    },

    isPaidPlan: function (id) {
      return id === 'monthly' || id === 'yearly' ||
             id === 'exam' || id === 'lifetime' ||
             id === 'premium' || id === 'pro';
    },

    /* Expiry timestamp (ISO) for a paid subscription starting now. */
    expiresAtFor: function (id, fromDate) {
      var p = window.ANTEEM_PLANS.planById(id);
      if (!p || !p.days) return null;
      var base = fromDate ? new Date(fromDate).getTime() : Date.now();
      return new Date(base + p.days * 864e5).toISOString();
    }
  };
})();
