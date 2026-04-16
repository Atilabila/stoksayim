# Ultra-Simple Multi-Branch Inventory System

A super simple, mobile-first React + Supabase implementation to track multi-branch inventory counts with real-time financial variation analysis.

## Core Features

- **Massive Keypad UI**: Intuitively large, hard-to-miss buttons, sticky to the bottom on mobile.
- **Fail-Proof Auto-Save**: Each count bypasses user clicks and automatically saves to the database immediately upon entry to prevent data loss.
- **Financial Dashboard**: See the entire system value based on `current_stock` vs `counted_stock` using `purchase_price`. Live updates, automated loss/shrinkage tracking in TL.
- **Camera Barcode Scan**: Super quick scanning to select items, fallback to search text.
- **Vercel Ready**: A built-in `vercel.json` ensures smooth React SPA routing.

## Setup Instructions

### 1. Supabase Initialization
1. Create a new Supabase Project.
2. In the "SQL Editor", run the contents of the `schema.sql` file provided in this repository.
3. Note your Supabase `Project URL` and `Anon Key`.

### 2. Environment Variables
1. Rename `.env.example` to `.env.local` for local development.
2. Fill your credentials:
```env
VITE_SUPABASE_URL="https://your-project-id.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key-here"
```

### 3. Git Automation & Deployment to GitHub

Run these commands in your project folder to push the code to a new GitHub repository:

```bash
# Initialize local git tracking
git init

# Add all project files
git add .

# Save the initial commit
git commit -m "Initial commit of Pro-Stock Inventory System"

# (IMPORTANT: Go to GitHub, create an empty repository, and copy the repository URL)
# Link this folder to your online GitHub repository
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git

# Push the code live!
git push -u origin main
```

### 4. Vercel Hosting
1. Go to [Vercel](https://vercel.com/) and sign in with your GitHub account.
2. Click **"Add New Project"** and select the repository you just pushed.
3. In the Vercel **Environment Variables** section, add your two Supabase keys:
    - Name: `VITE_SUPABASE_URL`, Value: `https://your-project-id.supabase.co`
    - Name: `VITE_SUPABASE_ANON_KEY`, Value: `your-anon-key-here`
4. Click **Deploy**. Vercel will build and host your site live within seconds!
