# Amazon Listing Helper - Railway Deployment Guide

**Version:** 1.0
**Date:** 2026-01-20
**Estimated Setup Time:** 10-15 minutes

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Preparation](#3-project-preparation)
4. [Railway Account Setup](#4-railway-account-setup)
5. [Deploy via Web UI](#5-deploy-via-web-ui)
6. [Deploy via CLI](#6-deploy-via-cli)
7. [Database Setup](#7-database-setup)
8. [Environment Variables](#8-environment-variables)
9. [Worker Process Setup](#9-worker-process-setup)
10. [Custom Domain](#10-custom-domain)
11. [Database Migrations](#11-database-migrations)
12. [Monitoring & Logs](#12-monitoring--logs)
13. [Backups](#13-backups)
14. [Scaling](#14-scaling)
15. [Cost Management](#15-cost-management)
16. [Troubleshooting](#16-troubleshooting)
17. [CI/CD with GitHub Actions](#17-cicd-with-github-actions)

---

## 1. Overview

### What Railway Provides

```
┌─────────────────────────────────────────────────────────────────┐
│                     RAILWAY PLATFORM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│   │   GitHub    │──▶│   Build     │──▶│   Deploy    │          │
│   │   Push      │   │   (Nixpacks)│   │   (Docker)  │          │
│   └─────────────┘   └─────────────┘   └─────────────┘          │
│                                              │                   │
│                                              ▼                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    YOUR PROJECT                          │   │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │
│   │  │  ALH API  │  │  Worker   │  │ PostgreSQL│           │   │
│   │  │  (web)    │  │ (worker)  │  │   (db)    │           │   │
│   │  └───────────┘  └───────────┘  └───────────┘           │   │
│   │       │              │              │                    │   │
│   │       └──────────────┴──────────────┘                    │   │
│   │              Shared DATABASE_URL                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│              https://your-app.railway.app                        │
│                    (Auto SSL)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### What You Get

| Feature | Included |
|---------|----------|
| Node.js hosting | ✅ Auto-detected |
| PostgreSQL database | ✅ One-click |
| Redis cache | ✅ One-click |
| Auto SSL certificates | ✅ Free |
| Custom domains | ✅ Free |
| Auto-deploy on git push | ✅ Free |
| Logs & metrics | ✅ Built-in |
| Horizontal scaling | ✅ Available |
| Background workers | ✅ Supported |

---

## 2. Prerequisites

### Required

- [ ] GitHub account with your code repository
- [ ] Railway account (free to create)
- [ ] Your Amazon SP-API credentials:
  - Refresh Token
  - Client ID
  - Client Secret
  - Seller ID

### Optional

- [ ] Keepa API key
- [ ] Custom domain name

### Local Tools (for CLI deployment)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Verify installation
railway --version
```

---

## 3. Project Preparation

### 3.1 Required Files

Your repository should have this structure:

```
amazon-listing-helper/
├── main/
│   ├── app/
│   │   ├── src/
│   │   │   ├── server.js          # Main entry point
│   │   │   └── workers/
│   │   │       └── job-worker.js  # Background worker
│   │   ├── package.json
│   │   ├── schema.sql
│   │   └── migrations/
│   │       ├── 001_slice_a_schema.sql
│   │       ├── 002_slice_b_schema.sql
│   │       ├── 003_slice_c_schema.sql
│   │       └── 004_slice_d_schema.sql
│   └── web/
│       ├── index.html
│       └── ...
```

### 3.2 Update package.json

Ensure your `package.json` has the correct start script:

```json
{
  "name": "amazon-listing-helper-api",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "start": "node src/server.js",
    "worker": "node src/workers/job-worker.js",
    "db:migrate": "node scripts/migrate.js"
  },
  "dependencies": {
    "@fastify/cors": "^8.4.0",
    "@fastify/static": "^7.0.0",
    "amazon-sp-api": "^1.2.0",
    "dotenv": "^16.3.0",
    "fastify": "^4.24.0",
    "pg": "^8.11.3"
  }
}
```

### 3.3 Create railway.json (Optional but Recommended)

Create `railway.json` in your `main/app/` directory:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/api/v1/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### 3.4 Create Procfile (Alternative)

Or create a `Procfile` in `main/app/`:

```
web: npm start
worker: npm run worker
```

### 3.5 Ensure Health Endpoint Exists

Your server should have a health check endpoint. Verify in `src/server.js`:

```javascript
fastify.get('/api/v1/health', async () => ({ status: 'ok' }));
```

### 3.6 Update Database Connection for Railway

Ensure your database connection code reads from `DATABASE_URL`:

```javascript
// src/database/connection.js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const query = (text, params) => pool.query(text, params);
export default pool;
```

---

## 4. Railway Account Setup

### 4.1 Create Account

1. Go to [railway.app](https://railway.app)
2. Click **"Login"** → **"Login with GitHub"**
3. Authorize Railway to access your GitHub

### 4.2 Choose Plan

| Plan | Cost | Includes | Best For |
|------|------|----------|----------|
| **Hobby** | $5/month | $5 credit, 512MB RAM | Development |
| **Pro** | $20/month | $20 credit, 8GB RAM, Team features | Production |

> **Note:** You need at least Hobby plan for always-on services. Free trial includes $5 credit.

### 4.3 Add Payment Method

1. Go to **Account Settings** → **Billing**
2. Add credit card (required for production use)
3. Set usage limit to prevent surprises

---

## 5. Deploy via Web UI

### Step 1: Create New Project

1. Click **"New Project"** on Railway dashboard
2. Select **"Deploy from GitHub repo"**
3. Choose your repository: `amazon-listing-helper`
4. Select the branch: `main` or `master`

### Step 2: Configure Root Directory

Railway will ask which directory to deploy:

1. Click on your service
2. Go to **Settings** → **Root Directory**
3. Set to: `main/app`

### Step 3: Add PostgreSQL Database

1. In your project, click **"+ New"**
2. Select **"Database"**
3. Choose **"PostgreSQL"**
4. Railway creates the database and injects `DATABASE_URL`

### Step 4: Configure Environment Variables

1. Click on your **web service**
2. Go to **Variables** tab
3. Add the following:

```
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data

# Amazon SP-API
SP_API_REFRESH_TOKEN=Atzr|your_refresh_token_here
SP_API_CLIENT_ID=amzn1.application-oa2-client.xxxxx
SP_API_CLIENT_SECRET=your_client_secret
SP_API_SELLER_ID=your_seller_id
SP_API_MARKETPLACE_ID=A1F83G8C2ARO7P

# Keepa (optional)
KEEPA_API_KEY=your_keepa_key
```

### Step 5: Deploy

1. Railway auto-deploys when you push to GitHub
2. Or click **"Deploy"** → **"Deploy Now"** to trigger manually

### Step 6: Get Your URL

1. Go to **Settings** → **Domains**
2. Click **"Generate Domain"**
3. Your app is live at: `https://your-app.railway.app`

---

## 6. Deploy via CLI

### 6.1 Install & Login

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login
```

### 6.2 Initialize Project

```bash
# Navigate to your app directory
cd amazon-listing-helper/main/app

# Link to existing project or create new
railway init

# Select "Create new project" or link existing
```

### 6.3 Add PostgreSQL

```bash
# Add PostgreSQL database
railway add --plugin postgresql

# Verify DATABASE_URL is set
railway variables
```

### 6.4 Set Environment Variables

```bash
# Set variables one by one
railway variables set NODE_ENV=production
railway variables set PORT=3000
railway variables set DATA_DIR=/app/data
railway variables set SP_API_REFRESH_TOKEN="your_token"
railway variables set SP_API_CLIENT_ID="your_client_id"
railway variables set SP_API_CLIENT_SECRET="your_secret"
railway variables set SP_API_SELLER_ID="your_seller_id"
railway variables set SP_API_MARKETPLACE_ID="A1F83G8C2ARO7P"

# Or set from .env file (local only, doesn't upload secrets)
railway variables set --from-file .env.production
```

### 6.5 Deploy

```bash
# Deploy current directory
railway up

# Deploy with logs
railway up --detach=false
```

### 6.6 Get Deployment URL

```bash
# Open project in browser
railway open

# Get domain
railway domain
```

---

## 7. Database Setup

### 7.1 Database is Auto-Configured

When you add PostgreSQL, Railway automatically:
- Creates the database
- Sets `DATABASE_URL` environment variable
- Configures SSL

### 7.2 Access Database Credentials

**Via Web UI:**
1. Click on your PostgreSQL service
2. Go to **Variables** tab
3. See `DATABASE_URL`, `PGHOST`, `PGUSER`, etc.

**Via CLI:**
```bash
railway variables | grep PG
```

### 7.3 Connect Directly to Database

```bash
# Via Railway CLI (opens psql)
railway connect postgresql

# Or get connection string and use local psql
railway variables get DATABASE_URL
psql "your_connection_string"
```

### 7.4 Run Initial Schema

```bash
# Connect and run schema
railway connect postgresql < schema.sql

# Or via psql
psql "$DATABASE_URL" -f schema.sql
```

---

## 8. Environment Variables

### 8.1 Complete Variable Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Environment | `production` |
| `PORT` | Yes | Server port | `3000` |
| `DATABASE_URL` | Auto | PostgreSQL URL | Auto-injected |
| `DATA_DIR` | Yes | Data directory | `/app/data` |
| `SP_API_REFRESH_TOKEN` | Yes | Amazon refresh token | `Atzr\|xxx` |
| `SP_API_CLIENT_ID` | Yes | Amazon client ID | `amzn1.xxx` |
| `SP_API_CLIENT_SECRET` | Yes | Amazon client secret | `xxx` |
| `SP_API_SELLER_ID` | Yes | Your seller ID | `AXXXXX` |
| `SP_API_MARKETPLACE_ID` | Yes | UK marketplace | `A1F83G8C2ARO7P` |
| `KEEPA_API_KEY` | No | Keepa API key | `xxx` |
| `REDIS_URL` | No | Redis URL | Auto if added |
| `LOG_LEVEL` | No | Logging level | `info` |

### 8.2 Shared Variables

To share variables between services (API and Worker):

1. Go to **Project Settings** → **Shared Variables**
2. Add variables there
3. They're automatically available to all services

### 8.3 Reference Database URL

In Railway, you can reference other service variables:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

---

## 9. Worker Process Setup

### 9.1 Add Worker Service

**Via Web UI:**

1. In your project, click **"+ New"**
2. Select **"GitHub Repo"**
3. Choose the **same repository**
4. Go to **Settings**:
   - Root Directory: `main/app`
   - Start Command: `node src/workers/job-worker.js`

**Via CLI:**

```bash
# Create new service in same project
railway service create worker

# Set start command
railway service update worker --start-command "node src/workers/job-worker.js"
```

### 9.2 Worker Configuration

The worker automatically inherits shared variables including `DATABASE_URL`.

Add worker-specific settings:
```
WORKER_POLL_INTERVAL_MS=5000
WORKER_BATCH_SIZE=5
```

### 9.3 Multiple Workers (Scaling)

For high-volume processing:

1. Go to worker service **Settings**
2. Set **Replicas** to 2 or more
3. Workers use `FOR UPDATE SKIP LOCKED` for safe parallel processing

---

## 10. Custom Domain

### 10.1 Add Custom Domain

1. Go to your service → **Settings** → **Domains**
2. Click **"+ Custom Domain"**
3. Enter your domain: `app.yourdomain.com`

### 10.2 Configure DNS

Add these records at your DNS provider:

**Option A: CNAME (Recommended)**
```
Type: CNAME
Name: app
Value: your-service.railway.app
TTL: 3600
```

**Option B: A Record (for apex domain)**
```
Type: A
Name: @
Value: (Railway provides IP)
TTL: 3600
```

### 10.3 SSL Certificate

Railway automatically provisions SSL via Let's Encrypt:
- Wait 5-10 minutes after DNS propagation
- Check status in Domains section
- HTTPS is enforced automatically

---

## 11. Database Migrations

### 11.1 Create Migration Script

Create `scripts/migrate.js`:

```javascript
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

const { Pool } = pg;

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const migrationsDir = join(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  console.log(`Found ${files.length} migrations`);

  for (const file of files) {
    console.log(`Running: ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`✓ ${file}`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`⊘ ${file} (already applied)`);
      } else {
        console.error(`✗ ${file}: ${error.message}`);
        throw error;
      }
    }
  }

  await pool.end();
  console.log('Migrations complete!');
}

migrate().catch(console.error);
```

### 11.2 Run Migrations

**Via Railway CLI:**
```bash
railway run npm run db:migrate
```

**Via Web UI:**
1. Go to service → **Settings**
2. Add **Deploy Command**: `npm run db:migrate && npm start`

### 11.3 One-Time Schema Setup

```bash
# Run initial schema
railway run psql $DATABASE_URL -f schema.sql

# Run all migrations
railway run node scripts/migrate.js
```

---

## 12. Monitoring & Logs

### 12.1 View Logs

**Via Web UI:**
1. Click on your service
2. Select **"Logs"** tab
3. View real-time logs

**Via CLI:**
```bash
# Stream logs
railway logs

# Logs for specific service
railway logs --service api

# Last 100 lines
railway logs --tail 100
```

### 12.2 Metrics

Railway provides built-in metrics:
- CPU usage
- Memory usage
- Network I/O
- Request count

View in: Service → **Metrics** tab

### 12.3 Alerts

Set up alerts for:
- High CPU/memory usage
- Service crashes
- Deploy failures

Go to: **Project Settings** → **Integrations** → Connect Slack/Discord

### 12.4 Health Checks

Configure in service **Settings**:
- Health Check Path: `/api/v1/health`
- Health Check Timeout: `30` seconds
- Restart on failure: Enabled

---

## 13. Backups

### 13.1 Automatic Backups

Railway PostgreSQL includes:
- Point-in-time recovery (last 7 days)
- Daily snapshots

### 13.2 Manual Backup

```bash
# Dump database
railway run pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Or via CLI with connection
railway connect postgresql
\copy (SELECT * FROM listings) TO 'listings_backup.csv' CSV HEADER
```

### 13.3 Restore from Backup

```bash
# Restore from SQL dump
railway run psql $DATABASE_URL < backup_20260120.sql
```

### 13.4 Export to S3/MinIO

Create a scheduled backup script:

```javascript
// scripts/backup-to-s3.js
import { exec } from 'child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const backup = async () => {
  const filename = `backup_${Date.now()}.sql`;

  // Dump database
  await exec(`pg_dump $DATABASE_URL > /tmp/${filename}`);

  // Upload to S3
  const s3 = new S3Client({ /* config */ });
  await s3.send(new PutObjectCommand({
    Bucket: 'your-backups',
    Key: filename,
    Body: fs.readFileSync(`/tmp/${filename}`)
  }));
};
```

---

## 14. Scaling

### 14.1 Vertical Scaling (More Resources)

1. Go to service **Settings**
2. Adjust **Memory** and **CPU** limits
3. Redeploy

| Size | Memory | vCPU | Use Case |
|------|--------|------|----------|
| Small | 512MB | 0.5 | Development |
| Medium | 1GB | 1 | Small production |
| Large | 2GB | 2 | Medium production |
| XL | 4GB+ | 4 | High traffic |

### 14.2 Horizontal Scaling (More Instances)

1. Go to service **Settings**
2. Set **Replicas** count
3. Railway auto-load-balances

```
Replicas: 1 → 2 → 3
Load Balancer automatically distributes traffic
```

### 14.3 Database Scaling

1. Click on PostgreSQL service
2. Go to **Settings**
3. Upgrade plan for more:
   - Storage
   - Memory
   - Connections

---

## 15. Cost Management

### 15.1 Understanding Costs

Railway bills for:
- **Execution:** $0.000463/vCPU-minute
- **Memory:** $0.000231/GB-minute
- **Database Storage:** $0.25/GB-month
- **Network Egress:** $0.10/GB (after 100GB free)

### 15.2 Estimate Monthly Cost

| Component | Typical Usage | Monthly Cost |
|-----------|---------------|--------------|
| API Service (1 vCPU, 512MB, 24/7) | 730 hours | ~$10 |
| Worker Service (0.5 vCPU, 256MB, 24/7) | 730 hours | ~$5 |
| PostgreSQL (1GB storage) | 1GB | ~$5 |
| **Total** | | **~$20/month** |

### 15.3 Cost Optimization

**Auto-sleep for development:**
```json
// railway.json
{
  "deploy": {
    "sleepApplication": true,
    "sleepAfterMinutes": 30
  }
}
```

**Resource limits:**
- Set memory limits to prevent runaway usage
- Use `max_connections` on database

**Monitor usage:**
- Check **Project Settings** → **Usage**
- Set budget alerts

### 15.4 Set Usage Limits

1. Go to **Account Settings** → **Billing**
2. Set **Spending Limit**
3. Railway stops services when limit reached

---

## 16. Troubleshooting

### 16.1 Common Issues

#### Build Fails

```
Error: Cannot find module 'xxx'
```
**Solution:** Check `package.json` has all dependencies listed

```bash
# View build logs
railway logs --build
```

#### Database Connection Refused

```
Error: connect ECONNREFUSED
```
**Solution:**
1. Verify `DATABASE_URL` is set
2. Check SSL settings
3. Ensure database service is running

```javascript
// Add SSL for Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
```

#### Service Keeps Restarting

**Solution:**
1. Check health check endpoint works
2. View crash logs: `railway logs`
3. Increase memory if OOM

#### Port Issues

```
Error: listen EADDRINUSE
```
**Solution:** Use Railway's `PORT` environment variable

```javascript
const port = process.env.PORT || 3000;
fastify.listen({ port, host: '0.0.0.0' });
```

### 16.2 Debug Commands

```bash
# Check service status
railway status

# View all variables
railway variables

# Open shell in service
railway shell

# Run one-off command
railway run node -e "console.log(process.env.DATABASE_URL)"
```

### 16.3 Reset Deployment

```bash
# Redeploy from scratch
railway up --force

# Or via UI: Settings → Deploy → Redeploy
```

---

## 17. CI/CD with GitHub Actions

### 17.1 Get Railway Token

1. Go to **Account Settings** → **Tokens**
2. Create new token: `github-actions`
3. Copy the token

### 17.2 Add GitHub Secret

1. Go to your GitHub repo → **Settings** → **Secrets**
2. Add secret: `RAILWAY_TOKEN` = your token

### 17.3 Create Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: main/app/package-lock.json

      - name: Install dependencies
        working-directory: main/app
        run: npm ci

      - name: Run tests
        working-directory: main/app
        run: npm test || true

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway
        working-directory: main/app
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service api

      - name: Deploy Worker
        working-directory: main/app
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service worker
```

### 17.4 Deploy on Release

```yaml
on:
  release:
    types: [published]
```

---

## Quick Reference

### Essential Commands

```bash
# Login
railway login

# Create project
railway init

# Add database
railway add --plugin postgresql

# Set variable
railway variables set KEY=value

# Deploy
railway up

# View logs
railway logs

# Open dashboard
railway open

# Connect to database
railway connect postgresql

# Run command
railway run <command>
```

### Project URLs

After deployment:
- **App:** `https://your-project.railway.app`
- **API:** `https://your-project.railway.app/api/v1/health`
- **Dashboard:** `https://railway.app/project/your-project`

---

## Checklist

- [ ] Railway account created
- [ ] GitHub repo connected
- [ ] PostgreSQL database added
- [ ] Environment variables configured
- [ ] Database schema applied
- [ ] Migrations run
- [ ] Health check working
- [ ] Worker service added (optional)
- [ ] Custom domain configured (optional)
- [ ] Monitoring set up
- [ ] Backups configured

---

## Support

- **Railway Docs:** https://docs.railway.app
- **Railway Discord:** https://discord.gg/railway
- **Status Page:** https://status.railway.app

---

*Document created: 2026-01-20*
