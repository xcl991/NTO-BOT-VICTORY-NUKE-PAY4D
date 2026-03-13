// === BOT NTO Panel - Main Application ===

const state = {
  currentSection: 'dashboard',
  accounts: { NUKE: [], VICTORY: [], PAY4D: [] },
  tarikdbAccounts: { NUKE: [], VICTORY: [], PAY4D: [] },
};

const PROVIDERS = [
  { key: 'NUKE', label: 'NUKE', icon: 'fa-bolt', color: 'red', defaultUrl: 'https://cpt77.nukepanel.com', feature: 'NTO' },
  { key: 'VICTORY', label: 'VICTORY', icon: 'fa-trophy', color: 'yellow', defaultUrl: '', feature: 'NTO' },
  { key: 'PAY4D', label: 'PAY4D', icon: 'fa-credit-card', color: 'green', defaultUrl: '', feature: 'NTO' },
];

const TARIKDB_PROVIDERS = [
  { key: 'NUKE', label: 'NUKE', icon: 'fa-bolt', color: 'red', defaultUrl: 'https://cpt77.nukepanel.com', feature: 'TARIKDB' },
  { key: 'VICTORY', label: 'VICTORY', icon: 'fa-trophy', color: 'yellow', defaultUrl: '', feature: 'TARIKDB' },
  { key: 'PAY4D', label: 'PAY4D', icon: 'fa-credit-card', color: 'green', defaultUrl: '', feature: 'TARIKDB' },
];

// ==================== DARK MODE ====================
window.toggleDarkMode = function() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark);
  updateDarkModeIcon();
  // Redraw chart with new colors if on dashboard
  if (state.currentSection === 'dashboard') {
    try { loadDashboard(); } catch {}
  }
};

function updateDarkModeIcon() {
  const icon = document.getElementById('darkModeIcon');
  const btn = document.getElementById('darkModeBtn');
  if (!icon) return;
  const isDark = document.documentElement.classList.contains('dark');
  icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  if (btn) btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  updateDarkModeIcon();
  renderProviderSections();
  ws.connect();
  setupWebSocketListeners();
  loadDashboard();
});

// ==================== NAVIGATION ====================
window.showSection = function(sectionId, element) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const section = document.getElementById(sectionId);
  if (section) section.classList.add('active');
  if (element) element.classList.add('active');
  state.currentSection = sectionId;
  // Close mobile sidebar
  document.querySelector('.sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-overlay')?.classList.remove('open');

  // Load section data
  switch (sectionId) {
    case 'dashboard': loadDashboard(); break;
    case 'provider-nuke': loadProviderAccounts('NUKE', 'NTO'); break;
    case 'provider-victory': loadProviderAccounts('VICTORY', 'NTO'); break;
    case 'provider-pay4d': loadProviderAccounts('PAY4D', 'NTO'); break;
    case 'tarikdb-nuke': loadProviderAccounts('NUKE', 'TARIKDB'); break;
    case 'tarikdb-victory': loadProviderAccounts('VICTORY', 'TARIKDB'); break;
    case 'tarikdb-pay4d': loadProviderAccounts('PAY4D', 'TARIKDB'); break;
    case 'tarikdb-scheduler': loadSchedulerSettings(); break;
    case 'livereport-scheduler': loadLiveReportSchedulerSettings(); break;
    case 'nto-results': loadNtoResults(); break;
    case 'bot-activity': loadActivity(); loadActiveBots(); break;
    case 'settings': loadSettings(); break;
  }
};

window.toggleSidebar = function() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.querySelector('.sidebar-overlay')?.classList.toggle('open');
};

// ==================== CUSTOM CONFIRM MODAL ====================
window.showConfirmModal = function(message, onConfirm, title = 'Konfirmasi') {
  let modal = document.getElementById('confirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'confirmModal';
    modal.innerHTML = `<div class="fixed inset-0 bg-black bg-opacity-50 z-[70] flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 id="confirmTitle" class="text-lg font-bold mb-3"></h3>
        <p id="confirmMessage" class="text-sm text-gray-600 mb-6 whitespace-pre-line"></p>
        <div class="flex justify-end gap-3">
          <button id="confirmCancel" class="px-4 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">Batal</button>
          <button id="confirmOk" class="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700">Ya, Lanjutkan</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  modal.classList.remove('hidden');
  const cleanup = () => modal.classList.add('hidden');
  document.getElementById('confirmCancel').onclick = cleanup;
  document.getElementById('confirmOk').onclick = () => { cleanup(); onConfirm(); };
};

// ==================== TOAST NOTIFICATIONS ====================
function showNotification(message, type = 'info', duration = 3000) {
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-blue-500' };
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 ${colors[type] || colors.info} text-white px-5 py-3 rounded-lg shadow-lg z-[60] flex items-center gap-2 text-sm animate-slide-up`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i>${escapeHtml(message)}`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== RENDER PROVIDER SECTIONS ====================
function renderProviderSections() {
  // Render both NTO and TARIKDB sections
  const allSections = [
    ...PROVIDERS.map(p => ({ ...p, sectionPrefix: 'provider', idPrefix: p.key, featureLabel: 'NTO' })),
    ...TARIKDB_PROVIDERS.map(p => ({ ...p, sectionPrefix: 'tarikdb', idPrefix: `TARIKDB_${p.key}`, featureLabel: 'TARIK DB' })),
  ];

  for (const p of allSections) {
    const sectionId = p.sectionPrefix === 'tarikdb' ? `tarikdb-${p.key.toLowerCase()}` : `provider-${p.key.toLowerCase()}`;
    const el = document.getElementById(sectionId);
    if (!el) continue;
    const uid = p.idPrefix; // Unique prefix for element IDs (e.g., "NUKE" or "TARIKDB_NUKE")
    el.innerHTML = `
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 class="text-2xl font-bold"><i class="fas ${p.icon} mr-2 text-${p.color}-500"></i>${p.label} Panel <span class="text-sm font-normal text-gray-400">(${p.featureLabel})</span></h2>
          <p class="text-gray-500 text-sm mt-1">Manage ${p.label} provider accounts and automation</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button onclick="toggleAddForm('${uid}')" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm"><i class="fas fa-plus mr-1"></i>Add Account</button>
          <button onclick="startAllBots('${p.key}')" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"><i class="fas fa-play mr-1"></i>Start All</button>
          <button onclick="stopAllBots('${p.key}')" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm"><i class="fas fa-stop mr-1"></i>Stop All</button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Accounts</p><p class="text-2xl font-bold" id="${uid}StatTotal">0</p></div>
            <div class="w-10 h-10 bg-${p.color}-100 rounded-lg flex items-center justify-center"><i class="fas fa-users text-${p.color}-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Active</p><p class="text-2xl font-bold text-green-600" id="${uid}StatActive">0</p></div>
            <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-robot text-green-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">NTO Checks</p><p class="text-2xl font-bold text-blue-600" id="${uid}StatNto">0</p></div>
            <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-clipboard-check text-blue-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Last Check</p><p class="text-lg font-bold text-gray-500" id="${uid}StatLast">-</p></div>
            <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><i class="fas fa-clock text-purple-500"></i></div>
          </div>
        </div>
      </div>

      <!-- Add Account Form -->
      <div id="${uid}AddForm" class="bg-white rounded-xl shadow-sm p-6 mb-6 hidden">
        <h3 class="font-bold text-lg mb-4"><i class="fas fa-user-plus mr-2 text-green-600"></i>Add New Account</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Account Name *</label>
            <input type="text" id="${uid}NewName" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., User 1">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Panel URL *</label>
            <input type="url" id="${uid}NewPanelUrl" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="${p.defaultUrl || 'https://panel-url.com'}" value="${p.defaultUrl}">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username *</label>
            <input type="text" id="${uid}NewUsername" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="username">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input type="password" id="${uid}NewPassword" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="password">
          </div>
          ${p.key === 'PAY4D' ? `<div>
            <label class="block text-sm font-medium text-gray-700 mb-1">PIN Code</label>
            <input type="password" id="${uid}NewPinCode" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="PIN code">
          </div>` : ''}
          ${p.key === 'NUKE' ? `<div>
            <label class="block text-sm font-medium text-gray-700 mb-1">2FA Secret (TOTP)</label>
            <input type="text" id="${uid}NewTwoFaSecret" class="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="JBSWY3DPEHPK3PXP">
          </div>` : ''}
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Proxy <span class="text-gray-400">(optional)</span></label>
            <div class="flex gap-2">
              <select id="${uid}NewProxyType" class="border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-28">
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
                <option value="socks4">SOCKS4</option>
              </select>
              <input type="text" id="${uid}NewProxy" class="flex-1 border border-gray-300 rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="host:port:username:password">
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button onclick="createAccount('${uid}')" class="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium"><i class="fas fa-save mr-2"></i>Save Account</button>
          <button onclick="toggleAddForm('${uid}')" class="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 text-sm">Cancel</button>
        </div>
      </div>

      <!-- Main Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Accounts Table -->
        <div class="lg:col-span-2 bg-white rounded-xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold"><i class="fas fa-list mr-2 text-gray-600"></i>Accounts</h3>
            <input type="text" id="${uid}Search" onkeyup="filterAccounts('${uid}')" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40" placeholder="Search...">
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-3 text-left w-8"><input type="checkbox" id="${uid}SelectAll" onchange="toggleSelectAll('${uid}')" class="h-4 w-4 rounded"></th>
                  <th class="px-3 py-3 text-left">Name</th>
                  <th class="px-3 py-3 text-left hidden md:table-cell">Panel URL</th>
                  <th class="px-3 py-3 text-left hidden sm:table-cell">Username</th>
                  <th class="px-3 py-3 text-left">Status</th>
                  <th class="px-3 py-3 text-left hidden lg:table-cell">Last NTO</th>
                  <th class="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody id="${uid}TableBody">
                <tr><td colspan="7" class="px-3 py-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl block mb-2"></i>No accounts yet</td></tr>
              </tbody>
            </table>
          </div>
          <div id="${uid}BulkActions" class="hidden mt-4 pt-4 border-t border-gray-200">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm text-gray-600"><span id="${uid}SelectedCount">0</span> selected</span>
              <button onclick="startSelectedBots('${uid}')" class="bg-blue-600 text-white px-3 py-1.5 rounded text-xs hover:bg-blue-700"><i class="fas fa-play mr-1"></i>Start</button>
              <button onclick="stopSelectedBots('${uid}')" class="bg-orange-500 text-white px-3 py-1.5 rounded text-xs hover:bg-orange-600"><i class="fas fa-stop mr-1"></i>Stop</button>
              <button onclick="deleteSelectedAccounts('${uid}')" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700"><i class="fas fa-trash mr-1"></i>Delete</button>
            </div>
          </div>
        </div>

        <!-- Right Column -->
        <div class="space-y-6">
          <div class="bg-white rounded-xl shadow-sm p-6">
            <h3 class="font-bold mb-3"><i class="fas fa-clipboard-check mr-2 text-blue-500"></i>Recent NTO</h3>
            <div id="${uid}NtoList" class="space-y-2 max-h-48 overflow-y-auto">
              <p class="text-sm text-gray-400 text-center py-3">No results yet</p>
            </div>
          </div>
          <div class="bg-white rounded-xl shadow-sm p-6">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-bold"><i class="fas fa-terminal mr-2 text-green-500"></i>Log</h3>
              <button onclick="clearLog('${uid}Log')" class="text-xs text-gray-400 hover:text-gray-600">Clear</button>
            </div>
            <div id="${uid}Log" class="bg-gray-900 text-green-400 font-mono text-xs p-3 rounded-lg h-48 overflow-y-auto">
              <div class="text-gray-500">[Ready] Waiting for command...</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  try {
    const [statsRes, activityRes] = await Promise.all([
      api.dashboard.getStats(),
      api.dashboard.getActivity(15),
    ]);
    if (statsRes.success) {
      const d = statsRes.data;
      setText('statTotalAccounts', d.totalAccounts);
      setText('statActiveBots', d.activeAccounts);
      setText('statNtoToday', d.ntoChecksToday);

      for (const p of d.providers) {
        const k = p.provider.toLowerCase();
        setText(`dash${capitalize(k)}Accounts`, p.total);
        setText(`dash${capitalize(k)}Status`, `${p.active} active`);
        setText(`dash${capitalize(k)}LastNto`, p.lastNto || '-');
        setText(`nav${capitalize(k)}Count`, p.total);
      }

      renderProviderChart(d.providers);
    }
    if (activityRes.success) renderActivityList('recentActivityList', activityRes.data);

    // Load TARIKDB sidebar counts separately
    try {
      const tarikRes = await api.dashboard.getStats('TARIKDB');
      if (tarikRes.success) {
        for (const p of tarikRes.data.providers) {
          setText(`navTarikdb${capitalize(p.provider.toLowerCase())}Count`, p.total);
        }
      }
    } catch (e) { /* non-critical */ }

    // Update NTO-specific sidebar counts
    try {
      const ntoRes = await api.dashboard.getStats('NTO');
      if (ntoRes.success) {
        for (const p of ntoRes.data.providers) {
          setText(`nav${capitalize(p.provider.toLowerCase())}Count`, p.total);
        }
      }
    } catch (e) { /* non-critical */ }
  } catch (e) {
    console.error('Dashboard load error:', e);
  }
}

function renderProviderChart(providers) {
  const ctx = document.getElementById('providerChart')?.getContext('2d');
  if (!ctx) return;
  if (window._providerChart) window._providerChart.destroy();
  const data = providers.map(p => p.total);
  const hasData = data.some(v => v > 0);
  window._providerChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: providers.map(p => p.provider),
      datasets: [{ data: hasData ? data : [1, 1, 1], backgroundColor: ['#ef4444', '#eab308', '#22c55e'], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: isDarkMode() ? '#d1d5db' : '#374151' } } } },
  });
}

