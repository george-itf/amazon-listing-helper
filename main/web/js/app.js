// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-' + page).classList.remove('hidden');
    
    if (page === 'dashboard') loadDashboard();
    if (page === 'settings') loadSettings();
  });
});

// Dashboard
async function loadDashboard() {
  try {
    const res = await fetch('/api/v1/dashboard');
    const { data } = await res.json();
    
    const statusEl = document.getElementById('dashboard-status');
    if (data.configured) {
      statusEl.className = 'mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800';
      statusEl.textContent = 'SP-API Connected - ' + data.message;
    } else {
      statusEl.className = 'mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800';
      statusEl.textContent = data.message;
    }
    
    document.getElementById('stat-listings').textContent = data.listings.total;
    document.getElementById('stat-active').textContent = data.listings.active;
    document.getElementById('stat-buybox').textContent = data.pricing.buyBoxWinRate + '%';
    document.getElementById('stat-tasks').textContent = data.tasks.pending;
  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

// Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/v1/settings');
    const { data } = await res.json();
    
    const statusEl = document.getElementById('settings-status');
    if (data.configured) {
      statusEl.className = 'mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700';
      statusEl.innerHTML = '<strong>Connected</strong> - Client ID: ' + data.spApiClientId;
    } else {
      statusEl.className = 'mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700';
      statusEl.textContent = 'Not configured - Enter your SP-API credentials below';
    }
  } catch (e) {
    console.error('Settings error:', e);
  }
}

async function saveSettings() {
  const btn = document.getElementById('btn-save');
  const status = document.getElementById('save-status');
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  status.textContent = '';
  
  const data = {
    spApiClientId: document.getElementById('input-client-id').value,
    spApiClientSecret: document.getElementById('input-client-secret').value,
    spApiRefreshToken: document.getElementById('input-refresh-token').value,
    keepaApiKey: document.getElementById('input-keepa-key').value
  };
  
  try {
    const res = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    
    if (result.success) {
      status.className = 'ml-4 text-sm text-green-600';
      status.textContent = 'Saved successfully!';
      document.getElementById('input-client-id').value = '';
      document.getElementById('input-client-secret').value = '';
      document.getElementById('input-refresh-token').value = '';
      document.getElementById('input-keepa-key').value = '';
      loadSettings();
    } else {
      status.className = 'ml-4 text-sm text-red-600';
      status.textContent = 'Error: ' + result.message;
    }
  } catch (e) {
    status.className = 'ml-4 text-sm text-red-600';
    status.textContent = 'Error: ' + e.message;
  }
  
  btn.disabled = false;
  btn.textContent = 'Save Settings';
}

// Initial load
loadDashboard();
