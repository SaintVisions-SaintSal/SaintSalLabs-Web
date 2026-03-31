/**
 * SaintSal™ Labs — Core App
 * Auth, routing, navigation, shared utilities
 * Saint Vision Technologies LLC | US Patent #10,290,222 (HACP™)
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const SAL_KEY = 'saintvision_gateway_2025';
const API_BASE = '';  // Same origin — served by FastAPI backend

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentPage = 'headquarters';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function signIn() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const err = document.getElementById('auth-error');
  err.style.display = 'none';

  try {
    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    onSignedIn(data.user);
  } catch (e) {
    err.textContent = e.message || 'Sign in failed';
    err.style.display = 'block';
  }
}

async function signInGoogle() {
  try {
    await window.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  } catch (e) {
    console.error('Google sign-in error:', e);
  }
}

async function signUp() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const name = document.getElementById('signup-name').value.trim();
  const err = document.getElementById('auth-error');

  try {
    const { data, error } = await window.supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    });
    if (error) throw error;
    if (data.user) onSignedIn(data.user);
  } catch (e) {
    err.textContent = e.message || 'Sign up failed';
    err.style.display = 'block';
  }
}

async function signOut() {
  await window.supabase.auth.signOut();
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

function showSignup() {
  document.getElementById('auth-login').style.display = 'none';
  document.getElementById('auth-signup').style.display = 'block';
}
function showLogin() {
  document.getElementById('auth-login').style.display = 'block';
  document.getElementById('auth-signup').style.display = 'none';
}

function onSignedIn(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'grid';

  // Set user display
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('user-display-name').textContent = name;
  document.getElementById('user-avatar-initials').textContent = initials;
  document.getElementById('hq-user-name').textContent = name.split(' ')[0];

  // Load user profile from Supabase
  loadUserProfile(user.id);

  // Load headquarters data
  loadHeadquarters();
}

async function loadUserProfile(userId) {
  try {
    const { data } = await window.supabase
      .from('profiles')
      .select('plan_tier, full_name')
      .eq('id', userId)
      .single();

    if (data) {
      const tier = data.plan_tier || 'free';
      const tierDisplay = tier.charAt(0).toUpperCase() + tier.slice(1);
      document.getElementById('user-tier-badge').textContent = tierDisplay;
      document.getElementById('current-plan-name').textContent = `${tierDisplay} Plan`;
    }
  } catch (e) {
    console.warn('Could not load profile:', e);
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

const PAGE_TITLES = {
  headquarters: { title: 'Headquarters', sub: 'Platform Overview' },
  chat: { title: 'SAL Search', sub: '8 Intelligence Verticals' },
  builder: { title: 'Builder v2', sub: '5-Agent AI App Builder' },
  career: { title: 'Career Suite', sub: 'AI-Powered Career Tools' },
  cards: { title: 'CookinCards™', sub: 'Card Scanning & Grading' },
  creative: { title: 'Creative Studio', sub: 'Content & Image Generation' },
  launchpad: { title: 'Launch Pad', sub: 'Business Formation' },
  ghl: { title: 'GHL Intel Hub', sub: 'CRM & Pipeline Intelligence' },
  finance: { title: 'Finance', sub: 'Market Intelligence' },
  realestate: { title: 'Real Estate', sub: 'Property Intelligence' },
  settings: { title: 'Settings', sub: 'Account & Subscription' },
};

function navigate(page) {
  // Hide current page
  const current = document.getElementById(`page-${currentPage}`);
  if (current) { current.style.display = 'none'; current.classList.remove('active'); }

  // Remove active from nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  // Show new page
  const next = document.getElementById(`page-${page}`);
  if (next) { next.style.display = 'block'; next.classList.add('active'); }

  // Update nav
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Update topbar
  const meta = PAGE_TITLES[page] || { title: page, sub: '' };
  document.getElementById('topbar-title').textContent = meta.title;
  document.getElementById('topbar-sub').textContent = meta.sub;

  currentPage = page;

  // Load page data
  if (page === 'headquarters') loadHeadquarters();
  if (page === 'chat') loadTrending();
  if (page === 'ghl') loadGHL();
  if (page === 'finance') loadFinance();
  if (page === 'cards') initCards();
  if (page === 'career') initCareer();
  if (page === 'creative') initCreative();
  if (page === 'launchpad') initLaunchpad();
}

// ── Headquarters ──────────────────────────────────────────────────────────────

async function loadHeadquarters() {
  // Load GHL stats
  try {
    const data = await apiGet('/api/ghl/stats');
    renderHQStats(data);
    renderHQGHL(data);
  } catch (e) {
    document.getElementById('hq-ghl-data').innerHTML = `<p class="text-muted">Could not load CRM data.</p>`;
  }
}

function renderHQStats(data) {
  const stats = data?.stats || {};
  const total = stats.total_contacts || 0;
  const pipelines = (data?.pipelines || []).length;

  document.getElementById('hq-stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${total.toLocaleString()}</div>
      <div class="stat-label">Total Contacts</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${pipelines}</div>
      <div class="stat-label">Pipelines</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${(data?.recent_leads || []).length}</div>
      <div class="stat-label">Recent Leads</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">—</div>
      <div class="stat-label">Revenue MTD</div>
    </div>
  `;
}

function renderHQGHL(data) {
  const leads = data?.recent_leads || [];
  if (!leads.length) {
    document.getElementById('hq-ghl-data').innerHTML = '<p class="text-muted">No recent leads.</p>';
    return;
  }

  document.getElementById('hq-ghl-data').innerHTML = `
    <h3 style="margin-bottom:12px">Recent Leads</h3>
    ${leads.slice(0, 5).map(l => `
      <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--brd)">
        <div>
          <div style="font-weight:600;font-size:13px">${l.firstName || ''} ${l.lastName || ''}</div>
          <div class="text-muted" style="font-size:12px">${l.email || ''}</div>
        </div>
        <span class="badge badge-blue">${l.tags?.[0] || 'Lead'}</span>
      </div>
    `).join('')}
  `;
}

// ── API Helpers ───────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(path, {
    headers: { 'x-sal-key': SAL_KEY },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sal-key': SAL_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Stream an SSE endpoint.
 * @param {string} path - API path
 * @param {object} body - Request body
 * @param {function} onChunk - Called with each text chunk
 * @param {function} onEvent - Called with each parsed event { type, ...data }
 * @param {function} onDone - Called when stream completes
 */
