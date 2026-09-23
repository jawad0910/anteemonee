/**
 * Anteemonee Account Manager
 * Single-account session manager using IndexedDB.
 */
const AccountManager = (() => {
  const DB_NAME = 'Anteemonee_accounts';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessions';
  const MAX_ACCOUNTS = 1;
  const ACTIVE_KEY = 'active_user_id';

  let _db = null;
  let _accounts = []; // { userId, email, displayName, username, avatarUrl, lastUsedAt, sessionStatus }
  let _activeUserId = null;

  // â”€â”€ IndexedDB helpers â”€â”€
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbGet(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  function dbPut(record) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  function dbDelete(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  function dbGetAll() {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function dbClear() {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }));
  }

  // â”€â”€ Public API â”€â”€

  /**
   * Initialize the account manager. Load saved accounts from IndexedDB.
   */
  async function init() {
    try {
      const records = await dbGetAll();
      _accounts = records.map(r => ({
        userId: r.userId,
        email: r.email,
        displayName: r.displayName || '',
        username: r.username || '',
        avatarUrl: r.avatarUrl || '',
        lastUsedAt: r.lastUsedAt || null,
        sessionStatus: r.sessionStatus || 'active',
      }));
      _activeUserId = localStorage.getItem(ACTIVE_KEY) || null;
      // Validate active user still exists in accounts
      if (_activeUserId && !_accounts.find(a => a.userId === _activeUserId)) {
        _activeUserId = _accounts.length > 0 ? _accounts[0].userId : null;
        if (_activeUserId) localStorage.setItem(ACTIVE_KEY, _activeUserId);
        else localStorage.removeItem(ACTIVE_KEY);
      }
    } catch (e) {
      console.error('[AccountManager] init failed:', e);
      _accounts = [];
      _activeUserId = null;
    }
  }

  /**
   * Get all saved accounts (metadata only, no session tokens).
   */
  function getSavedAccounts() {
    return [..._accounts];
  }

  /**
   * Get the currently active account metadata.
   */
  function getActiveAccount() {
    return _accounts.find(a => a.userId === _activeUserId) || null;
  }

  function getActiveUserId() {
    return _activeUserId;
  }

  /**
   * Get account count.
   */
  function getAccountCount() {
    return _accounts.length;
  }

  /**
   * Check if there's room for another account.
   */
  function hasAvailableSlot() {
    return _accounts.length < MAX_ACCOUNTS;
  }

  /**
   * Check if a user is already saved.
   */
  function isAccountSaved(userId) {
    return _accounts.some(a => a.userId === userId);
  }

  /**
   * Save the current Supabase session for the given user.
   * Call this after a successful login/signup.
   */
  async function saveCurrentSession(user, session) {
    if (!user || !session) return false;

    const existing = _accounts.find(a => a.userId === user.id);
    const profile = typeof currentProfile !== 'undefined' ? currentProfile : null;

    const record = {
      userId: user.id,
      email: user.email || '',
      displayName: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || '',
      username: profile?.username || user.user_metadata?.username || '',
      avatarUrl: profile?.profile_image_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? '',
      lastUsedAt: new Date().toISOString(),
      sessionStatus: 'active',
      // Store the full Supabase session (tokens)
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
      },
      // Store full user object for rehydration
      user: {
        id: user.id,
        email: user.email,
        aud: user.aud,
        role: user.role,
        user_metadata: user.user_metadata,
        app_metadata: user.app_metadata,
        created_at: user.created_at,
      },
    };

    try {
      await dbPut(record);
      _activeUserId = user.id;
      localStorage.setItem(ACTIVE_KEY, user.id);

      // Update in-memory list
      const idx = _accounts.findIndex(a => a.userId === user.id);
      const meta = {
        userId: user.id,
        email: record.email,
        displayName: record.displayName,
        username: record.username,
        avatarUrl: record.avatarUrl,
        lastUsedAt: record.lastUsedAt,
        sessionStatus: 'active',
      };
      if (idx >= 0) _accounts[idx] = meta;
      else _accounts.push(meta);

      return true;
    } catch (e) {
      console.error('[AccountManager] saveCurrentSession failed:', e);
      return false;
    }
  }

  /**
   * Update account metadata (e.g., after profile change).
   */
  async function updateAccountMeta(userId, updates) {
    const idx = _accounts.findIndex(a => a.userId === userId);
    if (idx < 0) return;

    Object.assign(_accounts[idx], updates);

    try {
      const record = await dbGet(userId);
      if (record) {
        Object.assign(record, updates);
        await dbPut(record);
      }
    } catch (e) {
      console.error('[AccountManager] updateAccountMeta failed:', e);
    }
  }

  /**
   * Switch to another account. Returns the session to apply to Supabase.
   * Caller must apply the session via db.auth.setSession() and refresh state.
   */
  async function switchAccount(userId) {
    if (userId === _activeUserId) return null;

    const record = await dbGet(userId);
    if (!record || !record.session) {
      console.error('[AccountManager] No session found for', userId);
      return null;
    }

    _activeUserId = userId;
    localStorage.setItem(ACTIVE_KEY, userId);

    // Update lastUsedAt
    record.lastUsedAt = new Date().toISOString();
    await dbPut(record);

    const meta = _accounts.find(a => a.userId === userId);
    if (meta) meta.lastUsedAt = record.lastUsedAt;

    return {
      session: record.session,
      user: record.user,
    };
  }

  /**
   * Remove an account from this browser.
   * Does NOT delete the Supabase account â€” only removes the saved session.
   */
  async function removeAccount(userId) {
    try {
      await dbDelete(userId);
    } catch (e) {
      console.error('[AccountManager] removeAccount DB failed:', e);
    }

    _accounts = _accounts.filter(a => a.userId !== userId);

    if (_activeUserId === userId) {
      _activeUserId = _accounts.length > 0 ? _accounts[0].userId : null;
      if (_activeUserId) localStorage.setItem(ACTIVE_KEY, _activeUserId);
      else localStorage.removeItem(ACTIVE_KEY);
      return { removedActive: true, nextAccount: _accounts[0] || null };
    }

    return { removedActive: false };
  }

  /**
   * Logout the current account only. Returns remaining accounts.
   */
  async function logoutCurrent() {
    if (!_activeUserId) return [];

    const result = await removeAccount(_activeUserId);
    return { remaining: _accounts, switchedTo: result.nextAccount };
  }

  /**
   * Logout all accounts. Clears everything.
   */
  async function logoutAll() {
    try {
      await dbClear();
    } catch (e) {
      console.error('[AccountManager] logoutAll DB failed:', e);
    }
    _accounts = [];
    _activeUserId = null;
    localStorage.removeItem(ACTIVE_KEY);
  }

  /**
   * Get the stored session for a specific account.
   * Returns null if not found or expired.
   */
  async function getAccountSession(userId) {
    const record = await dbGet(userId);
    if (!record || !record.session) return null;

    // Check if session is expired (with 5 min buffer)
    const expiresAt = record.session.expires_at;
    if (expiresAt && (expiresAt * 1000) < (Date.now() - 300000)) {
      return { ...record.session, expired: true };
    }

    return record.session;
  }

  /**
   * Refresh all account sessions. Marks expired ones.
   */
  async function refreshAccountSessions() {
    const results = [];
    for (const acc of _accounts) {
      const session = await getAccountSession(acc.userId);
      if (session?.expired) {
        acc.sessionStatus = 'expired';
        const record = await dbGet(acc.userId);
        if (record) {
          record.sessionStatus = 'expired';
          await dbPut(record);
        }
      } else if (session) {
        acc.sessionStatus = 'active';
      }
      results.push({ userId: acc.userId, status: acc.sessionStatus });
    }
    return results;
  }

  /**
   * Build a scoped localStorage key for the active user.
   * Use this for any user-specific cache.
   */
  function scopedKey(key) {
    if (!_activeUserId) return key;
    return `${key}_${_activeUserId}`;
  }

  /**
   * Migrate a generic localStorage key to a user-scoped key.
   * If the scoped key doesn't exist but the generic one does, move it.
   */
  function migrateKey(key) {
    const scoped = scopedKey(key);
    const generic = localStorage.getItem(key);
    if (generic !== null && localStorage.getItem(scoped) === null) {
      localStorage.setItem(scoped, generic);
    }
  }

  return {
    init,
    getSavedAccounts,
    getActiveAccount,
    getActiveUserId,
    getAccountCount,
    hasAvailableSlot,
    isAccountSaved,
    saveCurrentSession,
    updateAccountMeta,
    switchAccount,
    removeAccount,
    logoutCurrent,
    logoutAll,
    getAccountSession,
    refreshAccountSessions,
    scopedKey,
    migrateKey,
    MAX_ACCOUNTS,
  };
})();
