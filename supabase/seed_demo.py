#!/usr/bin/env python3
"""
Generates seed SQL for a fully-built-out demo org: Sunburst Solar (Tampa, FL).

Run:
    python3 supabase/seed_demo.py > supabase/seed_demo.sql

Then apply the SQL via Supabase SQL editor or `supabase db push`.

The script is deterministic — re-running produces the same UUIDs, addresses,
session counts, etc. Existing demo data is cleared at the top of the SQL so
the seed can be re-applied safely.
"""

import hashlib
import random
import sys
from datetime import datetime, timedelta, timezone

SEED = 20260601
random.seed(SEED)

# ───────── Configuration ─────────
ORG_ID = "d0d0d0d0-0000-4000-a000-000000000001"
ORG_NAME = "Sunburst Solar"
ORG_SLUG = "sunburst-solar"
MANAGER_EMAIL = "demo@knockiq.com"
MANAGER_PASSWORD = "DemoKnockIQ2026!"
MANAGER_NAME = "Marcus Reyes"
MANAGER_ID = "d0d0d0d0-0000-4000-a000-000000000002"

# Days of activity history. "today" is the day this SQL is APPLIED — we use
# now()/current_date inside the SQL so it stays fresh on re-runs.
DAYS_OF_HISTORY = 60

# Bell curve: 3 stars, 9 solid, 3 stragglers
REPS = [
    # Stars — high conversion, high revenue
    ("Sophia Martinez", "sophia.martinez", "star"),
    ("Tyler Brennan",   "tyler.brennan",   "star"),
    ("Aisha Patel",     "aisha.patel",     "star"),
    # Solid — middle of the bell curve
    ("Jordan Williams", "jordan.williams", "solid"),
    ("Maya Okafor",     "maya.okafor",     "solid"),
    ("Diego Hernandez", "diego.hernandez", "solid"),
    ("Brittany Chen",   "brittany.chen",   "solid"),
    ("Carlos Mendez",   "carlos.mendez",   "solid"),
    ("Hannah Schultz",  "hannah.schultz",  "solid"),
    ("Devin Brooks",    "devin.brooks",    "solid"),
    ("Priya Kumar",     "priya.kumar",     "solid"),
    ("Lucas Petrov",    "lucas.petrov",    "solid"),
    # Stragglers — low activity
    ("Connor Walsh",    "connor.walsh",    "straggler"),
    ("Madison Reilly",  "madison.reilly",  "straggler"),
    ("Justin Park",     "justin.park",     "straggler"),
]

# Performance profiles (avg per session)
PROFILES = {
    "star":      {"days_per_week": 5.5, "doors": (40, 60), "conv_rate": 0.28, "est_rate": 0.10, "book_rate": 0.04},
    "solid":     {"days_per_week": 5.0, "doors": (30, 50), "conv_rate": 0.20, "est_rate": 0.06, "book_rate": 0.022},
    "straggler": {"days_per_week": 3.0, "doors": (15, 30), "conv_rate": 0.15, "est_rate": 0.035, "book_rate": 0.012},
}

SERVICES = [
    "Rooftop Solar Install",
    "Battery Storage",
    "Solar + Roof Bundle",
    "EV Charger",
    "Free Solar Quote",
]

# Tampa neighborhoods with approx center (lat, lng) and short rectangle bounds
TERRITORIES = [
    ("Hyde Park",       "#3B82F6", 27.937, -82.471, 0.012, 0.014),
    ("Davis Islands",   "#10B981", 27.901, -82.453, 0.010, 0.010),
    ("Bayshore",        "#F59E0B", 27.910, -82.481, 0.014, 0.010),
    ("Westchase",       "#EF4444", 28.058, -82.609, 0.014, 0.014),
    ("New Tampa",       "#8B5CF6", 28.114, -82.379, 0.016, 0.014),
    ("Brandon",         "#EC4899", 27.937, -82.286, 0.014, 0.014),
    ("Carrollwood",     "#14B8A6", 28.052, -82.504, 0.014, 0.014),
]

