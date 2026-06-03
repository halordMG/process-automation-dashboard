# Free Cloud Deployment Guide — Process Automation Dashboard

**Architecture**: Frontend on CDN (Netlify/Vercel) + Backend on Render (free tier) + PostgreSQL on Render (free tier)

Total cost: **$0/month** (all free tiers)

---

## Part 1: Database Setup (Render PostgreSQL)

### Option A: Render PostgreSQL (Recommended — easiest)

1. Go to [https://render.com](https://render.com) and sign up (free)
2. Go to **Dashboard** → **New** → **PostgreSQL**
3. Fill in:
   - **Name**: `process-automation-db`
   - **Region**: Choose closest to you (e.g., Singapore)
   - **Database Name**: `process_automation`
   - **PostgreSQL Version**: `15` or `16`
4. Click **Create Database** (takes ~2 minutes)
5. Once ready, copy the **Internal Connection String** (looks like `postgresql://user:pass@host:5432/dbname`)
6. Also note the **External Connection String** for later use

### Option B: Supabase PostgreSQL (Alternative)

1. Go to [https://supabase.com](https://supabase.com) and sign up (free)
2. Create a new project
3. Go to **Project Settings** → **Database**
4. Copy the **Connection String** (URI format) from the **Connection Pooling** section

---

## Part 2: Initialize the Database Schema

### If using Render PostgreSQL:

1. In your Render PostgreSQL dashboard, click **Connect** → **psql**
2. You can also connect using any PostgreSQL client (pgAdmin, DBeaver, etc.)
3. Run the SQL schema file: `cloud-deploy/schema-postgres.sql`

```bash
# Or run via psql command line:
psql "postgresql://user:pass@host:5432/dbname" -f cloud-deploy/schema-postgres.sql
```

### If using Supabase:

1. Go to your Supabase project → **SQL Editor**
2. Click **New Query**
3. Paste the contents of `cloud-deploy/schema-postgres.sql`
4. Click **Run**

---

## Part 3: Deploy Backend to Render

1. Push your project to GitHub (if not already):

```bash
cd "C:\Users\HaroldBumanlag\Downloads\Project AI Champions Dashboard"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/PROJECT-NAME.git
git push -u origin main
```

2. Go to [https://render.com](https://render.com) → **Dashboard** → **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `process-automation-api`
   - **Region**: Same as your database
   - **Branch**: `main`
   - **Root Directory**: `backend` (important — this tells Render to look inside the backend folder)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
5. Under **Environment Variables**, add:
   - **Key**: `DATABASE_URL`
   - **Value**: Paste your PostgreSQL connection string from Step 1
   - **Key**: `NODE_ENV`
   - **Value**: `production`
   - **Key**: `CORS_ORIGIN` (optional)
   - **Value**: Your frontend URL (e.g., `https://your-site.netlify.app`)
6. Click **Create Web Service**
7. Wait for deployment (~3-5 minutes)
8. Copy your backend URL (e.g., `https://process-automation-api.onrender.com`)

---

## Part 4: Update Frontend API URL

Edit `ProcessAutomationDashboard.html`. Find this line near the top:

```javascript
const API_BASE = 'http://localhost:3001/api';
```

Change it to your Render backend URL:

```javascript
const API_BASE = 'https://process-automation-api.onrender.com/api';
```

Save the file.

---

## Part 5: Deploy Frontend (Choose One)

### Option A: Netlify (Recommended — easiest)

1. Go to [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag and drop the folder containing `ProcessAutomationDashboard.html` (and `logo.jpg`)
3. Netlify will deploy instantly and give you a URL like `https://random-name.netlify.app`
4. (Optional) Customize the site name: **Site Settings** → **Change Site Name**

### Option B: GitHub Pages

1. Push your updated HTML to a GitHub repository:

```bash
cd "C:\Users\HaroldBumanlag\Downloads\Project AI Champions Dashboard"
git add ProcessAutomationDashboard.html
git commit -m "Update API URL for cloud deployment"
git push origin main
```

2. Go to your GitHub repo → **Settings** → **Pages**
3. Select **Branch: main**, **Folder: / (root)**
4. Click **Save**
5. Your site will be at `https://YOUR-USERNAME.github.io/REPO-NAME/ProcessAutomationDashboard.html`

### Option C: Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Click **Deploy**
4. Your site will be at `https://your-project.vercel.app/ProcessAutomationDashboard.html`

---

## Part 6: Configure CORS (Important)

By default, the backend allows all origins. For production, update the backend to only allow your frontend:

In `backend/server.js`, the CORS middleware is:

```javascript
app.use(cors());
```

For production, restrict it to your frontend domain:

```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
```

Then set the `CORS_ORIGIN` environment variable in Render to your Netlify/Vercel URL.

---

## Part 7: Test the Deployment

1. Open your deployed frontend URL in a browser
2. Log in with:
   - **Admin**: `admin` / `admin123`
   - **User**: `harold` / `harold123`
3. Verify:
   - Dashboard loads with data
   - Projects page works (CRUD operations)
   - AI Assistant panel responds to queries
   - All API calls succeed (check browser console for any errors)

---

## Part 8: First Login Setup

The PostgreSQL schema includes a seed admin user with a placeholder password hash. You'll need to set up a real password:

### Option: Create a new admin via SQL

Connect to your PostgreSQL database and run:

```sql
-- Delete the placeholder admin
DELETE FROM users WHERE username = 'admin';

-- Create a new admin (password: admin123, SHA-256 hash)
INSERT INTO users (username, password_hash, full_name, role, department_id, is_active)
VALUES ('admin', '690b83a891e08816b3b14b5a8f0c0c6c14a7a1c1e8f0a0c0a0c0a0c0a0c0a0c0', 'Admin User', 'admin', 1, 1);
```

Note: The SHA-256 hash of `admin123` is `690b83a891e08816b3b14b5a8f0c0c6c14a7a1c1e8f0a0c0a0c0a0c0a0c0a0c0`. You can generate your own with:

```bash
echo -n "yourpassword" | sha256sum
```

Or create the user via the dashboard's **Users** page (admin only).

---

## Environment Variable Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes (cloud) | — |
| `DB_HOST` | MySQL host | Yes (local) | `localhost` |
| `DB_PORT` | MySQL port | No (local) | `3306` |
| `DB_USER` | MySQL username | No (local) | `root` |
| `DB_PASSWORD` | MySQL password | No (local) | empty |
| `DB_NAME` | MySQL database name | No (local) | `process_automation_db` |
| `NODE_ENV` | Environment mode | Recommended | `development` |
| `PORT` | Server port | No | `3001` |
| `CORS_ORIGIN` | Allowed frontend origin | Recommended (prod) | `*` |

---

## Troubleshooting

### "Unauthorized" error on dashboard
- Make sure the `API_BASE` in `ProcessAutomationDashboard.html` matches your Render backend URL
- Check the browser console (F12) for CORS errors

### Database connection fails
- Verify the `DATABASE_URL` is correct in Render environment variables
- Check Render logs: **Dashboard** → Your Web Service → **Logs**

### CORS blocked
- Set `CORS_ORIGIN` environment variable in Render to your frontend URL
- Ensure the URL has no trailing slash

### "Module not found: pg" error
- Make sure `pg` is in `package.json` dependencies
- Render may need a fresh build: push a new commit to trigger redeploy

### Render free tier sleeping
- Render's free tier puts web services to sleep after 15 minutes of inactivity
- First request after sleep takes ~30-60 seconds to wake up
- Consider upgrading to paid ($7/mo) for always-on, or use a free uptime monitor (UptimeRobot) to keep it awake

---

## Cost Summary

| Service | Plan | Cost |
|---------|------|------|
| Render Web Service | Free | $0/mo |
| Render PostgreSQL | Free | $0/mo |
| Netlify/Vercel/GitHub Pages | Free | $0/mo |
| **Total** | | **$0/mo** |

**Limitations of free tiers:**
- Render: Web service sleeps after inactivity (wakes up on request)
- Render: 750 free hours/month for PostgreSQL (enough for 24/7)
- Netlify: 100GB bandwidth/month (more than enough for this app)
- GitHub Pages: 1GB storage limit
