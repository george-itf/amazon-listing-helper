# Amazon Listing Helper - Project Context

## Quick Start for Claude
Tell Claude: "Help me with my Amazon Listing Helper project. It's a Node.js/Fastify API with PostgreSQL, deployed on Hetzner."

## Architecture
- **Frontend:** Static HTML/JS served by Node (port 3000)
- **API:** Fastify Node.js server (port 4000)
- **Database:** PostgreSQL on the same VPS
- **Reverse Proxy:** Nginx with SSL (Let's Encrypt)

## Deployment
- **Domain:** https://listings.invicta-tools-online.co.uk
- **Server:** Hetzner VPS - 46.224.229.175
- **SSH:** `ssh -i key.txt root@46.224.229.175`
- **PM2 Apps:**
  - ID 2: `amazon-listing-helper` (API on port 4000)
  - ID 3: `web` (Frontend on port 3000)

## Key Paths on Server
- **App code:** `/opt/alh/`
- **Frontend:** `/opt/alh/web/`
- **API:** `/opt/alh/app/`
- **Nginx config:** `/etc/nginx/sites-available/alh`
- **PM2 logs:** `/root/.pm2/logs/`

## Database
- **Host:** localhost (on VPS)
- **Database:** amazon_listing_helper
- **User:** alh_user
- **Password:** AmazonHelper2026Secure!

### Connect to DB:
```bash
PGPASSWORD='AmazonHelper2026Secure!' psql -h localhost -U alh_user -d amazon_listing_helper
```


```
