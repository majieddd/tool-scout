# Tool Scout — Pre-flight Setup Checklist

> **For:** Majied, before handing the spec to Claude Code
> **Goal:** Everything below must be ✅ before Phase 1. `scout doctor` will verify each item in Phase 1 and refuse to continue if any are missing.
>
> Estimated time to complete this checklist: **60–90 minutes** (most of it is GCP + ngrok).

---

## Part 1 — Software to Install on Windows

### 1.1 Python 3.11+

```powershell
python --version
# Expected: Python 3.11.x or newer
```

If missing: download from https://www.python.org/downloads/ (check "Add to PATH" during install).

### 1.2 Node.js 20 LTS

```powershell
node --version
# Expected: v20.x.x
```

If missing: download from https://nodejs.org/ (LTS version).

### 1.3 PowerShell 7+

```powershell
pwsh --version
# Expected: 7.4.x or newer
```

If missing: `winget install Microsoft.PowerShell`

### 1.4 Git

```powershell
git --version
# Expected: 2.40+
git config --global user.name
git config --global user.email
# Both must return your values
```

### 1.5 Claude Code CLI

```powershell
claude --version
```

If missing, see https://docs.claude.com/en/docs/claude-code/setup. Log in with your Max subscription before proceeding.

### 1.6 Docker Desktop

```powershell
docker --version
docker run --rm hello-world
# The hello-world test MUST succeed
```

If missing: https://www.docker.com/products/docker-desktop/ (free for personal use). After install: open Docker Desktop once to finish initialization, accept the terms, let it start the engine. Verify with the hello-world test above.

### 1.7 ngrok CLI

```powershell
ngrok version
# Expected: ngrok version 3.x.x
```

If missing: https://ngrok.com/download → unzip → add the folder to your PATH.

### 1.8 NSSM (Non-Sucking Service Manager)

Used to run the Symphony-pattern orchestrator (v1.1) as a Windows Service.

```powershell
nssm version
# Expected: NSSM 2.24 or newer
```

If missing: `winget install NSSM.NSSM` or download from https://nssm.cc/download (unzip, add to PATH).

---

## Part 2 — Accounts and Credentials

Open a text file and collect each of these as you go. At the end you'll paste them into `.env`.

### 2.1 GitHub — two Personal Access Tokens

You need **two** tokens. Keep them clearly labeled.

**Token A — "crawler" (for the GitHub API during crawling)**

1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. Note: `tool-scout crawler`
4. Expiration: No expiration (or 1 year)
5. Scopes: check `public_repo` only
6. Generate + **copy immediately** (you cannot view again)
7. Save as → `GITHUB_TOKEN`

**Token B — "bot" (for committing data to the repo)**

This one should be fine-grained (more secure).

1. Go to https://github.com/settings/personal-access-tokens/new
2. Token name: `tool-scout bot`
3. Expiration: 1 year
4. Repository access: Only select repositories → pick `tool-scout`
5. Repository permissions:
   - **Contents**: Read and write
   - **Metadata**: Read-only (auto-selected)
6. Generate + copy
7. Save as → `GIT_BOT_TOKEN`

**Also create the public repo now (empty):**

