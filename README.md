# DebtView — Loan Tracker

A private, PIN-protected loan portfolio tracker. Hosted on GitHub Pages, data stays in your browser.

---

## 🚀 Deploy in 5 steps

### Step 1 — Create a GitHub repo
1. Go to https://github.com/new
2. Name it exactly: `loan-tracker`
3. Set it to **Public** (GitHub Pages requires this on free accounts)
4. Click **Create repository**

### Step 2 — Upload these files
Option A (easiest — drag & drop):
1. Open your new repo on GitHub
2. Click **uploading an existing file**
3. Drag the entire contents of this folder in
4. Click **Commit changes**

Option B (Git CLI):
```bash
cd loan-tracker
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/loan-tracker.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages
1. Go to your repo → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Save

### Step 4 — Wait ~2 minutes
GitHub Actions will automatically build and deploy.
Check progress under the **Actions** tab in your repo.

### Step 5 — Open your app
Your app will be live at:
```
https://YOUR_USERNAME.github.io/loan-tracker/
```

---

## 🔒 How the PIN works
- First visit: you'll be asked to set a PIN (min 4 digits)
- PIN is hashed with SHA-256 and stored only in your browser's localStorage
- No data ever leaves your device
- If you forget your PIN, use "Reset" — this clears all loan data too, so export a CSV backup first

## 📱 Local development
```bash
npm install
npm run dev
```

## ⚠️ Important notes
- **Data is browser-local** — clearing browser data / using incognito will lose your loans. Export CSV regularly as backup.
- **Repo is public** but your financial data is NOT in the repo — it lives only in your browser's localStorage.
- If you rename the repo, update `base` in `vite.config.js` to match.
