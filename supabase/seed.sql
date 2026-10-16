-- Local development seed. `supabase db reset` runs this after the migrations.
-- Never run it against staging or production.
--
-- Users (sign in locally with the dev email link; messages land in Mailpit/Inbucket):
--   alice@example.test  owner of "Sunday Doubles"
--   bob@example.test    not yet a member; join with the invite below
--   carol@example.test  outsider who must not see the group
--
-- Invite link for the seeded group: /join/local-dev-invite-token-not-secret

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
   '{"provider":"email","providers":["email"]}', '{"full_name":"Carol Example"}', now(), now())
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email in ('alice@example.test', 'bob@example.test', 'carol@example.test')
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
