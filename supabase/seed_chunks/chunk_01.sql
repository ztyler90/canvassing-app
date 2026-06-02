-- ============================================================
-- Demo seed: Sunburst Solar (Tampa, FL)
-- Generated with seed=20260601, days=60
-- Manager login: demo@knockiq.com / DemoKnockIQ2026!
-- Re-runs are idempotent: existing rows for this org are wiped first.
-- ============================================================


-- Wipe any prior demo data for org d0d0d0d0-0000-4000-a000-000000000001
delete from public.gps_points where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.bookings where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.interactions where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.canvassing_sessions where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.territory_assignments where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.territory_completions where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.territories where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.organization_services where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.rep_locations where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.users where organization_id = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from auth.users where raw_user_meta_data->>'demo_org' = 'd0d0d0d0-0000-4000-a000-000000000001';
delete from public.organizations where id = 'd0d0d0d0-0000-4000-a000-000000000001';

-- Organization
insert into public.organizations
  (id, name, slug, tier, status, daily_goal_type, daily_goal_value, count_goal_label, invite_code_enabled, created_at)
values
  ('d0d0d0d0-0000-4000-a000-000000000001', 'Sunburst Solar', 'sunburst-solar', 'pro', 'active', 'count', 3, 'estimates', false, now() - interval '90 days');

-- Services
insert into public.organization_services (id, organization_id, label, sort_order) values ('444639cf-cbf2-4de0-a95f-9dabd3edfe08', 'd0d0d0d0-0000-4000-a000-000000000001', 'Rooftop Solar Install', 0);
insert into public.organization_services (id, organization_id, label, sort_order) values ('346e36d5-42cf-4002-a201-c20f3480c007', 'd0d0d0d0-0000-4000-a000-000000000001', 'Battery Storage', 1);
insert into public.organization_services (id, organization_id, label, sort_order) values ('46e76968-27f7-40d8-ac12-78e98d6b96fa', 'd0d0d0d0-0000-4000-a000-000000000001', 'Solar + Roof Bundle', 2);
insert into public.organization_services (id, organization_id, label, sort_order) values ('a9a25899-98ba-4369-ad44-e39729bd9313', 'd0d0d0d0-0000-4000-a000-000000000001', 'EV Charger', 3);
insert into public.organization_services (id, organization_id, label, sort_order) values ('9ec8e994-05d4-475d-af4b-191ed1cff1fd', 'd0d0d0d0-0000-4000-a000-000000000001', 'Free Solar Quote', 4);