# Tampa-flavored street names for synthetic addresses
STREETS = [
    "Bayshore Blvd", "Swann Ave", "Howard Ave", "MacDill Ave", "Henderson Blvd",
    "Dale Mabry Hwy", "Kennedy Blvd", "Bruce B Downs Blvd", "Hillsborough Ave",
    "Fletcher Ave", "Linebaugh Ave", "Bearss Ave", "Fowler Ave",
    "Davis Blvd", "Columbus Dr", "Cypress St", "Platt St", "Manhattan Ave",
    "Westshore Blvd", "Lois Ave", "Himes Ave", "Sheldon Rd", "Race Track Rd",
]

LAST_NAMES = ["Johnson", "Smith", "Rivera", "Garcia", "Thompson", "Wilson", "Lee",
              "Brown", "Davis", "Anderson", "Patel", "Singh", "Nguyen", "Wright",
              "Reed", "Cooper", "Bennett", "Murphy", "Russell", "Carter", "Foster",
              "Diaz", "Lopez", "Hall", "Hayes", "Stewart", "Reyes", "Bryant", "Hughes",
              "Price", "Sanders", "Coleman", "Jenkins", "Perry", "Powell", "Long"]

FIRST_NAMES_M = ["James", "Michael", "Robert", "David", "John", "Daniel", "Anthony",
                 "Mark", "Steven", "Andrew", "Joshua", "Kenneth", "Brian", "Kevin",
                 "Ryan", "Jason", "Eric", "Patrick", "Sean", "Jeremy", "Bryan", "Alex"]

FIRST_NAMES_F = ["Mary", "Jennifer", "Linda", "Patricia", "Elizabeth", "Susan", "Karen",
                 "Lisa", "Nancy", "Sandra", "Ashley", "Donna", "Emily", "Michelle",
                 "Amanda", "Stephanie", "Rebecca", "Laura", "Sharon", "Cynthia", "Kathleen"]

# ───────── Helpers ─────────

def uuid_from(label: str) -> str:
    """Deterministic UUIDv4-ish from a label."""
    h = hashlib.sha1(f"{SEED}:{label}".encode()).hexdigest()
    return f"{h[0:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"

def esc(s: str) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"

def round_money(v):
    return f"{v:.2f}"

def phone_for(slug: str) -> str:
    # Synthetic +1 813 number unique per rep
    digits = abs(hash(slug)) % 9000000 + 1000000
    return f"+1813{digits:07d}"

def random_address(territory_idx: int) -> tuple[str, float, float]:
    name, color, clat, clng, dlat, dlng = TERRITORIES[territory_idx]
    lat = clat + random.uniform(-dlat / 2, dlat / 2)
    lng = clng + random.uniform(-dlng / 2, dlng / 2)
    number = random.randint(100, 9999)
    street = random.choice(STREETS)
    suffix = random.choice(["Tampa, FL", "Tampa, FL", "Tampa, FL", "Brandon, FL"])
    return f"{number} {street}, {suffix}", lat, lng

def random_contact():
    if random.random() < 0.5:
        first = random.choice(FIRST_NAMES_F)
    else:
        first = random.choice(FIRST_NAMES_M)
    last = random.choice(LAST_NAMES)
    name = f"{first} {last}"
    phone = f"+1813{random.randint(2000000, 9999999):07d}"
    email = f"{first.lower()}.{last.lower()}@example.com"
    return name, phone, email

