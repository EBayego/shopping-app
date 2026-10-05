begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

insert into auth.users (instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', '{}', '{}', true, now(), now());

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temporary table invite_test (key text primary key, value text);
grant all on invite_test to authenticated;
set local role authenticated;
insert into invite_test select 'group', group_id::text from public.create_group_with_initial_list('Invites', 'Weekly', '50009');
insert into invite_test select 'other_group', group_id::text from public.create_group_with_initial_list('Other invites', 'Weekly', '50009');
insert into invite_test select 'random_code', public.generate_group_invite((select value::uuid from invite_test where key = 'group'));
select extensions.ok((select value ~ '^[0-9]{6}$' from invite_test where key = 'random_code'), 'new invitations have exactly six digits');
reset role;
select extensions.ok((select expires_at = created_at + interval '7 days' and max_uses = 100 from private.group_invites where code_hash = extensions.digest((select value from invite_test where key = 'random_code'), 'sha256')), 'default invitation lasts exactly 7 days and allows 100 joins');
update private.group_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where code_hash = extensions.digest((select value from invite_test where key = 'random_code'), 'sha256');

-- Exercise the same atomic allocator as the generator with known candidate codes.
select extensions.ok(private.claim_group_invite(
  (select value::uuid from invite_test where key = 'group'), 'f1000000-0000-4000-8000-000000000001',
  '000042', interval '7 days', 100
) is not null, 'a code with leading zeroes can be allocated');
select extensions.ok(private.claim_group_invite(
  (select value::uuid from invite_test where key = 'other_group'), 'f1000000-0000-4000-8000-000000000001',
  '000042', interval '7 days', 100
) is null, 'a collision never replaces an active invitation');
select extensions.is((select group_id::text from private.group_invites where code_hash = extensions.digest('000042', 'sha256')), (select value from invite_test where key = 'group'), 'active code still belongs to the original group');

select extensions.ok(private.claim_group_invite(
  (select value::uuid from invite_test where key = 'other_group'), 'f1000000-0000-4000-8000-000000000001',
  '000043', interval '7 days', 100
) is not null, 'a different candidate can be allocated after a collision');

select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(public.join_group_by_invite('000042')::text, (select value from invite_test where key = 'group'), 'a numeric invitation can be redeemed');
select extensions.is(public.join_group_by_invite('000042')::text, (select value from invite_test where key = 'group'), 'redeeming again is idempotent');
select extensions.throws_ok($$ select public.generate_group_invite((select value::uuid from invite_test where key = 'group')) $$, '42501', 'Only a group owner can create invites', 'members cannot create codes');
reset role;
update private.group_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where code_hash = extensions.digest('000042', 'sha256');
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$ select public.join_group_by_invite('000042') $$, '22023', 'Invite code is invalid or expired', 'expired codes cannot grant access');
reset role;

select extensions.ok(private.claim_group_invite(
  (select value::uuid from invite_test where key = 'other_group'), 'f1000000-0000-4000-8000-000000000001',
  '000042', interval '7 days', 100
) is not null, 'an expired numeric code can be allocated to a new invitation');
select extensions.ok((select group_id::text = (select value from invite_test where key = 'other_group') and use_count = 0 and expires_at = now() + interval '7 days' from private.group_invites where code_hash = extensions.digest('000042', 'sha256')), 'reallocated code resets the group, usage and expiry atomically');

select * from extensions.finish();
rollback;