-- Territories
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('be8d0ea6-8ab5-4966-a505-b1df14683221', 'd0d0d0d0-0000-4000-a000-000000000001', 'Hyde Park', '#3B82F6', '{"type":"Polygon","coordinates":[[[-82.478000,27.931000],[-82.464000,27.931000],[-82.464000,27.943000],[-82.478000,27.943000],[-82.478000,27.931000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('20bea5b1-7205-4774-ac5e-e92090ca173a', 'd0d0d0d0-0000-4000-a000-000000000001', 'Davis Islands', '#10B981', '{"type":"Polygon","coordinates":[[[-82.458000,27.896000],[-82.448000,27.896000],[-82.448000,27.906000],[-82.458000,27.906000],[-82.458000,27.896000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('ac293ac2-3972-478b-afd5-1c87ab45d11c', 'd0d0d0d0-0000-4000-a000-000000000001', 'Bayshore', '#F59E0B', '{"type":"Polygon","coordinates":[[[-82.486000,27.903000],[-82.476000,27.903000],[-82.476000,27.917000],[-82.486000,27.917000],[-82.486000,27.903000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('c6f25e10-ba98-4f47-a031-a9fed9a5429a', 'd0d0d0d0-0000-4000-a000-000000000001', 'Westchase', '#EF4444', '{"type":"Polygon","coordinates":[[[-82.616000,28.051000],[-82.602000,28.051000],[-82.602000,28.065000],[-82.616000,28.065000],[-82.616000,28.051000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('f416b737-efa9-462f-a1fa-6d4e4d05c8a9', 'd0d0d0d0-0000-4000-a000-000000000001', 'New Tampa', '#8B5CF6', '{"type":"Polygon","coordinates":[[[-82.386000,28.106000],[-82.372000,28.106000],[-82.372000,28.122000],[-82.386000,28.122000],[-82.386000,28.106000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', 'd0d0d0d0-0000-4000-a000-000000000001', 'Brandon', '#EC4899', '{"type":"Polygon","coordinates":[[[-82.293000,27.930000],[-82.279000,27.930000],[-82.279000,27.944000],[-82.293000,27.944000],[-82.293000,27.930000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');
insert into public.territories (id, organization_id, name, color, polygon, created_at, updated_at)
values ('2eec7d38-31c4-4c0c-ad33-de159d6b4513', 'd0d0d0d0-0000-4000-a000-000000000001', 'Carrollwood', '#14B8A6', '{"type":"Polygon","coordinates":[[[-82.511000,28.045000],[-82.497000,28.045000],[-82.497000,28.059000],[-82.511000,28.059000],[-82.511000,28.045000]]]}'::jsonb,
       now() - interval '85 days', now() - interval '30 days');

-- Manager auth + profile
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'd0d0d0d0-0000-4000-a000-000000000002',
  'authenticated', 'authenticated',
  'demo@knockiq.com',
  crypt('DemoKnockIQ2026!', gen_salt('bf')),
  now() - interval '85 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Marcus Reyes', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '85 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, avatar_url, created_at)
values ('d0d0d0d0-0000-4000-a000-000000000002', 'demo@knockiq.com', '+18137938447', 'Marcus Reyes',
        'manager', 'd0d0d0d0-0000-4000-a000-000000000001', 'active', NULL, now() - interval '85 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = excluded.role, organization_id = excluded.organization_id, status = excluded.status;
update public.organizations set owner_user_id = 'd0d0d0d0-0000-4000-a000-000000000002' where id = 'd0d0d0d0-0000-4000-a000-000000000001';

-- Reps auth + profiles
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'dc99802f-dfe9-403b-a038-606a10638d2f',
  'authenticated', 'authenticated',
  'sophia.martinez@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Sophia Martinez', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('dc99802f-dfe9-403b-a038-606a10638d2f', 'sophia.martinez@sunburstsolar.demo', '+18135606413', 'Sophia Martinez', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '782cb651-4802-436d-a1be-a350218fc22c',
  'authenticated', 'authenticated',
  'tyler.brennan@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Tyler Brennan', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('782cb651-4802-436d-a1be-a350218fc22c', 'tyler.brennan@sunburstsolar.demo', '+18137592725', 'Tyler Brennan', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '8effcdba-d9fa-45b8-ac70-c78db64b7bed',
  'authenticated', 'authenticated',
  'aisha.patel@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Aisha Patel', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('8effcdba-d9fa-45b8-ac70-c78db64b7bed', 'aisha.patel@sunburstsolar.demo', '+18138474751', 'Aisha Patel', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c',
  'authenticated', 'authenticated',
  'jordan.williams@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Jordan Williams', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('f7a92b8d-5865-4e71-adca-0e8b6730b58c', 'jordan.williams@sunburstsolar.demo', '+18134493961', 'Jordan Williams', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b',
  'authenticated', 'authenticated',
  'maya.okafor@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Maya Okafor', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('e89df180-6ccd-4d61-a8ed-4924927c7b8b', 'maya.okafor@sunburstsolar.demo', '+18132899821', 'Maya Okafor', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '80576a58-ed48-48f0-a8d5-5f7c061c3a27',
  'authenticated', 'authenticated',
  'diego.hernandez@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Diego Hernandez', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('80576a58-ed48-48f0-a8d5-5f7c061c3a27', 'diego.hernandez@sunburstsolar.demo', '+18132024680', 'Diego Hernandez', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '5ec3649f-5c71-4e31-a1eb-621421171d0a',
  'authenticated', 'authenticated',
  'brittany.chen@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Brittany Chen', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('5ec3649f-5c71-4e31-a1eb-621421171d0a', 'brittany.chen@sunburstsolar.demo', '+18135527604', 'Brittany Chen', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'c5bf3928-4687-42e8-a7f5-743b7de47d59',
  'authenticated', 'authenticated',
  'carlos.mendez@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Carlos Mendez', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('c5bf3928-4687-42e8-a7f5-743b7de47d59', 'carlos.mendez@sunburstsolar.demo', '+18138091127', 'Carlos Mendez', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2',
  'authenticated', 'authenticated',
  'hannah.schultz@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Hannah Schultz', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', 'hannah.schultz@sunburstsolar.demo', '+18137966038', 'Hannah Schultz', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '8a4dc880-a6ec-4e22-ac89-71860e85d451',
  'authenticated', 'authenticated',
  'devin.brooks@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Devin Brooks', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('8a4dc880-a6ec-4e22-ac89-71860e85d451', 'devin.brooks@sunburstsolar.demo', '+18135193422', 'Devin Brooks', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f',
  'authenticated', 'authenticated',
  'priya.kumar@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Priya Kumar', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', 'priya.kumar@sunburstsolar.demo', '+18138547850', 'Priya Kumar', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '13525546-8db1-44f0-adb0-666e731ee044',
  'authenticated', 'authenticated',
  'lucas.petrov@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Lucas Petrov', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('13525546-8db1-44f0-adb0-666e731ee044', 'lucas.petrov@sunburstsolar.demo', '+18132820301', 'Lucas Petrov', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab',
  'authenticated', 'authenticated',
  'connor.walsh@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Connor Walsh', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', 'connor.walsh@sunburstsolar.demo', '+18136536287', 'Connor Walsh', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '7d6afc78-c90b-41d0-a32f-c326cba7c10e',
  'authenticated', 'authenticated',
  'madison.reilly@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Madison Reilly', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('7d6afc78-c90b-41d0-a32f-c326cba7c10e', 'madison.reilly@sunburstsolar.demo', '+18135321586', 'Madison Reilly', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be',
  'authenticated', 'authenticated',
  'justin.park@sunburstsolar.demo',
  crypt('DemoRep!20260601', gen_salt('bf')),
  now() - interval '70 days',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Justin Park', 'demo_org', 'd0d0d0d0-0000-4000-a000-000000000001'),
  false, now() - interval '70 days', now(),
  '', '', '', ''
);
insert into public.users (id, email, phone, full_name, role, organization_id, status, created_at)
values ('98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', 'justin.park@sunburstsolar.demo', '+18134789759', 'Justin Park', 'rep', 'd0d0d0d0-0000-4000-a000-000000000001', 'active',
        now() - interval '70 days')
on conflict (id) do update set
  email = excluded.email, phone = excluded.phone, full_name = excluded.full_name,
  role = 'rep', organization_id = excluded.organization_id, status = 'active';

-- Territory assignments
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('7edbb915-788f-4092-aa0b-7de443a0014d', '20bea5b1-7205-4774-ac5e-e92090ca173a', 'dc99802f-dfe9-403b-a038-606a10638d2f', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('800b6fc7-0fb5-41fa-aae9-a0f9f803cee9', 'f416b737-efa9-462f-a1fa-6d4e4d05c8a9', 'dc99802f-dfe9-403b-a038-606a10638d2f', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('974526c6-d19c-4344-aa31-5d5c8a0e5af3', 'be8d0ea6-8ab5-4966-a505-b1df14683221', '782cb651-4802-436d-a1be-a350218fc22c', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('cfbc1a16-3994-464b-a05b-67f7bed19fb0', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '782cb651-4802-436d-a1be-a350218fc22c', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('dadc75b5-b7e8-484b-acff-487e16719a47', 'f416b737-efa9-462f-a1fa-6d4e4d05c8a9', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('aa018345-8baa-4c94-a7ad-a702e0374f72', '20bea5b1-7205-4774-ac5e-e92090ca173a', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('ada94c7d-925c-43d1-a46a-2596662ced75', 'f416b737-efa9-462f-a1fa-6d4e4d05c8a9', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('6a0b4699-c9e4-42fd-a244-eb5806cdb8c4', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('e47aca69-a32a-4c39-a8e4-072337d26d99', 'be8d0ea6-8ab5-4966-a505-b1df14683221', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('de94671a-324c-495d-a2c5-972f99d88413', 'c6f25e10-ba98-4f47-a031-a9fed9a5429a', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('74f62474-20c7-4f36-abfb-eee6ad17e338', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('47ccdb48-b5fd-47e8-a69e-0183a7e74db6', 'be8d0ea6-8ab5-4966-a505-b1df14683221', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('b9a89e3b-9c93-416d-a474-e9e91e126537', 'ac293ac2-3972-478b-afd5-1c87ab45d11c', '5ec3649f-5c71-4e31-a1eb-621421171d0a', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('24de7a5a-f7e4-42a2-ac62-1013da44b04b', '20bea5b1-7205-4774-ac5e-e92090ca173a', '5ec3649f-5c71-4e31-a1eb-621421171d0a', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('fe00e84b-1a74-4f23-a977-5b8fe694b670', 'c6f25e10-ba98-4f47-a031-a9fed9a5429a', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('4fefb476-2d96-469e-aec9-639d7f05aec0', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('5c5b2c7d-58f5-4281-ae5f-7589d5a5dbf6', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('209e746f-c2d2-4d6d-a4f3-50536717420d', 'be8d0ea6-8ab5-4966-a505-b1df14683221', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('672c4987-b22d-4645-ac86-49b45af5120b', '20bea5b1-7205-4774-ac5e-e92090ca173a', '8a4dc880-a6ec-4e22-ac89-71860e85d451', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('5c8c1105-4a8c-48aa-a66f-ebe838fb9d7a', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '8a4dc880-a6ec-4e22-ac89-71860e85d451', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('7008fa47-c223-4489-a589-118d3a64291f', 'ac293ac2-3972-478b-afd5-1c87ab45d11c', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('d7cabe16-cd5f-478f-ac1b-d4d158688030', 'be8d0ea6-8ab5-4966-a505-b1df14683221', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('b41d6a2d-238b-49a6-aed9-828f8ca6405a', '20bea5b1-7205-4774-ac5e-e92090ca173a', '13525546-8db1-44f0-adb0-666e731ee044', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('72c98743-5c42-4958-a969-1c8988c0c264', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '13525546-8db1-44f0-adb0-666e731ee044', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('3848ce67-b12b-4c0c-a7ae-342f824efd77', 'ac293ac2-3972-478b-afd5-1c87ab45d11c', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('7a53d638-44fb-4504-aafb-18f19fcdf356', 'ac293ac2-3972-478b-afd5-1c87ab45d11c', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');
insert into public.territory_assignments (id, territory_id, rep_id, organization_id, assigned_by, assigned_at) values ('e4592c38-def2-48c3-a147-f231c66f9f83', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', 'd0d0d0d0-0000-4000-a000-000000000001', 'd0d0d0d0-0000-4000-a000-000000000002', now() - interval '60 days');

-- Territory completions (recent)
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('fb7839c3-b8ac-4016-a465-aaa83e64392c', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', 'dc99802f-dfe9-403b-a038-606a10638d2f', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '14 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('0830f798-0c31-4d25-af0f-020c1718863a', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '5ec3649f-5c71-4e31-a1eb-621421171d0a', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '25 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('1de284ec-2487-476c-a557-3199ad496f2f', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '11 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('b6844593-b9f1-4a07-abc3-2ffe908e3ce9', 'ac293ac2-3972-478b-afd5-1c87ab45d11c', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '24 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('391d36ed-4ee9-4673-a1f1-14bd9933aefa', 'c6f25e10-ba98-4f47-a031-a9fed9a5429a', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '25 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('17afee2e-63ed-44b3-a87b-3f197aa7503c', '20bea5b1-7205-4774-ac5e-e92090ca173a', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '12 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('83c8f8f6-c817-43f8-a6a8-93fd2e3a17e2', '5db6001d-0a1e-46e5-af8e-7f7e817bd0dc', 'dc99802f-dfe9-403b-a038-606a10638d2f', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '24 days');
insert into public.territory_completions (id, territory_id, rep_id, organization_id, completed_at) values ('c9aed08f-4996-4703-a364-38cacea2de29', '2eec7d38-31c4-4c0c-ad33-de159d6b4513', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', 'd0d0d0d0-0000-4000-a000-000000000001', now() - interval '22 days');

-- Canvassing sessions, interactions, bookings
-- 511 sessions, ~20646 interactions

-- Sessions
insert into public.canvassing_sessions (id, rep_id, started_at, ended_at, status, doors_knocked, conversations, estimates, bookings, revenue_booked, neighborhood, organization_id) values
('e9233f3d-f83d-4968-a6d2-88cc49760f1a', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-03T16:30:00+00:00'::timestamptz, '2026-04-03T20:03:44.411979+00:00'::timestamptz, 'submitted', 44, 10, 2, 2, 42200.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6289cc49-c722-48b2-ac5a-9b727827d007', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-06T16:00:00+00:00'::timestamptz, '2026-04-06T18:21:42.811955+00:00'::timestamptz, 'submitted', 60, 17, 3, 3, 103700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f8a4cd42-ca13-4ac7-a086-6a0fdfaecfca', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-07T16:45:00+00:00'::timestamptz, '2026-04-07T20:46:33.671064+00:00'::timestamptz, 'submitted', 54, 16, 4, 1, 20900.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ae101a67-f155-4d56-aa13-d993c248c709', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-09T17:30:00+00:00'::timestamptz, '2026-04-09T21:06:03.176226+00:00'::timestamptz, 'submitted', 58, 12, 9, 1, 8800.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fa9b5e4c-30a4-475d-ab70-403242e16824', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-13T16:15:00+00:00'::timestamptz, '2026-04-13T18:40:17.675998+00:00'::timestamptz, 'submitted', 48, 15, 2, 2, 77700.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e50bff25-5d60-4d3d-ab99-ad417b855ea6', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-14T15:15:00+00:00'::timestamptz, '2026-04-14T18:27:49.348740+00:00'::timestamptz, 'submitted', 55, 16, 8, 1, 2700.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('53d03545-fc09-4d89-a179-d00bb97e8a6b', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-16T17:15:00+00:00'::timestamptz, '2026-04-16T21:05:46.463671+00:00'::timestamptz, 'submitted', 40, 9, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d36bdcda-92af-4556-a8f7-ad6852e2ffa6', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-17T15:15:00+00:00'::timestamptz, '2026-04-17T17:56:49.899143+00:00'::timestamptz, 'submitted', 46, 11, 4, 1, 67400.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('45f6c190-0f2d-4881-a8fe-5983f9c5f5e1', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-20T15:00:00+00:00'::timestamptz, '2026-04-20T17:39:17.914315+00:00'::timestamptz, 'submitted', 57, 17, 9, 1, 11100.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0ca43d5c-0504-44eb-acde-bf9ed575cd0c', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-21T17:45:00+00:00'::timestamptz, '2026-04-21T20:42:01.830036+00:00'::timestamptz, 'submitted', 42, 11, 6, 2, 23800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('10f3735d-5d18-4678-a0b4-28765841024c', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-22T15:45:00+00:00'::timestamptz, '2026-04-22T18:12:25.887687+00:00'::timestamptz, 'submitted', 40, 12, 4, 2, 52400.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('99fb1520-f8b0-425d-ab3e-bf2c55c5dc1f', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-24T17:45:00+00:00'::timestamptz, '2026-04-24T20:02:29.078877+00:00'::timestamptz, 'submitted', 43, 15, 2, 1, 18500.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('01da765f-481a-4128-a2cb-a4ef1ce3bed0', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-25T13:30:00+00:00'::timestamptz, '2026-04-25T15:35:29.366947+00:00'::timestamptz, 'submitted', 46, 11, 4, 2, 96400.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('dc453439-5ed8-4163-acb8-173e2be61dee', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-27T16:00:00+00:00'::timestamptz, '2026-04-27T19:34:21.719027+00:00'::timestamptz, 'submitted', 53, 15, 5, 1, 19800.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f637e528-7acd-46fe-aebf-bfd07b04382b', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-28T15:00:00+00:00'::timestamptz, '2026-04-28T19:16:32.517526+00:00'::timestamptz, 'submitted', 52, 13, 3, 2, 57200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c9608496-e5fe-4ab7-ab2e-e1fbdde9a9a8', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-04-29T17:45:00+00:00'::timestamptz, '2026-04-29T21:10:44.648587+00:00'::timestamptz, 'submitted', 54, 13, 6, 2, 5400.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('edfd6435-1e9f-439d-a849-897ad51ec8bc', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-01T16:30:00+00:00'::timestamptz, '2026-05-01T20:26:05.265646+00:00'::timestamptz, 'submitted', 60, 11, 4, 3, 122100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d9ff0368-6f06-497a-abe2-c655250a3cc7', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-06T15:15:00+00:00'::timestamptz, '2026-05-06T17:47:23.156295+00:00'::timestamptz, 'submitted', 47, 9, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ee0a96f3-870f-4a80-a453-296631f3bff8', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-07T15:45:00+00:00'::timestamptz, '2026-05-07T18:34:00.318795+00:00'::timestamptz, 'submitted', 54, 18, 6, 3, 119700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7ae61786-b764-44e6-a576-0f0c09887a6a', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-08T17:30:00+00:00'::timestamptz, '2026-05-08T21:29:46.927814+00:00'::timestamptz, 'submitted', 41, 14, 4, 1, 2700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('919c1351-d004-4323-a1c6-1ee67b306d05', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-09T12:15:00+00:00'::timestamptz, '2026-05-09T14:59:25.200045+00:00'::timestamptz, 'submitted', 52, 11, 3, 1, 39000.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d5ea0485-2b8b-4de6-adc0-a83f4a752b4f', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-11T16:00:00+00:00'::timestamptz, '2026-05-11T18:03:00.519066+00:00'::timestamptz, 'submitted', 50, 12, 6, 1, 34200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('917b0e79-d401-43b2-ad79-ccd026705a62', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-12T16:15:00+00:00'::timestamptz, '2026-05-12T19:47:56.735997+00:00'::timestamptz, 'submitted', 48, 11, 5, 2, 92200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6b4f476e-5de8-4c95-abb0-c9e6a09da852', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-13T17:15:00+00:00'::timestamptz, '2026-05-13T21:04:54.998154+00:00'::timestamptz, 'submitted', 41, 11, 3, 2, 130800.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('90d5fee4-5d24-49df-adde-8882b80f398c', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-14T16:15:00+00:00'::timestamptz, '2026-05-14T20:18:33.859507+00:00'::timestamptz, 'submitted', 55, 11, 6, 2, 36000.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('33a24b10-8a58-43a4-a46e-fe17cc7433b3', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-15T16:30:00+00:00'::timestamptz, '2026-05-15T20:58:51.371811+00:00'::timestamptz, 'submitted', 58, 18, 7, 1, 50800.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('84260713-f1de-4277-a2ba-75377667a0c2', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-16T13:45:00+00:00'::timestamptz, '2026-05-16T15:45:08.822253+00:00'::timestamptz, 'submitted', 57, 14, 6, 1, 18500.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cb6dcec1-e0bb-422b-a53d-720307240c5c', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-19T15:30:00+00:00'::timestamptz, '2026-05-19T18:03:45.414895+00:00'::timestamptz, 'submitted', 45, 8, 2, 2, 93500.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fa5ac6e1-5a6c-4f60-a61e-1437add2299a', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-20T15:15:00+00:00'::timestamptz, '2026-05-20T18:04:20.996021+00:00'::timestamptz, 'submitted', 51, 17, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ff5b42e8-a67d-4803-a35f-02df506d5b11', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-21T15:15:00+00:00'::timestamptz, '2026-05-21T17:44:38.942982+00:00'::timestamptz, 'submitted', 60, 14, 8, 3, 52600.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b1e2e9b0-f6e3-4da9-a9c6-220d54f86243', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-22T15:15:00+00:00'::timestamptz, '2026-05-22T19:32:55.199736+00:00'::timestamptz, 'submitted', 44, 15, 2, 2, 63700.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1c8f5a00-24c1-4fab-ad39-e3a6a106aa7b', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-25T16:15:00+00:00'::timestamptz, '2026-05-25T19:39:31.940041+00:00'::timestamptz, 'submitted', 57, 20, 7, 1, 1800.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('58951409-fbce-431a-a7f1-93f0bddc2701', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-26T16:45:00+00:00'::timestamptz, '2026-05-26T20:51:37.911706+00:00'::timestamptz, 'submitted', 54, 12, 3, 3, 96900.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('71ff68e4-da82-4e5e-ae00-4bab4695170d', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-27T16:00:00+00:00'::timestamptz, '2026-05-27T19:33:03.938081+00:00'::timestamptz, 'submitted', 58, 20, 4, 4, 191300.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8ccfca0e-02e7-40f2-a2cb-35dde85f30f7', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-28T17:15:00+00:00'::timestamptz, '2026-05-28T20:46:44.954644+00:00'::timestamptz, 'submitted', 40, 13, 5, 2, 70500.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0e9f5b86-9c5d-4b14-a3b1-0ab006437575', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-29T17:00:00+00:00'::timestamptz, '2026-05-29T20:44:51.883143+00:00'::timestamptz, 'submitted', 48, 12, 7, 1, 1800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('047b10f1-7e47-48dc-ab46-328761abffab', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-05-30T14:00:00+00:00'::timestamptz, '2026-05-30T16:13:51.233296+00:00'::timestamptz, 'submitted', 44, 12, 7, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('67157969-6ed1-4a8f-a895-9b8cdefb358f', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-06-01T16:00:00+00:00'::timestamptz, '2026-06-01T19:57:40.446522+00:00'::timestamptz, 'submitted', 53, 17, 3, 3, 36600.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('67f41053-ce4b-45c0-ad4c-eb5657fc3035', 'dc99802f-dfe9-403b-a038-606a10638d2f', '2026-06-02T17:45:00+00:00'::timestamptz, NULL, 'active', 19, 5, 1, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4c019d17-945f-474b-ade6-813eca54c615', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-03T16:15:00+00:00'::timestamptz, '2026-04-03T20:26:47.366886+00:00'::timestamptz, 'submitted', 47, 13, 6, 1, 1700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b41bbb50-b62f-41c8-a3c5-57b8e009bda5', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-06T16:15:00+00:00'::timestamptz, '2026-04-06T18:51:27.512809+00:00'::timestamptz, 'submitted', 50, 9, 5, 2, 4200.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0d3985f2-4926-4ec6-a3ce-050f67ddfb9f', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-07T17:15:00+00:00'::timestamptz, '2026-04-07T19:36:44.055497+00:00'::timestamptz, 'submitted', 60, 18, 6, 3, 46700.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6654d303-8935-4f13-a219-af323690383a', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-08T15:15:00+00:00'::timestamptz, '2026-04-08T17:46:14.649769+00:00'::timestamptz, 'submitted', 50, 17, 6, 2, 54200.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('32778a79-1f99-40f5-a209-a418641433c6', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-09T16:15:00+00:00'::timestamptz, '2026-04-09T18:47:53.140289+00:00'::timestamptz, 'submitted', 43, 15, 6, 1, 31500.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('77089ce0-6533-442c-aac8-11636bce8702', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-10T17:15:00+00:00'::timestamptz, '2026-04-10T20:07:03.788227+00:00'::timestamptz, 'submitted', 47, 12, 7, 1, 48700.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('11519c6a-0ad0-45c1-ae8e-4551d26d6629', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-13T16:45:00+00:00'::timestamptz, '2026-04-13T19:10:10.979233+00:00'::timestamptz, 'submitted', 41, 10, 5, 2, 40700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8412522a-a2b0-41b1-a5c8-ee570a1b141a', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-14T17:45:00+00:00'::timestamptz, '2026-04-14T20:04:01.685451+00:00'::timestamptz, 'submitted', 43, 10, 6, 2, 48700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2ab4ac05-d338-4984-a668-ff913280f88f', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-16T17:30:00+00:00'::timestamptz, '2026-04-16T20:05:16.861830+00:00'::timestamptz, 'submitted', 55, 14, 6, 3, 29400.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fae7744a-8c5c-4110-a049-8c5f9948d926', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-19T13:45:00+00:00'::timestamptz, '2026-04-19T18:10:53.266766+00:00'::timestamptz, 'submitted', 55, 19, 4, 2, 27600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9aac0741-39f0-4036-a1ad-61cc184e29b9', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-20T16:30:00+00:00'::timestamptz, '2026-04-20T18:59:17.881121+00:00'::timestamptz, 'submitted', 58, 17, 3, 3, 91400.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8bf1d5fd-e24b-4b63-a7dd-861bf78d175d', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-21T16:15:00+00:00'::timestamptz, '2026-04-21T18:45:31.046693+00:00'::timestamptz, 'submitted', 57, 13, 8, 1, 69400.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('359f7077-168b-48ec-adaa-51ce0cfc460f', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-22T15:15:00+00:00'::timestamptz, '2026-04-22T18:11:11.560684+00:00'::timestamptz, 'submitted', 53, 19, 3, 2, 60500.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('dbc2f786-dc72-4f44-a420-d1ac10f880b9', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-23T17:30:00+00:00'::timestamptz, '2026-04-23T20:42:07.326102+00:00'::timestamptz, 'submitted', 40, 13, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ec3fa9f3-98ff-4269-a52a-ebde214fa38c', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-24T16:45:00+00:00'::timestamptz, '2026-04-24T19:46:37.940774+00:00'::timestamptz, 'submitted', 51, 17, 6, 3, 29700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5147c3de-1f8c-4c1c-ab29-fb37d293b9dd', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-25T11:00:00+00:00'::timestamptz, '2026-04-25T14:06:12.893924+00:00'::timestamptz, 'submitted', 57, 18, 8, 3, 69500.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e24ff5b5-bab3-4b34-a756-92d807dacc1b', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-27T17:15:00+00:00'::timestamptz, '2026-04-27T20:21:21.291729+00:00'::timestamptz, 'submitted', 49, 10, 4, 3, 81600.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('24e840c8-3933-480f-a066-c7942357a032', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-28T16:15:00+00:00'::timestamptz, '2026-04-28T20:01:33.025616+00:00'::timestamptz, 'submitted', 59, 21, 7, 2, 12200.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3dc3fe56-99bd-4212-a929-3c27e05f48ce', '782cb651-4802-436d-a1be-a350218fc22c', '2026-04-29T15:45:00+00:00'::timestamptz, '2026-04-29T18:22:14.875212+00:00'::timestamptz, 'submitted', 57, 12, 5, 2, 39000.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('22ee4222-f9d7-49ef-a5ce-233fe4f7c8c7', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-01T15:45:00+00:00'::timestamptz, '2026-05-01T19:38:10.774454+00:00'::timestamptz, 'submitted', 41, 8, 3, 2, 102500.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('09a2b520-be5a-462a-a0f2-9ee7e580557e', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-02T14:30:00+00:00'::timestamptz, '2026-05-02T17:20:10.201915+00:00'::timestamptz, 'submitted', 57, 13, 3, 3, 94200.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('64add3cc-2ba0-4a6e-a8ef-158cdc3b8d35', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-04T17:30:00+00:00'::timestamptz, '2026-05-04T21:45:30.373577+00:00'::timestamptz, 'submitted', 60, 21, 7, 3, 138700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2b875a0e-3112-47bc-ad48-b9232533b19e', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-05T17:45:00+00:00'::timestamptz, '2026-05-05T20:56:17.950771+00:00'::timestamptz, 'submitted', 40, 8, 4, 2, 13300.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c076b451-5fb2-42ab-a13a-0fd9d31abd9d', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-06T17:15:00+00:00'::timestamptz, '2026-05-06T21:17:47.910820+00:00'::timestamptz, 'submitted', 45, 14, 4, 2, 26000.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5ad86a42-c850-4f20-a035-6859e25b654a', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-07T15:45:00+00:00'::timestamptz, '2026-05-07T20:03:36.926327+00:00'::timestamptz, 'submitted', 51, 14, 3, 3, 84900.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('41f4f78b-ecee-4691-a76c-4a7045414d71', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-08T16:00:00+00:00'::timestamptz, '2026-05-08T18:32:25.177248+00:00'::timestamptz, 'submitted', 46, 9, 5, 2, 22600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ebb74c21-0789-4823-a14e-fe5a6d6249dd', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-11T16:30:00+00:00'::timestamptz, '2026-05-11T19:46:38.671752+00:00'::timestamptz, 'submitted', 41, 9, 3, 2, 84900.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('abaaf1ed-e4cb-404e-a49a-f43c188d7d73', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-12T15:15:00+00:00'::timestamptz, '2026-05-12T18:53:32.494273+00:00'::timestamptz, 'submitted', 50, 14, 4, 1, 2600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8bc3cb1b-6904-4375-aa3a-fa535354022b', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-13T16:15:00+00:00'::timestamptz, '2026-05-13T20:14:26.465407+00:00'::timestamptz, 'submitted', 45, 16, 3, 2, 16800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('87b89b54-d8e7-4eac-a445-d2e78ffc5326', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-14T17:00:00+00:00'::timestamptz, '2026-05-14T20:31:31.901731+00:00'::timestamptz, 'submitted', 58, 14, 3, 3, 82500.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2c4c2ef7-58a6-4e66-aab4-ffd1f6ecfd12', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-15T16:15:00+00:00'::timestamptz, '2026-05-15T19:23:23.151618+00:00'::timestamptz, 'submitted', 43, 9, 5, 2, 50400.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6ffe0eb5-d695-4a7b-a7cd-4ca76c8076b5', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-19T15:15:00+00:00'::timestamptz, '2026-05-19T19:21:00.439209+00:00'::timestamptz, 'submitted', 43, 12, 3, 2, 69400.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d3406677-e464-4906-a062-4abd765826ff', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-20T15:30:00+00:00'::timestamptz, '2026-05-20T18:00:19.565452+00:00'::timestamptz, 'submitted', 46, 14, 7, 2, 53200.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ce2642f6-72be-423a-aa57-3177e92978d0', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-21T16:00:00+00:00'::timestamptz, '2026-05-21T20:26:45.551351+00:00'::timestamptz, 'submitted', 48, 11, 5, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('37ed5549-9d5c-4ad2-aab2-3349b2b29342', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-22T15:00:00+00:00'::timestamptz, '2026-05-22T17:27:16.250362+00:00'::timestamptz, 'submitted', 60, 15, 4, 2, 35300.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6249388a-f8e7-4c1c-ab44-af91d34ba930', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-23T13:00:00+00:00'::timestamptz, '2026-05-23T17:09:23.326200+00:00'::timestamptz, 'submitted', 59, 17, 5, 2, 62500.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b86bdf54-f6cb-4759-ae91-bfd8a1747137', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-25T17:30:00+00:00'::timestamptz, '2026-05-25T21:25:39.544848+00:00'::timestamptz, 'submitted', 48, 9, 3, 2, 56100.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7db07672-1aa7-48cf-ae3f-b6ae3cbcc4f7', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-26T16:30:00+00:00'::timestamptz, '2026-05-26T19:58:45.509177+00:00'::timestamptz, 'submitted', 43, 9, 4, 1, 23700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e017a217-8687-4fcf-a1be-94bbae6e83b7', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-27T16:15:00+00:00'::timestamptz, '2026-05-27T18:43:03.748310+00:00'::timestamptz, 'submitted', 42, 11, 5, 2, 29000.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2c46ec1f-7163-40ff-a862-00644c155d4c', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-28T17:15:00+00:00'::timestamptz, '2026-05-28T20:11:09.125137+00:00'::timestamptz, 'submitted', 55, 19, 6, 1, 44800.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2ae17251-65e4-4282-a3ff-b3354a92b915', '782cb651-4802-436d-a1be-a350218fc22c', '2026-05-29T15:15:00+00:00'::timestamptz, '2026-05-29T18:46:56.008509+00:00'::timestamptz, 'submitted', 41, 13, 3, 1, 67800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d2602ad7-f334-483b-aa0d-6cfe5b522ce4', '782cb651-4802-436d-a1be-a350218fc22c', '2026-06-01T17:45:00+00:00'::timestamptz, '2026-06-01T20:10:57.791593+00:00'::timestamptz, 'submitted', 55, 14, 5, 1, 14300.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6a3e233c-51ca-425a-aa6a-398f69350d26', '782cb651-4802-436d-a1be-a350218fc22c', '2026-06-02T15:00:00+00:00'::timestamptz, NULL, 'active', 22, 5, 1, 1, 61800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4ee032bf-3216-420f-a207-5af7b36c5764', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-03T16:00:00+00:00'::timestamptz, '2026-04-03T19:48:53.634317+00:00'::timestamptz, 'submitted', 53, 12, 6, 1, 51200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e6b5f422-33db-4e29-a76e-6e22337e6615', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-04T12:15:00+00:00'::timestamptz, '2026-04-04T16:16:26.796601+00:00'::timestamptz, 'submitted', 59, 13, 5, 4, 137400.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6032939d-5287-4911-ae8e-3b50dab3f244', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-06T17:00:00+00:00'::timestamptz, '2026-04-06T20:34:33.569697+00:00'::timestamptz, 'submitted', 54, 12, 7, 2, 97000.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7f2a67af-f587-429c-ab76-bcc63a00e475', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-07T17:30:00+00:00'::timestamptz, '2026-04-07T21:52:03.719077+00:00'::timestamptz, 'submitted', 41, 11, 4, 2, 75500.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('50de6195-9c6d-4e45-aad2-a0356d1055fb', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-09T17:30:00+00:00'::timestamptz, '2026-04-09T20:27:49.362332+00:00'::timestamptz, 'submitted', 54, 10, 4, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1d3f654e-efba-419e-a0f3-f1d18c42718e', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-10T17:30:00+00:00'::timestamptz, '2026-04-10T20:08:08.213320+00:00'::timestamptz, 'submitted', 44, 13, 3, 2, 10900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d552d50d-a3f7-42e7-a904-39c0ce6dfd99', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-11T13:30:00+00:00'::timestamptz, '2026-04-11T15:55:57.218108+00:00'::timestamptz, 'submitted', 43, 14, 3, 1, 50800.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5fcb6722-3860-4d06-a1dc-d91f7a5a055c', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-12T14:00:00+00:00'::timestamptz, '2026-04-12T17:24:55.732868+00:00'::timestamptz, 'submitted', 40, 10, 2, 2, 86700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('15c2ad2f-8d11-494a-a5c0-28a6e93123ae', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-14T16:30:00+00:00'::timestamptz, '2026-04-14T19:58:36.681559+00:00'::timestamptz, 'submitted', 56, 11, 6, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b76f2dbb-654e-4037-abbd-5086ee57a82f', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-15T16:30:00+00:00'::timestamptz, '2026-04-15T20:11:26.014873+00:00'::timestamptz, 'submitted', 42, 8, 6, 2, 91900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cc2f49e2-b731-46df-a0e8-6bc756bc611f', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-17T16:45:00+00:00'::timestamptz, '2026-04-17T18:56:40.501771+00:00'::timestamptz, 'submitted', 60, 21, 8, 1, 13900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7a07a98b-82f0-4add-ae28-39861d6fcb1c', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-18T11:00:00+00:00'::timestamptz, '2026-04-18T13:15:59.389686+00:00'::timestamptz, 'submitted', 60, 13, 4, 2, 24400.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cbb863f3-b6aa-4c13-a9f8-1d61bc963f95', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-20T17:00:00+00:00'::timestamptz, '2026-04-20T20:39:38.894946+00:00'::timestamptz, 'submitted', 55, 14, 6, 2, 18800.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d47fa48f-4704-48ec-a297-4306ec013367', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-21T17:45:00+00:00'::timestamptz, '2026-04-21T20:25:22.863205+00:00'::timestamptz, 'submitted', 50, 9, 5, 1, 58500.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b6c0e2cb-b702-4ab4-a0a5-998666f6cd2e', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-22T16:30:00+00:00'::timestamptz, '2026-04-22T18:46:57.938174+00:00'::timestamptz, 'submitted', 57, 12, 3, 3, 93500.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a821948b-e994-4241-a06b-a34c0e9acf13', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-24T16:45:00+00:00'::timestamptz, '2026-04-24T19:36:14.983316+00:00'::timestamptz, 'submitted', 40, 8, 5, 1, 32700.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('896fa552-25bd-43a0-a5d1-49abae41401f', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-25T14:00:00+00:00'::timestamptz, '2026-04-25T16:56:55.347392+00:00'::timestamptz, 'submitted', 55, 13, 3, 3, 68100.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f8744c21-34e3-419e-a2ef-a0b78f136ef0', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-27T15:30:00+00:00'::timestamptz, '2026-04-27T18:01:58.794906+00:00'::timestamptz, 'submitted', 45, 10, 3, 2, 44100.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b8e64b1d-fe05-4bd2-aea1-beb7fcd5372d', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-28T17:45:00+00:00'::timestamptz, '2026-04-28T20:05:24.955512+00:00'::timestamptz, 'submitted', 55, 18, 8, 1, 35600.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8891bcc7-e9e7-4981-a7fd-fc5e901052bc', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-04-29T17:30:00+00:00'::timestamptz, '2026-04-29T20:45:59.202337+00:00'::timestamptz, 'submitted', 52, 16, 2, 2, 102700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('42953a81-4470-443e-a5dc-cdfd34834a12', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-04T16:00:00+00:00'::timestamptz, '2026-05-04T19:47:12.413717+00:00'::timestamptz, 'submitted', 60, 13, 7, 3, 117100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0b1a8117-a211-463e-aeeb-3933ecc1c3eb', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-05T17:15:00+00:00'::timestamptz, '2026-05-05T19:32:39.502929+00:00'::timestamptz, 'submitted', 53, 17, 4, 3, 81900.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cd598159-7437-4796-a97f-83136465e56b', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-06T17:00:00+00:00'::timestamptz, '2026-05-06T20:39:34.273895+00:00'::timestamptz, 'submitted', 55, 19, 7, 3, 112400.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a28d50d4-2f82-448f-a0cb-f2087444bb07', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-07T16:30:00+00:00'::timestamptz, '2026-05-07T20:10:07.793337+00:00'::timestamptz, 'submitted', 59, 12, 6, 4, 105200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4ae02bc2-f1ca-4d2d-acf4-f6fe19c47e98', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-08T15:00:00+00:00'::timestamptz, '2026-05-08T18:41:18.166208+00:00'::timestamptz, 'submitted', 46, 11, 4, 1, 45500.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('52c8ef56-38a0-41ae-a44a-be762c279242', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-11T17:30:00+00:00'::timestamptz, '2026-05-11T21:11:07.286758+00:00'::timestamptz, 'submitted', 60, 13, 6, 3, 128200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('99065c4e-1264-4b3c-ae6e-8c2b9785053e', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-12T15:30:00+00:00'::timestamptz, '2026-05-12T19:23:38.159294+00:00'::timestamptz, 'submitted', 43, 10, 5, 2, 36800.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('18e2d047-a383-4528-ae39-63032da09064', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-13T15:15:00+00:00'::timestamptz, '2026-05-13T19:43:51.995646+00:00'::timestamptz, 'submitted', 44, 10, 3, 1, 10000.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8af6fb6b-2759-4d9b-ad3e-409542be0801', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-14T16:30:00+00:00'::timestamptz, '2026-05-14T20:59:21.140380+00:00'::timestamptz, 'submitted', 42, 13, 2, 2, 68300.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('774d76f5-574d-4333-a258-2a180a9ab722', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-15T17:15:00+00:00'::timestamptz, '2026-05-15T19:54:35.632013+00:00'::timestamptz, 'submitted', 44, 14, 5, 1, 2100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3fe30926-7c48-4209-a163-7dd32d8c133b', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-19T15:00:00+00:00'::timestamptz, '2026-05-19T18:14:47.591924+00:00'::timestamptz, 'submitted', 54, 17, 3, 3, 107100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('409186ad-2dff-4632-a910-9d64d2902950', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-20T15:15:00+00:00'::timestamptz, '2026-05-20T19:09:25.811804+00:00'::timestamptz, 'submitted', 56, 20, 8, 3, 65300.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ce7c4210-8af1-48cc-a7a4-aab6eba289f1', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-21T17:45:00+00:00'::timestamptz, '2026-05-21T20:41:29.683785+00:00'::timestamptz, 'submitted', 48, 16, 5, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f1d622f7-3ca8-4360-a877-fc7d4a91c210', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-22T17:15:00+00:00'::timestamptz, '2026-05-22T20:51:15.016027+00:00'::timestamptz, 'submitted', 60, 11, 7, 3, 34100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5ae23a95-3811-4127-ab2e-e1efdab782a5', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-23T14:15:00+00:00'::timestamptz, '2026-05-23T16:52:33.956449+00:00'::timestamptz, 'submitted', 40, 13, 3, 1, 14300.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b7fd19fc-518c-44e2-a567-704039bbd3b1', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-26T16:30:00+00:00'::timestamptz, '2026-05-26T20:28:09.347150+00:00'::timestamptz, 'submitted', 49, 10, 5, 2, 90800.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f61fa4c8-6bc9-4ed8-a608-9762947c02eb', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-27T16:45:00+00:00'::timestamptz, '2026-05-27T19:06:59.965019+00:00'::timestamptz, 'submitted', 42, 9, 6, 1, 9600.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3bcaadcd-a229-4cd1-a8c4-27f0f3ff9e4e', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-28T16:45:00+00:00'::timestamptz, '2026-05-28T20:36:11.262031+00:00'::timestamptz, 'submitted', 50, 15, 4, 3, 95900.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8af213ad-2692-45bd-a387-233c3780e92e', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-29T16:15:00+00:00'::timestamptz, '2026-05-29T18:53:46.993809+00:00'::timestamptz, 'submitted', 57, 19, 3, 3, 54200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b9869b31-5b44-4280-a04d-11bf34a3a55c', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-05-30T11:30:00+00:00'::timestamptz, '2026-05-30T15:03:13.365875+00:00'::timestamptz, 'submitted', 45, 9, 6, 2, 72600.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0e845f4c-c488-44a8-a483-920118635628', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-06-01T16:15:00+00:00'::timestamptz, '2026-06-01T19:07:46.477974+00:00'::timestamptz, 'submitted', 57, 16, 4, 3, 60900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('49d3b1f8-5660-446b-a15b-674b5d20c700', '8effcdba-d9fa-45b8-ac70-c78db64b7bed', '2026-06-02T15:15:00+00:00'::timestamptz, '2026-06-02T18:53:23.731455+00:00'::timestamptz, 'submitted', 57, 12, 4, 3, 151200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c37915c1-dadf-4b8d-ac86-3eafdc3a094c', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-03T16:45:00+00:00'::timestamptz, '2026-04-03T20:15:01.341993+00:00'::timestamptz, 'submitted', 37, 5, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fdbdd231-fc41-410b-ae1a-2cf1279931a4', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-06T15:15:00+00:00'::timestamptz, '2026-04-06T19:35:32.605776+00:00'::timestamptz, 'submitted', 31, 5, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('05c2a602-8033-43af-ad62-af6d0e4a76d7', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-07T16:15:00+00:00'::timestamptz, '2026-04-07T20:41:27.522298+00:00'::timestamptz, 'submitted', 48, 8, 3, 1, 37800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('662a6d23-9ff2-463f-af26-e057fabc3d77', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-08T17:30:00+00:00'::timestamptz, '2026-04-08T20:04:10.402694+00:00'::timestamptz, 'submitted', 50, 9, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('999d832b-895e-4457-a2c3-cc1ab97389c7', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-11T13:30:00+00:00'::timestamptz, '2026-04-11T16:07:05.097807+00:00'::timestamptz, 'submitted', 44, 11, 2, 1, 2400.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f9e6fd8c-a9b3-46e4-ab19-d86b1edd38cf', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-13T17:30:00+00:00'::timestamptz, '2026-04-13T21:19:04.569655+00:00'::timestamptz, 'submitted', 42, 7, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('57d7cf73-02c5-4423-a01e-b03baf9416ea', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-14T17:45:00+00:00'::timestamptz, '2026-04-14T19:57:37.297350+00:00'::timestamptz, 'submitted', 34, 7, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('65ffedc8-2353-45a6-a682-4ebcbbc291e0', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-15T15:00:00+00:00'::timestamptz, '2026-04-15T18:31:37.310901+00:00'::timestamptz, 'submitted', 46, 9, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e71644f9-445a-4cdc-acc8-0d8898023784', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-16T17:30:00+00:00'::timestamptz, '2026-04-16T19:42:10.468064+00:00'::timestamptz, 'submitted', 36, 5, 2, 1, 33900.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('36c13192-5fc0-4e26-aae4-7f2179d9c408', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-17T16:15:00+00:00'::timestamptz, '2026-04-17T19:53:18.358381+00:00'::timestamptz, 'submitted', 43, 8, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6a953cb3-f94f-4103-a7ba-1903a9beabb9', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-20T17:15:00+00:00'::timestamptz, '2026-04-20T21:14:11.418658+00:00'::timestamptz, 'submitted', 31, 5, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ec8ab734-2b06-41e0-abd7-d28e6ab50af4', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-21T15:30:00+00:00'::timestamptz, '2026-04-21T18:51:26.788495+00:00'::timestamptz, 'submitted', 39, 5, 2, 1, 51200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a23fec9d-65e7-4548-ab49-60e3518d074e', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-22T17:45:00+00:00'::timestamptz, '2026-04-22T20:04:35.222729+00:00'::timestamptz, 'submitted', 50, 11, 1, 1, 30000.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c2218e85-ca1b-4e28-ab20-f47c867b3c92', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-23T16:30:00+00:00'::timestamptz, '2026-04-23T20:09:27.229133+00:00'::timestamptz, 'submitted', 38, 5, 1, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0157d5be-cdb4-46ea-ada3-61052ba335c2', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-24T15:15:00+00:00'::timestamptz, '2026-04-24T19:19:10.170622+00:00'::timestamptz, 'submitted', 50, 8, 2, 1, 8800.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('760b9614-1882-460d-ad73-6bee34489ae3', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-27T16:00:00+00:00'::timestamptz, '2026-04-27T19:22:37.696288+00:00'::timestamptz, 'submitted', 39, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d74cecb6-75cc-4937-ae5b-294e7943927e', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-28T16:30:00+00:00'::timestamptz, '2026-04-28T19:25:25.780675+00:00'::timestamptz, 'submitted', 33, 6, 2, 1, 30600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ea35be49-225a-403e-abf0-c9d5354622d4', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-29T17:00:00+00:00'::timestamptz, '2026-04-29T19:09:18.928844+00:00'::timestamptz, 'submitted', 45, 7, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('23e5abd6-36fe-4684-ae01-1e61a445c2ca', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-04-30T16:15:00+00:00'::timestamptz, '2026-04-30T18:25:11.600732+00:00'::timestamptz, 'submitted', 43, 10, 3, 1, 60900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('792397c7-2790-4e01-a781-dfa8cd73001b', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-02T11:45:00+00:00'::timestamptz, '2026-05-02T16:01:38.952991+00:00'::timestamptz, 'submitted', 32, 4, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f98ef1f0-5bd1-4919-a24d-7997ff65cdde', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-04T16:30:00+00:00'::timestamptz, '2026-05-04T18:38:30.212120+00:00'::timestamptz, 'submitted', 33, 8, 2, 1, 19000.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0c1cc100-56aa-472b-acfb-38846571bc9d', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-05T17:00:00+00:00'::timestamptz, '2026-05-05T19:44:30.972534+00:00'::timestamptz, 'submitted', 49, 10, 4, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4444829a-cca5-4e27-ab29-01cee4b7ef91', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-06T16:00:00+00:00'::timestamptz, '2026-05-06T19:33:33.181629+00:00'::timestamptz, 'submitted', 40, 8, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('459a7f9e-1c14-4a41-aff4-d2384188aec4', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-07T16:45:00+00:00'::timestamptz, '2026-05-07T19:05:45.986506+00:00'::timestamptz, 'submitted', 42, 6, 3, 1, 2200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('16990c1e-451c-4308-a908-8f4c6dd80036', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-08T15:45:00+00:00'::timestamptz, '2026-05-08T19:24:56.386851+00:00'::timestamptz, 'submitted', 50, 9, 4, 1, 8500.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1b990852-7884-4219-a88f-f6322e38fec8', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-12T16:30:00+00:00'::timestamptz, '2026-05-12T20:07:10.944942+00:00'::timestamptz, 'submitted', 32, 5, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('260046eb-d918-44e9-afe0-d5ebfdc549cb', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-13T16:15:00+00:00'::timestamptz, '2026-05-13T18:19:54.479469+00:00'::timestamptz, 'submitted', 31, 7, 2, 1, 37200.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5a7c770d-626d-430e-a72f-a6f75f0aa689', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-14T17:00:00+00:00'::timestamptz, '2026-05-14T20:18:22.740903+00:00'::timestamptz, 'submitted', 35, 6, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('db6c2c51-7c7d-4e51-ac8a-22cc9a05d9ec', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-15T15:45:00+00:00'::timestamptz, '2026-05-15T18:08:22.970995+00:00'::timestamptz, 'submitted', 45, 6, 4, 1, 2900.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e6c861e3-a80d-4100-a337-15221bd6b4d7', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-18T16:00:00+00:00'::timestamptz, '2026-05-18T18:24:05.104799+00:00'::timestamptz, 'submitted', 37, 7, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f55c5366-6df1-44e4-aa0c-e02cab060259', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-19T15:30:00+00:00'::timestamptz, '2026-05-19T17:31:52.694467+00:00'::timestamptz, 'submitted', 38, 9, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9ed762e5-1b21-49ad-a55c-b05f7da7d18d', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-21T17:30:00+00:00'::timestamptz, '2026-05-21T20:03:48.466518+00:00'::timestamptz, 'submitted', 42, 7, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('befeb10b-762b-4012-abbd-5a64ea42ae56', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-25T16:15:00+00:00'::timestamptz, '2026-05-25T19:28:51.957754+00:00'::timestamptz, 'submitted', 37, 7, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e5903f6a-cf47-47ca-a808-0dc1fc2a45eb', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-26T17:15:00+00:00'::timestamptz, '2026-05-26T21:13:57.531642+00:00'::timestamptz, 'submitted', 36, 6, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('af3f1dcb-22e8-4c06-a8fd-f30f0ebdd539', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-27T17:00:00+00:00'::timestamptz, '2026-05-27T19:11:33.056664+00:00'::timestamptz, 'submitted', 36, 5, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('eed949ec-f495-417c-ad35-c0257f8117b1', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-28T17:00:00+00:00'::timestamptz, '2026-05-28T21:19:50.786869+00:00'::timestamptz, 'submitted', 49, 11, 1, 1, 36600.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ce518e3c-36db-4dd2-a4c5-7b3e5fdefc6e', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-05-29T16:00:00+00:00'::timestamptz, '2026-05-29T18:27:08.166247+00:00'::timestamptz, 'submitted', 38, 6, 3, 1, 66900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a23a426b-556d-4e0a-a083-3dd8c41e7a62', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-06-01T15:45:00+00:00'::timestamptz, '2026-06-01T18:55:14.016338+00:00'::timestamptz, 'submitted', 39, 8, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('76fbfa9c-bca4-4064-a267-32d168513a41', 'f7a92b8d-5865-4e71-adca-0e8b6730b58c', '2026-06-02T16:15:00+00:00'::timestamptz, NULL, 'active', 20, 2, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0a3e9ff0-88b8-4c9c-a2ac-f9fcb3d67f07', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-03T15:30:00+00:00'::timestamptz, '2026-04-03T19:12:44.055260+00:00'::timestamptz, 'submitted', 32, 7, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('830e319c-8221-4655-acee-3e1c81e36227', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-06T16:30:00+00:00'::timestamptz, '2026-04-06T20:48:44.697971+00:00'::timestamptz, 'submitted', 40, 9, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('20cee6cb-83e9-4d08-a8c7-f60b1953be79', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-08T17:45:00+00:00'::timestamptz, '2026-04-08T20:39:59.163020+00:00'::timestamptz, 'submitted', 41, 8, 1, 1, 39300.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('65ebd677-62db-469b-a1b8-9fa9100025e3', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-11T11:15:00+00:00'::timestamptz, '2026-04-11T13:18:18.131059+00:00'::timestamptz, 'submitted', 33, 8, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9b1cdcd3-8f70-4d97-a01e-ecd99fd16b41', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-13T15:30:00+00:00'::timestamptz, '2026-04-13T19:09:38.669556+00:00'::timestamptz, 'submitted', 42, 6, 3, 1, 60000.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9e192dc1-e757-4229-a369-8d54f85f28ad', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-14T17:00:00+00:00'::timestamptz, '2026-04-14T19:10:12.008119+00:00'::timestamptz, 'submitted', 47, 8, 4, 1, 64600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9b0ae68a-2f37-4ea8-aa9c-416727b66ca8', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-15T15:00:00+00:00'::timestamptz, '2026-04-15T19:13:26.611915+00:00'::timestamptz, 'submitted', 47, 9, 2, 1, 64300.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('69c1e488-8aaa-4eaa-a9a5-4f638276644e', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-16T15:15:00+00:00'::timestamptz, '2026-04-16T19:07:07.922788+00:00'::timestamptz, 'submitted', 32, 7, 1, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d945f998-9958-45f0-a2e2-564ac03543e5', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-20T15:15:00+00:00'::timestamptz, '2026-04-20T18:04:31.934590+00:00'::timestamptz, 'submitted', 35, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b4456ae4-3c33-46d2-a151-e5ea2a7c15e3', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-22T17:45:00+00:00'::timestamptz, '2026-04-22T19:52:46.713597+00:00'::timestamptz, 'submitted', 46, 10, 2, 1, 63200.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d614842c-d81c-4b5c-a229-e1daf64f72bf', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-23T17:45:00+00:00'::timestamptz, '2026-04-23T19:50:41.247115+00:00'::timestamptz, 'submitted', 35, 8, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a2642366-b8fb-4bce-a110-756f2754cbb6', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-24T15:45:00+00:00'::timestamptz, '2026-04-24T17:58:49.144029+00:00'::timestamptz, 'submitted', 39, 8, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('99594dec-b106-48d0-af4a-bc8595db46d6', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-25T13:30:00+00:00'::timestamptz, '2026-04-25T17:40:17.668052+00:00'::timestamptz, 'submitted', 33, 7, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('18bb1279-f98c-4f78-a871-2d20e8cffa16', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-27T16:45:00+00:00'::timestamptz, '2026-04-27T21:14:55.489448+00:00'::timestamptz, 'submitted', 45, 10, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7c90250f-acbd-4b93-a28b-74ae39a6228f', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-29T16:45:00+00:00'::timestamptz, '2026-04-29T19:11:38.144536+00:00'::timestamptz, 'submitted', 49, 7, 2, 1, 20400.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d4ffc49a-950a-4788-aba4-55fcf78ddc23', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-04-30T16:45:00+00:00'::timestamptz, '2026-04-30T19:35:53.311092+00:00'::timestamptz, 'submitted', 49, 11, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5e8eca52-f3f4-47fe-a2e5-6c41c87ae8bf', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-01T17:00:00+00:00'::timestamptz, '2026-05-01T20:23:18.896139+00:00'::timestamptz, 'submitted', 39, 9, 3, 1, 69600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d12518c2-cf4d-4575-ae88-e9e543217614', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-04T16:00:00+00:00'::timestamptz, '2026-05-04T20:25:06.086914+00:00'::timestamptz, 'submitted', 43, 7, 3, 1, 29900.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e6411a5b-8862-47b1-a11b-430d1f051606', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-05T16:30:00+00:00'::timestamptz, '2026-05-05T20:07:34.475969+00:00'::timestamptz, 'submitted', 32, 8, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('94c2f0c5-3aab-43df-a9aa-07afba6d8146', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-06T17:15:00+00:00'::timestamptz, '2026-05-06T21:06:41.098087+00:00'::timestamptz, 'submitted', 46, 11, 4, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6df6b679-95a1-4587-aaf0-b6208529cd24', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-07T15:00:00+00:00'::timestamptz, '2026-05-07T17:47:28.269013+00:00'::timestamptz, 'submitted', 38, 7, 3, 1, 47000.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('616a5b2a-3c37-47af-a6a6-3aaa6f8e0f68', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-12T15:45:00+00:00'::timestamptz, '2026-05-12T19:31:46.623234+00:00'::timestamptz, 'submitted', 41, 6, 3, 1, 2700.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('194c0538-cc89-4e36-aee0-9444fd9ecbf2', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-15T17:15:00+00:00'::timestamptz, '2026-05-15T19:47:26.216070+00:00'::timestamptz, 'submitted', 35, 6, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('56a46df7-b00e-4f48-a089-f7f8eb550341', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-19T15:30:00+00:00'::timestamptz, '2026-05-19T18:50:53.357269+00:00'::timestamptz, 'submitted', 33, 8, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fabdf366-5cb3-433c-a6c5-51e874a1e78d', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-22T15:45:00+00:00'::timestamptz, '2026-05-22T17:57:45.838319+00:00'::timestamptz, 'submitted', 46, 8, 1, 1, 39100.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f93d62d4-568c-412b-aaec-b6ac5bccb436', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-25T15:00:00+00:00'::timestamptz, '2026-05-25T17:59:52.147839+00:00'::timestamptz, 'submitted', 50, 12, 3, 1, 58400.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8d20a9e9-fec7-4790-afac-9f04ee2eacae', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-26T17:00:00+00:00'::timestamptz, '2026-05-26T21:26:25.404995+00:00'::timestamptz, 'submitted', 31, 4, 0, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5e31fd0f-91b5-4079-a313-350accefbb9f', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-27T17:30:00+00:00'::timestamptz, '2026-05-27T19:53:45.345292+00:00'::timestamptz, 'submitted', 38, 6, 1, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('92874fb9-144a-492e-a862-20ca8eb0f236', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-29T17:45:00+00:00'::timestamptz, '2026-05-29T20:10:50.321395+00:00'::timestamptz, 'submitted', 33, 8, 1, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8002edcc-2345-449e-a64a-cde5217c119b', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-05-30T11:45:00+00:00'::timestamptz, '2026-05-30T15:31:30.765595+00:00'::timestamptz, 'submitted', 32, 5, 1, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b75687fe-040a-40aa-aa27-037a1f4b91ad', 'e89df180-6ccd-4d61-a8ed-4924927c7b8b', '2026-06-01T17:30:00+00:00'::timestamptz, '2026-06-01T21:32:08.164315+00:00'::timestamptz, 'submitted', 32, 6, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8b5b0764-fd8b-43ee-a189-ec7535d31a6c', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-03T17:15:00+00:00'::timestamptz, '2026-04-03T20:26:24.601237+00:00'::timestamptz, 'submitted', 34, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3d80f52b-fe25-408a-ae35-132ed868400b', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-04T12:45:00+00:00'::timestamptz, '2026-04-04T17:01:30.164415+00:00'::timestamptz, 'submitted', 32, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a00bd261-9d96-4b70-ac50-d21f9fa4868d', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-06T16:30:00+00:00'::timestamptz, '2026-04-06T18:43:58.304493+00:00'::timestamptz, 'submitted', 48, 8, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e05951ba-8402-4476-afc7-500236d5d928', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-07T16:15:00+00:00'::timestamptz, '2026-04-07T19:09:43.861328+00:00'::timestamptz, 'submitted', 40, 6, 3, 1, 68900.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a668e133-2084-4296-a143-d5ac303097c7', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-09T15:00:00+00:00'::timestamptz, '2026-04-09T18:14:05.523654+00:00'::timestamptz, 'submitted', 40, 9, 1, 1, 24900.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4e429702-6c52-4ba3-a091-872570c78a22', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-10T16:00:00+00:00'::timestamptz, '2026-04-10T19:39:31.591540+00:00'::timestamptz, 'submitted', 41, 6, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001');
insert into public.canvassing_sessions (id, rep_id, started_at, ended_at, status, doors_knocked, conversations, estimates, bookings, revenue_booked, neighborhood, organization_id) values
('b9dcc0b9-f897-4704-a898-f575467faad0', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-11T14:30:00+00:00'::timestamptz, '2026-04-11T16:46:26.746636+00:00'::timestamptz, 'submitted', 50, 9, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ab9304b7-05a6-431e-ab54-3d2f88834b93', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-13T15:15:00+00:00'::timestamptz, '2026-04-13T17:27:27.665475+00:00'::timestamptz, 'submitted', 50, 9, 2, 1, 13600.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('45efabb4-17ae-464d-a190-30215ce45152', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-15T17:30:00+00:00'::timestamptz, '2026-04-15T20:51:26.245915+00:00'::timestamptz, 'submitted', 48, 9, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('bcbd7d02-7d30-4d31-ad78-501c72efac02', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-16T16:15:00+00:00'::timestamptz, '2026-04-16T19:42:38.370086+00:00'::timestamptz, 'submitted', 50, 8, 2, 1, 32600.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2e2f1e54-ba09-4ec2-a018-cde31c075366', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-18T11:30:00+00:00'::timestamptz, '2026-04-18T15:18:44.780265+00:00'::timestamptz, 'submitted', 36, 6, 1, 1, 60200.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9e5c096b-2706-4b1b-ae72-002c22d6c4c7', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-20T17:45:00+00:00'::timestamptz, '2026-04-20T21:12:13.174238+00:00'::timestamptz, 'submitted', 38, 6, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('25b6b55b-3128-450d-a4a8-ea61b6118d80', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-21T17:00:00+00:00'::timestamptz, '2026-04-21T19:58:23.348551+00:00'::timestamptz, 'submitted', 47, 9, 3, 1, 26300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('06a78a2e-c9f3-46db-abdc-43791eaad5b6', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-22T15:45:00+00:00'::timestamptz, '2026-04-22T19:43:35.076293+00:00'::timestamptz, 'submitted', 32, 5, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4429a0da-5609-406b-ad4d-9aad43450557', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-23T15:00:00+00:00'::timestamptz, '2026-04-23T18:53:02.540427+00:00'::timestamptz, 'submitted', 34, 4, 2, 1, 52400.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('59bdd764-803c-4442-aeff-5e6691d1575d', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-24T15:30:00+00:00'::timestamptz, '2026-04-24T17:38:11.112893+00:00'::timestamptz, 'submitted', 38, 9, 2, 1, 11800.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('28149968-db7e-4f85-a49b-beb57a7de7dd', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-25T14:15:00+00:00'::timestamptz, '2026-04-25T18:40:35.641965+00:00'::timestamptz, 'submitted', 43, 7, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7e5b92d9-8acd-4a1a-aa9b-289d628dceaf', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-28T15:15:00+00:00'::timestamptz, '2026-04-28T19:32:53.346827+00:00'::timestamptz, 'submitted', 48, 8, 4, 1, 54100.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('af2c3fba-3a32-4d94-a5b5-5b65640e0eb8', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-04-30T17:15:00+00:00'::timestamptz, '2026-04-30T21:21:49.424917+00:00'::timestamptz, 'submitted', 34, 5, 2, 1, 2900.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8e441e1c-552a-42ce-ac8b-929d6e5ffe44', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-01T16:15:00+00:00'::timestamptz, '2026-05-01T19:53:00.986766+00:00'::timestamptz, 'submitted', 36, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ad3f7705-3b87-40fd-a63d-8d3ea5446530', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-02T11:00:00+00:00'::timestamptz, '2026-05-02T14:45:44.211369+00:00'::timestamptz, 'submitted', 41, 9, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('067b028e-b6ae-459d-a0bc-7be977858ace', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-04T15:00:00+00:00'::timestamptz, '2026-05-04T18:50:27.568995+00:00'::timestamptz, 'submitted', 44, 7, 2, 1, 31100.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('79915029-bb12-4d60-aaa8-b96674702f4f', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-05T15:45:00+00:00'::timestamptz, '2026-05-05T19:11:07.896983+00:00'::timestamptz, 'submitted', 50, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5d973772-6131-4a6d-aaf0-db72c0a4f8df', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-06T15:30:00+00:00'::timestamptz, '2026-05-06T19:54:18.072124+00:00'::timestamptz, 'submitted', 47, 6, 3, 1, 26000.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8a38534d-be94-4be0-af23-ce426d845463', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-07T16:45:00+00:00'::timestamptz, '2026-05-07T19:48:23.391737+00:00'::timestamptz, 'submitted', 32, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('37dfa918-3c71-4288-a824-6623760eae02', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-11T15:30:00+00:00'::timestamptz, '2026-05-11T18:40:33.664983+00:00'::timestamptz, 'submitted', 43, 8, 1, 1, 56400.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('67f57b76-ccee-4773-a95c-42ff730d6865', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-12T15:00:00+00:00'::timestamptz, '2026-05-12T18:54:38.176966+00:00'::timestamptz, 'submitted', 37, 7, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a17b1e66-1bb3-4f49-a11e-36a48307298b', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-14T17:15:00+00:00'::timestamptz, '2026-05-14T21:04:11.204194+00:00'::timestamptz, 'submitted', 39, 8, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2b3a886c-9ae4-4dea-afee-ef21d6e5d44f', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-18T17:30:00+00:00'::timestamptz, '2026-05-18T20:47:09.615759+00:00'::timestamptz, 'submitted', 30, 6, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('925b3fc7-02b7-41d2-a45f-b1372e782a13', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-19T16:30:00+00:00'::timestamptz, '2026-05-19T19:55:35.235974+00:00'::timestamptz, 'submitted', 30, 7, 2, 1, 38700.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a8b0d0f2-039c-4026-afca-eb60007ed09c', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-21T17:30:00+00:00'::timestamptz, '2026-05-21T19:36:49.372956+00:00'::timestamptz, 'submitted', 31, 5, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9ba8dfd0-f8b1-4eaa-a953-fb8ba86c5c9c', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-23T11:00:00+00:00'::timestamptz, '2026-05-23T13:16:54.252253+00:00'::timestamptz, 'submitted', 49, 7, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('34887954-ab7a-4191-ad93-dcf716f4957b', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-26T17:45:00+00:00'::timestamptz, '2026-05-26T20:25:08.697449+00:00'::timestamptz, 'submitted', 33, 7, 1, 1, 2200.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('840def28-4354-4d62-add9-6715151529ca', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-27T17:30:00+00:00'::timestamptz, '2026-05-27T21:35:35.439732+00:00'::timestamptz, 'submitted', 46, 7, 2, 1, 32600.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ab46ddcf-958d-4946-a385-ef2028c726f9', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-05-29T15:00:00+00:00'::timestamptz, '2026-05-29T18:59:03.774669+00:00'::timestamptz, 'submitted', 39, 6, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5c8398d0-b38c-4f38-a027-1c1d5872c897', '80576a58-ed48-48f0-a8d5-5f7c061c3a27', '2026-06-02T15:30:00+00:00'::timestamptz, NULL, 'active', 19, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a5fbabab-ebd5-425b-aa0e-c005bf67fe0f', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-03T17:00:00+00:00'::timestamptz, '2026-04-03T20:22:55.338496+00:00'::timestamptz, 'submitted', 32, 5, 1, 1, 2400.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d6248f72-8831-41e2-a13d-e22f40d3ff26', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-04T11:00:00+00:00'::timestamptz, '2026-04-04T15:27:32.920589+00:00'::timestamptz, 'submitted', 38, 9, 2, 1, 40000.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1778aebe-3e5c-4b7d-a3e5-e56957aeb93b', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-06T15:45:00+00:00'::timestamptz, '2026-04-06T19:39:11.284730+00:00'::timestamptz, 'submitted', 35, 8, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4691fbef-0d44-4040-add3-effbc4696c26', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-07T15:30:00+00:00'::timestamptz, '2026-04-07T17:35:31.437370+00:00'::timestamptz, 'submitted', 50, 11, 1, 1, 22300.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3f5c1fc2-6108-4dc7-a110-fd078ce6c6f4', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-08T17:45:00+00:00'::timestamptz, '2026-04-08T19:51:20.303382+00:00'::timestamptz, 'submitted', 30, 5, 2, 1, 47500.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8f852f01-15a1-4422-af48-e0abe094fb2c', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-09T17:00:00+00:00'::timestamptz, '2026-04-09T20:01:11.628347+00:00'::timestamptz, 'submitted', 47, 7, 3, 1, 37300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4fce5e1b-5ed5-4506-a836-6698708e39cb', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-10T16:15:00+00:00'::timestamptz, '2026-04-10T20:06:49.454615+00:00'::timestamptz, 'submitted', 46, 10, 3, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0d7fd612-2a66-4220-a23f-a6ea6a5f974e', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-11T12:00:00+00:00'::timestamptz, '2026-04-11T16:11:18.161419+00:00'::timestamptz, 'submitted', 41, 8, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('87889a4d-7c71-497b-adb6-1778cb0b51ba', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-13T15:30:00+00:00'::timestamptz, '2026-04-13T19:42:48.717093+00:00'::timestamptz, 'submitted', 47, 7, 1, 1, 42400.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fb0ba17d-453a-4d96-ae6e-52f0dad032d1', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-14T15:00:00+00:00'::timestamptz, '2026-04-14T18:00:40.051492+00:00'::timestamptz, 'submitted', 41, 6, 2, 1, 1500.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('17cf773e-9cc2-44b8-a85b-2beffd3332bf', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-15T15:15:00+00:00'::timestamptz, '2026-04-15T18:54:55.789608+00:00'::timestamptz, 'submitted', 49, 8, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f3edd1c9-de1e-4395-ac0c-fd7509884a63', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-16T15:15:00+00:00'::timestamptz, '2026-04-16T17:16:36.099520+00:00'::timestamptz, 'submitted', 32, 5, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8bfcbb75-3601-4b3a-ad00-d7b535aa3f45', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-17T17:45:00+00:00'::timestamptz, '2026-04-17T21:09:54.247017+00:00'::timestamptz, 'submitted', 45, 8, 3, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4804fc6e-d6df-4027-a134-dd785cb16eba', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-18T13:30:00+00:00'::timestamptz, '2026-04-18T15:48:01.879542+00:00'::timestamptz, 'submitted', 44, 8, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5209e57c-1bc7-45e1-aa07-aacc428a52f1', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-23T16:00:00+00:00'::timestamptz, '2026-04-23T18:20:26.270196+00:00'::timestamptz, 'submitted', 40, 5, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0a245c3f-33f3-4b39-abed-f957e86b3652', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-24T17:00:00+00:00'::timestamptz, '2026-04-24T19:02:59.596085+00:00'::timestamptz, 'submitted', 45, 6, 3, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8e0f40b3-8762-4874-a395-459d3d52ae61', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-25T14:00:00+00:00'::timestamptz, '2026-04-25T17:57:19.189531+00:00'::timestamptz, 'submitted', 49, 7, 2, 1, 30900.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8982954c-74b7-4ee2-ad7c-7e66c00863aa', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-28T17:45:00+00:00'::timestamptz, '2026-04-28T20:00:14.234653+00:00'::timestamptz, 'submitted', 33, 5, 3, 1, 2600.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('05d5096b-bf36-4b8a-aa64-cce0ae3c4eb2', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-04-29T15:00:00+00:00'::timestamptz, '2026-04-29T19:24:39.091365+00:00'::timestamptz, 'submitted', 43, 8, 1, 1, 29200.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ccc9dcdc-39c8-44b6-af67-88c6a521e0a9', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-01T17:45:00+00:00'::timestamptz, '2026-05-01T22:00:16.028777+00:00'::timestamptz, 'submitted', 37, 9, 1, 1, 33700.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e208a817-3342-4692-ac65-2f424f83ef22', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-04T15:45:00+00:00'::timestamptz, '2026-05-04T17:56:09.210407+00:00'::timestamptz, 'submitted', 46, 11, 3, 1, 25100.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cf7f48d0-da5a-4133-a519-71f8e6e46f98', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-05T16:00:00+00:00'::timestamptz, '2026-05-05T19:58:37.385849+00:00'::timestamptz, 'submitted', 39, 9, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('49cec75e-a27c-44fc-acda-4aa4b7687c45', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-07T16:30:00+00:00'::timestamptz, '2026-05-07T20:38:22.009530+00:00'::timestamptz, 'submitted', 32, 7, 2, 1, 26100.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6c255893-ceef-4585-a4bf-ff482cb71d60', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-08T17:00:00+00:00'::timestamptz, '2026-05-08T20:08:43.239933+00:00'::timestamptz, 'submitted', 32, 7, 1, 1, 47200.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c8519844-e1b8-410f-a5a0-56f167fd031c', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-09T13:45:00+00:00'::timestamptz, '2026-05-09T16:02:24.894180+00:00'::timestamptz, 'submitted', 39, 8, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('191559f7-bd52-4167-ad82-73080ec6a197', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-12T16:30:00+00:00'::timestamptz, '2026-05-12T20:00:10.031050+00:00'::timestamptz, 'submitted', 31, 7, 1, 1, 2300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a14854d1-c0d1-4884-a1c3-c218029d9c9a', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-13T16:15:00+00:00'::timestamptz, '2026-05-13T19:26:43.561563+00:00'::timestamptz, 'submitted', 50, 8, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8531c94a-c835-4a37-aeb7-ef5119f4efff', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-15T16:00:00+00:00'::timestamptz, '2026-05-15T18:21:51.215753+00:00'::timestamptz, 'submitted', 49, 7, 3, 1, 45700.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9678e934-b3d5-4833-a94e-c7c4e8f270bd', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-18T16:30:00+00:00'::timestamptz, '2026-05-18T19:14:24.126039+00:00'::timestamptz, 'submitted', 30, 4, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('92da0853-507b-461b-a38b-67e2c90c881c', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-19T16:15:00+00:00'::timestamptz, '2026-05-19T20:26:17.592158+00:00'::timestamptz, 'submitted', 38, 8, 2, 1, 32600.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e58e398d-64fd-4293-a01c-ee3d78c33f87', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-20T16:30:00+00:00'::timestamptz, '2026-05-20T19:06:54.846352+00:00'::timestamptz, 'submitted', 49, 11, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b6c8c276-cf28-4649-ac55-1f0fd829e37c', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-22T16:45:00+00:00'::timestamptz, '2026-05-22T20:30:20.584167+00:00'::timestamptz, 'submitted', 39, 9, 2, 1, 33900.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a00d4461-49d6-44d7-aeb2-33f2f9627418', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-25T16:30:00+00:00'::timestamptz, '2026-05-25T19:02:37.720278+00:00'::timestamptz, 'submitted', 35, 5, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('427cda12-fb20-4bbf-a594-4eaa1b47e054', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-26T17:30:00+00:00'::timestamptz, '2026-05-26T20:56:28.023155+00:00'::timestamptz, 'submitted', 47, 10, 1, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4a580cdf-f149-49d2-a6a0-a7c8edc34e88', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-28T17:45:00+00:00'::timestamptz, '2026-05-28T20:03:15.992504+00:00'::timestamptz, 'submitted', 31, 7, 0, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('67c751af-5140-4b49-a04c-7e607b3dc3d8', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-05-29T16:30:00+00:00'::timestamptz, '2026-05-29T19:38:20.773708+00:00'::timestamptz, 'submitted', 45, 8, 3, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('10ed49de-e5d5-4c56-a8ff-ec6191d315b0', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-06-01T15:15:00+00:00'::timestamptz, '2026-06-01T19:15:41.438097+00:00'::timestamptz, 'submitted', 31, 6, 2, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f30b339a-d0f6-4769-a46f-484b32bcc21b', '5ec3649f-5c71-4e31-a1eb-621421171d0a', '2026-06-02T16:00:00+00:00'::timestamptz, '2026-06-02T18:59:24.550463+00:00'::timestamptz, 'submitted', 37, 7, 2, 1, 37200.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a9070720-41ad-4029-ab12-73de4d591003', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-03T17:30:00+00:00'::timestamptz, '2026-04-03T21:45:00.923392+00:00'::timestamptz, 'submitted', 44, 8, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ce135c62-b914-4a34-a886-59e6da71d683', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-04T12:15:00+00:00'::timestamptz, '2026-04-04T14:32:53.733253+00:00'::timestamptz, 'submitted', 36, 7, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('637af9fa-7191-4496-abc5-8c6f008791c9', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-08T16:30:00+00:00'::timestamptz, '2026-04-08T20:10:58.802978+00:00'::timestamptz, 'submitted', 48, 12, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('eddcb491-6bc6-4651-a869-82886cd13e49', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-09T15:15:00+00:00'::timestamptz, '2026-04-09T19:18:11.196553+00:00'::timestamptz, 'submitted', 50, 8, 1, 1, 62900.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('76a4fd9b-913a-4136-a8ca-0d508ca545fe', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-10T15:15:00+00:00'::timestamptz, '2026-04-10T17:24:43.320167+00:00'::timestamptz, 'submitted', 49, 11, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('481a0979-ca1b-4047-aeaa-b13bd35966c5', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-13T16:45:00+00:00'::timestamptz, '2026-04-13T21:12:46.179658+00:00'::timestamptz, 'submitted', 38, 8, 3, 1, 53000.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6d29dce6-d1a1-4af6-adb0-4237077e2879', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-14T16:15:00+00:00'::timestamptz, '2026-04-14T20:19:39.192659+00:00'::timestamptz, 'submitted', 30, 5, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('878ebb7c-5611-4b52-a9b2-c17921e0d2c9', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-17T16:45:00+00:00'::timestamptz, '2026-04-17T18:59:28.221552+00:00'::timestamptz, 'submitted', 34, 6, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fe6bbabd-1b64-4b7f-aa63-444bce8f9ac2', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-18T11:45:00+00:00'::timestamptz, '2026-04-18T14:41:15.930002+00:00'::timestamptz, 'submitted', 36, 9, 2, 1, 39900.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('259bd4d9-688d-4888-a056-76ec69ac2ae3', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-20T15:45:00+00:00'::timestamptz, '2026-04-20T19:46:56.679327+00:00'::timestamptz, 'submitted', 32, 8, 2, 1, 55900.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c7a4f906-4435-486b-a077-d9e99b8fc322', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-22T16:00:00+00:00'::timestamptz, '2026-04-22T19:19:38.576506+00:00'::timestamptz, 'submitted', 50, 10, 2, 1, 2900.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('59125464-dc1f-445e-a809-ec46412982e5', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-24T16:30:00+00:00'::timestamptz, '2026-04-24T18:48:08.598517+00:00'::timestamptz, 'submitted', 30, 5, 1, 1, 2300.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('01b8583f-3c2e-49dd-abb7-011acabd4293', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-25T11:15:00+00:00'::timestamptz, '2026-04-25T15:23:47.363081+00:00'::timestamptz, 'submitted', 50, 8, 3, 1, 30600.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('50d68eb0-7684-4eaa-a499-ba970b0cfdd3', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-27T15:30:00+00:00'::timestamptz, '2026-04-27T18:55:51.244224+00:00'::timestamptz, 'submitted', 38, 6, 1, 1, 14500.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ee998b32-1610-4aec-a59b-169911610e9f', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-28T16:15:00+00:00'::timestamptz, '2026-04-28T18:42:55.577139+00:00'::timestamptz, 'submitted', 31, 5, 1, 1, 30100.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6c716638-ff70-4ceb-a5cc-610e002a8156', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-29T15:00:00+00:00'::timestamptz, '2026-04-29T17:10:01.742637+00:00'::timestamptz, 'submitted', 47, 9, 4, 1, 2000.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e0c8353b-99e7-4d3b-a1e9-da260e56cb36', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-04-30T15:30:00+00:00'::timestamptz, '2026-04-30T19:13:56.947656+00:00'::timestamptz, 'submitted', 39, 6, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6bd113ee-326b-4165-a38f-49d6b9c8efbc', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-01T17:00:00+00:00'::timestamptz, '2026-05-01T21:01:41.741755+00:00'::timestamptz, 'submitted', 44, 8, 1, 1, 35700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('00dd73ee-bdb2-4ca0-afc3-f33623b7c40b', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-02T12:30:00+00:00'::timestamptz, '2026-05-02T14:32:46.526071+00:00'::timestamptz, 'submitted', 36, 8, 1, 1, 2600.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0c7a1158-54c6-4a9f-a4dc-94482040acc2', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-03T12:45:00+00:00'::timestamptz, '2026-05-03T15:31:10.671441+00:00'::timestamptz, 'submitted', 49, 9, 3, 1, 62800.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3c230534-5083-4e3a-ac91-a6cf79d73939', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-04T17:15:00+00:00'::timestamptz, '2026-05-04T21:29:20.762609+00:00'::timestamptz, 'submitted', 31, 7, 1, 1, 52200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('17686383-683f-462b-abad-2f9b3b7ef433', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-05T16:30:00+00:00'::timestamptz, '2026-05-05T18:37:07.127325+00:00'::timestamptz, 'submitted', 47, 8, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d309c6d6-aa59-43aa-a02a-8f0314d4367a', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-06T16:15:00+00:00'::timestamptz, '2026-05-06T19:25:22.312538+00:00'::timestamptz, 'submitted', 35, 5, 2, 1, 12400.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c9f16262-1459-4338-a3d1-9ec46bc55538', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-07T17:45:00+00:00'::timestamptz, '2026-05-07T21:05:29.321820+00:00'::timestamptz, 'submitted', 49, 6, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a75dc1b0-7bfe-4091-a048-314ba27a016b', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-08T15:15:00+00:00'::timestamptz, '2026-05-08T17:43:05.122958+00:00'::timestamptz, 'submitted', 33, 6, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d05a3b49-5482-467a-ac7c-adb66bdf15ec', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-11T16:30:00+00:00'::timestamptz, '2026-05-11T19:36:52.605454+00:00'::timestamptz, 'submitted', 37, 5, 3, 1, 35300.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c9862b1a-d26f-4684-a747-d8d32f2a7662', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-12T16:45:00+00:00'::timestamptz, '2026-05-12T20:47:33.612197+00:00'::timestamptz, 'submitted', 49, 12, 2, 1, 30300.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('18abe195-d20b-4b5e-a43d-cdcbe412ad6e', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-14T17:45:00+00:00'::timestamptz, '2026-05-14T21:50:33.449414+00:00'::timestamptz, 'submitted', 32, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7cb0c45f-4aab-4896-a631-5e64527aae0f', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-15T16:15:00+00:00'::timestamptz, '2026-05-15T20:31:46.499836+00:00'::timestamptz, 'submitted', 47, 7, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f36afd8b-b893-406f-a136-7d404999394a', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-16T11:15:00+00:00'::timestamptz, '2026-05-16T13:59:27.287577+00:00'::timestamptz, 'submitted', 49, 10, 2, 1, 24700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('baa88e28-8c7b-4962-aa7c-9bc4b0cf2797', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-18T15:15:00+00:00'::timestamptz, '2026-05-18T18:33:21.527986+00:00'::timestamptz, 'submitted', 43, 7, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6ce757fe-b292-4ddc-a55a-c4bb2b858106', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-20T15:15:00+00:00'::timestamptz, '2026-05-20T19:15:15.610601+00:00'::timestamptz, 'submitted', 44, 6, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8f81f216-ded8-43c8-ad9a-dc9faddb14d4', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-21T17:30:00+00:00'::timestamptz, '2026-05-21T20:57:14.329349+00:00'::timestamptz, 'submitted', 31, 5, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ff08776d-1b08-4887-ab03-2b1811dbe9ae', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-22T17:45:00+00:00'::timestamptz, '2026-05-22T22:10:55.840326+00:00'::timestamptz, 'submitted', 37, 5, 1, 1, 1600.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cb672e43-7576-4e70-a53e-9983ce864ba7', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-25T17:45:00+00:00'::timestamptz, '2026-05-25T21:27:39.695895+00:00'::timestamptz, 'submitted', 31, 5, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f65b0d75-5614-4417-a592-4ac79449953b', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-26T16:00:00+00:00'::timestamptz, '2026-05-26T18:13:26.425312+00:00'::timestamptz, 'submitted', 40, 5, 1, 1, 51300.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('df72792a-b147-4122-a259-0672913cb52b', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-27T17:00:00+00:00'::timestamptz, '2026-05-27T21:10:46.118627+00:00'::timestamptz, 'submitted', 41, 9, 1, 1, 33100.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('725357f9-407b-427e-a62c-dca423efc671', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-28T16:00:00+00:00'::timestamptz, '2026-05-28T18:40:13.048568+00:00'::timestamptz, 'submitted', 46, 6, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('89101d91-2beb-4d5c-a06b-027c7edd5610', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-29T17:45:00+00:00'::timestamptz, '2026-05-29T21:09:37.692700+00:00'::timestamptz, 'submitted', 47, 8, 4, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6bce587e-e9bf-4d96-a99f-0be5475ea64e', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-05-30T12:30:00+00:00'::timestamptz, '2026-05-30T14:31:40.558335+00:00'::timestamptz, 'submitted', 41, 10, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a29b0d69-4728-4bc0-a67e-c9b0ec082d6f', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-06-01T17:30:00+00:00'::timestamptz, '2026-06-01T21:06:27.692458+00:00'::timestamptz, 'submitted', 30, 7, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('030c290c-1536-4acb-a8a6-3d3c90bea264', 'c5bf3928-4687-42e8-a7f5-743b7de47d59', '2026-06-02T15:30:00+00:00'::timestamptz, NULL, 'active', 14, 2, 1, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('183cbb81-995b-4999-af3d-a76ee9bc6c99', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-03T17:45:00+00:00'::timestamptz, '2026-04-03T20:33:03.723171+00:00'::timestamptz, 'submitted', 32, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('41c652e9-23ca-452d-a49c-108a45fe14ee', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-04T14:00:00+00:00'::timestamptz, '2026-04-04T16:47:42.471245+00:00'::timestamptz, 'submitted', 38, 5, 2, 1, 37900.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c233f1e7-f5ea-4d97-a76f-846483f04552', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-07T17:15:00+00:00'::timestamptz, '2026-04-07T19:31:39.246020+00:00'::timestamptz, 'submitted', 46, 6, 3, 1, 2700.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f51b4069-643f-44cd-a60e-33146e208942', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-08T15:30:00+00:00'::timestamptz, '2026-04-08T19:22:33.075885+00:00'::timestamptz, 'submitted', 38, 7, 2, 1, 11800.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7734393c-3554-4f63-adc3-d59b39b5e0d6', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-09T17:15:00+00:00'::timestamptz, '2026-04-09T21:08:20.884420+00:00'::timestamptz, 'submitted', 48, 9, 2, 1, 26500.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('bc132cfd-1b4d-4df1-ac30-e2916ed66050', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-10T15:15:00+00:00'::timestamptz, '2026-04-10T19:32:53.743645+00:00'::timestamptz, 'submitted', 34, 5, 1, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5ab667d8-e58d-40ee-ab69-55eed2fa589b', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-11T13:00:00+00:00'::timestamptz, '2026-04-11T17:14:06.755625+00:00'::timestamptz, 'submitted', 49, 9, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2c2888aa-dd69-4152-a741-5884a77d6d71', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-13T16:45:00+00:00'::timestamptz, '2026-04-13T20:52:12.767951+00:00'::timestamptz, 'submitted', 38, 7, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8713a6d3-6a7a-4ace-a47d-11112b2488e2', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-14T15:30:00+00:00'::timestamptz, '2026-04-14T17:30:01.801869+00:00'::timestamptz, 'submitted', 47, 7, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6a1d59aa-2e62-4514-acd1-089687c35b7c', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-15T15:45:00+00:00'::timestamptz, '2026-04-15T19:34:58.002852+00:00'::timestamptz, 'submitted', 48, 10, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('75cd741d-9277-4a26-a98f-090b23fb53fc', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-17T17:00:00+00:00'::timestamptz, '2026-04-17T20:58:06.957829+00:00'::timestamptz, 'submitted', 50, 7, 1, 1, 19700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('76d96b24-95e7-4675-a5f7-5379f9897060', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-18T12:30:00+00:00'::timestamptz, '2026-04-18T15:15:04.627003+00:00'::timestamptz, 'submitted', 38, 9, 2, 1, 20000.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('be722e22-7565-4106-acf1-cb7b1870faba', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-19T12:15:00+00:00'::timestamptz, '2026-04-19T15:11:43.643600+00:00'::timestamptz, 'submitted', 46, 8, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('545bb4fe-799a-4abf-a5df-ac24f4440b82', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-21T17:15:00+00:00'::timestamptz, '2026-04-21T20:46:52.786305+00:00'::timestamptz, 'submitted', 50, 9, 3, 1, 42700.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('abafcd88-5c3b-407e-a50d-633cf9e0bade', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-23T16:00:00+00:00'::timestamptz, '2026-04-23T20:07:24.806336+00:00'::timestamptz, 'submitted', 34, 5, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5b86eaf6-1ee0-405d-afed-6deb3e45a1b9', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-27T15:00:00+00:00'::timestamptz, '2026-04-27T18:38:00.651189+00:00'::timestamptz, 'submitted', 42, 8, 1, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a7400b56-5280-4c3d-a1de-b6380d4e19e3', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-04-28T17:30:00+00:00'::timestamptz, '2026-04-28T20:34:25.165988+00:00'::timestamptz, 'submitted', 32, 5, 2, 1, 11900.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5c34c9ee-e1b3-4317-af23-5d40daa95377', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-01T16:30:00+00:00'::timestamptz, '2026-05-01T20:12:57.093002+00:00'::timestamptz, 'submitted', 37, 7, 2, 1, 1700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0bbf2d86-31db-46f0-a0cf-5b7cd3f038b2', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-02T14:45:00+00:00'::timestamptz, '2026-05-02T17:43:06.512664+00:00'::timestamptz, 'submitted', 47, 8, 4, 1, 36300.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('bb6e1215-510e-41d3-ac52-53d52694f762', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-09T11:15:00+00:00'::timestamptz, '2026-05-09T14:46:52.918834+00:00'::timestamptz, 'submitted', 41, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a8ede016-bcfb-4e66-a55b-ea8f56434fa4', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-11T17:00:00+00:00'::timestamptz, '2026-05-11T19:01:07.422644+00:00'::timestamptz, 'submitted', 35, 6, 2, 1, 41000.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c7d00ad5-4a4d-4d51-a902-431cac594fdd', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-12T17:30:00+00:00'::timestamptz, '2026-05-12T20:55:19.194064+00:00'::timestamptz, 'submitted', 39, 9, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('404034b9-f30b-4b7a-aaa1-06443d602235', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-13T15:30:00+00:00'::timestamptz, '2026-05-13T18:57:09.918085+00:00'::timestamptz, 'submitted', 32, 6, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('68b9b8c8-88d2-4dd8-a1f3-942ae38019e1', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-14T16:30:00+00:00'::timestamptz, '2026-05-14T20:40:46.405383+00:00'::timestamptz, 'submitted', 47, 8, 2, 1, 2600.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c6e04dd6-1444-462b-add3-42440e580e69', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-16T12:15:00+00:00'::timestamptz, '2026-05-16T14:21:39.069921+00:00'::timestamptz, 'submitted', 50, 8, 2, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5fa156ba-f448-4836-a9d2-3329dcb4ccfb', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-18T15:45:00+00:00'::timestamptz, '2026-05-18T17:56:09.115378+00:00'::timestamptz, 'submitted', 30, 4, 1, 1, 42300.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('386f7982-2ad1-4846-aa4a-a7b9f84ba7ee', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-19T17:00:00+00:00'::timestamptz, '2026-05-19T20:43:53.198800+00:00'::timestamptz, 'submitted', 41, 6, 1, 1, 26900.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('65bf981d-8a8b-49de-aae2-fc01431ca270', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-20T17:45:00+00:00'::timestamptz, '2026-05-20T22:01:46.403019+00:00'::timestamptz, 'submitted', 34, 8, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('94fae82a-808c-4499-aeaf-b37303d2a075', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-21T16:30:00+00:00'::timestamptz, '2026-05-21T19:17:26.464768+00:00'::timestamptz, 'submitted', 50, 12, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('951e5cc8-d04d-4f12-a3e0-fec616cdfc34', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-22T15:45:00+00:00'::timestamptz, '2026-05-22T18:02:04.287068+00:00'::timestamptz, 'submitted', 49, 7, 3, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c0a89f87-b7cc-49be-a7f7-64aa593e9722', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-23T13:15:00+00:00'::timestamptz, '2026-05-23T17:26:45.565277+00:00'::timestamptz, 'submitted', 45, 6, 3, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cb44f9fa-7c46-4c7d-a720-5af590bc1418', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-27T17:00:00+00:00'::timestamptz, '2026-05-27T19:36:51.387307+00:00'::timestamptz, 'submitted', 39, 6, 1, 1, 68300.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cdfba85f-b21d-422d-a3f9-a6349b622722', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-05-29T17:00:00+00:00'::timestamptz, '2026-05-29T20:47:33.937561+00:00'::timestamptz, 'submitted', 43, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('69e2a444-d5b4-476a-a0f5-90d6f9c8bae2', '90cb2889-9600-4f5b-a9b4-b3fd27e9b8d2', '2026-06-02T15:30:00+00:00'::timestamptz, '2026-06-02T18:01:33.621875+00:00'::timestamptz, 'submitted', 36, 6, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e1c24ed0-1dcd-499d-a228-d5774bba4906', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-03T16:45:00+00:00'::timestamptz, '2026-04-03T19:40:45.412672+00:00'::timestamptz, 'submitted', 31, 5, 1, 1, 2200.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('da1e3fef-6deb-471f-a419-bc03ee34607d', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-06T16:45:00+00:00'::timestamptz, '2026-04-06T20:50:14.432273+00:00'::timestamptz, 'submitted', 39, 8, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4dbd9793-55d0-4a48-ace9-d57fa9492b24', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-08T17:30:00+00:00'::timestamptz, '2026-04-08T20:52:54.208671+00:00'::timestamptz, 'submitted', 33, 5, 1, 1, 20500.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1ba7cd5c-aa43-4b18-a34a-5b7eb1f5d1e5', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-10T15:45:00+00:00'::timestamptz, '2026-04-10T18:59:45.080614+00:00'::timestamptz, 'submitted', 33, 8, 2, 1, 35400.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a8da8c27-afdd-43a1-a52b-3c2c19e97ebf', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-13T15:30:00+00:00'::timestamptz, '2026-04-13T18:06:49.086302+00:00'::timestamptz, 'submitted', 38, 9, 1, 1, 53700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('42095433-fc42-41cb-a269-b171530e7694', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-14T15:00:00+00:00'::timestamptz, '2026-04-14T17:53:09.135971+00:00'::timestamptz, 'submitted', 41, 6, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a5305be4-99b4-460a-a914-34d135c98cd7', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-15T16:30:00+00:00'::timestamptz, '2026-04-15T20:26:55.068347+00:00'::timestamptz, 'submitted', 37, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('069a3014-4486-41c0-adea-8ef556c43b77', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-17T15:00:00+00:00'::timestamptz, '2026-04-17T17:09:10.754547+00:00'::timestamptz, 'submitted', 47, 10, 3, 1, 25400.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('eed8193f-33c9-41fc-a334-45075f66bce9', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-20T16:00:00+00:00'::timestamptz, '2026-04-20T19:00:38.203802+00:00'::timestamptz, 'submitted', 45, 8, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f1d7c060-453d-4946-a978-9238fe5c3958', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-21T15:00:00+00:00'::timestamptz, '2026-04-21T17:52:51.866478+00:00'::timestamptz, 'submitted', 43, 7, 3, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7660076b-533d-4d5e-afc0-4ec7d73ad8e8', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-22T17:15:00+00:00'::timestamptz, '2026-04-22T20:19:06.086216+00:00'::timestamptz, 'submitted', 35, 7, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('240cb5fa-0359-4846-a145-a9f475ccd416', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-23T15:00:00+00:00'::timestamptz, '2026-04-23T17:25:48.336832+00:00'::timestamptz, 'submitted', 43, 10, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7dc4fb04-4947-42c5-ab3d-27814805115e', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-24T16:30:00+00:00'::timestamptz, '2026-04-24T19:52:27.669617+00:00'::timestamptz, 'submitted', 32, 6, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b7bbe814-4577-42bb-a98e-6c7adb188f06', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-25T14:30:00+00:00'::timestamptz, '2026-04-25T18:53:29.051787+00:00'::timestamptz, 'submitted', 42, 7, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0e7f5368-bbad-424e-aa43-a340d7962cff', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-27T17:30:00+00:00'::timestamptz, '2026-04-27T21:14:01.813429+00:00'::timestamptz, 'submitted', 40, 9, 2, 1, 37000.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f0dc2049-6eed-46ac-ac12-2cb665a41682', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-28T16:15:00+00:00'::timestamptz, '2026-04-28T20:40:05.111315+00:00'::timestamptz, 'submitted', 49, 10, 4, 1, 18000.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('93c8f219-eda5-4fed-a485-7de73173e8f8', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-29T16:15:00+00:00'::timestamptz, '2026-04-29T19:45:50.045211+00:00'::timestamptz, 'submitted', 39, 7, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0fc7cecd-3175-4a78-ae12-281cf8e846c2', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-04-30T17:45:00+00:00'::timestamptz, '2026-04-30T20:01:37.267212+00:00'::timestamptz, 'submitted', 45, 8, 2, 1, 44700.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b338e8bf-d248-4f52-a8ba-a796a0c2eeca', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-01T16:30:00+00:00'::timestamptz, '2026-05-01T20:38:48.709383+00:00'::timestamptz, 'submitted', 37, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ac7bcc59-8624-4763-a998-bf5012f562a1', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-04T17:30:00+00:00'::timestamptz, '2026-05-04T19:43:56.246787+00:00'::timestamptz, 'submitted', 38, 8, 2, 1, 12400.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3071e78d-3f51-4020-ad3b-3a2f798de68e', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-05T17:00:00+00:00'::timestamptz, '2026-05-05T21:09:25.868099+00:00'::timestamptz, 'submitted', 50, 10, 4, 1, 28700.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e143d8eb-3dd3-4e6e-a34f-292e8024f8c0', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-06T15:30:00+00:00'::timestamptz, '2026-05-06T19:39:37.877698+00:00'::timestamptz, 'submitted', 37, 5, 3, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1fea9787-e34f-41ae-abe8-565ba6d90136', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-07T17:45:00+00:00'::timestamptz, '2026-05-07T19:50:02.705509+00:00'::timestamptz, 'submitted', 39, 6, 3, 1, 18200.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f8f1daff-15eb-4747-a5e1-aafa07d3ad6c', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-08T15:45:00+00:00'::timestamptz, '2026-05-08T18:38:20.790008+00:00'::timestamptz, 'submitted', 43, 6, 3, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8131bd0e-8326-4833-acf1-9d2f8d255d39', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-09T11:45:00+00:00'::timestamptz, '2026-05-09T14:35:58.612223+00:00'::timestamptz, 'submitted', 47, 6, 3, 1, 52900.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('33da8c06-d0f4-47a9-a06d-21b8aac9c99b', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-11T17:00:00+00:00'::timestamptz, '2026-05-11T19:44:10.009686+00:00'::timestamptz, 'submitted', 30, 7, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('094006df-6bfc-4c57-a82a-e35370a966e9', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-12T16:45:00+00:00'::timestamptz, '2026-05-12T20:45:36.503237+00:00'::timestamptz, 'submitted', 50, 11, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('383b928b-4f9f-4855-abee-4407710335d7', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-13T15:00:00+00:00'::timestamptz, '2026-05-13T17:52:21.429325+00:00'::timestamptz, 'submitted', 50, 9, 2, 1, 42500.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b377d82f-b063-498a-acf6-ce2c9a39d8d3', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-14T15:00:00+00:00'::timestamptz, '2026-05-14T19:03:22.635736+00:00'::timestamptz, 'submitted', 41, 7, 3, 1, 8000.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e2ba3329-a003-40b7-a47d-bc0d0fa5f5a5', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-15T15:45:00+00:00'::timestamptz, '2026-05-15T18:56:59.827923+00:00'::timestamptz, 'submitted', 35, 5, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1a909485-941c-4034-a878-2f1295efc7a8', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-18T15:15:00+00:00'::timestamptz, '2026-05-18T18:09:37.431795+00:00'::timestamptz, 'submitted', 35, 5, 2, 1, 12400.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c3da5375-ab62-4192-afa0-d817e3e0ae46', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-19T17:30:00+00:00'::timestamptz, '2026-05-19T21:14:34.885889+00:00'::timestamptz, 'submitted', 41, 7, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('697f463b-2472-4da2-a818-41060f9da22d', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-20T16:15:00+00:00'::timestamptz, '2026-05-20T19:54:42.796569+00:00'::timestamptz, 'submitted', 38, 5, 3, 1, 21500.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7ecbce16-62cc-44c9-a84f-2ad5467b142c', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-21T15:00:00+00:00'::timestamptz, '2026-05-21T17:27:01.945115+00:00'::timestamptz, 'submitted', 31, 5, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ce24409a-fb69-4069-ab15-5afe2cc734c3', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-23T11:30:00+00:00'::timestamptz, '2026-05-23T15:15:27.749568+00:00'::timestamptz, 'submitted', 44, 10, 2, 1, 23600.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('af59c11f-fabb-48cf-a0df-b0f7047dbf30', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-25T15:00:00+00:00'::timestamptz, '2026-05-25T17:33:21.479649+00:00'::timestamptz, 'submitted', 44, 7, 2, 1, 54200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7c36997b-3b32-4654-a63f-76d134551f7d', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-26T15:15:00+00:00'::timestamptz, '2026-05-26T18:48:53.016164+00:00'::timestamptz, 'submitted', 38, 9, 2, 1, 54200.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b2fc8a5e-b123-40ee-ac08-39bcfcc1012f', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-27T15:00:00+00:00'::timestamptz, '2026-05-27T17:08:39.211576+00:00'::timestamptz, 'submitted', 33, 4, 2, 1, 25900.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e2d3ab42-22e1-41ca-abf8-68b050a4eb91', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-28T15:15:00+00:00'::timestamptz, '2026-05-28T18:41:18.468542+00:00'::timestamptz, 'submitted', 45, 6, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('af0dbd7e-33bc-4dae-ac50-29dc78538750', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-05-29T15:00:00+00:00'::timestamptz, '2026-05-29T19:02:46.586180+00:00'::timestamptz, 'submitted', 42, 10, 3, 1, 36700.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b9a69e71-b639-454f-ae28-256f3ad0513c', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-06-01T17:15:00+00:00'::timestamptz, '2026-06-01T19:57:10.141150+00:00'::timestamptz, 'submitted', 34, 6, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e677816a-3e3a-4b60-a081-705ebd00c5a9', '8a4dc880-a6ec-4e22-ac89-71860e85d451', '2026-06-02T16:00:00+00:00'::timestamptz, NULL, 'active', 36, 7, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1dd548df-59e0-4dd7-ab40-fc426322888a', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-03T17:30:00+00:00'::timestamptz, '2026-04-03T20:02:21.229563+00:00'::timestamptz, 'submitted', 46, 10, 3, 1, 15000.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d9fc9211-59cd-4d07-a0e5-a7583bbde653', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-10T16:00:00+00:00'::timestamptz, '2026-04-10T20:24:55.319607+00:00'::timestamptz, 'submitted', 42, 7, 3, 1, 23100.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d3b94570-3a4a-4149-a59d-c5aabc34b413', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-11T11:00:00+00:00'::timestamptz, '2026-04-11T13:55:03.512028+00:00'::timestamptz, 'submitted', 35, 5, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('be342b34-9daa-4830-ae10-0b3f5a7ac4ee', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-13T17:15:00+00:00'::timestamptz, '2026-04-13T19:24:43.257963+00:00'::timestamptz, 'submitted', 45, 10, 3, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('362fd14c-f167-485f-a3cc-d4fc7639074c', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-16T17:15:00+00:00'::timestamptz, '2026-04-16T21:07:04.787720+00:00'::timestamptz, 'submitted', 31, 4, 2, 1, 27200.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ed2e01a3-13d8-4e45-a390-5080574221e0', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-17T15:00:00+00:00'::timestamptz, '2026-04-17T18:18:17.377006+00:00'::timestamptz, 'submitted', 47, 8, 4, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('65472969-cf11-46e0-afff-0c757647667c', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-20T15:30:00+00:00'::timestamptz, '2026-04-20T19:16:35.960612+00:00'::timestamptz, 'submitted', 33, 4, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2cc188eb-eef0-4441-a2de-bf002287991b', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-21T15:15:00+00:00'::timestamptz, '2026-04-21T19:33:05.432612+00:00'::timestamptz, 'submitted', 37, 6, 2, 1, 37200.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b8c46c7c-1c8c-49ba-ab19-2e3e24ed24ec', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-22T15:30:00+00:00'::timestamptz, '2026-04-22T17:44:53.571564+00:00'::timestamptz, 'submitted', 49, 11, 1, 1, 46300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('01e7dfff-55ab-419d-aeb0-40ac5bf2f7bb', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-23T15:30:00+00:00'::timestamptz, '2026-04-23T18:17:45.881717+00:00'::timestamptz, 'submitted', 48, 12, 1, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6c634d55-a88e-42c3-ad76-5c3f6f2f57a3', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-24T15:00:00+00:00'::timestamptz, '2026-04-24T19:24:22.278979+00:00'::timestamptz, 'submitted', 44, 11, 1, 1, 43800.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5410d885-d57a-4efb-ad44-68405b04b8df', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-25T12:30:00+00:00'::timestamptz, '2026-04-25T16:47:06.753239+00:00'::timestamptz, 'submitted', 34, 6, 1, 1, 12600.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5746a9f2-03cf-4e9b-a5f3-8adafb3c601a', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-27T15:00:00+00:00'::timestamptz, '2026-04-27T19:14:59.424880+00:00'::timestamptz, 'submitted', 41, 9, 2, 1, 2600.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7ce258f4-ca43-4c4d-acab-f1d8f5d8ad6a', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-28T17:45:00+00:00'::timestamptz, '2026-04-28T21:56:15.426349+00:00'::timestamptz, 'submitted', 30, 4, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001');
insert into public.canvassing_sessions (id, rep_id, started_at, ended_at, status, doors_knocked, conversations, estimates, bookings, revenue_booked, neighborhood, organization_id) values
('101bf477-998d-451b-a208-1cd66af8b2ec', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-04-29T15:15:00+00:00'::timestamptz, '2026-04-29T19:31:25.964430+00:00'::timestamptz, 'submitted', 40, 8, 1, 1, 32800.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cfc0acad-6b1e-43ec-ac54-5f8ee49a31b4', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-01T16:15:00+00:00'::timestamptz, '2026-05-01T20:28:34.765807+00:00'::timestamptz, 'submitted', 46, 11, 4, 1, 13300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('95a84ddf-c1ae-4d9c-a8bc-05edc842ac7a', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-02T11:45:00+00:00'::timestamptz, '2026-05-02T15:44:21.376147+00:00'::timestamptz, 'submitted', 41, 9, 1, 1, 2200.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('20be0ec5-e322-4bbc-ad28-586b4e9b523a', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-04T16:30:00+00:00'::timestamptz, '2026-05-04T20:56:15.792222+00:00'::timestamptz, 'submitted', 42, 7, 3, 1, 31000.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('97da98f4-a6c5-4d53-aad1-5341fe08a836', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-05T15:45:00+00:00'::timestamptz, '2026-05-05T18:34:49.099127+00:00'::timestamptz, 'submitted', 47, 8, 4, 1, 63800.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('60cf80a7-f4ad-451b-aed8-1c538d842811', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-06T17:00:00+00:00'::timestamptz, '2026-05-06T20:04:20.278520+00:00'::timestamptz, 'submitted', 44, 7, 3, 1, 41000.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e53e4d1f-33a4-4383-aa61-d97cc283c364', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-07T16:15:00+00:00'::timestamptz, '2026-05-07T18:30:42.102793+00:00'::timestamptz, 'submitted', 49, 12, 3, 1, 43500.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d3867feb-8d65-4542-aaa8-ec43332d4220', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-08T17:15:00+00:00'::timestamptz, '2026-05-08T21:21:45.099966+00:00'::timestamptz, 'submitted', 48, 8, 4, 1, 9200.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('192021aa-76e2-40e2-ad10-7e6a8ca3764f', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-09T14:15:00+00:00'::timestamptz, '2026-05-09T17:25:21.236445+00:00'::timestamptz, 'submitted', 46, 11, 3, 1, 14600.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('844e8eb0-0875-4973-a1d3-3fd05a380150', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-11T16:45:00+00:00'::timestamptz, '2026-05-11T20:53:58.135932+00:00'::timestamptz, 'submitted', 33, 7, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f8db659f-308c-4031-ad56-411d209aa5f4', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-12T16:45:00+00:00'::timestamptz, '2026-05-12T18:50:20.401441+00:00'::timestamptz, 'submitted', 39, 5, 2, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b0b40d9b-5945-4a45-a3d7-89d1abb753b6', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-13T16:00:00+00:00'::timestamptz, '2026-05-13T18:52:47.035375+00:00'::timestamptz, 'submitted', 37, 8, 2, 1, 36600.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f3c3dd4e-6c87-45c5-aaf6-151fbb5fc3bc', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-17T12:00:00+00:00'::timestamptz, '2026-05-17T15:59:00.724251+00:00'::timestamptz, 'submitted', 30, 5, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('19cef3e5-a53c-468d-abb8-820d85b3000d', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-18T16:15:00+00:00'::timestamptz, '2026-05-18T19:13:29.181514+00:00'::timestamptz, 'submitted', 48, 11, 2, 1, 56800.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3aa804e2-ee7a-46f4-aef8-90952b8f72d7', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-19T16:30:00+00:00'::timestamptz, '2026-05-19T20:15:35.014888+00:00'::timestamptz, 'submitted', 38, 9, 3, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2e4f320d-bd37-408a-acc4-37af5c5e522b', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-20T16:00:00+00:00'::timestamptz, '2026-05-20T19:14:20.091888+00:00'::timestamptz, 'submitted', 32, 4, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7f4ffdd2-a2f8-4bf2-a584-894149e05c7d', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-21T17:45:00+00:00'::timestamptz, '2026-05-21T21:45:13.647388+00:00'::timestamptz, 'submitted', 33, 8, 2, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('276023ec-a63f-46fd-a5d5-78028e74b9c6', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-22T17:00:00+00:00'::timestamptz, '2026-05-22T19:38:31.237856+00:00'::timestamptz, 'submitted', 33, 4, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('415a70f8-e53a-43db-a87f-c41f16ed5bf8', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-25T17:15:00+00:00'::timestamptz, '2026-05-25T20:39:51.291238+00:00'::timestamptz, 'submitted', 43, 9, 3, 1, 56300.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('2083ea75-3b70-49ab-a3c7-7ecb0aac6ea8', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-26T16:30:00+00:00'::timestamptz, '2026-05-26T18:32:30.328325+00:00'::timestamptz, 'submitted', 45, 10, 2, 0, 0.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e558716c-d134-4627-a52b-1d601b5b8679', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-27T16:15:00+00:00'::timestamptz, '2026-05-27T20:16:15.610020+00:00'::timestamptz, 'submitted', 45, 8, 1, 0, 0.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a70629bc-8f07-4d8f-a8ae-77f248c423cf', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-28T17:15:00+00:00'::timestamptz, '2026-05-28T19:25:32.849317+00:00'::timestamptz, 'submitted', 44, 10, 2, 1, 52500.00, 'Carrollwood', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a726e475-1b53-48ea-a1c9-bf0ba80afcda', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-05-29T16:30:00+00:00'::timestamptz, '2026-05-29T19:14:41.137646+00:00'::timestamptz, 'submitted', 30, 5, 1, 1, 26100.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ba75c7f0-d315-4e2f-a690-ccb8de9b106d', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-06-01T17:00:00+00:00'::timestamptz, '2026-06-01T19:00:58.538703+00:00'::timestamptz, 'submitted', 38, 8, 2, 1, 51100.00, 'Brandon', 'd0d0d0d0-0000-4000-a000-000000000001'),
('99cd525b-5ec3-45a9-a0ad-068a032c27f8', '94bb1f9a-f360-44cf-ad60-9a2acdb73a7f', '2026-06-02T16:45:00+00:00'::timestamptz, '2026-06-02T18:57:27.352924+00:00'::timestamptz, 'submitted', 46, 9, 2, 1, 36800.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0b385de1-df3a-4ada-abf5-8429f2a88a44', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-06T17:15:00+00:00'::timestamptz, '2026-04-06T19:59:23.989521+00:00'::timestamptz, 'submitted', 32, 8, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fab5d854-c637-4881-a682-d86652ce2351', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-09T17:45:00+00:00'::timestamptz, '2026-04-09T21:45:14.792044+00:00'::timestamptz, 'submitted', 46, 7, 1, 1, 25200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ae6fdee7-ae1a-4951-abd5-2faa6d195224', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-10T15:15:00+00:00'::timestamptz, '2026-04-10T18:09:13.915570+00:00'::timestamptz, 'submitted', 32, 8, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9ff82a40-afb7-44fc-a206-05808cd951db', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-13T17:30:00+00:00'::timestamptz, '2026-04-13T20:46:12.345935+00:00'::timestamptz, 'submitted', 46, 8, 3, 1, 69000.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8e4ad104-bd0c-484c-a7d1-6d3945ce5827', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-15T16:30:00+00:00'::timestamptz, '2026-04-15T20:42:04.988740+00:00'::timestamptz, 'submitted', 31, 4, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('cf248d8b-e0f2-42cd-a2e3-57fc14e74f4f', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-16T17:45:00+00:00'::timestamptz, '2026-04-16T19:51:57.205396+00:00'::timestamptz, 'submitted', 41, 7, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8e91aed3-a732-4a3b-aae5-99ea6d9dd9f6', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-17T15:00:00+00:00'::timestamptz, '2026-04-17T17:45:27.918483+00:00'::timestamptz, 'submitted', 39, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('45a6eff9-bd75-4c2d-aa30-11d40ee7c6de', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-18T13:30:00+00:00'::timestamptz, '2026-04-18T17:31:30.053484+00:00'::timestamptz, 'submitted', 36, 5, 1, 1, 2100.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1c43fbad-d6ed-4659-a19c-7a4848f7ddf5', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-20T16:45:00+00:00'::timestamptz, '2026-04-20T19:35:22.916459+00:00'::timestamptz, 'submitted', 38, 8, 3, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ddde4569-cc51-43a4-ae85-6a46c568dee5', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-21T17:15:00+00:00'::timestamptz, '2026-04-21T20:39:08.753663+00:00'::timestamptz, 'submitted', 32, 5, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3dbd602c-d23c-4873-a200-3eb8489c1ea7', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-22T17:45:00+00:00'::timestamptz, '2026-04-22T20:01:00.120665+00:00'::timestamptz, 'submitted', 31, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('99d6af73-f4cd-40bf-ace3-f0c6dbd1f6a3', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-23T17:00:00+00:00'::timestamptz, '2026-04-23T20:41:45.306047+00:00'::timestamptz, 'submitted', 38, 7, 3, 1, 55200.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7399cc0b-9fcf-48e9-a8df-48ffb2e9a5dc', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-24T17:15:00+00:00'::timestamptz, '2026-04-24T21:07:36.221305+00:00'::timestamptz, 'submitted', 30, 4, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('bc7649f8-2f0a-4c72-a18b-7b431ea28d26', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-27T16:30:00+00:00'::timestamptz, '2026-04-27T19:32:45.296255+00:00'::timestamptz, 'submitted', 30, 7, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('56cd432b-efee-43ee-a562-76fd2f02aab0', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-28T16:30:00+00:00'::timestamptz, '2026-04-28T19:47:23.334170+00:00'::timestamptz, 'submitted', 40, 9, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('66563cbf-66f1-4edd-af7c-a46b060e2c1c', '13525546-8db1-44f0-adb0-666e731ee044', '2026-04-30T16:45:00+00:00'::timestamptz, '2026-04-30T19:10:29.217851+00:00'::timestamptz, 'submitted', 31, 7, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f022ffee-f26c-4f8a-a355-5af6a4760e09', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-04T16:45:00+00:00'::timestamptz, '2026-05-04T20:55:31.656985+00:00'::timestamptz, 'submitted', 45, 8, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9e30d360-f5d2-4988-af8a-449a2e5e83ef', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-06T15:15:00+00:00'::timestamptz, '2026-05-06T17:28:06.781226+00:00'::timestamptz, 'submitted', 30, 6, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('deae742e-b244-4a7f-a451-fbd9605994c3', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-07T17:00:00+00:00'::timestamptz, '2026-05-07T21:20:06.371499+00:00'::timestamptz, 'submitted', 30, 6, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1e2735a9-ab6f-4752-a1b0-2ebdca36c9ec', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-08T16:15:00+00:00'::timestamptz, '2026-05-08T19:30:28.059115+00:00'::timestamptz, 'submitted', 30, 7, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fe3ae5f8-34e6-4943-a391-a8cf0cbd44f7', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-11T15:30:00+00:00'::timestamptz, '2026-05-11T19:58:42.366117+00:00'::timestamptz, 'submitted', 44, 8, 2, 1, 14200.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3dd2ab14-b4d3-47b1-a3a1-2d345cdb591b', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-12T17:45:00+00:00'::timestamptz, '2026-05-12T20:12:21.688563+00:00'::timestamptz, 'submitted', 34, 5, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6e4a5f4f-ef69-494b-a79d-53a66671229d', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-13T16:45:00+00:00'::timestamptz, '2026-05-13T21:13:51.625160+00:00'::timestamptz, 'submitted', 31, 4, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('89b0a6c6-becd-4121-af75-5e5280ae2700', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-14T16:15:00+00:00'::timestamptz, '2026-05-14T18:36:48.529950+00:00'::timestamptz, 'submitted', 43, 7, 3, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('78cec899-68ca-435e-a59d-162fbb5b54ba', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-16T13:45:00+00:00'::timestamptz, '2026-05-16T17:30:20.488151+00:00'::timestamptz, 'submitted', 30, 7, 2, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('01180d21-f97d-4531-a873-394604fc6b3c', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-19T17:30:00+00:00'::timestamptz, '2026-05-19T20:50:04.304764+00:00'::timestamptz, 'submitted', 43, 7, 4, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('de31e08d-b650-408e-a3e0-c0d834db11e8', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-20T16:45:00+00:00'::timestamptz, '2026-05-20T20:22:18.422634+00:00'::timestamptz, 'submitted', 39, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('fec51a34-c64a-4985-a0d9-a46671583125', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-21T17:15:00+00:00'::timestamptz, '2026-05-21T20:18:51.263934+00:00'::timestamptz, 'submitted', 48, 7, 1, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6f299e62-fd87-4701-a1b2-12aa0cc46793', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-22T15:00:00+00:00'::timestamptz, '2026-05-22T19:12:30.503035+00:00'::timestamptz, 'submitted', 39, 6, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('68832130-b45d-4e81-acb6-4204b4b34e04', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-25T15:30:00+00:00'::timestamptz, '2026-05-25T19:44:12.123512+00:00'::timestamptz, 'submitted', 37, 7, 2, 0, 0.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('ced470fc-48e1-4905-a051-a876968d5128', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-26T16:30:00+00:00'::timestamptz, '2026-05-26T20:19:27.645224+00:00'::timestamptz, 'submitted', 44, 8, 2, 1, 31500.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1db97e18-a491-4203-abeb-f92fde853385', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-27T16:15:00+00:00'::timestamptz, '2026-05-27T18:27:33.350318+00:00'::timestamptz, 'submitted', 39, 7, 3, 1, 43400.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('31539e96-5ed1-4f6a-ae94-392fc322f155', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-28T16:00:00+00:00'::timestamptz, '2026-05-28T18:41:11.497865+00:00'::timestamptz, 'submitted', 40, 6, 3, 1, 28800.00, 'Bayshore', 'd0d0d0d0-0000-4000-a000-000000000001'),
('332b00b1-4025-4f69-a92d-21927fe9a34f', '13525546-8db1-44f0-adb0-666e731ee044', '2026-05-30T12:15:00+00:00'::timestamptz, '2026-05-30T15:26:27.544377+00:00'::timestamptz, 'submitted', 41, 7, 3, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('872e720b-86f5-409c-a501-72c8ea2492b0', '13525546-8db1-44f0-adb0-666e731ee044', '2026-06-01T17:30:00+00:00'::timestamptz, '2026-06-01T21:21:32.216638+00:00'::timestamptz, 'submitted', 38, 7, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('20bd7a4f-ca66-4115-a7a0-0d7fd21d753e', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-04T13:00:00+00:00'::timestamptz, '2026-04-04T15:33:00.648752+00:00'::timestamptz, 'submitted', 24, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6f73343e-cea1-486e-a93f-b0168aa09515', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-06T16:15:00+00:00'::timestamptz, '2026-04-06T19:25:25.551983+00:00'::timestamptz, 'submitted', 16, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4242773d-fb49-4763-a2fa-1e694f7497c4', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-14T15:00:00+00:00'::timestamptz, '2026-04-14T19:11:58.420903+00:00'::timestamptz, 'submitted', 27, 3, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9aa70f5e-bbfc-4bf5-aaa4-577cefe967f4', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-18T13:45:00+00:00'::timestamptz, '2026-04-18T16:59:37.866281+00:00'::timestamptz, 'submitted', 28, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('61828934-528a-41fb-ac77-46867109308d', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-20T15:45:00+00:00'::timestamptz, '2026-04-20T18:27:40.379640+00:00'::timestamptz, 'submitted', 29, 4, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('8f2535ac-f8d5-495b-a196-26835b84f379', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-23T15:45:00+00:00'::timestamptz, '2026-04-23T19:29:29.288029+00:00'::timestamptz, 'submitted', 27, 4, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0b86c914-4495-4dce-a0dc-9b1664196988', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-25T12:00:00+00:00'::timestamptz, '2026-04-25T15:09:12.040620+00:00'::timestamptz, 'submitted', 17, 2, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7649ba4a-fcec-4da5-ae3e-6b7d44e15498', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-04-27T17:30:00+00:00'::timestamptz, '2026-04-27T21:17:56.832241+00:00'::timestamptz, 'submitted', 30, 4, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('98627cab-4d09-4d09-aae4-39b2b69bbd25', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-04T15:30:00+00:00'::timestamptz, '2026-05-04T17:39:36.243441+00:00'::timestamptz, 'submitted', 29, 4, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e63b95c3-67a3-4896-aa10-af51d49b8335', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-05T16:15:00+00:00'::timestamptz, '2026-05-05T20:31:00.756586+00:00'::timestamptz, 'submitted', 18, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9fa0ec05-e060-4f65-ad64-0d8159804516', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-07T16:00:00+00:00'::timestamptz, '2026-05-07T18:01:51.140120+00:00'::timestamptz, 'submitted', 30, 5, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6236abfd-43b4-4825-a01a-3578eacdff01', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-08T17:15:00+00:00'::timestamptz, '2026-05-08T20:19:21.255506+00:00'::timestamptz, 'submitted', 18, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('617e8ddb-49db-41c3-aa68-dd6b2e355ced', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-13T17:00:00+00:00'::timestamptz, '2026-05-13T20:02:04.492848+00:00'::timestamptz, 'submitted', 26, 2, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6fe33632-735c-474e-aaa1-05b30ee37629', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-19T17:15:00+00:00'::timestamptz, '2026-05-19T19:36:09.398840+00:00'::timestamptz, 'submitted', 24, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('42b9ba53-d1f9-4c47-ac4f-6a7e477635ea', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-20T16:45:00+00:00'::timestamptz, '2026-05-20T20:53:07.775312+00:00'::timestamptz, 'submitted', 16, 2, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('1956ab63-06b2-4382-a8bd-089f56469bc1', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-22T17:15:00+00:00'::timestamptz, '2026-05-22T19:57:24.430799+00:00'::timestamptz, 'submitted', 23, 2, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('889c80cf-ca5d-433b-a6b6-deda6bb9c4cf', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-26T17:15:00+00:00'::timestamptz, '2026-05-26T21:26:59.106485+00:00'::timestamptz, 'submitted', 27, 5, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f6c6b74f-eeff-4c75-ad69-8d68ecf09ddb', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-27T16:45:00+00:00'::timestamptz, '2026-05-27T20:22:34.403143+00:00'::timestamptz, 'submitted', 26, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('b628448c-c63d-458c-af5b-b654cd54da15', 'f49d40b1-9ccd-4250-a9e4-8857bd50c9ab', '2026-05-30T12:00:00+00:00'::timestamptz, '2026-05-30T15:27:44.570364+00:00'::timestamptz, 'submitted', 19, 3, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c01a1bea-3586-4593-af65-93c7b3ccd406', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-06T16:30:00+00:00'::timestamptz, '2026-04-06T20:33:48.479192+00:00'::timestamptz, 'submitted', 24, 3, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('828d86b9-ad3d-4ff4-a9a3-c94a8dcc7d6e', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-07T17:30:00+00:00'::timestamptz, '2026-04-07T20:19:45.088793+00:00'::timestamptz, 'submitted', 16, 2, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a25060bd-bcb0-447e-ab5d-0bd75e5fdee6', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-16T16:30:00+00:00'::timestamptz, '2026-04-16T18:31:16.099545+00:00'::timestamptz, 'submitted', 28, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('f05bbc72-782e-4b5f-a21b-dc5d56d43fdf', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-17T15:00:00+00:00'::timestamptz, '2026-04-17T18:18:18.826606+00:00'::timestamptz, 'submitted', 29, 4, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('86b3ac61-5c27-45c9-a83e-d17ff598d182', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-18T11:00:00+00:00'::timestamptz, '2026-04-18T14:58:56.302816+00:00'::timestamptz, 'submitted', 22, 3, 0, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('917fc109-5175-4f22-abb0-09a6ad828be5', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-20T17:15:00+00:00'::timestamptz, '2026-04-20T19:42:37.163323+00:00'::timestamptz, 'submitted', 20, 3, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5ca7c1b6-c2ab-45d1-a0f9-a31795bf01ac', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-22T17:30:00+00:00'::timestamptz, '2026-04-22T21:58:46.279515+00:00'::timestamptz, 'submitted', 16, 2, 0, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('9579b9ec-0ee8-48c4-acf3-856eb23fde41', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-27T15:45:00+00:00'::timestamptz, '2026-04-27T18:58:42.361426+00:00'::timestamptz, 'submitted', 29, 4, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d5e285f7-baee-4aa1-a9fe-7acb5880c83d', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-04-30T16:00:00+00:00'::timestamptz, '2026-04-30T19:55:18.968592+00:00'::timestamptz, 'submitted', 25, 3, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('7a4b903e-2f8f-4bfc-abb8-c4b94b0c83e6', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-06T16:45:00+00:00'::timestamptz, '2026-05-06T19:57:26.316717+00:00'::timestamptz, 'submitted', 17, 3, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a6605c49-60c4-4399-aa4d-12759a8f0b38', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-08T17:45:00+00:00'::timestamptz, '2026-05-08T21:08:26.396717+00:00'::timestamptz, 'submitted', 23, 2, 0, 0, 0.00, 'Westchase', 'd0d0d0d0-0000-4000-a000-000000000001'),
('480afef5-163d-426d-ac8e-b0c1f9e9411e', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-19T16:00:00+00:00'::timestamptz, '2026-05-19T19:55:46.071855+00:00'::timestamptz, 'submitted', 17, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('6501198e-f213-4bad-a3f6-f916f05b5d73', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-21T16:30:00+00:00'::timestamptz, '2026-05-21T20:14:59.134718+00:00'::timestamptz, 'submitted', 18, 2, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c7d588de-f9d9-49df-a27b-047809c7d2df', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-27T17:45:00+00:00'::timestamptz, '2026-05-27T21:13:48.838660+00:00'::timestamptz, 'submitted', 30, 5, 1, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e73c1089-acb2-498c-a086-d57f45764653', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-05-29T15:30:00+00:00'::timestamptz, '2026-05-29T18:09:22.635229+00:00'::timestamptz, 'submitted', 17, 1, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('3ccb7d5a-1934-4a8f-a9a2-87e17f92846b', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-06-01T17:15:00+00:00'::timestamptz, '2026-06-01T20:17:46.001279+00:00'::timestamptz, 'submitted', 18, 2, 0, 0, 0.00, 'Davis Islands', 'd0d0d0d0-0000-4000-a000-000000000001'),
('32d397ed-192c-4f17-a5c6-d063d5324d0e', '7d6afc78-c90b-41d0-a32f-c326cba7c10e', '2026-06-02T15:45:00+00:00'::timestamptz, '2026-06-02T19:45:25.405991+00:00'::timestamptz, 'submitted', 25, 2, 0, 0, 0.00, 'New Tampa', 'd0d0d0d0-0000-4000-a000-000000000001'),
('d3aee1c2-184a-4778-a201-bffcbb3f1e58', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-04-04T12:45:00+00:00'::timestamptz, '2026-04-04T16:59:35.064070+00:00'::timestamptz, 'submitted', 16, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('c51fd0c6-d8ba-4290-a4a4-04cbe55247ee', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-04-07T16:30:00+00:00'::timestamptz, '2026-04-07T18:55:06.082968+00:00'::timestamptz, 'submitted', 18, 3, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('42b7a84f-2d59-416c-a18a-60b659a96e97', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-04-11T12:15:00+00:00'::timestamptz, '2026-04-11T14:54:09.191412+00:00'::timestamptz, 'submitted', 21, 3, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('336d7a8f-5a42-4c61-ae64-3e4ad444eaad', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-04-14T17:45:00+00:00'::timestamptz, '2026-04-14T21:34:03.459274+00:00'::timestamptz, 'submitted', 16, 1, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('03288685-ade3-4b9c-a53e-7b731eaa67cf', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-04-21T15:30:00+00:00'::timestamptz, '2026-04-21T18:45:54.873122+00:00'::timestamptz, 'submitted', 17, 3, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('4727d6ce-bb19-45f7-a49f-21d5beb16c14', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-06T17:15:00+00:00'::timestamptz, '2026-05-06T19:38:50.640211+00:00'::timestamptz, 'submitted', 18, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('bde0effb-d96d-4f8d-a44a-5b5e8cb97fe2', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-07T16:15:00+00:00'::timestamptz, '2026-05-07T19:41:46.192752+00:00'::timestamptz, 'submitted', 23, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('e738d5e8-36f0-455a-abdd-2c621f8225cf', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-12T16:15:00+00:00'::timestamptz, '2026-05-12T18:38:31.671882+00:00'::timestamptz, 'submitted', 24, 3, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('81e37b41-a6db-4580-a19c-324e4f13b256', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-13T16:00:00+00:00'::timestamptz, '2026-05-13T18:20:21.276435+00:00'::timestamptz, 'submitted', 19, 2, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('a59fb931-fc36-4d9a-ad0b-85f7170a3bdd', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-21T15:45:00+00:00'::timestamptz, '2026-05-21T19:40:11.805878+00:00'::timestamptz, 'submitted', 17, 3, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('13eff123-a6f9-44cb-a532-31b99d057e44', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-22T17:30:00+00:00'::timestamptz, '2026-05-22T21:28:55.075127+00:00'::timestamptz, 'submitted', 26, 4, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('0ecf99ee-1fce-4b33-ad48-60833975ed8b', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-23T14:00:00+00:00'::timestamptz, '2026-05-23T17:00:54.082162+00:00'::timestamptz, 'submitted', 29, 5, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('5935cd4b-a277-4e70-aaee-c21b660db85a', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-26T15:00:00+00:00'::timestamptz, '2026-05-26T18:59:53.813577+00:00'::timestamptz, 'submitted', 27, 3, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('090bc646-371e-451c-ac25-f07aa3b7767b', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-27T16:00:00+00:00'::timestamptz, '2026-05-27T19:16:23.975036+00:00'::timestamptz, 'submitted', 24, 4, 0, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001'),
('df5a6e12-38be-4842-a814-ec0f4382525a', '98bccef9-9f0a-4e74-a6a5-1f4c01dce5be', '2026-05-29T16:00:00+00:00'::timestamptz, '2026-05-29T19:29:34.154093+00:00'::timestamptz, 'submitted', 24, 2, 1, 0, 0.00, 'Hyde Park', 'd0d0d0d0-0000-4000-a000-000000000001');