async function streamAPI(path, body, { onChunk, onEvent, onDone } = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sal-key': SAL_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { onDone?.(); break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          onEvent?.(data);
          if (data.type === 'chunk' && data.content) onChunk?.(data.content);
          if (data.type === 'done' || data.type === 'complete') { onDone?.(data); return; }
        } catch (e) { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatRelativeTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:${type === 'error' ? 'var(--coral)' : type === 'success' ? 'var(--green)' : 'var(--gold)'};
    color:${type === 'success' ? '#000' : type === 'error' ? '#fff' : '#000'};
    padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;
    z-index:9999;animation:slideIn 0.2s ease;
    box-shadow:0 4px 20px rgba(0,0,0,0.3);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function saveProfile() {
  const name = document.getElementById('settings-name').value;
  if (!currentUser) return;

  try {
    const { error } = await window.supabase
      .from('profiles')
      .upsert({ id: currentUser.id, full_name: name });
    if (error) throw error;
    showToast('Profile saved', 'success');
  } catch (e) {
    showToast(e.message || 'Save failed', 'error');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

// Listen to auth state
if (window.supabase) {
  window.supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      onSignedIn(session.user);
    } else if (event === 'SIGNED_OUT') {
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-screen').style.display = 'flex';
    }
  });

  // Check existing session
  window.supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      onSignedIn(session.user);
    }
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'k') { e.preventDefault(); navigate('chat'); }
    if (e.key === 'b') { e.preventDefault(); navigate('builder'); }
  }
});

// Stub init functions (filled in by each module's JS file)
if (typeof loadTrending !== 'function') window.loadTrending = () => {};
if (typeof loadGHL !== 'function') window.loadGHL = () => {};
if (typeof loadFinance !== 'function') window.loadFinance = () => {};
if (typeof initCards !== 'function') window.initCards = () => {};
if (typeof initCareer !== 'function') window.initCareer = () => {};
if (typeof initCreative !== 'function') window.initCreative = () => {};
if (typeof initLaunchpad !== 'function') window.initLaunchpad = () => {};
