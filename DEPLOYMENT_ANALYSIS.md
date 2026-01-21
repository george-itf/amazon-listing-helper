# Deployment Options Analysis

**Application:** Amazon Listing Helper
**Stack:** Node.js (Fastify) + PostgreSQL + Redis + Background Worker
**Date:** 2026-01-20

---

## Executive Summary

| Rank | Platform | Setup Time | Monthly Cost | Difficulty | Best For |
|------|----------|------------|--------------|------------|----------|
| 🥇 | **Railway** | 5-10 min | $5-20 | ⭐ Easy | **RECOMMENDED** |
| 🥈 | **Render** | 10-15 min | $7-25 | ⭐ Easy | Free tier testing |
| 🥉 | **Fly.io** | 15-20 min | $5-15 | ⭐⭐ Medium | Edge deployment |
| 4 | **Hetzner + Coolify** | 30-45 min | €4-10 | ⭐⭐ Medium | Self-hosted PaaS |
| 5 | **DigitalOcean App Platform** | 15-20 min | $12-25 | ⭐⭐ Medium | DO ecosystem |
| 6 | **Hetzner (Manual)** | 2-4 hours | €4-16 | ⭐⭐⭐ Hard | Full control |
| 7 | **AWS (ECS/EC2)** | 4-8 hours | $20-50+ | ⭐⭐⭐⭐ Expert | Enterprise |

---

## 🥇 WINNER: Railway (Fastest & Easiest)

### Why Railway Wins

```
┌─────────────────────────────────────────────────────────────┐
│  RAILWAY - Deploy in Under 10 Minutes                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ Connect GitHub repo                                     │
│  ✅ Auto-detects Node.js                                    │
│  ✅ Click to add PostgreSQL                                 │
│  ✅ Click to add Redis                                      │
│  ✅ Auto-provisions DATABASE_URL                            │
│  ✅ Auto-SSL on *.railway.app                               │
│  ✅ Auto-deploys on git push                                │
│  ✅ Built-in logs & metrics                                 │
│                                                             │
│  Total setup: ~5 minutes                                    │
│  Monthly cost: $5-20 (usage-based)                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Railway Deployment Steps

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Initialize project (from your app directory)
cd main/app
railway init

# 4. Add PostgreSQL
railway add --plugin postgresql

# 5. Add Redis (optional)
railway add --plugin redis

# 6. Deploy
railway up

# Done! Your app is live at https://your-app.railway.app
```

### Railway Pricing (Usage-Based)
- **Hobby:** $5/month (includes $5 credit)
- **Pro:** $20/month (includes $20 credit)
- PostgreSQL: ~$0.000231/GB-hour (~$5-10/month typical)
- Execution: $0.000463/vCPU-minute

---

## Detailed Comparison

### 1. Platform-as-a-Service (PaaS) Options

#### Railway ⭐⭐⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 5 min | Connect repo, add services, deploy |
| PostgreSQL | Built-in | One-click, auto-configured |
| Redis | Built-in | One-click |
| Workers | ✅ | Separate service, same repo |
| Custom Domain | ✅ | Free SSL |
| Auto-deploy | ✅ | On git push |
| Logs/Metrics | ✅ | Built-in |
| Cost | $5-20/mo | Usage-based |
| **Verdict** | **BEST** | Fastest path to production |

#### Render ⭐⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 10-15 min | Similar to Railway |
| PostgreSQL | Built-in | Free tier (90 days) |
| Redis | Built-in | $10/mo minimum |
| Workers | ✅ | Background workers supported |
| Custom Domain | ✅ | Free SSL |
| Free Tier | ✅ | 750 hours/month |
| Cost | $7-25/mo | Fixed pricing |
| **Verdict** | **Great** | Good free tier for testing |

#### Fly.io ⭐⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 15-20 min | CLI-based, more config |
| PostgreSQL | Built-in | Fly Postgres (managed) |
| Redis | Built-in | Upstash integration |
| Workers | ✅ | Machines API |
| Edge Deploy | ✅ | Global edge network |
| Cost | $5-15/mo | Very competitive |
| **Verdict** | **Great** | Best for global users |

#### Heroku ⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 10 min | Classic PaaS |
| PostgreSQL | Built-in | $5/mo minimum |
| Redis | Built-in | $15/mo minimum |
| Workers | ✅ | Separate dyno |
| Cost | $12-50/mo | Expensive now |
| **Verdict** | OK | Overpriced since Salesforce |

---

### 2. Self-Hosted Options

#### Hetzner + Coolify ⭐⭐⭐⭐
```
Coolify = Self-hosted Heroku/Railway
```

| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 30-45 min | Install Coolify, then easy |
| Control | Full | Your server, your rules |
| PostgreSQL | Docker | Managed by Coolify |
| Cost | €4-10/mo | Just server cost |
| Maintenance | Medium | Coolify handles most |
| **Verdict** | **Great** | Best self-hosted option |

**Coolify Setup:**
```bash
# On fresh Hetzner VPS
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Then use web UI to:
# 1. Add your GitHub repo
# 2. Add PostgreSQL database
# 3. Add Redis
# 4. Deploy with one click
```

#### Hetzner Manual ⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 2-4 hours | Full manual setup |
| Control | Full | Complete control |
| Cost | €4-16/mo | Cheapest option |
| Maintenance | High | All on you |
| **Verdict** | OK | Only if you need full control |

