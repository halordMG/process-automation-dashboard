# Host on GitHub Pages — Simple Guide

Your dashboard is a single HTML file, so it can run on **GitHub Pages for free**.

---

## Step 1: Push to GitHub

Open a terminal in your project folder:

```bash
cd "C:\Users\HaroldBumanlag\Downloads\Project AI Champions Dashboard"
git init
git add ProcessAutomationDashboard.html logo.jpg
git commit -m "Dashboard ready for GitHub Pages"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

Replace `YOUR-USERNAME` and `YOUR-REPO-NAME` with your GitHub account and repo name.

---

## Step 2: Enable GitHub Pages

1. Go to your GitHub repo page
2. Click **Settings** (tab near the top)
3. Click **Pages** (left sidebar)
4. Under **Source**, select:
   - **Branch**: `main`
   - **Folder**: `/ (root)`
5. Click **Save**
6. Wait ~1-2 minutes. Your site will be live at:

```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/ProcessAutomationDashboard.html
```

---

## Step 3: Connect to Your Backend

GitHub Pages is **static only** — it cannot run a backend server. Your API still needs to run somewhere.

### Option A: Backend stays on your PC (local development)

If your Node.js backend is running on your PC, update `ProcessAutomationDashboard.html`:

Find this line near the top:

```javascript
const API_BASE = 'http://localhost:3001/api';
```

Keep it as-is. Your GitHub Pages site will call your local backend. This works if you're the only user accessing the dashboard from your own PC.

### Option B: Backend on Render (free cloud — recommended)

Follow the backend deployment steps in `cloud-deploy/DEPLOY-GUIDE.md` (Parts 1-3), then update the `API_BASE` line:

```javascript
const API_BASE = 'https://your-backend-name.onrender.com/api';
```

Then push the change to GitHub:

```bash
git add ProcessAutomationDashboard.html
git commit -m "Update API for cloud backend"
git push
```

---

## That's It

- **Frontend**: Lives on GitHub Pages (free, static)
- **Backend**: Either your local PC or a free cloud service like Render
- **Database**: Either local MySQL or cloud PostgreSQL

Your dashboard URL will be:
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/ProcessAutomationDashboard.html
```

---

## Updating Your Site

Whenever you make changes to `ProcessAutomationDashboard.html`, just push to GitHub:

```bash
git add ProcessAutomationDashboard.html
git commit -m "Update dashboard"
git push
```

GitHub Pages auto-deploys in ~1 minute.

---

## Troubleshooting

**Dashboard shows "Unauthorized" or won't load data:**
- Your `API_BASE` URL doesn't match where your backend is running
- Check the browser console (F12) for error messages

**GitHub Pages shows a 404:**
- Make sure `ProcessAutomationDashboard.html` is in the root of your repo
- Wait 1-2 minutes after pushing — GitHub Pages takes a moment to deploy

**API calls blocked (CORS error):**
- Your backend needs to allow requests from GitHub Pages
- If using Render, set `CORS_ORIGIN` env variable to your GitHub Pages URL
