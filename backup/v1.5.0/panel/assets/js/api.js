// === BOT NTO API Client ===
const API_HOST = localStorage.getItem('apiHost') || 'http://localhost:6969';
const API_BASE = API_HOST + '/api';
const WS_URL = API_HOST.replace('http', 'ws') + '/ws';

const api = {
  async request(endpoint, options = {}) {
    const url = API_BASE + endpoint;
    const config = { headers: { 'Content-Type': 'application/json' }, ...options };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const data = await response.json();
    if (!response.ok) {
      const errMsg = data?.error?.message || `HTTP ${response.status}`;
      const details = data?.error?.details?.errors;
      if (details && Array.isArray(details)) {
        throw new Error(details.map(e => `${e.field}: ${e.message}`).join(', '));
      }
      throw new Error(errMsg);
    }
    return data;
  },
  get(endpoint) { return this.request(endpoint); },
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body }); },
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body }); },
  delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); },

  // --- Domain modules ---
  accounts: {
    list(provider, feature) {
      const params = [];
      if (provider) params.push(`provider=${provider}`);
      if (feature) params.push(`feature=${feature}`);
      return api.get('/accounts' + (params.length ? '?' + params.join('&') : ''));
    },
    get(id) { return api.get(`/accounts/${id}`); },
    create(data) { return api.post('/accounts', data); },
    update(id, data) { return api.put(`/accounts/${id}`, data); },
    delete(id) { return api.delete(`/accounts/${id}`); },
    bulkDelete(ids) { return api.post('/accounts/bulk-delete', { ids }); },
  },

  dashboard: {
    getStats(feature) { return api.get('/dashboard/stats' + (feature ? `?feature=${feature}` : '')); },
    getActivity(limit = 20) { return api.get(`/dashboard/activity?limit=${limit}`); },
  },

  bot: {
    start(accountId) { return api.post('/bot/start', { accountId }); },
    stop(accountId) { return api.post('/bot/stop', { accountId }); },
    startAll(provider) { return api.post('/bot/start-all', { provider }); },
    stopAll(provider) { return api.post('/bot/stop-all', { provider }); },
    status(provider) { return api.get('/bot/status' + (provider ? `?provider=${provider}` : '')); },
    submitOtp(accountId, otp) { return api.post('/bot/submit-otp', { accountId, otp }); },
  },

  nto: {
    list(provider, limit = 50) { return api.get(`/nto?${provider ? `provider=${provider}&` : ''}limit=${limit}`); },
    latest(provider) { return api.get('/nto/latest' + (provider ? `?provider=${provider}` : '')); },
    stats() { return api.get('/nto/stats'); },
  },

  settings: {
    list() { return api.get('/settings'); },
    get(key) { return api.get(`/settings/${key}`); },
    update(key, value, type) { return api.put(`/settings/${key}`, { value: String(value), type }); },
  },

  system: {
    info() { return api.get(''); },
    health() { return api.get('/health'); },
  },

  updater: {
    check() { return api.get('/updater/check'); },
    download(downloadUrl) { return api.post('/updater/download', { downloadUrl }); },
    apply() { return api.post('/updater/apply'); },
  },

  getBaseUrl() { return API_BASE; },
};

// === WebSocket Client ===
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
  }

  connect() {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected');
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
        } catch (e) { console.error('WS parse error:', e); }
      };
      this.ws.onclose = () => {
        this.emit('disconnected');
        this.attemptReconnect();
      };
      this.ws.onerror = (err) => console.error('WS error:', err);
    } catch (e) {
      console.error('WS connect failed:', e);
      this.attemptReconnect();
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), this.reconnectDelay);
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    const list = this.listeners.get(event);
    if (list) this.listeners.set(event, list.filter(cb => cb !== callback));
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(cb => cb(data));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

const ws = new WebSocketClient();

window.api = api;
window.ws = ws;
