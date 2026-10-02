/* =========================================================
   Anteemonee PLANS — single source of truth for pricing.
   Free (forever) · Exam (per exam period) · Lifetime.
   ========================================================= */
(function () {
  'use strict';

  window.ANTEEM_PLANS = {
    trialDays: 7,
    lifetimePrice: 4999,

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
    }
  };
})();