def territory_polygon(territory_idx: int) -> str:
    """Build a rectangle polygon (as GeoJSON-ish jsonb) around a territory's center."""
    name, color, clat, clng, dlat, dlng = TERRITORIES[territory_idx]
    half_lat = dlat / 2
    half_lng = dlng / 2
    # Format: { "type": "Polygon", "coordinates": [[[lng,lat], ...]] }
    coords = [
        [clng - half_lng, clat - half_lat],
        [clng + half_lng, clat - half_lat],
        [clng + half_lng, clat + half_lat],
        [clng - half_lng, clat + half_lat],
        [clng - half_lng, clat - half_lat],
    ]
    coord_str = ",".join(f"[{c[0]:.6f},{c[1]:.6f}]" for c in coords)
    return f'{{"type":"Polygon","coordinates":[[{coord_str}]]}}'

# Service deal-value ranges
def estimated_value_for(services: list[str]) -> float:
    total = 0.0
    for s in services:
        if s == "Rooftop Solar Install":
            total += random.uniform(18000, 45000)
        elif s == "Battery Storage":
            total += random.uniform(8000, 15000)
        elif s == "Solar + Roof Bundle":
            total += random.uniform(50000, 70000)
        elif s == "EV Charger":
            total += random.uniform(1500, 3000)
        elif s == "Free Solar Quote":
            total += 0  # free quotes don't add value directly
    if total == 0:
        total = random.uniform(20000, 35000)  # fallback
    return round(total, -2)  # round to nearest $100

def pick_services():
    """Pick 1-2 services for an interaction."""
    primary = random.choices(
        ["Rooftop Solar Install", "Battery Storage", "Solar + Roof Bundle", "EV Charger"],
        weights=[55, 15, 12, 18],
        k=1,
    )[0]
    services = [primary]
    if random.random() < 0.25 and primary == "Rooftop Solar Install":
        services.append("Battery Storage")
    return services


# ───────── Main generation ─────────

out = []

def w(s: str = ""):
    out.append(s)

w("-- ============================================================")
w(f"-- Demo seed: {ORG_NAME} (Tampa, FL)")
w(f"-- Generated with seed={SEED}, days={DAYS_OF_HISTORY}")
w(f"-- Manager login: {MANAGER_EMAIL} / {MANAGER_PASSWORD}")
w("-- Re-runs are idempotent: existing rows for this org are wiped first.")
w("-- ============================================================")
w()
w("begin;")
w()

# Wipe existing demo data for this org so re-runs are clean
w(f"-- Wipe any prior demo data for org {ORG_ID}")
w(f"delete from public.gps_points where organization_id = '{ORG_ID}';")
w(f"delete from public.bookings where organization_id = '{ORG_ID}';")
w(f"delete from public.interactions where organization_id = '{ORG_ID}';")
w(f"delete from public.canvassing_sessions where organization_id = '{ORG_ID}';")
w(f"delete from public.territory_assignments where organization_id = '{ORG_ID}';")
w(f"delete from public.territory_completions where organization_id = '{ORG_ID}';")
w(f"delete from public.territories where organization_id = '{ORG_ID}';")
w(f"delete from public.organization_services where organization_id = '{ORG_ID}';")
w(f"delete from public.rep_locations where organization_id = '{ORG_ID}';")
w(f"delete from public.users where organization_id = '{ORG_ID}';")
w(f"delete from auth.users where raw_user_meta_data->>'demo_org' = '{ORG_ID}';")
w(f"delete from public.organizations where id = '{ORG_ID}';")
w()

# Organization
w("-- Organization")
w(f"""insert into public.organizations
  (id, name, slug, tier, status, daily_goal_type, daily_goal_value, count_goal_label, invite_code_enabled, created_at)
values
  ('{ORG_ID}', {esc(ORG_NAME)}, {esc(ORG_SLUG)}, 'pro', 'active', 'count', 3, 'estimates', false, now() - interval '90 days');
""")

# Services
w("-- Services")
for i, s in enumerate(SERVICES):
    sid = uuid_from(f"service:{s}")
    w(f"insert into public.organization_services (id, organization_id, label, sort_order) values "
      f"('{sid}', '{ORG_ID}', {esc(s)}, {i});")
w()

