# Process Automation Dashboard

A single-page React dashboard for monitoring process automation projects across departments. Built with React 18 (CDN), Tailwind CSS, and a Node.js/Express backend.

## GitHub Pages Deployment

This repository is configured for GitHub Pages static hosting of the frontend.

### What Gets Hosted on GitHub Pages

- `index.html` — The dashboard frontend (React app loaded via CDN)
- `logo.jpg` — YSU logo

### Backend Requirements

GitHub Pages only hosts static files. The Node.js backend must run separately on:
- Your Synology NAS (local network access)
- Render / Railway / Heroku (cloud — see `cloud-deploy/`)
- Any server with Node.js and MariaDB/MySQL

### Configure Backend URL

When you open the dashboard on GitHub Pages, click **"Backend URL"** on the login screen and enter your backend API address, for example:

```
http://171.17.50.95:3001/api
```

Then click **Save & Reload**. The setting is stored in your browser and persists across visits.

You can also set it via URL parameter (one-time):

```
https://yourusername.github.io/your-repo?api=http://171.17.50.95:3001/api
```

### Demo Accounts

| Role     | Username | Password  |
|----------|----------|-----------|
| Admin    | admin    | admin123  |
| User     | harold   | harold123 |

### Features

- Role-based access (admin / user)
- Project tracking by stage (Discovery → Deploy)
- Department-based filtering and reporting
- Zoho Mail SMTP email notifications
- Activity timeline
- Responsive design

### Backend Setup (Separate Server)

See the `backend/` folder and `nas-deploy/` or `cloud-deploy/` guides for backend installation.

### Local Development

Open `index.html` directly in a browser, or serve with any static file server:

```bash
npx serve .
```
