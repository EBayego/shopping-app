begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(30);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'authenticated',
    'authenticated',
    '{}',
    '{"display_name":"Owner"}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'authenticated',
    'authenticated',
    '{}',
    '{"display_name":"Member"}',
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'authenticated',
    'authenticated',
    '{}',
    '{"display_name":"Outsider"}',
    true,
    now(),
    now()
  );

create temporary table rls_test_values (
  key text primary key,
  value text not null
);

grant select, insert, update on rls_test_values to authenticated;

select extensions.is(
  (select count(*) from public.profiles),
  3::bigint,
  'auth user creation provisions profiles server-side'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select extensions.is(
  auth.jwt() ->> 'is_anonymous',
  'true',
  'owner is an Anonymous Auth user with the authenticated database role'
);

with created as materialized (
  select *
  from public.create_group_with_initial_list('Home', 'Weekly', '50009')
)
insert into rls_test_values (key, value)
select 'group_id', group_id::text from created
union all
select 'list_id', shopping_list_id::text from created;

select extensions.is(
  (
    select role::text
    from public.group_members
    where group_id = (select value::uuid from rls_test_values where key = 'group_id')
      and profile_id = auth.uid()
  ),
  'owner',
  'group creation makes the caller its owner'
);

select extensions.is(
  (
    select count(*)
    from public.shopping_lists
    where id = (select value::uuid from rls_test_values where key = 'list_id')
  ),
  1::bigint,
  'group creation atomically creates the initial list'
);

select extensions.is(
  (select count(*) from public.groups),
  1::bigint,
  'owner can read their group'
);

select extensions.lives_ok(
  $$update public.groups set name = 'Home renamed' where id = (select value::uuid from rls_test_values where key = 'group_id')$$,
  'owner can update their group'
);

select extensions.is(
  (select name from public.groups where id = (select value::uuid from rls_test_values where key = 'group_id')),
  'Home renamed',
  'owner update is persisted'
);

insert into rls_test_values (key, value)
select
  'invite_code',
  public.generate_group_invite(
    (select value::uuid from rls_test_values where key = 'group_id'),
    interval '1 day',
    1
  );

select extensions.ok(
  length((select value from rls_test_values where key = 'invite_code')) = 48,
  'owner receives a 192-bit invite code'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select extensions.is(
  public.join_group_by_invite((select value from rls_test_values where key = 'invite_code')),
  (select value::uuid from rls_test_values where key = 'group_id'),
  'anonymous authenticated user can join with a valid invite'
);

select extensions.is(
  (select count(*) from public.groups),
  1::bigint,
  'member can read their group'
);

select extensions.is(
  (select count(*) from public.group_members),
  2::bigint,
  'member can read memberships in their group'
);

select extensions.lives_ok(
  $$
    insert into public.shopping_intents (
      shopping_list_id,
      raw_text,
      normalized_name
    ) values (
      (select value::uuid from rls_test_values where key = 'list_id'),
      '2 litros de leche',
      'leche'
    )
  $$,
  'member can create an item in a group list'
);

select extensions.lives_ok(
  $$update public.shopping_lists set name = 'Shared weekly' where id = (select value::uuid from rls_test_values where key = 'list_id')$$,
  'member can update a group list'
);

select extensions.results_eq(
  $$
    update public.groups
    set name = 'Member takeover'
    where id = (select value::uuid from rls_test_values where key = 'group_id')
    returning id
  $$,
  $$select null::uuid where false$$,
  'non-owner member cannot update the group'
);

select extensions.is(
  (
    select count(*)
    from public.profiles
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  1::bigint,
  'member can read another member profile in the same group'
);

select extensions.throws_ok(
  $$select * from private.group_invites$$,
  '42501',
  'permission denied for table group_invites',
  'invite possession does not expose invite storage'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-ccccccccccc3","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select extensions.is(
  auth.jwt() ->> 'is_anonymous',
  'true',
  'outsider also exercises Anonymous Auth semantics'
);

select extensions.is(
  (select count(*) from public.retailers),
  4::bigint,
  'authenticated anonymous user can read catalog data'
);

select extensions.is(
  (select count(*) from public.groups),
  0::bigint,
  'non-member cannot read another group'
);

select extensions.is(
  (select count(*) from public.shopping_lists),
  0::bigint,
  'non-member cannot read another group list'
);

select extensions.is(
  (select count(*) from public.shopping_intents),
  0::bigint,
  'non-member cannot read another group items'
);

select extensions.results_eq(
  $$
    update public.shopping_lists
    set name = 'Outsider edit'
    where id = (select value::uuid from rls_test_values where key = 'list_id')
    returning id
  $$,
  $$select null::uuid where false$$,
  'non-member cannot update another group list'
);

select extensions.throws_ok(
  format(
    'insert into public.shopping_intents (shopping_list_id, raw_text, normalized_name) values (%L, %L, %L)',
    (select value from rls_test_values where key = 'list_id'),
    'Outsider item',
    'outsider item'
  ),
  '42501',
  'new row violates row-level security policy for table "shopping_intents"',
  'non-member cannot insert into another group list'
);

select extensions.throws_ok(
  format(
    'select public.generate_group_invite(%L::uuid)',
    (select value from rls_test_values where key = 'group_id')
  ),
  '42501',
  'Only a group owner can create invites',
  'non-owner cannot generate an invite for another group'
);

select extensions.throws_ok(
  format(
    'select public.join_group_by_invite(%L)',
    (select value from rls_test_values where key = 'invite_code')
  ),
  '22023',
  'Invite code is invalid or expired',
  'a consumed single-use invite cannot be reused by an outsider'
);

select extensions.is(
  (select count(*) from public.group_members),
  0::bigint,
  'non-member cannot inspect another group membership'
);

select extensions.throws_ok(
  $$insert into public.retailer_products (retailer_id, external_id, name, observed_at) values ('00000000-0000-4000-8000-000000000001', 'forbidden', 'Forbidden', now())$$,
  '42501',
  'permission denied for table retailer_products',
  'authenticated clients cannot write retailer products'
);

reset role;
set local role anon;

select extensions.throws_ok(
  $$select * from public.retailers$$,
  '42501',
  'permission denied for table retailers',
  'unauthenticated anon role is denied catalog access'
);

select extensions.throws_ok(
  $$select * from public.create_group_with_initial_list('Forbidden', 'Forbidden', '50009')$$,
  '42501',
  'permission denied for function create_group_with_initial_list',
  'unauthenticated anon role cannot execute group RPCs'
);

reset role;

select extensions.ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind in ('r', 'p')
  ),
  'every exposed public table has RLS enabled'
);

select * from extensions.finish();

rollback;