# Territories
territory_ids = []
w("-- Territories")
for i, t in enumerate(TERRITORIES):
    tid = uuid_from(f"territory:{t[0]}")
    territory_ids.append(tid)
    poly = territory_polygon(i)
    w(f"""insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('{tid}', '{ORG_ID}', {esc(t[0])}, {esc(t[1])}, '{poly}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');""")
w()

# auth.users + public.users — manager first, then reps
w("-- Manager auth + profile")
w(f"""insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '{MANAGER_ID}',
  'authenticated', 'authenticated',
  {esc(MANAGER_EMAIL)},
  crypt({esc(MANAGER_PASSWORD)}, gen_salt('bf')),
  now() - interval '85 days',
  '{{"provider":"email","providers":["email"]}}'::jsonb,
  jsonb_build_object('full_name', {esc(MANAGER_NAME)}, 'demo_org', {esc(ORG_ID)}),
  false, now() - interval '85 days', now(),
  '', '', '', ''
);""")

w(f"""insert into public.users (id, email, phone, full_name, role, organization_id, status, avatar_url, created_at)
values ('{MANAGER_ID}', {esc(MANAGER_EMAIL)}, {esc(phone_for("marcus.reyes"))}, {esc(MANAGER_NAME)},
        'manager', '{ORG_ID}', 'active', NULL, now() - interval '85 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = excluded.role, organization_id = excluded.organization_id, status = excluded.status;""")
w(f"update public.organizations set owner_user_id = '{MANAGER_ID}' where id = '{ORG_ID}';")
w()

# Reps
rep_records = []  # (id, name, slug, tier)
w("-- Reps auth + profiles")
for name, slug, tier in REPS:
    rep_id = uuid_from(f"rep:{slug}")
    rep_records.append((rep_id, name, slug, tier))
    email = f"{slug}@sunburstsolar.demo"
    phone = phone_for(slug)
    w(f"""insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '{rep_id}',
  'authenticated', 'authenticated',
  {esc(email)},
  crypt('DemoRep!{SEED}', gen_salt('bf')),
  now() - interval '70 days',
  '{{"provider":"email","providers":["email"]}}'::jsonb,
  jsonb_build_object('full_name', {esc(name)}, 'demo_org', {esc(ORG_ID)}),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);""")
    w(f"""insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('{rep_id}', {esc(email)}, {esc(phone)}, {esc(name)}, 'rep', '{ORG_ID}', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';""")
w()

# Territory assignments — each rep assigned to 1-2 territories
w("-- Territory assignments")
for rep_id, name, slug, tier in rep_records:
    n_assigns = 2 if tier in ("star", "solid") else 1
    chosen = random.sample(range(len(TERRITORIES)), n_assigns)
    for ti in chosen:
        tid = territory_ids[ti]
        aid = uuid_from(f"assign:{slug}:{ti}")
        w(f"insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) "
          f"values ('{aid}', '{tid}', '{rep_id}', '{ORG_ID}', '{MANAGER_ID}', now() - interval '60 days');")
w()

# Territory completions — handful in the last 30 days
w("-- Territory completions (recent)")
for ci in range(8):
    rep_id, name, slug, tier = random.choice(rep_records)
    ti = random.randrange(len(TERRITORIES))
    tid = territory_ids[ti]
    days_ago = random.randint(1, 30)
    cid = uuid_from(f"completion:{ci}")
    w(f"insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) "
      f"values ('{cid}', '{tid}', '{rep_id}', '{ORG_ID}', now() - interval '{days_ago} days');")
w()

# Sessions + interactions
w("-- Canvassing sessions, interactions, bookings")
total_sessions = 0
total_interactions = 0
total_bookings = 0
recent_session_ids_for_gps = []  # we'll add gps for ~6 most-recent sessions

session_values = []   # (id, rep_id, started_at_expr, ended_at_expr, status, doors, convos, est, book, revenue, territory_idx)
interaction_values = []  # tuples
booking_values = []

