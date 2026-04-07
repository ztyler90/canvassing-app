# Shack Shine Field Canvassing App

A mobile-first PWA for tracking door-to-door canvassing activity, built with React + Vite + Supabase.

---

## Stack

| Layer      | Tech                         |
|------------|------------------------------|
| Frontend   | React 18, Vite, Tailwind CSS |
| Maps       | Leaflet + OpenStreetMap      |
| Backend    | Supabase (Postgres + Auth)   |
| GPS        | Browser Geolocation API      |
| Geocoding  | OpenStreetMap Nominatim (free) or Google Maps API |
| Deployment | Any static host (Vercel, Netlify, Cloudflare Pages) |

---

## Quick Start

### 1. Clone and install

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. In SQL Editor, paste and run `supabase/schema.sql`
3. In Authentication → Providers, enable **Phone** (requires a Twilio account)
4. Copy your **Project URL** and **anon key** from Settings → API

### 3. Configure environment

```bash
cp .env.example .env
# Fill in your Supabase URL and anon key
```

### 4. Run locally

```bash
npm run dev
# Open http://localhost:5173 on your phone (use your local IP, not localhost)
```

### 5. Build for production

```bash
npm run build
# Deploy the `dist/` folder to Vercel, Netlify, or any static host
```

---

## Setting Up SMS Auth (Twilio)

Supabase Phone Auth requires Twilio:

1. Create a free [Twilio](https://twilio.com) account
2. Get a phone number with SMS capability (~$1/month)
3. In Supabase → Authentication → Providers → Phone:
   - Enable Phone provider
   - Enter your Twilio Account SID, Auth Token, and phone number
4. Reps can now sign in with their mobile number

---

## Creating Your First Manager Account

After signing in for the first time with a phone number, promote that user to manager in Supabase:

```sql
-- Run in Supabase SQL Editor
UPDATE public.users
SET role = 'manager'
WHERE phone = '+1XXXXXXXXXX';  -- replace with your phone number
```

Managers see the full dashboard; reps see the field app.

---

## GPS Geocoding

By default, the app uses **OpenStreetMap Nominatim** (free, no API key needed). For higher accuracy and rate limits, add a Google Maps API key:

```env
VITE_GOOGLE_MAPS_API_KEY=your-key-here
```

Enable the **Geocoding API** in your Google Cloud Console.

---

## App Architecture

```
src/
├── lib/
│   ├── supabase.js       # All DB queries and auth helpers
│   ├── gps.js            # GPS tracker (batches points to Supabase)
│   ├── doorKnock.js      # Door knock detection algorithm
│   └── geocoding.js      # Reverse geocoding (Nominatim / Google)
│
├── contexts/
│   ├── AuthContext.jsx   # Global auth state
│   └── SessionContext.jsx # Live session state (GPS trail, interactions, stats)
│
├── screens/
│   ├── Login.jsx          # Phone + SMS OTP login
│   ├── RepHome.jsx        # Rep home with Start Canvassing button
│   ├── ActiveCanvassing.jsx # Live map + auto door-knock detection
│   ├── SessionSummary.jsx # End-of-session stats + Submit Day
│   └── ManagerDashboard.jsx # Overview / Reps / Map tabs
│
└── components/
    ├── MapView.jsx        # Leaflet map (GPS trail + outcome pins)
    └── InteractionModal.jsx # Bottom-sheet interaction logger
```

---

## Door Knock Detection Algorithm

A door knock is registered when:
1. Rep stops within **15 meters** of a position
2. Remains there for **20–120 seconds**
3. That address hasn't been logged in the last **24 hours**

Stops under 15 seconds and stays over 120 seconds (probably went inside) are ignored.

---

## Phase 2 Roadmap (from PRD)

- [ ] Jobber / ServiceTitan / Housecall Pro sync (pull actual invoice values)
- [ ] Neighborhood scoring & suggested routes
- [ ] Photo upload for door hanger placement
- [ ] QR code tracking from door hangers
- [ ] Weather / time-of-day conversion insights
- [ ] Push notifications for follow-up reminders

---

## Deployment (Vercel — recommended)

```bash
npm install -g vercel
vercel deploy
# Add your environment variables in the Vercel dashboard
```

Or drag-and-drop the `dist/` folder into Netlify.
