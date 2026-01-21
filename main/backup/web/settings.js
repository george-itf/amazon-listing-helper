async function loadSettings() {
  try {
    const res = await fetch('/api/v1/settings');
    const { data } = await res.json();
    if (data.sppiClientId) document.getElementById('sp-client-id').placeholder = data.sppiClientId;
    if (data.configured) {
      document.getElementById('api-status').innerHTML = '<span class="text-green-600 font-medium">Connected</span>';
    }
  } catch (e) { console.error('Failed to load settings:', e); }
}

async function saveSettings() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  const data = {
    sppiClientId: document.getElementById('sp-client-id').value,
    sppiClientSecret: document.getElementById('sp-client-secret').value,
    sppiRefreshToken: document.getElementById('sp-refresh-token').value,
    keepaApiKey: document.getElementById('keepa-api-key').value
  };
  
  try {
    const res = await fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.success) {
      alert('Settings saved successfully!');
      document.getElementById('sp-client-id').value = '';
      document.getElementById('sp-client-secret').value = '';
      document.getElementById('sp-refresh-token').value = '';
      document.getElementById('keepa-api-key').value = '';
      loadSettings();
    }
  } catch (e) {
    alert('Failed to save settings: ' + e.message);
  }
  
  btn.disabled = false;
  btn.textContent = 'Save Settings';
}

document.addEventListener('DOMContentLoaded', loadSettings);
