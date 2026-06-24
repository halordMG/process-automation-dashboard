# Process Automation Monitoring Dashboard - Backend API

A Node.js/Express REST API connected to MySQL for the Process Automation Monitoring Dashboard.

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [MySQL](https://www.mysql.com/) (v8.0 or higher)

## Setup Instructions

### 1. Configure Database Connection

Open `.env` and update your MySQL credentials:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=process_automation_db
PORT=3001
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

```bash
npm start
```

The server will:
- Auto-create the database if it doesn't exist
- Auto-create all tables
- Seed initial data (departments, users, projects)
- Start listening on `http://localhost:3001`

### 4. Open the Dashboard

Open the `ProcessAutomationDashboard.html` file in your browser, or navigate to:
```
http://localhost:3001/ProcessAutomationDashboard.html
```

## Demo Accounts

Demo passwords are configured through environment variables (`SEED_ADMIN_PASSWORD`, `SEED_DEFAULT_PASSWORD`) and rendered into the seed SQL by `scripts/render-seed-sql.js`.

| Username | Role |
|----------|------|
| admin | Admin |
| harold | User |
| niel | User |

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username/password
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Dashboard
- `GET /api/dashboard/stats` - Get KPI statistics
- `GET /api/dashboard/by-stage` - Get projects grouped by stage
- `GET /api/dashboard/by-department` - Get projects grouped by department

### Projects
- `GET /api/projects?search=&department=&stage=&priority=&status=` - List projects with filters
- `POST /api/projects` - Create new project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project (admin only)

### Users
- `GET /api/users` - List all users (admin only)
- `POST /api/users` - Create new user (admin only)
- `PUT /api/users/:id` - Update user (admin only)
- `DELETE /api/users/:id` - Delete user (admin only)

### Activity
- `GET /api/activity` - Get recent activity logs

### Departments
- `GET /api/departments` - List all departments

## Architecture

```
backend/
  server.js        # Express API server with auto-database setup
  package.json     # Dependencies
  .env             # Environment configuration
  README.md        # This file
```

## Features

- **Auto Database Setup**: The server automatically creates the database, tables, and seed data on first run.
- **Role-Based Access**: Admin users have full CRUD permissions. Regular users can read and update but not delete.
- **Activity Logging**: All create, update, and delete operations are logged automatically.
- **Stage History**: Every stage change is tracked with an audit trail.
- **MySQL Transactions**: All write operations use proper database transactions.
- **CORS Enabled**: Frontend can communicate from any origin.