1. https://github.com/new
2. Owner: your username (we'll assume `Majied` in docs — substitute yours)
3. Repository name: `tool-scout`
4. Public ✅
5. Do NOT initialize with README/license/.gitignore — leave empty. Claude Code will populate it.
6. Create repository
7. Copy the clone URL → `GIT_REPO_URL` (e.g. `https://github.com/Majied/tool-scout.git`)

### 2.2 Vercel — account + project

1. https://vercel.com/signup → sign in with your GitHub account (connects automatically)
2. After signup: New Project
3. Import the `tool-scout` repository you just created
4. Framework preset: **Next.js** (Vercel auto-detects)
5. Root directory: `web`  ← important, not the repo root
6. Build command: leave default (`next build`)
7. Output directory: leave default (`.next`)
8. Environment variables: **skip for now**, we'll add them later
9. Deploy → the first build will fail (no code yet). That's fine. Cancel or ignore.

**Now create a Deploy Hook:**

1. Project Settings → Git → Deploy Hooks
2. Name: `manual-deploy`, branch: `main`
3. Create → copy the URL → save as → `VERCEL_DEPLOY_HOOK_URL`

**Confirm the domain:** Project Settings → Domains. Should show `tool-scout.vercel.app` (or similar if taken; if so, make note of the actual URL).

### 2.3 ngrok — auth token + static domain

1. https://dashboard.ngrok.com/signup → free account
2. https://dashboard.ngrok.com/get-started/your-authtoken → copy token → save as → `NGROK_AUTHTOKEN`
3. https://dashboard.ngrok.com/cloud-edge/domains → **Create Domain** → free tier gives one random persistent domain (e.g. `curly-panda-1234.ngrok-free.app`)
4. Copy the full domain (without `https://`) → save as → `NGROK_STATIC_DOMAIN`

### 2.4 Google Cloud — service account + Sheets API

This is the longest one. ~15 minutes.

**Create the project:**

1. https://console.cloud.google.com/projectcreate
2. Name: `tool-scout` (or anything you like)
3. Create → wait for provisioning

**Enable the APIs:**

1. https://console.cloud.google.com/apis/library
2. Search and enable both:
   - **Google Sheets API**
   - **Google Drive API**

**Create the service account:**

1. https://console.cloud.google.com/iam-admin/serviceaccounts
2. Create service account
3. Service account name: `tool-scout-sheets`
4. Description: `Writes to tool-scout monthly workbooks`
5. Create and continue → skip optional role grants → Done

**Create a JSON key for the service account:**

1. Click the new service account
2. Keys tab → Add Key → Create new key → JSON → Create
3. A JSON file downloads automatically
4. Move it to: `C:\Users\<YourUsername>\.tool-scout\gcp-credentials.json`
   - Create the `.tool-scout` folder if needed
5. Save the path → `GOOGLE_SERVICE_ACCOUNT_PATH`
6. **Also copy the service account email** (ends in `@<project>.iam.gserviceaccount.com`) — you'll need it next

**Create the Drive folder + share it:**

1. https://drive.google.com → New → Folder → name it `tool-scout`
2. Open the folder
3. Share → paste the service account email → role: **Editor** → Share
4. Copy the folder ID from the URL (the long string after `/folders/`) → save as → `GOOGLE_DRIVE_FOLDER_ID`

### 2.5 Google reCAPTCHA v3

1. https://www.google.com/recaptcha/admin/create
2. Label: `tool-scout`
3. reCAPTCHA type: **reCAPTCHA v3**
4. Domains: add BOTH:
   - `tool-scout.vercel.app` (or your actual Vercel domain from §2.2)
   - `localhost`
5. Accept Terms → Submit
6. Copy Site Key → save as → `RECAPTCHA_SITE_KEY`
7. Copy Secret Key → save as → `RECAPTCHA_SECRET_KEY`

---

## Part 3 — Folder & File Setup

Create the working directory:

```powershell
mkdir $HOME\.tool-scout
mkdir $HOME\.tool-scout\cache
mkdir $HOME\.tool-scout\logs
mkdir $HOME\.tool-scout\backups
```

Confirm the GCP credentials JSON is at `$HOME\.tool-scout\gcp-credentials.json`.

---

## Part 4 — Credentials Summary Sheet

Fill these in before `scout doctor` runs. You'll give them to Claude Code to paste into `.env`.

```
GITHUB_TOKEN=                    (from §2.1 Token A)
GIT_BOT_TOKEN=                   (from §2.1 Token B)
GIT_REPO_URL=                    (from §2.1, e.g. https://github.com/Majied/tool-scout.git)
GIT_BOT_USERNAME=tool-scout-bot  (you pick this, any label)
GIT_BOT_EMAIL=bot@tool-scout.invalid

NGROK_AUTHTOKEN=                 (from §2.3)
NGROK_STATIC_DOMAIN=             (from §2.3, e.g. your-subdomain.ngrok-free.app)

GOOGLE_SERVICE_ACCOUNT_PATH=C:\Users\<you>\.tool-scout\gcp-credentials.json
GOOGLE_DRIVE_FOLDER_ID=          (from §2.4)

RECAPTCHA_SITE_KEY=              (from §2.5)
RECAPTCHA_SECRET_KEY=            (from §2.5)

VERCEL_DEPLOY_HOOK_URL=          (from §2.2)

WEBHOOK_SHARED_SECRET=           (leave blank — scout doctor generates this)
```

---

## Part 5 — Verification Before Starting Claude Code

Run through this list. Every item must pass.

```powershell
# Platform
python --version                              # 3.11+
node --version                                 # 20+
pwsh --version                                 # 7.4+
git --version                                  # 2.40+
git config --global user.name                  # returns your name
git config --global user.email                 # returns your email
claude --version                               # works
docker run --rm hello-world                    # prints "Hello from Docker!"
ngrok version                                  # 3.x
nssm version                                   # 2.24+

# Folders
Test-Path $HOME\.tool-scout                    # True
Test-Path $HOME\.tool-scout\gcp-credentials.json  # True

# Credentials collected
# (visual check of your credentials summary sheet — all fields filled)

# GitHub repo exists + is empty
# (visit https://github.com/<you>/tool-scout in browser — should be a fresh empty repo)

# Vercel project exists
# (visit https://vercel.com/dashboard — tool-scout project visible, connected to the GitHub repo)
```

If all checks pass → you're ready. Hand both `TOOL_SCOUT_SPEC.md` and this file to Claude Code with the message:

> "Start at Phase 1 of TOOL_SCOUT_SPEC.md. My pre-flight is complete per TOOL_SCOUT_SETUP.md. Here are my credentials: [paste the §4 summary sheet]."

Claude Code will then run `scout doctor` against your credentials, install the project in editable mode, and begin Phase 1.

---

## Part 6 — Common First-Run Issues

**"`claude --version` works but `claude -p "hi"` hangs."** Your Max subscription may not be logged in to the CLI. Run `claude` once interactively, log in, exit, then retry.

**"Docker hello-world hangs."** Docker Desktop engine isn't running. Open Docker Desktop, wait for the whale icon to go steady green in the system tray.

**"Vercel won't import the repo."** You need to authorize Vercel to see the repo. Vercel dashboard → Settings → Git → GitHub → Configure → grant access to `tool-scout`.

**"Service account email bounced when I tried to share the Drive folder."** Wait 30 seconds after creating the service account, then retry. Google's IAM propagation takes a moment.

**"ngrok domain doesn't show up on free tier."** Their free plan UI has shifted — look for "Cloud Edge → Domains" or "Your Domain" in the dashboard. Every free account gets one static domain.

**"I forgot where I saved token X."** GitHub tokens can't be viewed again — you'd need to regenerate. reCAPTCHA keys can be re-viewed in the admin console. GCP service account keys can be re-downloaded by creating a new key for the same account.

---

**End of pre-flight.** When everything above is ✅, the spec is ready to hand off.
