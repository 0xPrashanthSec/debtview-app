# DebtView — Loan Tracker

A private, PIN-protected loan portfolio tracker. Hosted on GitHub Pages, data stays in your browser.

**Live app:** <https://0xPrashanthSec.github.io/debtview-app/>

---

## Features

- **Dashboard** — total outstanding, monthly EMI outgo, % paid off, and debt-free timeline at a glance
- **Repayment priority** — Avalanche (highest rate first), Snowball (smallest balance first), or custom order
- **Loan schedule** — per-loan amortization table with monthly principal/interest/balance breakdown
- **Year snapshot** — projected EMI, principal, and interest for the current calendar year
- **Balance projection chart** — area chart showing how total debt shrinks over the next 5 years
- **CSV export** — one-click download of all loan data
- **PIN protection** — SHA-256 hashed PIN stored only in localStorage; no data leaves your device
- **Loan types** — Home, Personal, Credit Card EMI, Informal/Family, Vehicle, Education, Other

---

## 🚀 Deploy in 5 steps

### Step 1 — Create a GitHub repo

1. Go to <https://github.com/new>
2. Name it exactly: `debtview-app`
3. Set it to **Public** (GitHub Pages requires this on free accounts)
4. Click **Create repository**

### Step 2 — Push the code

```bash
git clone https://github.com/YOUR_USERNAME/debtview-app.git
cd debtview-app
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

```
https://YOUR_USERNAME.github.io/debtview-app/
```

---

## 🔒 How the PIN works

- First visit: you'll be asked to set a PIN (min 4 digits)
- PIN is hashed with SHA-256 and stored only in your browser's localStorage
- No data ever leaves your device
- If you forget your PIN, use "Reset" — this clears all loan data too, so export a CSV backup first

---

## 📱 Local development

```bash
npm install
npm run dev
```

App runs at `http://localhost:5173/debtview-app/`

---

## Tech stack

- React 18 + Vite
- Recharts (area chart)
- Google Fonts — Playfair Display, Crimson Pro, DM Mono
- GitHub Pages + GitHub Actions (CI/CD)

---

## ⚠️ Important notes

- **Data is browser-local** — clearing browser data or using incognito will lose your loans. Export CSV regularly as a backup.
- **Repo is public** but your financial data is NOT in the repo — it lives only in your browser's localStorage.
- If you rename the repo, update `base` in `vite.config.js` to match.
