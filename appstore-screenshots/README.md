# KnockIQ — App Store screenshots

Promotional screenshot panels for the App Store listing, on the KnockIQ brand gradient.

## Folders / sizes

| Folder | Pixel size | Use |
|---|---|---|
| `iPhone-6.9/` | 1290 × 2796 | **Required.** iPhone 16/15 Pro Max (6.9"). Apple can auto-scale this down to smaller iPhones. |
| `iPhone-6.5/` | 1242 × 2688 | Optional dedicated set for 6.5" iPhones (cleaner than auto-scaling). |
| `iPad-13/` | 2064 × 2752 | Only needed if you publish an iPad-compatible build. |

Each folder has the same 5 panels, numbered in display order:

1. `01-knock` — Every door, tracked automatically (rep active session)
2. `02-live` — See your whole team in the field, live (manager map + rep phone)
3. `03-coach` — Turn your crew into top closers (leaderboard + team chat)
4. `04-pipeline` — From knock to close, one pipeline (pipeline board + funnel)
5. `05-overview` — Know your numbers at a glance (KPI dashboard + goal tracker)

## Uploading

In App Store Connect → your app → the version → **Previews and Screenshots**, pick the
6.9" iPhone tab and drag in the five `iPhone-6.9` files in order. Repeat for other tabs if used.
You can upload up to 10 per size; 3–5 is typical.

## Notes

- Source app screenshots come from `public/screenshots/`. To change a panel's screenshot,
  swap the source image and the panels can be regenerated.
- Headlines, subtext, and the feature pills are easy to reword — just ask.
- Apple requires the 6.9" set as of 2024; the others are optional.
