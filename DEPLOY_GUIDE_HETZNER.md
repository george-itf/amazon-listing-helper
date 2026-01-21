# Amazon Listing Helper - Hetzner Deployment Guide

**Version:** 1.0
**Date:** 2026-01-20
**Application:** Amazon Listing Helper (ALH)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Server Provisioning](#3-server-provisioning)
4. [Initial Server Setup](#4-initial-server-setup)
5. [Install Dependencies](#5-install-dependencies)
6. [Database Setup](#6-database-setup)
7. [Application Deployment](#7-application-deployment)
8. [Reverse Proxy (Nginx)](#8-reverse-proxy-nginx)
9. [SSL/TLS Certificates](#9-ssltls-certificates)
10. [Process Management](#10-process-management)
11. [Firewall Configuration](#11-firewall-configuration)
12. [Environment Configuration](#12-environment-configuration)
13. [Backups](#13-backups)
14. [Monitoring & Logging](#14-monitoring--logging)
15. [Maintenance](#15-maintenance)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HETZNER VPS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌─────────────┐    ┌──────────────────────┐   │
│   │  Nginx   │───▶│  Node.js    │───▶│  PostgreSQL          │   │
│   │  (443)   │    │  (3000)     │    │  (TimescaleDB)       │   │
│   └──────────┘    └─────────────┘    │  (5432)              │   │
│        │                │            └──────────────────────┘   │
│        │                │                                        │
│        ▼                ▼            ┌──────────────────────┐   │
│   ┌──────────┐    ┌─────────────┐   │  MinIO (S3)          │   │
│   │  Static  │    │  Redis      │   │  (9000/9001)         │   │
│   │  Files   │    │  (6379)     │   └──────────────────────┘   │
│   └──────────┘    └─────────────┘                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Stack Components

| Component | Version | Purpose |
|-----------|---------|---------|
| Ubuntu | 22.04 LTS | Operating System |
| Node.js | 20 LTS | Application Runtime |
| PostgreSQL | 15 (TimescaleDB) | Primary Database |
| Redis | 7 | Caching & Job Queue |
| MinIO | Latest | Object Storage |
| Nginx | Latest | Reverse Proxy |
| PM2 | Latest | Process Manager |
| Docker | Latest | Container Runtime |

---

## 2. Prerequisites

### Required Accounts

- [ ] Hetzner Cloud account
- [ ] Domain name (optional but recommended)
- [ ] Amazon SP-API credentials (refresh token, client ID, client secret)
- [ ] Keepa API key (optional)

### Recommended Server Specifications

| Tier | vCPU | RAM | Storage | Cost (approx) | Use Case |
|------|------|-----|---------|---------------|----------|
| **Starter** | 2 | 4GB | 40GB SSD | €4.50/mo | Development/Testing |
| **Standard** | 2 | 8GB | 80GB SSD | €8.00/mo | Small catalog (<1000 SKUs) |
| **Production** | 4 | 16GB | 160GB SSD | €16.00/mo | Medium catalog (1000-10000 SKUs) |
| **Enterprise** | 8 | 32GB | 240GB SSD | €32.00/mo | Large catalog (>10000 SKUs) |

---

## 3. Server Provisioning

### 3.1 Create Hetzner Cloud Server

1. **Login to Hetzner Cloud Console**
   - Navigate to: https://console.hetzner.cloud

2. **Create New Project** (if needed)
   ```
   Project name: amazon-listing-helper
   ```

3. **Add New Server**
   - Click "Add Server"
   - **Location:** Choose nearest (e.g., `Falkenstein`, `Nuremberg`, or `Helsinki`)
   - **Image:** Ubuntu 22.04
   - **Type:** CPX21 (2 vCPU, 4GB RAM) minimum
   - **Volume:** Add 50GB+ if needed
   - **Network:** Enable IPv4 and IPv6
   - **SSH Keys:** Add your public SSH key
   - **Name:** `alh-production-01`

4. **Note Your Server IP**
   ```
   IPv4: xxx.xxx.xxx.xxx
   IPv6: xxxx:xxxx:xxxx:xxxx::1
   ```

### 3.2 DNS Configuration (Optional)

If using a domain, add these DNS records:

```
Type    Name              Value                TTL
A       @                 YOUR_SERVER_IP       3600
A       api               YOUR_SERVER_IP       3600
A       www               YOUR_SERVER_IP       3600
AAAA    @                 YOUR_IPV6_ADDRESS    3600
```

---

## 4. Initial Server Setup

### 4.1 Connect to Server

```bash
ssh root@YOUR_SERVER_IP
```

### 4.2 Update System

```bash
# Update package lists and upgrade
apt update && apt upgrade -y

# Install essential tools
apt install -y \
    curl \
    wget \
    git \
    htop \
    vim \
    nano \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    fail2ban \
    ufw
```

### 4.3 Create Application User

```bash
# Create dedicated user for the application
adduser --disabled-password --gecos "" alh

# Add to sudo group (optional, for maintenance)
usermod -aG sudo alh

# Set password (optional)
passwd alh

# Create application directories
mkdir -p /opt/alh/{app,data,logs,backups}
chown -R alh:alh /opt/alh
```

### 4.4 Configure SSH Security

```bash
# Backup original sshd_config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Edit SSH configuration
nano /etc/ssh/sshd_config
```

Update these settings:
```
Port 22                          # Consider changing to non-standard port
PermitRootLogin prohibit-password  # Or 'no' after setting up alh user
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
# Restart SSH
systemctl restart sshd
```

### 4.5 Set Timezone

```bash
timedatectl set-timezone Europe/London  # Adjust for your timezone
```

---

## 5. Install Dependencies

### 5.1 Install Node.js 20 LTS

```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version
```

### 5.2 Install Docker & Docker Compose

```bash
# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add alh user to docker group
usermod -aG docker alh

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Verify installation
docker --version
docker compose version
```

### 5.3 Install PM2 (Process Manager)

```bash
npm install -g pm2

# Enable PM2 startup on boot
pm2 startup systemd -u alh --hp /home/alh
```

### 5.4 Install Nginx

```bash
apt install -y nginx

# Enable and start Nginx
systemctl enable nginx
systemctl start nginx
```

---

## 6. Database Setup

### 6.1 Create Docker Compose Configuration

```bash
# Switch to alh user
su - alh

# Navigate to app directory
cd /opt/alh

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: timescale/timescaledb:latest-pg15
    container_name: alh-postgres
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: amazon_listing_helper
      POSTGRES_USER: alh_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U alh_user -d amazon_listing_helper"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: alh-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: alh-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  postgres_data:
  redis_data:
  minio_data:
EOF
```

### 6.2 Create Init SQL

```bash
cat > init.sql << 'EOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS ops;
EOF
```

### 6.3 Create Docker Environment File

```bash
# Generate secure passwords
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
MINIO_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

# Create .env file for Docker
cat > .env << EOF
DB_PASSWORD=${DB_PASSWORD}
MINIO_PASSWORD=${MINIO_PASSWORD}
EOF

# Save passwords securely
cat > /opt/alh/.secrets << EOF
# AUTO-GENERATED SECRETS - KEEP SECURE
DB_PASSWORD=${DB_PASSWORD}
MINIO_PASSWORD=${MINIO_PASSWORD}
EOF
chmod 600 /opt/alh/.secrets

echo "Passwords saved to /opt/alh/.secrets"
```

### 6.4 Start Database Services

```bash
# Start services
docker compose up -d

# Wait for services to be healthy
sleep 10

# Verify services are running
docker compose ps

# Check logs
docker compose logs postgres
```

### 6.5 Initialize Database Schema

```bash
# Install PostgreSQL client (as root)
exit  # Back to root
apt install -y postgresql-client
su - alh

# Load your passwords
source /opt/alh/.secrets

# Apply schema
cd /opt/alh/app
psql "postgresql://alh_user:${DB_PASSWORD}@localhost:5432/amazon_listing_helper" -f schema.sql

# Apply migrations
for migration in migrations/*.sql; do
    echo "Applying $migration..."
    psql "postgresql://alh_user:${DB_PASSWORD}@localhost:5432/amazon_listing_helper" -f "$migration"
done
```

---

## 7. Application Deployment

### 7.1 Clone/Upload Application

**Option A: Git Clone (if using Git repository)**
```bash
su - alh
cd /opt/alh
git clone YOUR_REPO_URL app
cd app
```

**Option B: Upload via SCP (from local machine)**
```bash
# From your local machine
scp -r ./main/* alh@YOUR_SERVER_IP:/opt/alh/app/
```

### 7.2 Install Node Dependencies

```bash
su - alh
cd /opt/alh/app

# Install production dependencies
npm install --production

# If you have a web directory with its own dependencies
cd /opt/alh/app/web
npm install --production
```

### 7.3 Create Application Environment File

```bash
# Load secrets
source /opt/alh/.secrets

# Create .env file
cat > /opt/alh/app/.env << EOF
# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://alh_user:${DB_PASSWORD}@localhost:5432/amazon_listing_helper?schema=public
DB_HOST=localhost
DB_PORT=5432
DB_NAME=amazon_listing_helper
DB_USER=alh_user
DB_PASSWORD=${DB_PASSWORD}

# Redis
REDIS_URL=redis://localhost:6379

# MinIO / S3
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=${MINIO_PASSWORD}
MINIO_USE_SSL=false

# Data Directory
DATA_DIR=/opt/alh/data

# Amazon SP-API (Fill in your credentials)
SP_API_REFRESH_TOKEN=
SP_API_CLIENT_ID=
SP_API_CLIENT_SECRET=
SP_API_SELLER_ID=
SP_API_MARKETPLACE_ID=A1F83G8C2ARO7P

# Keepa API (Optional)
KEEPA_API_KEY=

# Logging
LOG_LEVEL=info
LOG_DIR=/opt/alh/logs
EOF

chmod 600 /opt/alh/app/.env
```

### 7.4 Create Credentials File

```bash
mkdir -p /opt/alh/data

cat > /opt/alh/data/credentials.json << 'EOF'
{
  "refreshToken": "YOUR_REFRESH_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "sellerId": "YOUR_SELLER_ID",
  "marketplaceId": "A1F83G8C2ARO7P",
  "keepaKey": "YOUR_KEEPA_API_KEY"
}
EOF

chmod 600 /opt/alh/data/credentials.json
```

### 7.5 Test Application

```bash
cd /opt/alh/app

# Run in foreground to test
node src/server.js

# Should see:
# API v2 routes registered
# Server listening at http://0.0.0.0:3000

# Test endpoint (from another terminal)
curl http://localhost:3000/api/v1/health
# Should return: {"status":"ok"}

# Press Ctrl+C to stop
```

---

## 8. Reverse Proxy (Nginx)

### 8.1 Create Nginx Configuration

```bash
# As root
cat > /etc/nginx/sites-available/alh << 'EOF'
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;

    # Allow Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;

    # SSL certificates (will be configured after certbot)
    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/alh_access.log;
    error_log /var/log/nginx/alh_error.log;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # Root for static files
    root /opt/alh/app/web;
    index index.html;

    # Static file caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;

        # Enable request body buffering for file uploads
        client_max_body_size 50M;
    }

    # Serve index.html for SPA routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

### 8.2 For IP-Only Access (No Domain)

If not using a domain, use this simpler config:

```bash
cat > /etc/nginx/sites-available/alh << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Logging
    access_log /var/log/nginx/alh_access.log;
    error_log /var/log/nginx/alh_error.log;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Root for static files
    root /opt/alh/app/web;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

### 8.3 Enable Site

```bash
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Enable ALH site
ln -sf /etc/nginx/sites-available/alh /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Reload Nginx
systemctl reload nginx
```

---

## 9. SSL/TLS Certificates

### 9.1 Install Certbot

```bash
apt install -y certbot python3-certbot-nginx
```

### 9.2 Obtain Certificate

```bash
# Create webroot directory
mkdir -p /var/www/certbot

# Obtain certificate (replace YOUR_DOMAIN.com)
certbot --nginx -d YOUR_DOMAIN.com -d www.YOUR_DOMAIN.com

# Follow the prompts:
# - Enter email address
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: yes)
```

### 9.3 Auto-Renewal

Certbot automatically sets up renewal. Verify:

```bash
# Test renewal
certbot renew --dry-run

# Check timer
systemctl status certbot.timer
```

---

## 10. Process Management

### 10.1 Create PM2 Ecosystem File

```bash
su - alh
cd /opt/alh/app

cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: 'alh-api',
      script: 'src/server.js',
      cwd: '/opt/alh/app',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_file: '/opt/alh/app/.env',
      error_file: '/opt/alh/logs/api-error.log',
      out_file: '/opt/alh/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true
    },
    {
      name: 'alh-worker',
      script: 'src/workers/job-worker.js',
      cwd: '/opt/alh/app',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      env_file: '/opt/alh/app/.env',
      error_file: '/opt/alh/logs/worker-error.log',
      out_file: '/opt/alh/logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
EOF
```

### 10.2 Start Application

```bash
# Start all apps
pm2 start ecosystem.config.cjs

# Save process list
pm2 save

# View status
pm2 status

# View logs
pm2 logs

# Monitor
pm2 monit
```

### 10.3 PM2 Commands Reference

```bash
# Restart all
pm2 restart all

# Restart specific app
pm2 restart alh-api

# Stop all
pm2 stop all

# View logs
pm2 logs alh-api --lines 100

# Flush logs
pm2 flush

# Update PM2
pm2 update
```

---

## 11. Firewall Configuration

### 11.1 Configure UFW

```bash
# As root

# Reset UFW
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (IMPORTANT: Do this first!)
ufw allow ssh
# Or if using custom SSH port:
# ufw allow 2222/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow PostgreSQL only from localhost (already bound to 127.0.0.1)
# No rule needed

# Enable UFW
ufw --force enable

# Check status
ufw status verbose
```

### 11.2 Configure Fail2ban

```bash
# Create ALH jail
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 3
bantime = 24h

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
maxretry = 5

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
maxretry = 10
findtime = 1m
bantime = 1h
EOF

# Restart fail2ban
systemctl restart fail2ban
systemctl enable fail2ban

# Check status
fail2ban-client status
```

---

## 12. Environment Configuration

### 12.1 Complete Environment Variables Reference

```bash
# /opt/alh/app/.env

# ============================================================================
# SERVER CONFIGURATION
# ============================================================================
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# ============================================================================
# DATABASE
# ============================================================================
DATABASE_URL=postgresql://alh_user:PASSWORD@localhost:5432/amazon_listing_helper?schema=public
DB_HOST=localhost
DB_PORT=5432
DB_NAME=amazon_listing_helper
DB_USER=alh_user
DB_PASSWORD=YOUR_SECURE_PASSWORD

# ============================================================================
# REDIS
# ============================================================================
REDIS_URL=redis://localhost:6379

# ============================================================================
# MINIO / S3
# ============================================================================
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=YOUR_SECURE_PASSWORD
MINIO_USE_SSL=false

# ============================================================================
# DATA DIRECTORY
# ============================================================================
DATA_DIR=/opt/alh/data

# ============================================================================
# AMAZON SP-API
# ============================================================================
# Get these from Amazon Seller Central > Apps & Services > Develop Apps
SP_API_REFRESH_TOKEN=Atzr|YOUR_REFRESH_TOKEN
SP_API_CLIENT_ID=amzn1.application-oa2-client.YOUR_CLIENT_ID
SP_API_CLIENT_SECRET=YOUR_CLIENT_SECRET
SP_API_SELLER_ID=YOUR_SELLER_ID
SP_API_MARKETPLACE_ID=A1F83G8C2ARO7P  # UK Marketplace

# ============================================================================
# KEEPA API (Optional)
# ============================================================================
KEEPA_API_KEY=YOUR_KEEPA_API_KEY

# ============================================================================
# LOGGING
# ============================================================================
LOG_LEVEL=info
LOG_DIR=/opt/alh/logs

# ============================================================================
# JOB WORKER
# ============================================================================
WORKER_POLL_INTERVAL_MS=5000
WORKER_BATCH_SIZE=5
```

---

## 13. Backups

### 13.1 Create Backup Script

```bash
cat > /opt/alh/scripts/backup.sh << 'EOF'
#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/opt/alh/backups"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="alh_backup_${DATE}"

# Load secrets
source /opt/alh/.secrets

# Create backup directory
mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"

echo "[$(date)] Starting backup: ${BACKUP_NAME}"

# Backup PostgreSQL
echo "[$(date)] Backing up PostgreSQL..."
docker exec alh-postgres pg_dump -U alh_user amazon_listing_helper | gzip > "${BACKUP_DIR}/${BACKUP_NAME}/database.sql.gz"

# Backup data directory
echo "[$(date)] Backing up data directory..."
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz" -C /opt/alh data/

# Backup configuration
echo "[$(date)] Backing up configuration..."
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/config.tar.gz" \
    /opt/alh/app/.env \
    /opt/alh/docker-compose.yml \
    /opt/alh/.secrets \
    /etc/nginx/sites-available/alh

# Create combined archive
echo "[$(date)] Creating combined archive..."
cd "${BACKUP_DIR}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}/"
rm -rf "${BACKUP_NAME}"

# Calculate checksum
sha256sum "${BACKUP_NAME}.tar.gz" > "${BACKUP_NAME}.tar.gz.sha256"

# Cleanup old backups
echo "[$(date)] Cleaning up old backups..."
find "${BACKUP_DIR}" -name "alh_backup_*.tar.gz*" -mtime +${RETENTION_DAYS} -delete

# Report
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)
echo "[$(date)] Backup complete: ${BACKUP_NAME}.tar.gz (${BACKUP_SIZE})"

# List recent backups
echo "[$(date)] Recent backups:"
ls -lh "${BACKUP_DIR}"/*.tar.gz | tail -5
EOF

chmod +x /opt/alh/scripts/backup.sh
chown alh:alh /opt/alh/scripts/backup.sh
```

### 13.2 Create Restore Script

```bash
cat > /opt/alh/scripts/restore.sh << 'EOF'
#!/bin/bash
set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.tar.gz>"
    echo "Available backups:"
    ls -lh /opt/alh/backups/*.tar.gz
    exit 1
fi

BACKUP_FILE="$1"
RESTORE_DIR="/tmp/alh_restore_$$"

# Load secrets
source /opt/alh/.secrets

echo "[$(date)] Starting restore from: ${BACKUP_FILE}"

# Extract backup
echo "[$(date)] Extracting backup..."
mkdir -p "${RESTORE_DIR}"
tar -xzf "${BACKUP_FILE}" -C "${RESTORE_DIR}"
BACKUP_NAME=$(ls "${RESTORE_DIR}")

# Stop application
echo "[$(date)] Stopping application..."
pm2 stop all || true

# Restore database
echo "[$(date)] Restoring database..."
gunzip -c "${RESTORE_DIR}/${BACKUP_NAME}/database.sql.gz" | \
    docker exec -i alh-postgres psql -U alh_user amazon_listing_helper

# Restore data directory
echo "[$(date)] Restoring data directory..."
tar -xzf "${RESTORE_DIR}/${BACKUP_NAME}/data.tar.gz" -C /opt/alh/

# Cleanup
rm -rf "${RESTORE_DIR}"

# Start application
echo "[$(date)] Starting application..."
pm2 start all

echo "[$(date)] Restore complete!"
EOF

chmod +x /opt/alh/scripts/restore.sh
chown alh:alh /opt/alh/scripts/restore.sh
```

### 13.3 Schedule Automatic Backups

```bash
# As alh user
crontab -e

# Add these lines:
# Daily backup at 3 AM
0 3 * * * /opt/alh/scripts/backup.sh >> /opt/alh/logs/backup.log 2>&1

# Weekly database vacuum at 4 AM on Sunday
0 4 * * 0 docker exec alh-postgres psql -U alh_user -c "VACUUM ANALYZE;" amazon_listing_helper
```

### 13.4 Optional: Off-site Backup to Hetzner Storage Box

```bash
# Install rclone
curl https://rclone.org/install.sh | bash

# Configure rclone for Hetzner Storage Box
rclone config

# Add to backup script:
echo "Syncing to off-site storage..."
rclone sync /opt/alh/backups/ hetzner:alh-backups/ --max-age 30d
```

---

## 14. Monitoring & Logging

### 14.1 Log Rotation

```bash
cat > /etc/logrotate.d/alh << 'EOF'
/opt/alh/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 alh alh
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

### 14.2 Create Health Check Script

```bash
cat > /opt/alh/scripts/healthcheck.sh << 'EOF'
#!/bin/bash

WEBHOOK_URL="${HEALTHCHECK_WEBHOOK:-}"
ERRORS=""

# Check API
if ! curl -sf http://localhost:3000/api/v1/health > /dev/null; then
    ERRORS="${ERRORS}API health check failed\n"
fi

# Check PostgreSQL
if ! docker exec alh-postgres pg_isready -U alh_user > /dev/null 2>&1; then
    ERRORS="${ERRORS}PostgreSQL not ready\n"
fi

# Check Redis
if ! docker exec alh-redis redis-cli ping > /dev/null 2>&1; then
    ERRORS="${ERRORS}Redis not responding\n"
fi

# Check disk space
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
    ERRORS="${ERRORS}Disk usage at ${DISK_USAGE}%\n"
fi

# Report errors
if [ -n "$ERRORS" ]; then
    echo -e "[$(date)] Health check FAILED:\n${ERRORS}"
    if [ -n "$WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"ALH Health Check Failed:\n${ERRORS}\"}" \
            "$WEBHOOK_URL"
    fi
    exit 1
fi

echo "[$(date)] Health check passed"
EOF

chmod +x /opt/alh/scripts/healthcheck.sh

# Add to cron (every 5 minutes)
# */5 * * * * /opt/alh/scripts/healthcheck.sh >> /opt/alh/logs/healthcheck.log 2>&1
```

### 14.3 View Logs

```bash
# Application logs
pm2 logs

# Nginx logs
tail -f /var/log/nginx/alh_access.log
tail -f /var/log/nginx/alh_error.log

# Docker logs
docker compose logs -f postgres
docker compose logs -f redis

# System logs
journalctl -u nginx -f
```

---

## 15. Maintenance

### 15.1 Update Application

```bash
#!/bin/bash
# /opt/alh/scripts/deploy.sh

set -e

cd /opt/alh/app

# Pull latest code (if using Git)
git pull origin main

# Install dependencies
npm install --production

# Run database migrations
for migration in migrations/*.sql; do
    echo "Checking $migration..."
    psql "$DATABASE_URL" -f "$migration" 2>/dev/null || true
done

# Restart application
pm2 reload ecosystem.config.cjs

echo "Deploy complete!"
```

### 15.2 Update System Packages

```bash
# Monthly maintenance script
cat > /opt/alh/scripts/maintenance.sh << 'EOF'
#!/bin/bash
set -e

echo "[$(date)] Starting monthly maintenance..."

# Update system packages
apt update && apt upgrade -y

# Update Docker images
docker compose pull
docker compose up -d

# Clean Docker
docker system prune -f

# Update PM2
npm update -g pm2
pm2 update

# Vacuum database
docker exec alh-postgres psql -U alh_user -c "VACUUM ANALYZE;" amazon_listing_helper

# Clear old logs
find /opt/alh/logs -name "*.log.*" -mtime +30 -delete

echo "[$(date)] Maintenance complete!"
EOF
chmod +x /opt/alh/scripts/maintenance.sh
```

### 15.3 Database Maintenance

```bash
# Vacuum and analyze
docker exec alh-postgres psql -U alh_user -c "VACUUM ANALYZE;" amazon_listing_helper

# Check database size
docker exec alh-postgres psql -U alh_user -c "
SELECT pg_size_pretty(pg_database_size('amazon_listing_helper'));
" amazon_listing_helper

# Check table sizes
docker exec alh-postgres psql -U alh_user -c "
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 20;
" amazon_listing_helper
```

---

## 16. Troubleshooting

### 16.1 Common Issues

#### Application Won't Start

```bash
# Check PM2 logs
pm2 logs alh-api --lines 100

# Check if port is in use
ss -tlnp | grep 3000

# Check environment variables
pm2 env 0

# Restart application
pm2 restart all
```

#### Database Connection Failed

```bash
# Check PostgreSQL status
docker ps | grep postgres
docker compose logs postgres

# Test connection
docker exec alh-postgres psql -U alh_user -c "SELECT 1;" amazon_listing_helper

# Restart PostgreSQL
docker compose restart postgres
```

#### Nginx 502 Bad Gateway

```bash
# Check if application is running
curl http://localhost:3000/api/v1/health

# Check Nginx error log
tail -50 /var/log/nginx/alh_error.log

# Check Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

#### High Memory Usage

```bash
# Check memory usage
free -h
htop

# Check PM2 memory
pm2 monit

# Restart application to clear memory
pm2 restart all

# Clear Redis cache
docker exec alh-redis redis-cli FLUSHALL
```

#### Disk Space Full

```bash
# Check disk usage
df -h

# Find large files
du -sh /opt/alh/* | sort -h
du -sh /var/log/* | sort -h

# Clean Docker
docker system prune -a

# Clean old backups
find /opt/alh/backups -mtime +30 -delete

# Clean logs
pm2 flush
```

### 16.2 Useful Commands Reference

```bash
# Application
pm2 status                    # View status
pm2 logs                      # View logs
pm2 restart all               # Restart all
pm2 monit                     # Monitor

# Docker
docker compose ps             # View containers
docker compose logs -f        # View logs
docker compose restart        # Restart all
docker stats                  # Resource usage

# Database
docker exec -it alh-postgres psql -U alh_user amazon_listing_helper

# System
htop                          # Process viewer
df -h                         # Disk usage
free -h                       # Memory usage
ss -tlnp                      # Open ports
journalctl -xe                # System logs
```

---

## Quick Start Checklist

- [ ] Provision Hetzner server (Ubuntu 22.04, 4GB+ RAM)
- [ ] SSH in and run initial setup
- [ ] Install Node.js, Docker, PM2, Nginx
- [ ] Start database services with Docker Compose
- [ ] Upload application code
- [ ] Configure environment variables
- [ ] Initialize database schema
- [ ] Configure Nginx reverse proxy
- [ ] (Optional) Set up SSL with Certbot
- [ ] Start application with PM2
- [ ] Configure firewall
- [ ] Set up backup cron job
- [ ] Test all endpoints

---

**Need Help?**

- Check logs: `pm2 logs` and `/var/log/nginx/alh_error.log`
- Restart services: `pm2 restart all` or `docker compose restart`
- Full restart: `reboot`

---

*Document generated: 2026-01-20*
