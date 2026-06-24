# PRFlow Mobile - Synology DS1522+ Deployment Guide

## Target Environment
- **Device:** Synology DS1522+
- **IP Address:** `<your-server-ip>`
- **Port:** `3444` (HTTPS)
- **App ID:** `com.ysumarketing.prflow`
- **App Name:** PRFlow Mobile

---

## Prerequisites

### For Web App Build
- Node.js 18+ and npm

### For Android APK Build
- Java JDK 17
- Android SDK (API 33+)
- Android Studio or command-line Gradle

### For Synology Hosting
- Docker package installed (recommended)
- OR Web Station package installed
- Valid SSL certificate for `<your-server-ip>:3444` (self-signed or custom)

---

## 1. Web App Build

From the `mobile/` directory:

```bash
# Install dependencies
npm install

# Build production bundle (outputs to build/)
npm run build
```

The `build/` folder will contain:
- `index.html`
- Bundled JS/CSS assets
- All static files ready for deployment

---

## 2. Android APK Build

### First-time Android project setup

```bash
# Generate native Android project
npx cap add android

# Copy web assets to Android project
npx cap sync
```

### Build debug APK

```bash
npm run apk:debug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Build release APK (requires signing)

```bash
npm run apk:release
```

Output: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

To sign the release APK:

```bash
cd android
keytool -genkey -v -keystore prflow-release.keystore -alias prflow -keyalg RSA -keysize 2048 -validity 10000
./gradlew assembleRelease -Pandroid.injected.signing.store.file=prflow-release.keystore -Pandroid.injected.signing.store.password=YOUR_PASSWORD -Pandroid.injected.signing.key.alias=prflow -Pandroid.injected.signing.key.password=YOUR_PASSWORD
```

---

## 3. Deploy Web App to Synology DS1522+

### Option A: Docker + Nginx (Recommended)

1. In Synology DSM, open **Container Manager** (or Docker).

2. Create a new folder on your NAS:
   ```
   /volume1/docker/prflow-mobile
   ```

3. Copy the `build/` contents into `/volume1/docker/prflow-mobile/html`.

4. Create `/volume1/docker/prflow-mobile/nginx.conf`:

```nginx
server {
    listen 3444 ssl http2;
    server_name <your-server-ip>;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    location /api {
        proxy_pass https://<your-server-ip>:3444;
        proxy_ssl_verify off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

5. Create `/volume1/docker/prflow-mobile/docker-compose.yml`:

```yaml
version: '3.8'
services:
  prflow-mobile:
    image: nginx:alpine
    container_name: prflow-mobile
    ports:
      - "3444:3444"
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    restart: unless-stopped
```

6. Place your SSL certificate files in `/volume1/docker/prflow-mobile/ssl/`:
   - `cert.pem`
   - `key.pem`

7. Start the container:
   ```bash
   cd /volume1/docker/prflow-mobile
   docker-compose up -d
   ```

8. Access the app at `https://<your-server-ip>:3444/`

### Option B: Synology Web Station

1. Open **Web Station** in DSM.

2. Create a virtual host:
   - Port: `3444`
   - Document root: select a shared folder containing the `build/` contents
   - Enable HTTPS and select your certificate

3. Under **PHP Settings**, ensure static file serving is enabled.

4. Add a `.htaccess` or nginx rewrite rule so SPA routing works:
   ```
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```

---

## 4. Network & SSL Notes

### Self-Signed Certificate
If using a self-signed certificate, the mobile app and browsers will show a security warning. For internal corporate use, you can:
- Install the CA certificate on company devices
- Use a corporate CA to issue the certificate
- Accept the warning during testing

### API Proxy
The Vite dev server proxies `/api` to the URL configured in `VITE_API_URL` (e.g., `https://<your-server-ip>:3444`). In production, the nginx config above handles API routing. Ensure your backend API is accessible at the same origin or configure CORS appropriately.

### Firewall
Ensure DSM Firewall allows port 3444:
1. DSM > Security > Firewall
2. Add allow rule for port 3444 (TCP)

---

## 5. Mobile App Distribution

### Install APK on Android devices

```bash
# Via ADB (developer mode required)
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Or copy APK to device storage and install from file manager
```

### For production distribution
- Upload APK to Google Play Console (requires Google Developer account)
- Or use Microsoft Intune / MDM for enterprise deployment
- Or distribute via internal file share with "Install from unknown sources" enabled

---

## 6. Offline Sync Behavior

The mobile app is designed to work offline-first:

- **SQLite Database:** Local PR data, approvals, and sync queue stored via `@capacitor-community/sqlite`
- **Network Detection:** Automatically detects online/offline state via `@capacitor/network`
- **Sync Queue:** When offline, mutations (create PR, approve, reject, RFI) are queued locally
- **Auto-Sync:** When connectivity returns, the queue automatically processes and syncs with the server
- **Cached Reads:** GET requests fallback to local SQLite cache when offline

### Demo Accounts (pre-seeded)

Demo account passwords are configured via environment variables (`VITE_DEMO_ADMIN_PASSWORD`, `VITE_DEMO_MANAGER_PASSWORD`, `VITE_DEMO_USER_PASSWORD`) and are not hardcoded in the source.

- `admin@ysu.local`
- `manager@ysu.local`
- `user@ysu.local`

---

## 7. Troubleshooting

### Build fails with "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Android Gradle errors
```bash
cd android
./gradlew clean
npx cap sync
```

### SQLite not working on Android
Ensure `android/app/src/main/AndroidManifest.xml` includes:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### CORS errors in production
Ensure your backend API allows the origin `https://<your-server-ip>:3444` or configure the nginx proxy to route `/api` to the backend.

---

## 8. File Structure Summary

```
prflow/mobile/
  build/                  # Production web bundle (generated)
  android/                # Native Android project (generated)
  public/
    index.html            # Entry HTML with viewport meta
  src/
    index.js              # React entry point
    index.css             # Tailwind + custom styles
    App.jsx               # Root app with auth + navigation
    components/
      Login.jsx           # Login screen
      PRForm.jsx          # Submit PR form (offline-aware)
      ApprovalDashboard.jsx # Virtualized approvals list
      StatusTracker.jsx   # PR status lookup
      OfflineBadge.jsx    # Sync status indicator
    services/
      api.js              # Axios + offlineAwareRequest wrapper
      auth.js             # Login/logout with offline fallback
      localDb.js          # SQLite schema and CRUD
      syncService.js      # Network listener + sync queue processor
  capacitor.config.json   # Capacitor app config
  vite.config.js          # Vite build + dev proxy
  tailwind.config.js      # Tailwind theme config
  postcss.config.js       # PostCSS config
  package.json            # Dependencies + build scripts
  .env.production         # Production API URL
  DEPLOYMENT.md           # This file
```