today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

for rep_id, name, slug, tier in rep_records:
    prof = PROFILES[tier]
    # Assigned territories
    assigned_ti = [ti for ti in range(len(TERRITORIES)) if random.random() < (0.35 if tier == 'straggler' else 0.45)]
    if not assigned_ti:
        assigned_ti = [random.randrange(len(TERRITORIES))]

    for day_back in range(DAYS_OF_HISTORY, -1, -1):
        day = today - timedelta(days=day_back)
        weekday = day.weekday()  # 0=Mon ... 6=Sun
        # Probability of working this day:
        if weekday == 6:
            work_prob = 0.05
        elif weekday == 5:
            work_prob = 0.45
        else:
            work_prob = prof["days_per_week"] / 5.5 * 0.85
        if tier == "straggler":
            work_prob *= 0.75
        if random.random() > work_prob:
            continue

        # Session start: 3 PM - 5 PM typical, weekends 11 AM - 2 PM
        if weekday >= 5:
            start_hour = random.randint(11, 14)
        else:
            start_hour = random.randint(15, 17)
        start_min = random.choice([0, 15, 30, 45])
        start_dt = day + timedelta(hours=start_hour, minutes=start_min)
        duration_hr = random.uniform(2.0, 4.5)
        end_dt = start_dt + timedelta(hours=duration_hr)

        # Today's sessions: 30% are still 'active' for some reps (currently working)
        is_today = (day_back == 0)
        if is_today and random.random() < 0.4:
            status = "active"
            end_dt_sql = "NULL"
            # Active session has accumulated stats so far
            elapsed_frac = random.uniform(0.3, 0.85)
        else:
            status = "submitted"
            end_dt_sql = f"'{end_dt.isoformat()}'::timestamptz"
            elapsed_frac = 1.0

        territory_idx = random.choice(assigned_ti)
        doors_target = random.randint(*prof["doors"])
        doors = max(1, int(doors_target * elapsed_frac))
        conversations = int(doors * prof["conv_rate"] * random.uniform(0.7, 1.3))
        estimates = int(doors * prof["est_rate"] * random.uniform(0.5, 1.6))
        bookings = int(doors * prof["book_rate"] * random.uniform(0.4, 1.8))
        # Ensure ordering
        conversations = max(estimates, conversations)
        estimates = max(bookings, estimates)
        revenue = 0.0

        sid = uuid_from(f"session:{slug}:{day_back}")
        # We'll build interaction rows AND tally revenue from bookings
        interactions_for_this_session = []
        # Distribute the doors as interactions
        # Outcome counts:
        n_booked = bookings
        n_estimate = max(0, estimates - bookings)
        n_convo_no_outcome = max(0, conversations - estimates)
        n_noanswer_or_notint = max(0, doors - conversations)
        n_no_answer = int(n_noanswer_or_notint * random.uniform(0.45, 0.65))
        n_not_int = n_noanswer_or_notint - n_no_answer
        # Add some not_interested for the conversations that didn't lead to estimate
        n_not_int_extra = n_convo_no_outcome
        n_not_int += n_not_int_extra

        outcome_list = (["booked"] * n_booked +
                        ["estimate_requested"] * n_estimate +
                        ["not_interested"] * n_not_int +
                        ["no_answer"] * n_no_answer)
        # Pad if short
        while len(outcome_list) < doors:
            outcome_list.append("no_answer")
        outcome_list = outcome_list[:doors]
        random.shuffle(outcome_list)

        # Create interactions
        seconds_per_interaction = (end_dt - start_dt).total_seconds() / max(1, doors)
        for di, outcome in enumerate(outcome_list):
            addr, lat, lng = random_address(territory_idx)
            ts = start_dt + timedelta(seconds=di * seconds_per_interaction + random.uniform(-30, 30))
            if outcome in ("estimate_requested", "booked"):
                cname, cphone, cemail = random_contact()
                services = pick_services()
                ev = estimated_value_for(services)
                if outcome == "booked":
                    revenue += ev
            else:
                cname = cphone = cemail = None
                services = None
                ev = None
            iid = uuid_from(f"interaction:{slug}:{day_back}:{di}")
            interactions_for_this_session.append({
                "id": iid, "ts": ts, "outcome": outcome, "addr": addr,
                "lat": lat, "lng": lng, "cname": cname, "cphone": cphone,
                "cemail": cemail, "services": services, "ev": ev,
            })
        total_interactions += len(interactions_for_this_session)

        # Build session insert
        session_values.append({
            "id": sid, "rep_id": rep_id, "started_at": start_dt,
            "ended_at": end_dt if status == "submitted" else None,
            "status": status, "doors": doors, "conversations": conversations,
            "estimates": estimates, "bookings": bookings, "revenue": revenue,
            "neighborhood": TERRITORIES[territory_idx][0],
            "interactions": interactions_for_this_session,
        })
        total_sessions += 1
        if day_back <= 7 and len(recent_session_ids_for_gps) < 8:
            recent_session_ids_for_gps.append((sid, rep_id, start_dt, end_dt, territory_idx))

