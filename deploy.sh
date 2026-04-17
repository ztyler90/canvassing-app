#!/bin/bash
# KnockIQ — one-shot deploy script
# Run from the canvassing-app directory: bash deploy.sh
set -e

echo "🚀 KnockIQ Deploy"
echo "=================="

# ── 1. Install deps (if needed) ───────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies…"
  npm install
fi

# ── 2. Build the app ─────────────────────────────────────────────────────────
echo "🔨 Building app…"
npm run build
echo "✅ Build complete"

# ── 3. Deploy Supabase Edge Function ─────────────────────────────────────────
if command -v supabase &> /dev/null; then
  echo "☁️  Deploying manage-team Edge Function…"
  supabase functions deploy manage-team --project-ref mcwspvhihekhkytfxggv
  echo "✅ Edge Function deployed"
else
  echo "⚠️  Supabase CLI not found — skipping Edge Function deploy."
  echo "    Install it with: brew install supabase/tap/supabase"
  echo "    Then run: supabase functions deploy manage-team --project-ref mcwspvhihekhkytfxggv"
fi

# ── 4. Deploy to Vercel ───────────────────────────────────────────────────────
if command -v vercel &> /dev/null; then
  echo "🌐 Deploying to Vercel (production)…"
  vercel --prod
  echo "✅ Vercel deploy complete"
elif command -v git &> /dev/null && git remote | grep -q origin; then
  echo "📤 Pushing to git (Vercel will auto-deploy)…"
  git add -A
  git commit -m "feat: team management, clickable sessions, GPS accuracy, rep profiles"
  git push origin main
  echo "✅ Pushed — Vercel will deploy automatically"
else
  echo "⚠️  No Vercel CLI or git remote found."
  echo "    Option A: npm i -g vercel && vercel --prod"
  echo "    Option B: Connect repo on vercel.com and push via GitHub Desktop or git"
fi

echo ""
echo "🎉 Done!"
