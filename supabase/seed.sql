-- Local development seed. `supabase db reset` runs this after the migrations.
-- Never run it against staging or production.
--
-- Users (sign in locally with the dev email link; messages land in Mailpit/Inbucket):
--   alice@example.test  owner of "Sunday Doubles"
--   bob@example.test    not yet a member; join with the invite below
--   carol@example.test  outsider who must not see the group
--
-- Invite link for the seeded group: /join/local-dev-invite-token-not-secret
--
-- Settlement demo, group "Demo: Settle up" (sign in as asha@example.test, the owner):
--   Asha bought 12 cans for 1200, Rohan 6 cans for 600. Two sessions used 4 and 9 cans.
--   Expected balances: Asha +800, Vikram -100, Neha -400, Rohan +200, and the plan
--   Vikram -> Asha 100, Neha -> Asha 400, Asha -> Rohan 200.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000a11c', 'authenticated',
   'authenticated', 'alice@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Alice Example"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000b0b', 'authenticated',
   'authenticated', 'bob@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bob Example"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000ca01', 'authenticated',
   'authenticated', 'carol@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Carol Example"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000a5a0', 'authenticated',
   'authenticated', 'asha@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Asha"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000b1c0', 'authenticated',
   'authenticated', 'vikram@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Vikram"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000e0a0', 'authenticated',
   'authenticated', 'neha@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Neha"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000f0a0', 'authenticated',
   'authenticated', 'rohan@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Rohan"}', now(), now())
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

insert into public.groups (id, name, sport, timezone, currency, backdate_days, owner_id)
values ('00000000-0000-4000-8000-0000000000a1', 'Sunday Doubles', 'tennis', 'Asia/Kolkata', 'INR', 14,
        '00000000-0000-4000-8000-00000000a11c')
on conflict (id) do nothing;

insert into public.memberships (group_id, user_id, role)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000a11c', 'owner')
on conflict (group_id, user_id) do nothing;

insert into public.group_invites (group_id, token_hash, created_by, expires_at)
values ('00000000-0000-4000-8000-0000000000a1',
        public.hash_invite_token('local-dev-invite-token-not-secret'),
        '00000000-0000-4000-8000-00000000a11c', now() + interval '365 days')
on conflict (token_hash) do nothing;

insert into public.audit_events (group_id, actor_id, action, entity_type, entity_id, after_json)
select '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000a11c',
       'seed.loaded', 'group', '00000000-0000-4000-8000-0000000000a1', '{"source":"supabase/seed.sql"}'
where not exists (select 1 from public.audit_events where action = 'seed.loaded');

-- ---------------------------------------------------------------------------
-- Settlement demo
-- ---------------------------------------------------------------------------

insert into public.groups (id, name, sport, timezone, currency, backdate_days, owner_id)
values ('00000000-0000-4000-8000-0000000000d1', 'Demo: Settle up', 'tennis', 'Asia/Kolkata', 'INR', 14,
        '00000000-0000-4000-8000-00000000a5a0')
on conflict (id) do nothing;

insert into public.memberships (group_id, user_id, role)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000a5a0', 'owner'),
       ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000b1c0', 'member'),
       ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000e0a0', 'member'),
       ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000f0a0', 'member')
on conflict (group_id, user_id) do nothing;

-- Recorded through the app's own commands, acting as Asha, so the ledger, lots and audit
-- trail look exactly as they would after real use.
do $$
declare
  v_group uuid := '00000000-0000-4000-8000-0000000000d1';
  v_asha uuid := '00000000-0000-4000-8000-00000000a5a0';
  v_vikram uuid := '00000000-0000-4000-8000-00000000b1c0';
  v_neha uuid := '00000000-0000-4000-8000-00000000e0a0';
  v_rohan uuid := '00000000-0000-4000-8000-00000000f0a0';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_item uuid;
  v_person uuid;
begin
  if exists (select 1 from public.purchases where group_id = v_group) then
    return;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_asha, 'role', 'authenticated')::text, true);
  select id into v_item from public.items where group_id = v_group;

  perform public.record_purchase(v_group, v_item, v_asha, 12, 120000, v_today - 10, 'Demo: 12 cans', null, 'seed-demo-purchase-asha');
  perform public.record_purchase(v_group, v_item, v_rohan, 6, 60000, v_today - 5, 'Demo: 6 cans', null, 'seed-demo-purchase-rohan');

  foreach v_person in array array[v_asha, v_vikram, v_neha, v_rohan] loop
    perform public.upsert_attendance(v_group, v_today - 7, v_person, 'present', 'seed-demo-s1-' || v_person);
  end loop;
  perform public.record_consumption_and_allocate(v_group, v_today - 7, v_item, 4, null, 'seed-demo-use-1');

  foreach v_person in array array[v_asha, v_neha, v_rohan] loop
    perform public.upsert_attendance(v_group, v_today - 3, v_person, 'present', 'seed-demo-s2-' || v_person);
  end loop;
  perform public.upsert_attendance(v_group, v_today - 3, v_vikram, 'absent', 'seed-demo-s2-' || v_vikram);
  perform public.record_consumption_and_allocate(v_group, v_today - 3, v_item, 9, null, 'seed-demo-use-2');

  perform set_config('request.jwt.claims', '', true);
end;
$$;