#### DigitalOcean Droplet ⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 1-2 hours | Similar to Hetzner |
| Managed DB | ✅ | $15/mo extra |
| Cost | $6-24/mo | Slightly more than Hetzner |
| **Verdict** | OK | Good docs, higher cost |

---

### 3. Cloud Provider Options

#### AWS (ECS/Fargate) ⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 4-8 hours | Complex configuration |
| PostgreSQL | RDS | $15+ minimum |
| Scaling | Excellent | Auto-scaling built-in |
| Cost | $30-100+/mo | Enterprise pricing |
| **Verdict** | Overkill | Only for enterprise |

#### Google Cloud Run ⭐⭐⭐
| Aspect | Rating | Notes |
|--------|--------|-------|
| Setup Time | 1-2 hours | Container-based |
| PostgreSQL | Cloud SQL | $10+ minimum |
| Cost | $15-40/mo | Pay-per-use |
| **Verdict** | OK | Good for containers |

---

## Decision Matrix

### Choose Based on Your Priority

| If You Want... | Choose | Why |
|----------------|--------|-----|
| **Fastest setup** | Railway | 5-minute deploy |
| **Cheapest** | Hetzner + Coolify | €4-10/mo total |
| **Free testing** | Render | 90-day free PostgreSQL |
| **Global users** | Fly.io | Edge deployment |
| **Full control** | Hetzner Manual | Complete ownership |
| **Enterprise** | AWS | Compliance, SLAs |

---

## 🚀 Quick Start: Railway (Recommended)

### Step-by-Step (5 Minutes)

**1. Prepare Your Repo**

Create `railway.json` in project root:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node src/server.js",
    "healthcheckPath": "/api/v1/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Create `Procfile` (optional but recommended):
```
web: node src/server.js
worker: node src/workers/job-worker.js
```

**2. Deploy via Web UI**

1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway auto-detects Node.js

**3. Add Database**

1. Click "+ New" in your project
2. Select "Database" → "PostgreSQL"
3. Railway auto-injects `DATABASE_URL`

**4. Configure Environment**

Add these variables in Railway dashboard:
```
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
SP_API_REFRESH_TOKEN=your_token
SP_API_CLIENT_ID=your_client_id
SP_API_CLIENT_SECRET=your_secret
```

**5. Deploy Worker (Optional)**

1. Click "+ New" → "GitHub Repo" (same repo)
2. Set start command: `node src/workers/job-worker.js`
3. It shares the same DATABASE_URL

**Done!** Your app is live at `https://your-project.railway.app`

---

## 🥈 Alternative: Render (Free Tier)

### Best for Testing/Development

```bash
# 1. Create render.yaml in project root
cat > render.yaml << 'EOF'
services:
  - type: web
    name: alh-api
    env: node
    buildCommand: npm install
    startCommand: node src/server.js
    healthCheckPath: /api/v1/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: alh-db
          property: connectionString

  - type: worker
    name: alh-worker
    env: node
    buildCommand: npm install
    startCommand: node src/workers/job-worker.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: alh-db
          property: connectionString

databases:
  - name: alh-db
    plan: free  # 90 days free, then $7/mo
EOF

# 2. Push to GitHub
# 3. Connect repo on render.com
# 4. Deploy
```

---

## 🥉 Alternative: Fly.io (Global Edge)

### Best for International Users

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Create fly.toml
cat > fly.toml << 'EOF'
app = "amazon-listing-helper"
primary_region = "lhr"  # London

[build]
  builder = "heroku/buildpacks:20"

[env]
  NODE_ENV = "production"
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[services]]
  protocol = "tcp"
  internal_port = 8080
  [[services.ports]]
    port = 80
    handlers = ["http"]
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
EOF

# 4. Create Postgres
fly postgres create --name alh-db

# 5. Attach to app
fly postgres attach alh-db

# 6. Deploy
fly deploy
```

---

## Cost Comparison (Monthly)

| Platform | Small (Dev) | Medium (Prod) | Large (Scale) |
|----------|-------------|---------------|---------------|
| **Railway** | $5 | $15 | $40 |
| **Render** | $7 | $25 | $60 |
| **Fly.io** | $5 | $12 | $35 |
| **Hetzner+Coolify** | €4 | €8 | €16 |
| **Hetzner Manual** | €4 | €8 | €16 |
| **DigitalOcean** | $12 | $30 | $70 |
| **AWS** | $25 | $60 | $150+ |

---

## Final Recommendation

### For Most Users: Railway

```
✅ 5-minute setup
✅ Zero DevOps knowledge needed
✅ Built-in PostgreSQL & Redis
✅ Auto-scaling
✅ $5-20/month
✅ Great developer experience
```

### For Budget-Conscious: Hetzner + Coolify

```
✅ 30-45 minute setup
✅ €4-10/month total
✅ Self-hosted but managed UI
✅ Full control when needed
✅ EU data residency
```

### For Testing: Render Free Tier

```
✅ 10-minute setup
✅ Free for 90 days
✅ Good for demos/testing
✅ Easy upgrade path
```

---

## TL;DR

**Just want it deployed NOW?**

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login & deploy
railway login
cd main/app
railway init
railway add --plugin postgresql
railway up

# Done in 5 minutes! 🚀
```