function renderActivityList(containerId, activities) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (activities.length === 0) {
    el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No activity yet</p>';
    return;
  }
  el.innerHTML = activities.map(a => {
    const colors = { success: 'text-green-500', warning: 'text-yellow-500', error: 'text-red-500', info: 'text-blue-500' };
    const icons = { success: 'fa-check-circle', warning: 'fa-exclamation-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const time = new Date(a.createdAt).toLocaleString();
    return `<div class="flex items-start gap-3 p-2 rounded hover:bg-gray-50 text-sm">
      <i class="fas ${icons[a.status] || icons.info} ${colors[a.status] || colors.info} mt-0.5"></i>
      <div class="flex-1 min-w-0">
        <p class="text-gray-700 truncate">${escapeHtml(a.details || a.action)}</p>
        <p class="text-xs text-gray-400">${time}${a.provider ? ` · ${a.provider}` : ''}</p>
      </div>
    </div>`;
  }).join('');
}

// ==================== PROVIDER ACCOUNTS ====================
async function loadProviderAccounts(provider, feature) {
  feature = feature || 'NTO';
  const uid = feature === 'TARIKDB' ? `TARIKDB_${provider}` : provider;
  const stateKey = feature === 'TARIKDB' ? 'tarikdbAccounts' : 'accounts';
  try {
    const res = await api.accounts.list(provider, feature);
    if (res.success) {
      state[stateKey][provider] = res.data;
      renderAccountsTable(uid, res.data, feature);
      updateProviderStats(uid, res.data);
    }
  } catch (e) {
    showNotification('Failed to load accounts: ' + e.message, 'error');
  }
}

