# Process Automation Dashboard — Quick Deploy

## Overview

This dashboard can be hosted online for **free** using:
- **Frontend**: Netlify, Vercel, or GitHub Pages (free CDN)
- **Backend**: Render Web Service (free tier)
- **Database**: Render PostgreSQL (free tier)

## Quick Steps

1. **Push to GitHub** — Your project needs to be on GitHub first
2. **Create PostgreSQL Database** — See `cloud-deploy/DEPLOY-GUIDE.md` Part 1
3. **Run Schema** — Execute `cloud-deploy/schema-postgres.sql` on your database
4. **Deploy Backend** — Connect repo to Render as a Web Service (see Part 3)
5. **Update API URL** — Edit `API_BASE` in `ProcessAutomationDashboard.html`
6. **Deploy Frontend** — Drop folder to Netlify or push to GitHub Pages (see Part 5)

## Files You'll Need

| File | Purpose |
|------|---------|
| `cloud-deploy/DEPLOY-GUIDE.md` | Complete step-by-step deployment guide |
| `cloud-deploy/schema-postgres.sql` | PostgreSQL database schema (converts from MySQL) |
| `cloud-deploy/Procfile` | Render deployment config |
| `cloud-deploy/.env.example` | Environment variable template |
| `backend/db.js` | Database adapter (works with MySQL + PostgreSQL) |
| `backend/server.js` | Updated to support both databases |

## Cost

**$0/month** — All services have free tiers sufficient for this dashboard.

## Support

For detailed instructions, see `cloud-deploy/DEPLOY-GUIDE.md`