# Emit session inserts in batches
def chunked(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

w(f"-- {len(session_values)} sessions, ~{total_interactions} interactions")
w()
w("-- Sessions")
sess_rows = []
for s in session_values:
    started = f"'{s['started_at'].isoformat()}'::timestamptz"
    if s["ended_at"]:
        ended = f"'{s['ended_at'].isoformat()}'::timestamptz"
    else:
        ended = "NULL"
    sess_rows.append(
        f"('{s['id']}', '{s['rep_id']}', {started}, {ended}, '{s['status']}', "
        f"{s['doors']}, {s['conversations']}, {s['estimates']}, {s['bookings']}, "
        f"{round_money(s['revenue'])}, {esc(s['neighborhood'])}, '{ORG_ID}')"
    )
for chunk in chunked(sess_rows, 200):
    w("insert into public.canvassing_sessions (id, rep_id, started_at, ended_at, status, "
      "doors_knocked, conversations, estimates, bookings, revenue_booked, neighborhood, organization_id) values")
    w(",\n".join(chunk) + ";")
w()

# Interaction inserts
w("-- Interactions")
int_rows = []
booking_rows = []
for s in session_values:
    for it in s["interactions"]:
        ts = f"'{it['ts'].isoformat()}'::timestamptz"
        if it["services"]:
            svc_array = "ARRAY[" + ",".join(esc(x) for x in it["services"]) + "]::text[]"
        else:
            svc_array = "NULL"
        ev = f"{it['ev']:.2f}" if it["ev"] is not None else "NULL"
        int_rows.append(
            f"('{it['id']}', '{s['id']}', '{s['rep_id']}', {esc(it['addr'])}, "
            f"{it['lat']:.6f}, {it['lng']:.6f}, '{it['outcome']}', "
            f"{esc(it['cname'])}, {esc(it['cphone'])}, {esc(it['cemail'])}, "
            f"{svc_array}, {ev}, {ts}, '{ORG_ID}')"
        )
        if it["outcome"] == "booked":
            total_bookings += 1
            # Booking status: completed if older than 30 days, mostly booked otherwise, occasional cancelled
            age_days = (today - it["ts"].replace(hour=0, minute=0, second=0, microsecond=0)).days
            if age_days > 30 and random.random() < 0.6:
                bstatus = "completed"
                actual = it["ev"] * random.uniform(0.95, 1.05)
                completed_at = f"'{(it['ts'] + timedelta(days=random.randint(7, 30))).isoformat()}'::timestamptz"
            elif random.random() < 0.05:
                bstatus = "cancelled"
                actual = None
                completed_at = "NULL"
            else:
                bstatus = "booked"
                actual = None
                completed_at = "NULL"
            actual_sql = f"{actual:.2f}" if actual is not None else "NULL"
            bid = uuid_from(f"booking:{it['id']}")
            booking_rows.append(
                f"('{bid}', '{it['id']}', '{s['id']}', '{s['rep_id']}', {esc(it['addr'])}, "
                f"{esc(it['cname'])}, {esc(it['cphone'])}, {svc_array}, {ev}, {actual_sql}, "
                f"'{bstatus}', {ts}, {completed_at}, '{ORG_ID}')"
            )

for chunk in chunked(int_rows, 250):
    w("insert into public.interactions (id, session_id, rep_id, address, lat, lng, outcome, "
      "contact_name, contact_phone, contact_email, service_types, estimated_value, created_at, organization_id) values")
    w(",\n".join(chunk) + ";")
w()

w("-- Bookings")
for chunk in chunked(booking_rows, 250):
    w("insert into public.bookings (id, interaction_id, session_id, rep_id, address, "
      "contact_name, contact_phone, service_types, estimated_value, actual_value, "
      "status, booked_at, completed_at, organization_id) values")
    w(",\n".join(chunk) + ";")
w()

# GPS points for recent sessions
w("-- GPS points (recent sessions only — for breadcrumb trail demos)")
for sid, rep_id, start_dt, end_dt, territory_idx in recent_session_ids_for_gps:
    n_points = random.randint(80, 160)
    duration = (end_dt - start_dt).total_seconds()
    t_info = TERRITORIES[territory_idx]
    rows = []
    lat = t_info[2] + random.uniform(-t_info[4] / 3, t_info[4] / 3)
    lng = t_info[3] + random.uniform(-t_info[5] / 3, t_info[5] / 3)
    for i in range(n_points):
        # Random walk
        lat += random.uniform(-0.0005, 0.0005)
        lng += random.uniform(-0.0005, 0.0005)
        ts = start_dt + timedelta(seconds=duration * (i / n_points))
        pid = uuid_from(f"gps:{sid}:{i}")
        rows.append(f"('{pid}', '{sid}', '{rep_id}', {lat:.6f}, {lng:.6f}, "
                    f"{random.uniform(3, 12):.2f}, {random.uniform(0, 1.5):.2f}, "
                    f"'{ts.isoformat()}'::timestamptz, '{ORG_ID}')")
    w("insert into public.gps_points (id, session_id, rep_id, lat, lng, accuracy, speed, recorded_at, organization_id) values")
    w(",\n".join(rows) + ";")
w()

# rep_locations: current location for reps with active sessions today
w("-- Live rep locations (for reps currently in active sessions)")
for s in session_values:
    if s["status"] == "active":
        last_it = s["interactions"][-1] if s["interactions"] else None
        if last_it:
            lat, lng = last_it["lat"], last_it["lng"]
        else:
            lat = TERRITORIES[0][2]; lng = TERRITORIES[0][3]
        # Live view filter is `updated_at >= now() - 5 minutes`, so keep
    # all active-rep locations comfortably inside that window.
    w(f"insert into public.rep_locations (rep_id, session_id, lat, lng, organization_id, updated_at) "
          f"values ('{s['rep_id']}', '{s['id']}', {lat:.6f}, {lng:.6f}, '{ORG_ID}', now() - interval '{random.randint(15, 240)} seconds') "
          f"on conflict (rep_id) do update set session_id=excluded.session_id, lat=excluded.lat, lng=excluded.lng, "
          f"organization_id=excluded.organization_id, updated_at=excluded.updated_at;")

w()
w("commit;")
w()
w(f"-- Done. Org: {ORG_NAME} | sessions: {total_sessions} | interactions: {total_interactions} | bookings: {total_bookings}")
w(f"-- Login: {MANAGER_EMAIL} / {MANAGER_PASSWORD}")

sys.stdout.write("\n".join(out) + "\n")