function renderAccountsTable(uid, accounts, feature) {
  accounts = accounts || [];
  const tbody = document.getElementById(`${uid}TableBody`);
  if (!tbody) return;
  if (accounts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl block mb-2"></i>No accounts yet. Click "Add Account" to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = accounts.map(acc => {
    const statusCfg = getStatusConfig(acc.status);
    return `<tr class="hover:bg-gray-50 border-b border-gray-100" data-name="${escapeHtml(acc.name.toLowerCase())}">
      <td class="px-3 py-3"><input type="checkbox" class="${uid}-checkbox h-4 w-4 rounded" value="${acc.id}" onchange="updateSelectedCount('${uid}')"></td>
      <td class="px-3 py-3 font-medium">${escapeHtml(acc.name)}</td>
      <td class="px-3 py-3 text-xs text-gray-500 hidden md:table-cell max-w-[200px] truncate" title="${escapeHtml(acc.panelUrl)}">${escapeHtml(acc.panelUrl)}</td>
      <td class="px-3 py-3 hidden sm:table-cell">${escapeHtml(acc.username)}</td>
      <td class="px-3 py-3"><span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusCfg.classes}"><i class="fas ${statusCfg.icon} text-[10px]"></i>${statusCfg.label}</span></td>
      <td class="px-3 py-3 text-sm hidden lg:table-cell">${acc.lastNto || '<span class="text-gray-400">-</span>'}</td>
      <td class="px-3 py-3 text-right space-x-1">
        ${acc.status === 'running' || acc.status === 'checking_nto'
          ? `<button onclick="stopBot(${acc.id}, this)" class="text-orange-500 hover:text-orange-700 p-1" title="Stop"><i class="fas fa-stop"></i></button>`
          : `<button onclick="startBot(${acc.id}, this)" class="text-green-500 hover:text-green-700 p-1" title="Start"><i class="fas fa-play"></i></button>`
        }
        ${(acc.status === 'running' || acc.status === 'checking_nto') ? `<button onclick="showScreenshot(${acc.id})" class="text-purple-500 hover:text-purple-700 p-1" title="Screenshot"><i class="fas fa-camera"></i></button>` : ''}
        <button onclick="showEditModal(${acc.id}, '${uid}')" class="text-blue-500 hover:text-blue-700 p-1" title="Edit"><i class="fas fa-edit"></i></button>
        <button onclick="deleteAccount(${acc.id}, '${uid}')" class="text-red-400 hover:text-red-600 p-1" title="Delete"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function getStatusConfig(status) {
  const map = {
    idle: { label: 'Idle', icon: 'fa-circle', classes: 'bg-gray-100 text-gray-600' },
    starting: { label: 'Starting', icon: 'fa-spinner fa-spin', classes: 'bg-blue-100 text-blue-600' },
    logging_in: { label: 'Logging In', icon: 'fa-spinner fa-spin', classes: 'bg-indigo-100 text-indigo-600' },
    logged_in: { label: 'Logged In', icon: 'fa-check', classes: 'bg-teal-100 text-teal-600' },
    running: { label: 'Running', icon: 'fa-circle', classes: 'bg-green-100 text-green-700' },
    checking_nto: { label: 'Checking', icon: 'fa-spinner fa-spin', classes: 'bg-purple-100 text-purple-600' },
    waiting_otp: { label: 'OTP', icon: 'fa-key', classes: 'bg-amber-100 text-amber-700' },
    error: { label: 'Error', icon: 'fa-exclamation-triangle', classes: 'bg-red-100 text-red-600' },
    stopped: { label: 'Stopped', icon: 'fa-stop-circle', classes: 'bg-gray-200 text-gray-500' },
  };
  return map[status] || map.idle;
}

function updateProviderStats(uid, accounts) {
  accounts = accounts || [];
  const active = accounts.filter(a => ['running', 'checking_nto'].includes(a.status)).length;
  setText(`${uid}StatTotal`, accounts.length);
  setText(`${uid}StatActive`, active);
}

// ==================== ACCOUNT CRUD ====================

// Build proxy URL from type + "host:port:user:pass" format
function buildProxyUrl(type, raw) {
  const parts = raw.split(':');
  if (parts.length >= 4) {
    // host:port:user:pass
    const host = parts[0];
    const port = parts[1];
    const user = parts[2];
    const pass = parts.slice(3).join(':'); // password may contain ':'
    return `${type}://${user}:${pass}@${host}:${port}`;
  } else if (parts.length === 2) {
    // host:port (no auth)
    return `${type}://${parts[0]}:${parts[1]}`;
  }
  // fallback: treat as-is
  return `${type}://${raw}`;
}

// Parse stored proxy URL back to { type, raw } for display
function parseProxyUrl(url) {
  if (!url) return { type: 'http', raw: '' };
  const match = url.match(/^(https?|socks[45]):\/\/(?:([^:]+):([^@]+)@)?(.+)$/i);
  if (!match) return { type: 'http', raw: url };
  const type = match[1].toLowerCase();
  const user = match[2] || '';
  const pass = match[3] || '';
  const hostPort = match[4]; // host:port
  if (user && pass) {
    return { type, raw: `${hostPort}:${user}:${pass}` };
  }
  return { type, raw: hostPort };
}

window.toggleAddForm = function(provider) {
  document.getElementById(`${provider}AddForm`)?.classList.toggle('hidden');
};

// Parse uid to get { provider, feature }
function parseUid(uid) {
  if (uid.startsWith('TARIKDB_')) {
    return { provider: uid.replace('TARIKDB_', ''), feature: 'TARIKDB' };
  }
  return { provider: uid, feature: 'NTO' };
}

