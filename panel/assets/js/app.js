// === BOT NTO Panel - Main Application ===

const state = {
  currentSection: 'dashboard',
  accounts: { NUKE: [], VICTORY: [], PAY4D: [] },
};

const PROVIDERS = [
  { key: 'NUKE', label: 'NUKE', icon: 'fa-bolt', color: 'red', defaultUrl: 'https://cpt77.nukepanel.com' },
  { key: 'VICTORY', label: 'VICTORY', icon: 'fa-trophy', color: 'yellow', defaultUrl: '' },
  { key: 'PAY4D', label: 'PAY4D', icon: 'fa-credit-card', color: 'green', defaultUrl: '' },
];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
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
    case 'provider-nuke': loadProviderAccounts('NUKE'); break;
    case 'provider-victory': loadProviderAccounts('VICTORY'); break;
    case 'provider-pay4d': loadProviderAccounts('PAY4D'); break;
    case 'nto-results': loadNtoResults(); break;
    case 'bot-activity': loadActivity(); loadActiveBots(); break;
    case 'settings': loadSettings(); break;
  }
};

window.toggleSidebar = function() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.querySelector('.sidebar-overlay')?.classList.toggle('open');
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
  for (const p of PROVIDERS) {
    const el = document.getElementById(`provider-${p.key.toLowerCase()}`);
    if (!el) continue;
    el.innerHTML = `
      <!-- Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 class="text-2xl font-bold"><i class="fas ${p.icon} mr-2 text-${p.color}-500"></i>${p.label} Panel</h2>
          <p class="text-gray-500 text-sm mt-1">Manage ${p.label} provider accounts and automation</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button onclick="toggleAddForm('${p.key}')" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm"><i class="fas fa-plus mr-1"></i>Add Account</button>
          <button onclick="startAllBots('${p.key}')" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"><i class="fas fa-play mr-1"></i>Start All</button>
          <button onclick="stopAllBots('${p.key}')" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm"><i class="fas fa-stop mr-1"></i>Stop All</button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Accounts</p><p class="text-2xl font-bold" id="${p.key}StatTotal">0</p></div>
            <div class="w-10 h-10 bg-${p.color}-100 rounded-lg flex items-center justify-center"><i class="fas fa-users text-${p.color}-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Active</p><p class="text-2xl font-bold text-green-600" id="${p.key}StatActive">0</p></div>
            <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><i class="fas fa-robot text-green-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">NTO Checks</p><p class="text-2xl font-bold text-blue-600" id="${p.key}StatNto">0</p></div>
            <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><i class="fas fa-clipboard-check text-blue-500"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow-sm p-4 stat-card">
          <div class="flex items-center justify-between">
            <div><p class="text-sm text-gray-500">Last Check</p><p class="text-lg font-bold text-gray-500" id="${p.key}StatLast">-</p></div>
            <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><i class="fas fa-clock text-purple-500"></i></div>
          </div>
        </div>
      </div>

      <!-- Add Account Form -->
      <div id="${p.key}AddForm" class="bg-white rounded-xl shadow-sm p-6 mb-6 hidden">
        <h3 class="font-bold text-lg mb-4"><i class="fas fa-user-plus mr-2 text-green-600"></i>Add New Account</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Account Name *</label>
            <input type="text" id="${p.key}NewName" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., User 1">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Panel URL *</label>
            <input type="url" id="${p.key}NewPanelUrl" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="${p.defaultUrl || 'https://panel-url.com'}" value="${p.defaultUrl}">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username *</label>
            <input type="text" id="${p.key}NewUsername" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="username">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input type="password" id="${p.key}NewPassword" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="password">
          </div>
          ${p.key === 'PAY4D' ? `<div>
            <label class="block text-sm font-medium text-gray-700 mb-1">PIN Code</label>
            <input type="password" id="${p.key}NewPinCode" class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="PIN code">
          </div>` : ''}
        </div>
        <div class="flex gap-2">
          <button onclick="createAccount('${p.key}')" class="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 text-sm font-medium"><i class="fas fa-save mr-2"></i>Save Account</button>
          <button onclick="toggleAddForm('${p.key}')" class="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 text-sm">Cancel</button>
        </div>
      </div>

      <!-- Main Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Accounts Table -->
        <div class="lg:col-span-2 bg-white rounded-xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold"><i class="fas fa-list mr-2 text-gray-600"></i>Accounts</h3>
            <input type="text" id="${p.key}Search" onkeyup="filterAccounts('${p.key}')" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40" placeholder="Search...">
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-3 text-left w-8"><input type="checkbox" id="${p.key}SelectAll" onchange="toggleSelectAll('${p.key}')" class="h-4 w-4 rounded"></th>
                  <th class="px-3 py-3 text-left">Name</th>
                  <th class="px-3 py-3 text-left hidden md:table-cell">Panel URL</th>
                  <th class="px-3 py-3 text-left hidden sm:table-cell">Username</th>
                  <th class="px-3 py-3 text-left">Status</th>
                  <th class="px-3 py-3 text-left hidden lg:table-cell">Last NTO</th>
                  <th class="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody id="${p.key}TableBody">
                <tr><td colspan="7" class="px-3 py-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl block mb-2"></i>No accounts yet</td></tr>
              </tbody>
            </table>
          </div>
          <div id="${p.key}BulkActions" class="hidden mt-4 pt-4 border-t border-gray-200">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm text-gray-600"><span id="${p.key}SelectedCount">0</span> selected</span>
              <button onclick="startSelectedBots('${p.key}')" class="bg-blue-600 text-white px-3 py-1.5 rounded text-xs hover:bg-blue-700"><i class="fas fa-play mr-1"></i>Start</button>
              <button onclick="stopSelectedBots('${p.key}')" class="bg-orange-500 text-white px-3 py-1.5 rounded text-xs hover:bg-orange-600"><i class="fas fa-stop mr-1"></i>Stop</button>
              <button onclick="deleteSelectedAccounts('${p.key}')" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700"><i class="fas fa-trash mr-1"></i>Delete</button>
            </div>
          </div>
        </div>

        <!-- Right Column -->
        <div class="space-y-6">
          <div class="bg-white rounded-xl shadow-sm p-6">
            <h3 class="font-bold mb-3"><i class="fas fa-clipboard-check mr-2 text-blue-500"></i>Recent NTO</h3>
            <div id="${p.key}NtoList" class="space-y-2 max-h-48 overflow-y-auto">
              <p class="text-sm text-gray-400 text-center py-3">No results yet</p>
            </div>
          </div>
          <div class="bg-white rounded-xl shadow-sm p-6">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-bold"><i class="fas fa-terminal mr-2 text-green-500"></i>Log</h3>
              <button onclick="clearLog('${p.key}Log')" class="text-xs text-gray-400 hover:text-gray-600">Clear</button>
            </div>
            <div id="${p.key}Log" class="bg-gray-900 text-green-400 font-mono text-xs p-3 rounded-lg h-48 overflow-y-auto">
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
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
async function loadProviderAccounts(provider) {
  try {
    const res = await api.accounts.list(provider);
    if (res.success) {
      state.accounts[provider] = res.data;
      renderAccountsTable(provider);
      updateProviderStats(provider);
    }
  } catch (e) {
    showNotification('Failed to load accounts: ' + e.message, 'error');
  }
}

function renderAccountsTable(provider) {
  const accounts = state.accounts[provider] || [];
  const tbody = document.getElementById(`${provider}TableBody`);
  if (!tbody) return;
  if (accounts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl block mb-2"></i>No accounts yet. Click "Add Account" to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = accounts.map(acc => {
    const statusCfg = getStatusConfig(acc.status);
    return `<tr class="hover:bg-gray-50 border-b border-gray-100" data-name="${escapeHtml(acc.name.toLowerCase())}">
      <td class="px-3 py-3"><input type="checkbox" class="${provider}-checkbox" value="${acc.id}" onchange="updateSelectedCount('${provider}')" class="h-4 w-4 rounded"></td>
      <td class="px-3 py-3 font-medium">${escapeHtml(acc.name)}</td>
      <td class="px-3 py-3 text-xs text-gray-500 hidden md:table-cell max-w-[200px] truncate" title="${escapeHtml(acc.panelUrl)}">${escapeHtml(acc.panelUrl)}</td>
      <td class="px-3 py-3 hidden sm:table-cell">${escapeHtml(acc.username)}</td>
      <td class="px-3 py-3"><span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusCfg.classes}"><i class="fas ${statusCfg.icon} text-[10px]"></i>${statusCfg.label}</span></td>
      <td class="px-3 py-3 text-sm hidden lg:table-cell">${acc.lastNto || '<span class="text-gray-400">-</span>'}</td>
      <td class="px-3 py-3 text-right space-x-1">
        ${acc.status === 'running' || acc.status === 'checking_nto'
          ? `<button onclick="stopBot(${acc.id})" class="text-orange-500 hover:text-orange-700 p-1" title="Stop"><i class="fas fa-stop"></i></button>`
          : `<button onclick="startBot(${acc.id})" class="text-green-500 hover:text-green-700 p-1" title="Start"><i class="fas fa-play"></i></button>`
        }
        <button onclick="showEditModal(${acc.id}, '${provider}')" class="text-blue-500 hover:text-blue-700 p-1" title="Edit"><i class="fas fa-edit"></i></button>
        <button onclick="deleteAccount(${acc.id}, '${provider}')" class="text-red-400 hover:text-red-600 p-1" title="Delete"><i class="fas fa-trash"></i></button>
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

