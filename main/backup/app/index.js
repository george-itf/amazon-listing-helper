import Fastify from 'fastify';
import cors from '@fastify/cors';
import fs from 'fs';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });

const CREDENTIALS_FILE = '/opt/alh/credentials.json';

// Load existing credentials
function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error loading credentials:', e); }
  return { sppiClientId: '', sppiClientSecret: '', sppiRefreshToken: '', keepaApiKey: '' };
}

// Save credentials
function saveCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

// Health check
fastify.get('/api/v1/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Get settings (masked)
fastify.get('/api/v1/settings', async () => {
  const creds = loadCredentials();
  return {
    data: {
      sppiClientId: creds.sppiClientId ? creds.sppiClientId.substring(0, 20) + '...' : '',
      sppiClientSecret: creds.sppiClientSecret ? '••••••••' : '',
      sppiRefreshToken: creds.sppiRefreshToken ? '••••••••' : '',
      keepaApiKey: creds.keepaApiKey ? '••••••••' : '',
      configured: !!(creds.sppiClientId && creds.sppiClientSecret && creds.sppiRefreshToken)
    }
  };
});

// Save settings
fastify.post('/api/v1/settings', async (request) => {
  const { sppiClientId, sppiClientSecret, sppiRefreshToken, keepaApiKey } = request.body;
  const current = loadCredentials();
  
  // Only update non-empty values
  if (sppiClientId) current.sppiClientId = sppiClientId;
  if (sppiClientSecret) current.sppiClientSecret = sppiClientSecret;
  if (sppiRefreshToken) current.sppiRefreshToken = sppiRefreshToken;
  if (keepaApiKey) current.keepaApiKey = keepaApiKey;
  
  saveCredentials(current);
  return { success: true, message: 'Settings saved successfully' };
});

// Dashboard metrics
fastify.get('/api/v1/dashboard/metrics', async () => {
  const creds = loadCredentials();
  const configured = !!(creds.sppiClientId && creds.sppiClientSecret && creds.sppiRefreshToken);
  
  return {
    data: {
      listings: { total: 0, active: 0, inactive: 0, suppressed: 0 },
      scores: { average: 0, distribution: [0, 0, 0, 0, 0] },
      pricing: { totalRevenue: 0, averageMargin: 0, buyBoxWinRate: 0, priceChanges24h: 0 },
      tasks: { total: 0, overdue: 0 },
      competitors: { tracked: 0, alertsNew: 0, avgThreatScore: 0 },
      configured: configured,
      message: configured ? 'SP-API connected' : 'Please configure SP-API in Settings'
    }
  };
});

fastify.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('API server running on port 4000');
});
