function showPage(name) {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.classList.add('hidden'));
  document.getElementById('page-' + name).classList.remove('hidden');
  document.querySelectorAll('nav a').forEach(a => {
    a.classList.remove('bg-gray-100', 'border-r-4', 'border-blue-600');
  });
  document.getElementById('nav-' + name).classList.add('bg-gray-100', 'border-r-4', 'border-blue-600');
  if (name === 'dashboard') loadDashboard();
  if (name === 'settings') loadSettingsStatus();
  if (name === 'listings') loadListings();
}

async function loadDashboard() {
  try {
    const res = await fetch('/api/v1/dashboard');
    const { data } = await res.json();
    const box = document.getElementById('status-box');
    if (data.configured) {
      box.className = 'mb-6 p-4 bg-green-50 border border-green-200 rounded text-green-800';
      let msg = 'SP-API Connected (FBM Mode)';
      if (data.lastSync) msg += ' - Last sync: ' + new Date(data.lastSync).toLocaleString();
      box.textContent = msg;
    } else {
      box.className = 'mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800';
      box.textContent = 'Configure SP-API in Settings to get started';
    }
    document.getElementById('s-total').textContent = data.totalSkus || 0;
    document.getElementById('s-active').textContent = data.active || 0;
    document.getElementById('s-inactive').textContent = data.inactive || 0;
  } catch (e) { console.error(e); }
}

async function syncListings() {
  const btn = document.getElementById('btn-sync');
  const msg = document.getElementById('sync-msg');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  msg.textContent = 'Requesting report from Amazon (this may take 1-2 minutes)...';
  msg.className = 'ml-4 text-sm text-blue-600';
  
  try {
    const res = await fetch('/api/v1/sync', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      msg.className = 'ml-4 text-sm text-green-600';
      msg.textContent = 'Synced ' + result.data.synced + ' listings!';
      loadDashboard();
      loadListings();
    } else {
      msg.className = 'ml-4 text-sm text-red-600';
      msg.textContent = 'Error: ' + result.error;
    }
  } catch (e) {
    msg.className = 'ml-4 text-sm text-red-600';
    msg.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'Sync Now';
}

async function loadListings() {
  const container = document.getElementById('listings-container');
  container.innerHTML = '<p class="text-gray-500">Loading...</p>';
  
  try {
    const res = await fetch('/api/v1/listings');
    const { data } = await res.json();
    
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<p class="text-gray-500">No listings yet. Click "Sync Now" to fetch from Amazon.</p>';
      return;
    }
    
    let html = '<table class="w-full text-sm"><thead><tr class="text-left border-b">';
    html += '<th class="pb-3 pr-4">Product</th><th class="pb-3 pr-4">SKU</th><th class="pb-3 pr-4">ASIN</th>';
    html += '<th class="pb-3 pr-4 text-right">Price</th><th class="pb-3 pr-4 text-right">Qty</th><th class="pb-3">Status</th></tr></thead><tbody>';
    
    data.items.forEach(item => {
      const statusClass = item.status === 'Active' ? 'text-green-600' : 'text-red-600';
      html += '<tr class="border-b hover:bg-gray-50">';
      html += '<td class="py-3 pr-4 max-w-xs truncate" title="' + item.title + '">' + (item.title || 'Unknown').substring(0, 50) + '</td>';
      html += '<td class="py-3 pr-4 font-mono text-xs">' + item.sku + '</td>';
      html += '<td class="py-3 pr-4 font-mono text-xs">' + item.asin + '</td>';
      html += '<td class="py-3 pr-4 text-right">£' + (item.price || 0).toFixed(2) + '</td>';
      html += '<td class="py-3 pr-4 text-right">' + (item.quantity || 0) + '</td>';
      html += '<td class="py-3 ' + statusClass + '">' + item.status + '</td>';
      html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="text-red-500">Error: ' + e.message + '</p>';
  }
}

async function loadSettingsStatus() {
  try {
    const res = await fetch('/api/v1/settings');
    const { data } = await res.json();
    const el = document.getElementById('cred-status');
    if (data.configured) {
      el.className = 'mb-4 p-3 bg-green-100 rounded text-sm text-green-700';
      el.textContent = 'Connected: ' + data.clientIdPreview;
    } else {
      el.className = 'mb-4 p-3 bg-yellow-100 rounded text-sm text-yellow-700';
      el.textContent = 'Not configured';
    }
  } catch (e) { console.error(e); }
}

async function saveSettings() {
  const btn = document.getElementById('btn-save');
  const msg = document.getElementById('save-msg');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: document.getElementById('f-clientid').value,
        clientSecret: document.getElementById('f-secret').value,
        refreshToken: document.getElementById('f-token').value
      })
    });
    const result = await res.json();
    if (result.success) {
      msg.className = 'ml-3 text-sm text-green-600';
      msg.textContent = 'Saved!';
      document.getElementById('f-clientid').value = '';
      document.getElementById('f-secret').value = '';
      document.getElementById('f-token').value = '';
      loadSettingsStatus();
    }
  } catch (e) {
    msg.className = 'ml-3 text-sm text-red-600';
    msg.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'Save';
}

loadDashboard();