window.createAccount = async function(uid) {
  const { provider, feature } = parseUid(uid);
  const name = document.getElementById(`${uid}NewName`)?.value.trim();
  const panelUrl = document.getElementById(`${uid}NewPanelUrl`)?.value.trim();
  const username = document.getElementById(`${uid}NewUsername`)?.value.trim();
  const password = document.getElementById(`${uid}NewPassword`)?.value.trim();
  const pinCode = document.getElementById(`${uid}NewPinCode`)?.value.trim();
  const twoFaSecret = document.getElementById(`${uid}NewTwoFaSecret`)?.value.trim();
  const proxyRaw = document.getElementById(`${uid}NewProxy`)?.value.trim();
  const proxyType = document.getElementById(`${uid}NewProxyType`)?.value || 'http';
  const proxy = proxyRaw ? buildProxyUrl(proxyType, proxyRaw) : '';
  if (!name || !panelUrl || !username || !password) {
    showNotification('All fields are required', 'warning');
    return;
  }
  const payload = { provider, feature, name, panelUrl, username, password };
  if (pinCode) payload.pinCode = pinCode;
  if (twoFaSecret) payload.twoFaSecret = twoFaSecret;
  if (proxy) payload.proxy = proxy;
  try {
    await api.accounts.create(payload);
    showNotification(`Account "${name}" created`, 'success');
    document.getElementById(`${uid}NewName`).value = '';
    document.getElementById(`${uid}NewUsername`).value = '';
    document.getElementById(`${uid}NewPassword`).value = '';
    const pinInput = document.getElementById(`${uid}NewPinCode`);
    if (pinInput) pinInput.value = '';
    const twoFaInput = document.getElementById(`${uid}NewTwoFaSecret`);
    if (twoFaInput) twoFaInput.value = '';
    const proxyInput = document.getElementById(`${uid}NewProxy`);
    if (proxyInput) proxyInput.value = '';
    const proxyTypeSelect = document.getElementById(`${uid}NewProxyType`);
    if (proxyTypeSelect) proxyTypeSelect.value = 'http';
    toggleAddForm(uid);
    loadProviderAccounts(provider, feature);
    loadDashboard();
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.deleteAccount = function(id, uid) {
  showConfirmModal('Delete this account? This cannot be undone.', async () => {
    const { provider, feature } = parseUid(uid);
    try {
      await api.accounts.delete(id);
      showNotification('Account deleted', 'success');
      loadProviderAccounts(provider, feature);
      loadDashboard();
    } catch (e) {
      showNotification('Error: ' + e.message, 'error');
    }
  }, 'Delete Account');
};

// ==================== EDIT MODAL ====================
window.showEditModal = function(id, uid) {
  const { provider, feature } = parseUid(uid);
  const stateKey = feature === 'TARIKDB' ? 'tarikdbAccounts' : 'accounts';
  const acc = state[stateKey][provider]?.find(a => a.id === id);
  if (!acc) return;
  document.getElementById('editAccountId').value = acc.id;
  document.getElementById('editAccountProvider').value = uid;
  document.getElementById('editAccountName').value = acc.name;
  document.getElementById('editAccountPanelUrl').value = acc.panelUrl;
  document.getElementById('editAccountUsername').value = acc.username;
  document.getElementById('editAccountPassword').value = '';
  document.getElementById('editAccountPinCode').value = '';
  document.getElementById('editAccountTwoFaSecret').value = '';
  const proxyParsed = parseProxyUrl(acc.proxy);
  document.getElementById('editAccountProxyType').value = proxyParsed.type;
  document.getElementById('editAccountProxy').value = proxyParsed.raw;
  const pinGroup = document.getElementById('editPinCodeGroup');
  const twoFaGroup = document.getElementById('editTwoFaSecretGroup');
  if (provider === 'PAY4D' || uid.includes('PAY4D')) {
    pinGroup.classList.remove('hidden');
  } else {
    pinGroup.classList.add('hidden');
  }
  if (provider === 'NUKE' || uid.includes('NUKE')) {
    twoFaGroup.classList.remove('hidden');
  } else {
    twoFaGroup.classList.add('hidden');
  }
  // Show upline field for LIVEREPORT accounts
  const uplineGroup = document.getElementById('editUplineGroup');
  const uplineInput = document.getElementById('editAccountUpline');
  if (uplineGroup && uplineInput) {
    if (acc.uplineUsername || feature === 'LIVEREPORT') {
      uplineGroup.classList.remove('hidden');
      uplineInput.value = acc.uplineUsername || '';
    } else {
      uplineGroup.classList.add('hidden');
      uplineInput.value = '';
    }
  }
  document.getElementById('editAccountModal').classList.remove('hidden');
};

window.hideEditModal = function() {
  document.getElementById('editAccountModal').classList.add('hidden');
};

window.saveAccountEdit = async function() {
  const id = document.getElementById('editAccountId').value;
  const uid = document.getElementById('editAccountProvider').value;
  const { provider, feature } = parseUid(uid);
  const data = {
    name: document.getElementById('editAccountName').value.trim(),
    panelUrl: document.getElementById('editAccountPanelUrl').value.trim(),
    username: document.getElementById('editAccountUsername').value.trim(),
  };
  const password = document.getElementById('editAccountPassword').value;
  if (password) data.password = password;
  const pinCode = document.getElementById('editAccountPinCode').value;
  if (pinCode) data.pinCode = pinCode;
  const twoFaSecret = document.getElementById('editAccountTwoFaSecret').value.trim();
  if (twoFaSecret) data.twoFaSecret = twoFaSecret;
  const editProxyRaw = document.getElementById('editAccountProxy').value.trim();
  const editProxyType = document.getElementById('editAccountProxyType').value || 'http';
  data.proxy = editProxyRaw ? buildProxyUrl(editProxyType, editProxyRaw) : '';
  const uplineVal = document.getElementById('editAccountUpline')?.value?.trim();
  if (uplineVal !== undefined) data.uplineUsername = uplineVal || '';
  if (!data.name) { showNotification('Name is required', 'warning'); return; }
  try {
    await api.accounts.update(id, data);
    showNotification('Account updated', 'success');
    hideEditModal();
    loadProviderAccounts(provider, feature);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

// ==================== BOT CONTROLS ====================
window.startBot = async function(accountId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    await api.bot.start(accountId);
    showNotification('Bot starting...', 'info');
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
  if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-play"></i>'; }
};

window.stopBot = async function(accountId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    await api.bot.stop(accountId);
    showNotification('Bot stopped', 'info');
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
  if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-stop"></i>'; }
};

window.startAllBots = function(provider) {
  showConfirmModal(`Start all bots for ${provider}?`, async () => {
    try {
      const res = await api.bot.startAll(provider);
      showNotification(res.message || 'Starting all bots...', 'success');
    } catch (e) { showNotification('Error: ' + e.message, 'error'); }
  }, 'Start All Bots');
};

window.stopAllBots = function(provider) {
  showConfirmModal(`Stop all bots for ${provider}?`, async () => {
    try {
      await api.bot.stopAll(provider);
      showNotification('All bots stopped', 'warning');
      loadProviderAccounts(provider);
    } catch (e) { showNotification('Error: ' + e.message, 'error'); }
  }, 'Stop All Bots');
};

// ==================== BULK SELECTION ====================
window.toggleSelectAll = function(provider) {
  const selectAll = document.getElementById(`${provider}SelectAll`);
  document.querySelectorAll(`.${provider}-checkbox`).forEach(cb => cb.checked = selectAll.checked);
  updateSelectedCount(provider);
};

window.updateSelectedCount = function(provider) {
  const checked = document.querySelectorAll(`.${provider}-checkbox:checked`).length;
  setText(`${provider}SelectedCount`, checked);
  const bulk = document.getElementById(`${provider}BulkActions`);
  if (bulk) checked > 0 ? bulk.classList.remove('hidden') : bulk.classList.add('hidden');
};

window.startSelectedBots = async function(uid) {
  const ids = getSelectedIds(uid);
  for (const id of ids) await api.bot.start(id);
  showNotification(`Starting ${ids.length} bots...`, 'info');
};

window.stopSelectedBots = async function(uid) {
  const ids = getSelectedIds(uid);
  const { provider, feature } = parseUid(uid);
  for (const id of ids) await api.bot.stop(id);
  showNotification(`Stopping ${ids.length} bots...`, 'info');
  setTimeout(() => loadProviderAccounts(provider, feature), 1500);
};

window.deleteSelectedAccounts = function(uid) {
  const ids = getSelectedIds(uid);
  const { provider, feature } = parseUid(uid);
  showConfirmModal(`Delete ${ids.length} accounts? This cannot be undone.`, async () => {
    try {
      await api.accounts.bulkDelete(ids);
      showNotification(`${ids.length} accounts deleted`, 'success');
      loadProviderAccounts(provider, feature);
      loadDashboard();
    } catch (e) { showNotification('Error: ' + e.message, 'error'); }
  }, 'Delete Accounts');
};

function getSelectedIds(uid) {
  return Array.from(document.querySelectorAll(`.${uid}-checkbox:checked`)).map(cb => Number(cb.value));
}

window.filterAccounts = function(uid) {
  const query = (document.getElementById(`${uid}Search`)?.value || '').toLowerCase();
  document.querySelectorAll(`#${uid}TableBody tr`).forEach(row => {
    const name = row.dataset.name || '';
    row.style.display = !query || name.includes(query) ? '' : 'none';
  });
};

// ==================== OTP MODAL ====================
window.showOtpModal = function(accountId, accountName) {
  document.getElementById('otpAccountId').value = accountId;
  document.getElementById('otpAccountName').textContent = accountName;
  document.getElementById('otpInput').value = '';
  document.getElementById('otpModal').classList.remove('hidden');
  document.getElementById('otpInput').focus();
};

window.hideOtpModal = function() {
  document.getElementById('otpModal').classList.add('hidden');
};

window.submitOtp = async function() {
  const accountId = Number(document.getElementById('otpAccountId').value);
  const otp = document.getElementById('otpInput').value.trim();
  if (!otp) { showNotification('Enter OTP', 'warning'); return; }
  try {
    await api.bot.submitOtp(accountId, otp);
    showNotification('OTP submitted', 'success');
    hideOtpModal();
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

// ==================== SCREENSHOT ====================
window.showScreenshot = function(accountId) {
  let modal = document.getElementById('screenshotModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'screenshotModal';
    document.body.appendChild(modal);
  }
  const url = api.bot.screenshotUrl(accountId) + '?t=' + Date.now();
  modal.innerHTML = `<div class="fixed inset-0 bg-black bg-opacity-60 z-[70] flex items-center justify-center p-4" onclick="this.parentElement.classList.add('hidden')">
    <div class="bg-white rounded-xl shadow-xl max-w-4xl w-full p-4" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-lg">Screenshot — Account #${accountId}</h3>
        <div class="flex gap-2">
          <button onclick="showScreenshot(${accountId})" class="text-blue-500 hover:text-blue-700 text-sm"><i class="fas fa-sync mr-1"></i>Refresh</button>
          <button onclick="document.getElementById('screenshotModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-xl"></i></button>
        </div>
      </div>
      <img src="${url}" class="w-full rounded-lg border" onerror="this.src='';this.alt='Screenshot not available'" alt="Browser screenshot">
    </div>
  </div>`;
  modal.classList.remove('hidden');
};

// ==================== NTO RESULTS ====================
const ntoState = { page: 1, pageSize: 25, total: 0, filter: '' };

window.loadNtoResults = async function() {
  try {
    const provider = document.getElementById('ntoFilterProvider')?.value || '';
    const search = document.getElementById('ntoSearchAccount')?.value?.toLowerCase() || '';
    ntoState.filter = search;
    const offset = (ntoState.page - 1) * ntoState.pageSize;
    const res = await api.nto.list(provider, ntoState.pageSize, offset);
    if (res.success) {
      ntoState.total = res.total || res.data.length;
      const filtered = search ? res.data.filter(r => (r.account?.name || '').toLowerCase().includes(search)) : res.data;
      renderNtoTable(filtered);
      renderNtoPagination();
    }
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.setNtoPageSize = function(size) {
  ntoState.pageSize = Number(size);
  ntoState.page = 1;
  loadNtoResults();
};

window.ntoPage = function(dir) {
  const maxPage = Math.ceil(ntoState.total / ntoState.pageSize) || 1;
  ntoState.page = Math.max(1, Math.min(maxPage, ntoState.page + dir));
  loadNtoResults();
};

function renderNtoPagination() {
  const el = document.getElementById('ntoPagination');
  if (!el) return;
  const maxPage = Math.ceil(ntoState.total / ntoState.pageSize) || 1;
  el.innerHTML = `<div class="flex items-center justify-between text-sm text-gray-500 mt-3">
    <div class="flex items-center gap-2">
      <span>Rows:</span>
      <select onchange="setNtoPageSize(this.value)" class="border border-gray-300 rounded px-2 py-1 text-xs">
        ${[10,25,50,100].map(n => `<option value="${n}" ${n===ntoState.pageSize?'selected':''}>${n}</option>`).join('')}
      </select>
      <span class="ml-2">${ntoState.total} results</span>
    </div>
    <div class="flex items-center gap-2">
      <button onclick="ntoPage(-1)" class="px-2 py-1 rounded hover:bg-gray-100 ${ntoState.page<=1?'opacity-30':''}"><i class="fas fa-chevron-left"></i></button>
      <span>${ntoState.page} / ${maxPage}</span>
      <button onclick="ntoPage(1)" class="px-2 py-1 rounded hover:bg-gray-100 ${ntoState.page>=maxPage?'opacity-30':''}"><i class="fas fa-chevron-right"></i></button>
    </div>
  </div>`;
}

function renderNtoTable(results) {
  const tbody = document.getElementById('ntoResultsTableBody');
  if (!tbody) return;
  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No NTO results</td></tr>';
    return;
  }
  tbody.innerHTML = results.map(r => {
    const providerColor = { NUKE: 'red', VICTORY: 'yellow', PAY4D: 'green' }[r.provider] || 'gray';
    return `<tr class="hover:bg-gray-50 border-b border-gray-100">
      <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-xs font-medium bg-${providerColor}-100 text-${providerColor}-700">${r.provider}</span></td>
      <td class="px-4 py-3 text-sm">${escapeHtml(r.account?.name || '-')}</td>
      <td class="px-4 py-3 font-mono font-medium">${escapeHtml(r.value)}</td>
      <td class="px-4 py-3 text-sm text-gray-500">${new Date(r.checkedAt).toLocaleString()}</td>
      <td class="px-4 py-3 text-right space-x-1">
        <button onclick="exportNtoResult(${r.accountId}, ${r.id}, this)" class="text-green-500 hover:text-green-700 p-1" title="Export Excel"><i class="fas fa-file-excel"></i></button>
        <button onclick="sendNtoTelegram(${r.accountId}, ${r.id}, this)" class="text-blue-500 hover:text-blue-700 p-1" title="Send Telegram"><i class="fab fa-telegram"></i></button>
      </td>
    </tr>`;
  }).join('');
}

window.exportNtoResult = async function(accountId, resultId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const res = await api.nto.exportExcel(accountId, resultId);
    if (res.success && res.data?.filename) {
      showNotification('Exported: ' + res.data.filename, 'success');
      window.open(api.getBaseUrl() + '/nto/download/' + res.data.filename, '_blank');
    } else {
      showNotification('Export done', 'success');
    }
  } catch (e) { showNotification('Export error: ' + e.message, 'error'); }
  if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-file-excel"></i>'; }
};

window.sendNtoTelegram = async function(accountId, resultId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    await api.nto.sendTelegram(accountId, resultId);
    showNotification('Sent to Telegram', 'success');
  } catch (e) { showNotification('Telegram error: ' + e.message, 'error'); }
  if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fab fa-telegram"></i>'; }
};

// ==================== BOT ACTIVITY ====================
window.loadActivity = async function() {
  try {
    const res = await api.dashboard.getActivity(100);
    if (res.success) {
      let data = res.data;
      const provFilter = document.getElementById('activityFilterProvider')?.value;
      const statusFilter = document.getElementById('activityFilterStatus')?.value;
      if (provFilter) data = data.filter(a => a.provider === provFilter);
      if (statusFilter) data = data.filter(a => a.status === statusFilter);
      renderActivityList('activityHistoryList', data);
    }
  } catch (e) { console.error(e); }
};

window.loadActiveBots = async function() {
  try {
    const res = await api.bot.status();
    if (res.success) {
      const el = document.getElementById('activeBotsList');
      if (!el) return;
      if (res.data.length === 0) {
        el.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No active bots</p>';
        return;
      }
      el.innerHTML = res.data.map(b => {
        const cfg = getStatusConfig(b.status);
        return `<div class="flex items-center justify-between p-2 rounded border border-gray-100">
          <div class="flex items-center gap-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${cfg.classes}"><i class="fas ${cfg.icon} text-[10px]"></i>${cfg.label}</span><span class="text-sm font-medium">${escapeHtml(b.name)}</span></div>
          <span class="text-xs text-gray-400">${b.provider}</span>
        </div>`;
      }).join('');
    }
  } catch (e) { console.error(e); }
};

// ==================== SETTINGS ====================
async function loadSettings() {
  try {
    const [settingsRes, healthRes] = await Promise.all([
      api.settings.list(),
      api.system.health(),
    ]);
    if (settingsRes.success) {
      for (const s of settingsRes.data) {
        switch (s.key) {
          case 'browser.headless': setCheckbox('settingHeadless', s.value === 'true'); break;
          case 'browser.slowMo': setInput('settingSlowMo', s.value); break;
          case 'nto.autoCheck': setCheckbox('settingAutoCheck', s.value === 'true'); break;
          case 'nto.checkInterval': setInput('settingCheckInterval', s.value); break;
          case 'notification.telegramBotToken': setInput('settingTelegramToken', s.value); break;
          case 'notification.telegramChatId': setInput('settingTelegramChatId', s.value); break;
          case 'notification.telegramChatIdTarikDb': setInput('settingTelegramChatIdTarikDb', s.value); break;
          case 'notification.adminUserIds': {
            try {
              const ids = JSON.parse(s.value || '[]');
              setInput('settingAdminUserIds', Array.isArray(ids) ? ids.join(', ') : '');
            } catch { setInput('settingAdminUserIds', ''); }
            break;
          }
          case 'updater.url': setInput('settingUpdaterUrl', s.value); break;
          case 'captcha_api_key': setInput('settingCaptchaApiKey', s.value); if (s.value) load2CaptchaBalance(); break;
        }
      }
      // Check unified Telegram listener status
      checkTelegramStatus();
    }
    if (healthRes.success) {
      const uptime = Math.floor(healthRes.data.uptime);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      setText('settingUptime', `${h}h ${m}m`);
      setText('statUptime', `${h}h ${m}m`);
    }
    // Load version from /api
    try {
      const infoRes = await api.system.info();
      if (infoRes.success) setText('settingVersion', infoRes.data.version || '-');
    } catch {}
  } catch (e) { console.error(e); }
}

window.saveSetting = async function(key, value) {
  try {
    await api.settings.update(key, value);
    showNotification('Setting saved', 'success', 1500);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.saveAdminUserIds = async function(value) {
  try {
    const ids = value.split(',').map(s => s.trim()).filter(s => s.length > 0).map(Number).filter(n => !isNaN(n));
    await api.settings.update('notification.adminUserIds', JSON.stringify(ids), 'json');
    showNotification(`Admin User IDs saved (${ids.length} ID)`, 'success', 1500);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

// ==================== TELEGRAM LISTENER ====================
window.checkTelegramStatus = async function() {
  const dot = document.getElementById('telegramStatusDot');
  const text = document.getElementById('telegramStatusText');
  const btn = document.getElementById('telegramToggleBtn');
  if (!dot || !text || !btn) return;

  try {
    const res = await api.get('/settings/telegram/status');
    if (res.success && res.data.running) {
      dot.className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
      text.textContent = 'Running — listening for commands (NTO + TARIK DB)';
      text.className = 'text-xs text-green-600';
      btn.innerHTML = '<i class="fas fa-stop mr-1"></i>Stop';
      btn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700';
      btn.dataset.running = 'true';
    } else {
      dot.className = 'w-3 h-3 rounded-full bg-gray-400';
      text.textContent = 'Stopped';
      text.className = 'text-xs text-gray-500';
      btn.innerHTML = '<i class="fas fa-play mr-1"></i>Start';
      btn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700';
      btn.dataset.running = 'false';
    }
  } catch (e) {
    dot.className = 'w-3 h-3 rounded-full bg-red-500';
    text.textContent = 'Error checking status';
    text.className = 'text-xs text-red-500';
  }
};

window.toggleTelegramListener = async function() {
  const btn = document.getElementById('telegramToggleBtn');
  const isRunning = btn?.dataset.running === 'true';

  try {
    if (isRunning) {
      await api.post('/settings/telegram/stop');
      showNotification('Telegram listener stopped', 'warning');
    } else {
      await api.post('/settings/telegram/start');
      showNotification('Telegram listener started', 'success');
    }
    // Refresh status after toggle
    setTimeout(() => checkTelegramStatus(), 500);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

// ==================== TARIK DB SCHEDULER ====================
async function loadSchedulerSettings() {
  try {
    const settingsRes = await api.settings.list();
    if (!settingsRes.success) return;

    for (const s of settingsRes.data) {
      switch (s.key) {
        case 'tarikdb.scheduler.enabled': setCheckbox('settingSchedulerEnabled', s.value === 'true'); break;
        case 'tarikdb.scheduler.time': setInput('settingSchedulerTime', s.value || '08:00'); break;
      }
    }

    // Load TARIKDB accounts for checkbox list
    const accountsRes = await api.accounts.list(undefined, 'TARIKDB');
    const accountList = document.getElementById('schedulerAccountList');
    if (!accountList) return;

    const accounts = accountsRes.success ? accountsRes.data : [];
    if (accounts.length === 0) {
      accountList.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">Belum ada akun TARIK DB</p>';
      return;
    }

    // Get selected account IDs
    let selectedIds = [];
    const idsSetting = settingsRes.data.find(s => s.key === 'tarikdb.scheduler.accountIds');
    try { selectedIds = JSON.parse(idsSetting?.value || '[]'); } catch { selectedIds = []; }

    accountList.innerHTML = accounts.map(acc => {
      const checked = selectedIds.includes(acc.id) ? 'checked' : '';
      const provColor = { NUKE: 'red', VICTORY: 'yellow', PAY4D: 'green' }[acc.provider] || 'gray';
      return `<label class="scheduler-account-row flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer" data-name="${escapeHtml(acc.name.toLowerCase())}">
        <input type="checkbox" class="scheduler-account-cb h-4 w-4 rounded text-indigo-600" value="${acc.id}" ${checked} onchange="saveSchedulerAccounts()">
        <span class="flex-1 text-sm truncate">${escapeHtml(acc.name)}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-${provColor}-100 text-${provColor}-700 shrink-0">${acc.provider}</span>
      </label>`;
    }).join('');

    updateSchedulerCounter();

    // Check scheduler status
    checkSchedulerStatus();
  } catch (e) {
    console.error('loadSchedulerSettings error:', e);
  }
}

window.saveSchedulerAccounts = async function() {
  const ids = Array.from(document.querySelectorAll('.scheduler-account-cb:checked')).map(cb => Number(cb.value));
  updateSchedulerCounter();
  try {
    await api.settings.update('tarikdb.scheduler.accountIds', JSON.stringify(ids));
    showNotification(`${ids.length} akun dipilih untuk scheduler`, 'success', 1500);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.filterSchedulerAccounts = function() {
  const query = (document.getElementById('schedulerAccountSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.scheduler-account-row').forEach(row => {
    row.style.display = !query || row.dataset.name.includes(query) ? '' : 'none';
  });
};

window.selectAllSchedulerAccounts = function(selectAll) {
  const query = (document.getElementById('schedulerAccountSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.scheduler-account-row').forEach(row => {
    if (!query || row.dataset.name.includes(query)) {
      const cb = row.querySelector('.scheduler-account-cb');
      if (cb) cb.checked = selectAll;
    }
  });
  saveSchedulerAccounts();
};

function updateSchedulerCounter() {
  const total = document.querySelectorAll('.scheduler-account-cb').length;
  const checked = document.querySelectorAll('.scheduler-account-cb:checked').length;
  const el = document.getElementById('schedulerAccountCounter');
  if (el) el.textContent = `${checked}/${total} dipilih`;
}

window.checkSchedulerStatus = async function() {
  const dot = document.getElementById('schedulerStatusDot');
  const text = document.getElementById('schedulerStatusText');
  const btn = document.getElementById('schedulerToggleBtn');
  const lastRunText = document.getElementById('schedulerLastRunText');
  if (!dot || !text || !btn) return;

  try {
    const res = await api.get('/settings/tarikdb-scheduler/status');
    if (res.success) {
      const d = res.data;
      if (d.running) {
        dot.className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
        text.textContent = d.executing ? 'Running — sedang memproses...' : `Running — check jam ${d.scheduledTime}`;
        text.className = 'text-xs text-green-600';
        btn.innerHTML = '<i class="fas fa-stop mr-1"></i>Stop';
        btn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700';
        btn.dataset.running = 'true';
      } else {
        dot.className = 'w-3 h-3 rounded-full bg-gray-400';
        text.textContent = 'Stopped';
        text.className = 'text-xs text-gray-500';
        btn.innerHTML = '<i class="fas fa-play mr-1"></i>Start';
        btn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700';
        btn.dataset.running = 'false';
      }

      // Show last run info
      if (lastRunText) {
        if (d.lastRun) {
          const ts = new Date(d.lastRun.timestamp).toLocaleString('id-ID');
          const summary = d.lastRun.summary || '-';
          lastRunText.innerHTML = `<div class="p-3 bg-indigo-50 rounded-lg text-indigo-700"><p class="font-medium mb-1">${ts} <span class="text-indigo-400">(${d.lastRun.date})</span></p><p class="text-xs whitespace-pre-line">${escapeHtml(summary)}</p></div>`;
        } else {
          lastRunText.innerHTML = '<p class="text-gray-400 text-center py-3">Belum pernah dijalankan</p>';
        }
      }
    }
  } catch (e) {
    dot.className = 'w-3 h-3 rounded-full bg-red-500';
    text.textContent = 'Error checking status';
    text.className = 'text-xs text-red-500';
  }
};

window.toggleScheduler = async function() {
  const btn = document.getElementById('schedulerToggleBtn');
  const isRunning = btn?.dataset.running === 'true';

  try {
    if (isRunning) {
      await api.post('/settings/tarikdb-scheduler/stop');
      showNotification('Scheduler stopped', 'warning');
    } else {
      await api.post('/settings/tarikdb-scheduler/start');
      showNotification('Scheduler started', 'success');
    }
    setTimeout(() => checkSchedulerStatus(), 500);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.runSchedulerNow = function() {
  showConfirmModal('Run TARIK DB check sekarang? (H+1 = tanggal kemarin)', async () => {
    try {
      const res = await api.post('/settings/tarikdb-scheduler/run-now');
      showNotification(res.message || 'Scheduler triggered!', 'success');
      setTimeout(() => checkSchedulerStatus(), 2000);
    } catch (e) {
      showNotification('Error: ' + e.message, 'error');
    }
  }, 'Run Scheduler');
};

// ==================== LIVE REPORT SCHEDULER ====================
async function loadLiveReportSchedulerSettings() {
  try {
    const settingsRes = await api.settings.list();
    if (!settingsRes.success) return;

    for (const s of settingsRes.data) {
      switch (s.key) {
        case 'livereport.scheduler.enabled': setCheckbox('lrSchedulerEnabled', s.value === 'true'); break;
        case 'livereport.scheduler.interval': setInput('lrInterval', s.value || '60'); break;
        case 'livereport.scheduler.dailyRecapTime': setInput('lrDailyRecapTime', s.value || '00:10'); break;
        case 'livereport.scheduler.weeklyRecap': setCheckbox('lrWeeklyRecap', s.value !== 'false'); break;
        case 'livereport.scheduler.monthlyRecap': setCheckbox('lrMonthlyRecap', s.value !== 'false'); break;
        case 'notification.telegramChatIdLiveReport': setInput('lrTelegramChatId', s.value || ''); break;
        case 'notification.telegramBotTokenLiveReport': setInput('lrTelegramBotToken', s.value || ''); break;
      }
    }

    // Load LIVEREPORT accounts
    const accountsRes = await api.accounts.list(undefined, 'LIVEREPORT');
    const accountList = document.getElementById('lrAccountList');
    if (!accountList) return;

    const accounts = accountsRes.success ? accountsRes.data : [];
    if (accounts.length === 0) {
      accountList.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">Belum ada akun LIVE REPORT. Buat akun Victory dengan feature LIVEREPORT.</p>';
      updateLrCounter();
      checkLiveReportSchedulerStatus();
      return;
    }

    let selectedIds = [];
    const idsSetting = settingsRes.data.find(s => s.key === 'livereport.scheduler.accountIds');
    try { selectedIds = JSON.parse(idsSetting?.value || '[]'); } catch { selectedIds = []; }

    accountList.innerHTML = accounts.map(acc => {
      const checked = selectedIds.includes(acc.id) ? 'checked' : '';
      return `<div class="lr-account-row flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50" data-name="${escapeHtml(acc.name.toLowerCase())}">
        <input type="checkbox" class="lr-account-cb h-4 w-4 rounded text-emerald-600" value="${acc.id}" ${checked} onchange="saveLiveReportAccounts()">
        <span class="text-sm truncate min-w-0 flex-shrink-0" style="max-width:120px">${escapeHtml(acc.name)}</span>
        <input type="text" class="lr-upline-input flex-1 px-2 py-0.5 border border-gray-200 rounded text-xs" value="${escapeHtml(acc.uplineUsername || '')}" placeholder="teammkt,teamreborn" data-account-id="${acc.id}" onchange="saveLrUpline(this)">
      </div>`;
    }).join('');

    updateLrCounter();
    checkLiveReportSchedulerStatus();
  } catch (e) {
    console.error('loadLiveReportSchedulerSettings error:', e);
  }
}

window.saveLiveReportAccounts = async function() {
  const ids = Array.from(document.querySelectorAll('.lr-account-cb:checked')).map(cb => Number(cb.value));
  updateLrCounter();
  try {
    await api.settings.update('livereport.scheduler.accountIds', JSON.stringify(ids));
    showNotification(`${ids.length} akun dipilih untuk Live Report`, 'success', 1500);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.saveLrUpline = async function(input) {
  const accountId = Number(input.dataset.accountId);
  const upline = input.value.trim();
  try {
    await api.accounts.update(accountId, { uplineUsername: upline });
    showNotification(`Upline updated: ${upline || '(kosong)'}`, 'success', 1500);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.filterLiveReportAccounts = function() {
  const query = (document.getElementById('lrAccountSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.lr-account-row').forEach(row => {
    row.style.display = !query || row.dataset.name.includes(query) ? '' : 'none';
  });
};

window.selectAllLiveReportAccounts = function(selectAll) {
  const query = (document.getElementById('lrAccountSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.lr-account-row').forEach(row => {
    if (!query || row.dataset.name.includes(query)) {
      const cb = row.querySelector('.lr-account-cb');
      if (cb) cb.checked = selectAll;
    }
  });
  saveLiveReportAccounts();
};

function updateLrCounter() {
  const total = document.querySelectorAll('.lr-account-cb').length;
  const checked = document.querySelectorAll('.lr-account-cb:checked').length;
  const el = document.getElementById('lrSelectedCount');
  if (el) el.textContent = `${checked}/${total} dipilih`;
}

window.saveLiveReportSettings = async function() {
  try {
    const enabled = document.getElementById('lrSchedulerEnabled')?.checked;
    const interval = document.getElementById('lrInterval')?.value || '60';
    const dailyTime = document.getElementById('lrDailyRecapTime')?.value || '00:10';
    const weeklyRecap = document.getElementById('lrWeeklyRecap')?.checked;
    const monthlyRecap = document.getElementById('lrMonthlyRecap')?.checked;
    const chatId = document.getElementById('lrTelegramChatId')?.value || '';
    const botToken = document.getElementById('lrTelegramBotToken')?.value || '';

    await Promise.all([
      api.settings.update('livereport.scheduler.enabled', String(!!enabled)),
      api.settings.update('livereport.scheduler.interval', interval),
      api.settings.update('livereport.scheduler.dailyRecapTime', dailyTime),
      api.settings.update('livereport.scheduler.weeklyRecap', String(!!weeklyRecap)),
      api.settings.update('livereport.scheduler.monthlyRecap', String(!!monthlyRecap)),
      api.settings.update('notification.telegramChatIdLiveReport', chatId),
      api.settings.update('notification.telegramBotTokenLiveReport', botToken),
    ]);

    showNotification('Settings saved', 'success', 1500);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.checkLiveReportSchedulerStatus = async function() {
  const statusEl = document.getElementById('lrSchedulerStatus');
  const lastRunEl = document.getElementById('lrLastRun');
  const btn = document.getElementById('lrSchedulerToggleBtn');
  if (!statusEl || !btn) return;

  try {
    const res = await api.get('/settings/livereport-scheduler/status');
    if (res.success) {
      const d = res.data;
      if (d.running) {
        statusEl.textContent = d.executing ? 'Executing...' : 'Running';
        statusEl.className = 'text-xs px-2 py-1 rounded-full bg-green-100 text-green-700';
        btn.innerHTML = '<i class="fas fa-stop mr-1"></i>Stop';
        btn.className = 'px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium';
        btn.dataset.running = 'true';
      } else {
        statusEl.textContent = 'Stopped';
        statusEl.className = 'text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-600';
        btn.innerHTML = '<i class="fas fa-play mr-1"></i>Start';
        btn.className = 'px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium';
        btn.dataset.running = 'false';
      }

      if (lastRunEl && d.lastRun) {
        const ts = new Date(d.lastRun.timestamp).toLocaleString('id-ID');
        lastRunEl.innerHTML = `<span class="text-emerald-600">Last run: ${ts}</span>`;
      }
    }
  } catch (e) {
    statusEl.textContent = 'Error';
    statusEl.className = 'text-xs px-2 py-1 rounded-full bg-red-100 text-red-700';
  }
};

window.toggleLiveReportScheduler = async function() {
  const btn = document.getElementById('lrSchedulerToggleBtn');
  const isRunning = btn?.dataset.running === 'true';

  try {
    if (isRunning) {
      await api.post('/settings/livereport-scheduler/stop');
      showNotification('Live Report scheduler stopped', 'warning');
    } else {
      await api.post('/settings/livereport-scheduler/start');
      showNotification('Live Report scheduler started', 'success');
    }
    setTimeout(() => checkLiveReportSchedulerStatus(), 500);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.runLiveReportNow = function() {
  showConfirmModal('Run Live Report sekarang?', async () => {
    try {
      const res = await api.post('/settings/livereport-scheduler/run-now');
      showNotification(res.message || 'Live Report triggered!', 'success');
      setTimeout(() => checkLiveReportSchedulerStatus(), 2000);
    } catch (e) {
      showNotification('Error: ' + e.message, 'error');
    }
  }, 'Run Live Report');
};

window.toggleLrAddForm = function() {
  document.getElementById('lrAddForm')?.classList.toggle('hidden');
};

window.createLrAccount = async function() {
  const name = document.getElementById('lrNewName')?.value.trim();
  const panelUrl = document.getElementById('lrNewPanelUrl')?.value.trim();
  const username = document.getElementById('lrNewUsername')?.value.trim();
  const password = document.getElementById('lrNewPassword')?.value.trim();
  const uplineUsername = document.getElementById('lrNewUpline')?.value.trim();

  if (!name || !panelUrl || !username || !password || !uplineUsername) {
    showNotification('Semua field wajib diisi', 'warning');
    return;
  }

  try {
    await api.accounts.create({
      provider: 'VICTORY',
      feature: 'LIVEREPORT',
      name,
      panelUrl,
      username,
      password,
      uplineUsername,
    });
    showNotification(`Account "${name}" created`, 'success');
    document.getElementById('lrNewName').value = '';
    document.getElementById('lrNewUsername').value = '';
    document.getElementById('lrNewPassword').value = '';
    document.getElementById('lrNewUpline').value = '';
    toggleLrAddForm();
    loadLiveReportSchedulerSettings();
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.load2CaptchaBalance = async function() {
  const box = document.getElementById('captchaBalanceBox');
  const val = document.getElementById('captchaBalanceValue');
  if (!box || !val) return;

  box.classList.remove('hidden');
  val.textContent = '...';
  val.className = 'text-lg font-bold text-gray-400';

  try {
    const res = await api.get('/settings/captcha/balance');
    if (res.success && res.data.balance !== null) {
      val.textContent = `$${res.data.balance.toFixed(2)}`;
      val.className = res.data.balance > 1
        ? 'text-lg font-bold text-green-600'
        : 'text-lg font-bold text-red-500';
    } else {
      val.textContent = res.data.error || 'Error';
      val.className = 'text-lg font-bold text-red-500';
    }
  } catch (e) {
    val.textContent = 'Failed';
    val.className = 'text-lg font-bold text-red-500';
  }

  // Also load history
  loadCaptchaHistory();
};

window.toggleCaptchaHistory = function() {
  const content = document.getElementById('captchaHistoryContent');
  const icon = document.getElementById('captchaHistoryToggleIcon');
  if (!content) return;
  const isHidden = content.classList.toggle('hidden');
  if (icon) icon.style.transform = isHidden ? '' : 'rotate(180deg)';
};

async function loadCaptchaHistory() {
  const section = document.getElementById('captchaHistorySection');
  const tbody = document.getElementById('captchaHistoryBody');
  if (!section || !tbody) return;

  try {
    const res = await api.get('/settings/captcha/history?limit=20');
    if (!res.success) return;

    section.classList.remove('hidden');

    const { records, stats } = res.data;

    // Update stats
    const elSolves = document.getElementById('captchaStatsSolves');
    const elCost = document.getElementById('captchaStatsCost');
    const elAvg = document.getElementById('captchaStatsAvg');
    if (elSolves) elSolves.textContent = stats.totalSolves;
    if (elCost) elCost.textContent = stats.totalCost.toFixed(2);
    if (elAvg) elAvg.textContent = stats.avgCost.toFixed(3);

    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-400">Belum ada data</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => {
      const date = new Date(r.createdAt);
      const timeStr = date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' }) + ' ' +
                      date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const statusColor = r.status === 'success' ? 'bg-green-100 text-green-700'
                        : r.status === 'invalid' ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700';
      const costStr = r.cost > 0 ? `-$${r.cost.toFixed(4)}` : '$0';
      const costColor = r.cost > 0 ? 'text-red-500' : 'text-gray-400';
      const acctLabel = r.accountId ? `#${r.accountId}` : '-';
      const resultStr = r.result ? (r.result.length > 20 ? r.result.substring(0, 20) + '...' : r.result) : '-';

      return `<tr class="hover:bg-gray-50">
        <td class="p-2 text-gray-600 whitespace-nowrap">${timeStr}</td>
        <td class="p-2 text-gray-600">${acctLabel}${r.provider ? ' <span class="text-purple-500">'+r.provider+'</span>' : ''}</td>
        <td class="p-2 font-mono text-gray-700">${resultStr}</td>
        <td class="p-2 text-right font-mono ${costColor}">${costStr}</td>
        <td class="p-2 text-right font-mono text-gray-600">$${r.balanceAfter.toFixed(2)}</td>
        <td class="p-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor}">${r.status}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    // Silently fail - history is non-critical
  }
}

// ==================== LOG ====================
window.clearLog = function(logId) {
  const el = document.getElementById(logId);
  if (el) el.innerHTML = '<div class="text-gray-500">[Ready] Waiting...</div>';
};

function addLog(logId, message, type = 'info') {
  const el = document.getElementById(logId);
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  const colors = { info: 'text-green-400', success: 'text-cyan-400', warning: 'text-yellow-400', error: 'text-red-400' };
  el.innerHTML += `<div class="${colors[type] || colors.info}">[${time}] ${escapeHtml(message)}</div>`;
  el.scrollTop = el.scrollHeight;
}

// ==================== WEBSOCKET LISTENERS ====================
function setupWebSocketListeners() {
  ws.on('connected', () => {
    document.getElementById('statusDot')?.classList.replace('bg-gray-400', 'bg-green-400');
    setText('statusText', 'Connected');
  });
  ws.on('disconnected', () => {
    document.getElementById('statusDot')?.classList.replace('bg-green-400', 'bg-gray-400');
    setText('statusText', 'Disconnected');
  });

  ws.on('BOT_STATUS', (data) => {
    const d = data.data;
    addLog('globalLog', `[${d.provider}] Account #${d.accountId} → ${d.status}`, d.status === 'error' ? 'error' : 'info');
    // Update account in state (check both NTO and TARIKDB accounts)
    for (const [stateKey, prefix] of [['accounts', ''], ['tarikdbAccounts', 'TARIKDB_']]) {
      for (const provider of Object.keys(state[stateKey])) {
        const acc = state[stateKey][provider].find(a => a.id === d.accountId);
        if (acc) {
          acc.status = d.status;
          const uid = prefix + provider;
          renderAccountsTable(uid, state[stateKey][provider], prefix ? 'TARIKDB' : 'NTO');
          updateProviderStats(uid, state[stateKey][provider]);
          addLog(`${uid}Log`, `${acc.name} → ${d.status}`, d.status === 'error' ? 'error' : 'success');
          if (d.status === 'waiting_otp') showOtpModal(acc.id, acc.name);
          return;
        }
      }
    }
  });

  ws.on('BOT_STATUS_BULK', (data) => {
    const d = data.data;
    loadProviderAccounts(d.provider);
    addLog('globalLog', `[${d.provider}] All bots → ${d.status}`, 'info');
  });

  ws.on('BOT_LOG', (data) => {
    const d = data.data;
    const levelMap = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
    const level = levelMap[d.level] || 'info';
    // Add to the provider-specific log panel (both NTO and TARIKDB)
    addLog(`${d.provider}Log`, `[${d.accountId}] ${d.message}`, level);
    addLog(`TARIKDB_${d.provider}Log`, `[${d.accountId}] ${d.message}`, level);
    // Route scheduler/system logs to scheduler log panel
    if (d.provider === 'SYSTEM' && d.message.includes('[Scheduler]')) {
      addLog('schedulerLog', d.message, level);
    }
    // Route Live Report logs
    if (d.provider === 'SYSTEM' && d.message.includes('[LiveReport]')) {
      addLog('lrLogContainer', d.message, level);
    }
    // Also add to global log
    addLog('globalLog', `[${d.provider}#${d.accountId}] ${d.message}`, level);
  });

  ws.on('ACCOUNT_CREATED', () => { if (state.currentSection === 'dashboard') loadDashboard(); });
  ws.on('ACCOUNT_DELETED', () => { if (state.currentSection === 'dashboard') loadDashboard(); });
}

// ==================== AUTO UPDATER ====================

/**
 * One-click update: cek → download → install → restart (semua otomatis)
 */
window.oneClickUpdate = async function() {
  const btn = document.getElementById('btnOneClickUpdate');
  const resultBox = document.getElementById('updateCheckResult');
  const infoBox = document.getElementById('updateInfoBox');
  const title = document.getElementById('updateInfoTitle');
  const badge = document.getElementById('updateInfoBadge');
  const changelog = document.getElementById('updateInfoChangelog');
  const progress = document.getElementById('updateProgress');
  const progressText = document.getElementById('updateProgressText');

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Mengecek update...'; }

  try {
    // Step 1: Check for updates
    const res = await api.updater.check();
    if (!res.success) throw new Error('Gagal cek update');
    const d = res.data;

    if (resultBox) resultBox.classList.remove('hidden');

    if (d.error) {
      infoBox.className = 'p-4 rounded-lg border border-red-200 bg-red-50';
      title.textContent = d.error;
      badge.textContent = 'v' + d.currentVersion;
      badge.className = 'text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600';
      changelog.textContent = '';
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
      return;
    }

    if (!d.updateAvailable) {
      infoBox.className = 'p-4 rounded-lg border border-green-200 bg-green-50';
      title.textContent = 'Sudah versi terbaru!';
      badge.textContent = 'v' + d.currentVersion;
      badge.className = 'text-xs px-2 py-1 rounded-full bg-green-100 text-green-700';
      changelog.textContent = '';
      showNotification('Sudah versi terbaru (v' + d.currentVersion + ')', 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
      return;
    }

    // Update available — show info
    infoBox.className = 'p-4 rounded-lg border border-indigo-200 bg-indigo-50';
    title.textContent = 'Update ditemukan: v' + d.latestVersion;
    badge.textContent = 'v' + d.currentVersion + ' → v' + d.latestVersion;
    badge.className = 'text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700';
    changelog.textContent = d.changelog || '';

    if (!d.downloadUrl) {
      showNotification('Download URL tidak tersedia di versions.json', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
      return;
    }

    // Step 2: Confirm & Download
    showConfirmModal('Update v' + d.latestVersion + ' tersedia!\n\n' + (d.changelog || '') + '\n\nDownload dan install sekarang?\nServer akan restart otomatis.', async () => {
      try {
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Downloading...';
        if (progress) progress.classList.remove('hidden');
        if (progressText) progressText.textContent = 'Downloading update v' + d.latestVersion + '...';

        const dlRes = await api.updater.download(d.downloadUrl);
        if (!dlRes.success) throw new Error('Download gagal');

        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Installing...';
        if (progressText) progressText.textContent = 'Applying update... Server akan restart otomatis.';

        const applyRes = await api.updater.apply();
        if (!applyRes.success) throw new Error('Apply gagal');

        if (progressText) progressText.textContent = 'Server sedang restart... Halaman akan refresh otomatis.';
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Restarting...';

        waitForServerRestart();
      } catch (e2) {
        showNotification('Update gagal: ' + e2.message, 'error');
        if (progress) progress.classList.add('hidden');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
      }
    }, 'Update Tersedia');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
    return;

  } catch (e) {
    showNotification('Update gagal: ' + e.message, 'error');
    if (progress) progress.classList.add('hidden');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Cek & Update Otomatis'; }
  }
};

window.uploadAndApplyUpdate = function() {
  const fileInput = document.getElementById('updateFileInput');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    return showNotification('Pilih file ZIP update terlebih dahulu', 'error');
  }

  const file = fileInput.files[0];
  showConfirmModal('Upload dan install update? Server akan restart otomatis.', async () => {
  const progress = document.getElementById('updateProgress');
  const progressText = document.getElementById('updateProgressText');
  if (progress) progress.classList.remove('hidden');
  if (progressText) progressText.textContent = 'Uploading update...';

  try {
    // Upload via FormData
    const formData = new FormData();
    formData.append('updateFile', file);
    const uploadRes = await fetch(api.getBaseUrl() + '/updater/upload', { method: 'POST', body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadData.success) throw new Error(uploadData.error?.message || 'Upload failed');

    if (progressText) progressText.textContent = 'Applying update... Server akan restart.';

    // Apply
    const applyRes = await api.updater.apply();
    if (!applyRes.success) throw new Error('Apply failed');

    if (progressText) progressText.textContent = 'Server sedang restart... Halaman akan refresh otomatis.';
    waitForServerRestart();
  } catch (e) {
    showNotification('Update gagal: ' + e.message, 'error');
    if (progress) progress.classList.add('hidden');
  }
  }, 'Upload Update');
};

function waitForServerRestart() {
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      const progressText = document.getElementById('updateProgressText');
      if (progressText) progressText.textContent = 'Server belum kembali. Coba refresh manual.';
      return;
    }
    try {
      const res = await fetch(api.getBaseUrl() + '/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        clearInterval(interval);
        showNotification('Update berhasil! Halaman akan refresh...', 'success');
        setTimeout(() => location.reload(), 1500);
      }
    } catch {
      // Server not ready yet
    }
  }, 2000);
}

// Listen for update WebSocket events
ws.on('UPDATE_STATUS', (data) => {
  const d = data.data;
  const progressText = document.getElementById('updateProgressText');
  const progress = document.getElementById('updateProgress');
  if (progress) progress.classList.remove('hidden');
  if (progressText) progressText.textContent = d.message || d.status;
  addLog('globalLog', `[UPDATER] ${d.message || d.status}`, d.status === 'error' ? 'error' : 'info');
});

// ==================== HELPERS ====================
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = String(text); }
function setInput(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function setCheckbox(id, checked) { const el = document.getElementById(id); if (el) el.checked = checked; }
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(); }