function updateProviderStats(provider) {
  const accounts = state.accounts[provider] || [];
  const active = accounts.filter(a => ['running', 'checking_nto'].includes(a.status)).length;
  setText(`${provider}StatTotal`, accounts.length);
  setText(`${provider}StatActive`, active);
}

// ==================== ACCOUNT CRUD ====================
window.toggleAddForm = function(provider) {
  document.getElementById(`${provider}AddForm`)?.classList.toggle('hidden');
};

window.createAccount = async function(provider) {
  const name = document.getElementById(`${provider}NewName`)?.value.trim();
  const panelUrl = document.getElementById(`${provider}NewPanelUrl`)?.value.trim();
  const username = document.getElementById(`${provider}NewUsername`)?.value.trim();
  const password = document.getElementById(`${provider}NewPassword`)?.value.trim();
  const pinCode = document.getElementById(`${provider}NewPinCode`)?.value.trim();
  if (!name || !panelUrl || !username || !password) {
    showNotification('All fields are required', 'warning');
    return;
  }
  const payload = { provider, name, panelUrl, username, password };
  if (pinCode) payload.pinCode = pinCode;
  try {
    await api.accounts.create(payload);
    showNotification(`Account "${name}" created`, 'success');
    document.getElementById(`${provider}NewName`).value = '';
    document.getElementById(`${provider}NewUsername`).value = '';
    document.getElementById(`${provider}NewPassword`).value = '';
    const pinInput = document.getElementById(`${provider}NewPinCode`);
    if (pinInput) pinInput.value = '';
    toggleAddForm(provider);
    loadProviderAccounts(provider);
    loadDashboard();
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

window.deleteAccount = async function(id, provider) {
  if (!confirm('Delete this account? This cannot be undone.')) return;
  try {
    await api.accounts.delete(id);
    showNotification('Account deleted', 'success');
    loadProviderAccounts(provider);
    loadDashboard();
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

// ==================== EDIT MODAL ====================
window.showEditModal = function(id, provider) {
  const acc = state.accounts[provider]?.find(a => a.id === id);
  if (!acc) return;
  document.getElementById('editAccountId').value = acc.id;
  document.getElementById('editAccountProvider').value = provider;
  document.getElementById('editAccountName').value = acc.name;
  document.getElementById('editAccountPanelUrl').value = acc.panelUrl;
  document.getElementById('editAccountUsername').value = acc.username;
  document.getElementById('editAccountPassword').value = '';
  document.getElementById('editAccountPinCode').value = '';
  const pinGroup = document.getElementById('editPinCodeGroup');
  if (provider === 'PAY4D') {
    pinGroup.classList.remove('hidden');
  } else {
    pinGroup.classList.add('hidden');
  }
  document.getElementById('editAccountModal').classList.remove('hidden');
};

window.hideEditModal = function() {
  document.getElementById('editAccountModal').classList.add('hidden');
};

window.saveAccountEdit = async function() {
  const id = document.getElementById('editAccountId').value;
  const provider = document.getElementById('editAccountProvider').value;
  const data = {
    name: document.getElementById('editAccountName').value.trim(),
    panelUrl: document.getElementById('editAccountPanelUrl').value.trim(),
    username: document.getElementById('editAccountUsername').value.trim(),
  };
  const password = document.getElementById('editAccountPassword').value;
  if (password) data.password = password;
  const pinCode = document.getElementById('editAccountPinCode').value;
  if (pinCode) data.pinCode = pinCode;
  if (!data.name) { showNotification('Name is required', 'warning'); return; }
  try {
    await api.accounts.update(id, data);
    showNotification('Account updated', 'success');
    hideEditModal();
    loadProviderAccounts(provider);
  } catch (e) {
    showNotification('Error: ' + e.message, 'error');
  }
};

// ==================== BOT CONTROLS ====================
window.startBot = async function(accountId) {
  try {
    await api.bot.start(accountId);
    showNotification('Bot starting...', 'info');
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.stopBot = async function(accountId) {
  try {
    await api.bot.stop(accountId);
    showNotification('Bot stopped', 'info');
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.startAllBots = async function(provider) {
  if (!confirm(`Start all bots for ${provider}?`)) return;
  try {
    const res = await api.bot.startAll(provider);
    showNotification(res.message || 'Starting all bots...', 'success');
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

window.stopAllBots = async function(provider) {
  if (!confirm(`Stop all bots for ${provider}?`)) return;
  try {
    await api.bot.stopAll(provider);
    showNotification('All bots stopped', 'warning');
    loadProviderAccounts(provider);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
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

window.startSelectedBots = async function(provider) {
  const ids = getSelectedIds(provider);
  for (const id of ids) await api.bot.start(id);
  showNotification(`Starting ${ids.length} bots...`, 'info');
};

window.stopSelectedBots = async function(provider) {
  const ids = getSelectedIds(provider);
  for (const id of ids) await api.bot.stop(id);
  showNotification(`Stopping ${ids.length} bots...`, 'info');
  setTimeout(() => loadProviderAccounts(provider), 1500);
};

window.deleteSelectedAccounts = async function(provider) {
  const ids = getSelectedIds(provider);
  if (!confirm(`Delete ${ids.length} accounts?`)) return;
  try {
    await api.accounts.bulkDelete(ids);
    showNotification(`${ids.length} accounts deleted`, 'success');
    loadProviderAccounts(provider);
    loadDashboard();
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

function getSelectedIds(provider) {
  return Array.from(document.querySelectorAll(`.${provider}-checkbox:checked`)).map(cb => Number(cb.value));
}

window.filterAccounts = function(provider) {
  const query = (document.getElementById(`${provider}Search`)?.value || '').toLowerCase();
  document.querySelectorAll(`#${provider}TableBody tr`).forEach(row => {
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

// ==================== NTO RESULTS ====================
window.loadNtoResults = async function() {
  try {
    const provider = document.getElementById('ntoFilterProvider')?.value || '';
    const res = await api.nto.list(provider, 100);
    if (res.success) renderNtoTable(res.data);
  } catch (e) { showNotification('Error: ' + e.message, 'error'); }
};

function renderNtoTable(results) {
  const tbody = document.getElementById('ntoResultsTableBody');
  if (!tbody) return;
  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400">No NTO results</td></tr>';
    return;
  }
  tbody.innerHTML = results.map(r => {
    const providerColor = { NUKE: 'red', VICTORY: 'yellow', PAY4D: 'green' }[r.provider] || 'gray';
    return `<tr class="hover:bg-gray-50 border-b border-gray-100">
      <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-xs font-medium bg-${providerColor}-100 text-${providerColor}-700">${r.provider}</span></td>
      <td class="px-4 py-3 text-sm">${escapeHtml(r.account?.name || '-')}</td>
      <td class="px-4 py-3 font-mono font-medium">${escapeHtml(r.value)}</td>
      <td class="px-4 py-3 text-sm text-gray-500">${new Date(r.checkedAt).toLocaleString()}</td>
    </tr>`;
  }).join('');
}

// ==================== BOT ACTIVITY ====================
window.loadActivity = async function() {
  try {
    const res = await api.dashboard.getActivity(50);
    if (res.success) renderActivityList('activityHistoryList', res.data);
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
          case 'notification.enabled': setCheckbox('settingTelegramEnabled', s.value === 'true'); break;
          case 'notification.telegramBotToken': setInput('settingTelegramToken', s.value); break;
          case 'notification.telegramChatId': setInput('settingTelegramChatId', s.value); break;
          case 'captcha_api_key': setInput('settingCaptchaApiKey', s.value); if (s.value) load2CaptchaBalance(); break;
        }
      }
      // Check Telegram listener status
      checkTelegramStatus();
    }
    if (healthRes.success) {
      const uptime = Math.floor(healthRes.data.uptime);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      setText('settingUptime', `${h}h ${m}m`);
      setText('statUptime', `${h}h ${m}m`);
    }
  } catch (e) { console.error(e); }
}

window.saveSetting = async function(key, value) {
  try {
    await api.settings.update(key, value);
    showNotification('Setting saved', 'success', 1500);
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
      text.textContent = 'Running — listening for commands';
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
    setTimeout(checkTelegramStatus, 500);
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
    // Update account in state
    for (const provider of Object.keys(state.accounts)) {
      const acc = state.accounts[provider].find(a => a.id === d.accountId);
      if (acc) {
        acc.status = d.status;
        renderAccountsTable(provider);
        updateProviderStats(provider);
        addLog(`${provider}Log`, `${acc.name} → ${d.status}`, d.status === 'error' ? 'error' : 'success');
        if (d.status === 'waiting_otp') showOtpModal(acc.id, acc.name);
        break;
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
    // Add to the provider-specific log panel
    addLog(`${d.provider}Log`, `[${d.accountId}] ${d.message}`, level);
    // Also add to global log
    addLog('globalLog', `[${d.provider}#${d.accountId}] ${d.message}`, level);
  });

  ws.on('ACCOUNT_CREATED', () => { if (state.currentSection === 'dashboard') loadDashboard(); });
  ws.on('ACCOUNT_DELETED', () => { if (state.currentSection === 'dashboard') loadDashboard(); });
}

// ==================== HELPERS ====================
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = String(text); }
function setInput(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function setCheckbox(id, checked) { const el = document.getElementById(id); if (el) el.checked = checked; }
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(); }
