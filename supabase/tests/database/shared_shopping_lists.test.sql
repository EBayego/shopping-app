begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select extensions.plan(14);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', '{}', '{}', true, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', '{}', '{}', true, now(), now()
  );

insert into public.groups (id, name, created_by)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'Group A', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'Group B', '22222222-2222-4222-8222-222222222222');
insert into public.group_members (group_id, profile_id, role, added_by)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner', '22222222-2222-4222-8222-222222222222');
insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'List A', '28001', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'List B', '28002', '22222222-2222-4222-8222-222222222222');

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select extensions.ok(
  public.apply_shopping_intent_operation(
    '00000000-0000-4000-8000-000000000001', 'add',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', null, 'Milk', 'milk'
  ) ->> 'id' is not null,
  'a group member can add through the idempotent mutation RPC'
);

create temporary table shared_list_values as
select id as intent_id
from public.shopping_intents
where shopping_list_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001';
grant select on shared_list_values to authenticated;

select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000002', 'increment', null,
  (select intent_id from shared_list_values)
);

select extensions.is(
  (select requested_quantity from public.shopping_intents where id = (select intent_id from shared_list_values)),
  2::numeric,
  'quantity starts the concurrency scenario at two'
);

select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000003', 'increment', null,
  (select intent_id from shared_list_values)
);
select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000004', 'increment', null,
  (select intent_id from shared_list_values)
);

select extensions.is(
  (select requested_quantity from public.shopping_intents where id = (select intent_id from shared_list_values)),
  4::numeric,
  'two independent increment operations both apply without a lost update'
);

reset role;
set local role postgres;

select extensions.dblink_exec(
  'host=supabase_db_shopping-app port=5432 dbname=postgres user=postgres password=postgres',
  $$
    insert into auth.users (
      instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
      is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '33333333-3333-4333-8333-333333333333',
      'authenticated', 'authenticated', '{}', '{}', true, now(), now()
    );
    insert into public.groups (id, name, created_by)
    values ('cccccccc-3333-4333-8333-cccccccccccc', 'Concurrent group', '33333333-3333-4333-8333-333333333333');
    insert into public.group_members (group_id, profile_id, role, added_by)
    values (
      'cccccccc-3333-4333-8333-cccccccccccc',
      '33333333-3333-4333-8333-333333333333',
      'owner',
      '33333333-3333-4333-8333-333333333333'
    );
    insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
      'cccccccc-3333-4333-8333-cccccccccccc',
      'Concurrent list', '28003',
      '33333333-3333-4333-8333-333333333333'
    );
    insert into public.shopping_intents (
      id, shopping_list_id, raw_text, normalized_name,
      requested_quantity, created_by
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccc0004',
      'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
      'Concurrent milk', 'concurrent milk', 2,
      '33333333-3333-4333-8333-333333333333'
    );
  $$
);

select extensions.dblink_connect(
  'quantity_client_a',
  'host=supabase_db_shopping-app port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'quantity_client_b',
  'host=supabase_db_shopping-app port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_exec(
  'quantity_client_a',
  $$begin;
    set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}';
    set local role authenticated;
  $$
);
select extensions.dblink_exec(
  'quantity_client_b',
  $$begin;
    set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}';
    set local role authenticated;
  $$
);

select extensions.dblink_send_query(
  'quantity_client_a',
  $$select public.apply_shopping_intent_operation(
    '00000000-0000-4000-8000-000000000021', 'increment', null,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0004'
  )$$
);
select * from extensions.dblink_get_result('quantity_client_a') as result(payload jsonb);
select * from extensions.dblink_get_result('quantity_client_a') as result(payload jsonb);
select extensions.dblink_send_query(
  'quantity_client_b',
  $$select public.apply_shopping_intent_operation(
    '00000000-0000-4000-8000-000000000022', 'increment', null,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0004'
  )$$
);
select extensions.dblink_exec('quantity_client_a', 'commit');
select * from extensions.dblink_get_result('quantity_client_b') as result(payload jsonb);
select * from extensions.dblink_get_result('quantity_client_b') as result(payload jsonb);
select extensions.dblink_exec('quantity_client_b', 'commit');
select extensions.dblink_disconnect('quantity_client_a');
select extensions.dblink_disconnect('quantity_client_b');

select extensions.is(
  (
    select requested_quantity
    from public.shopping_intents
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccc0004'
  ),
  4::numeric,
  'two simultaneous database clients increment from two to four'
);

select extensions.dblink_exec(
  'host=supabase_db_shopping-app port=5432 dbname=postgres user=postgres password=postgres',
  $$
    delete from public.groups
    where id = 'cccccccc-3333-4333-8333-cccccccccccc';
    delete from auth.users
    where id = '33333333-3333-4333-8333-333333333333';
  $$
);

set local role authenticated;

select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000005', 'increment', null,
  (select intent_id from shared_list_values)
);
select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000005', 'increment', null,
  (select intent_id from shared_list_values)
);

select extensions.is(
  (select requested_quantity from public.shopping_intents where id = (select intent_id from shared_list_values)),
  5::numeric,
  'a duplicate operation_id applies its increment exactly once'
);

select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000006', 'set_checked', null,
  (select intent_id from shared_list_values), null, null, true
);
select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000007', 'set_checked', null,
  (select intent_id from shared_list_values), null, null, true
);

select extensions.is(
  (select checked from public.shopping_intents where id = (select intent_id from shared_list_values)),
  true,
  'concurrent clients marking the same item converge on checked'
);

select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000008', 'edit', null,
  (select intent_id from shared_list_values), 'Whole milk', 'whole milk'
);
select public.apply_shopping_intent_operation(
  '00000000-0000-4000-8000-000000000009', 'delete', null,
  (select intent_id from shared_list_values)
);

select extensions.is(
  (select count(*) from public.shopping_intents where id = (select intent_id from shared_list_values)),
  0::bigint,
  'delete wins over an overlapping completed edit'
);

select extensions.throws_ok(
  format(
    'select public.apply_shopping_intent_operation(%L, %L, null, %L, %L, %L)',
    '00000000-0000-4000-8000-000000000010', 'edit',
    (select intent_id from shared_list_values), 'Late edit', 'late edit'
  ),
  'P0002',
  'Shopping item not found',
  'an edit that loses a delete race cannot recreate the deleted item'
);

select extensions.throws_ok(
  $$
    select public.apply_shopping_intent_operation(
      '00000000-0000-4000-8000-000000000011', 'add',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002', null, 'Forbidden', 'forbidden'
    )
  $$,
  '42501',
  'Not authorized for this shopping list',
  'a member of group A cannot mutate a list in group B'
);

select extensions.is(
  (select count(*) from public.shopping_lists where group_id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'),
  0::bigint,
  'a member of group A cannot read lists in group B'
);

select public.apply_shopping_list_operation(
  '00000000-0000-4000-8000-000000000012',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', null, '28003'
);
select public.apply_shopping_list_operation(
  '00000000-0000-4000-8000-000000000012',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', null, '28003'
);

select extensions.is(
  (select postal_code from public.shopping_lists where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'),
  '28003',
  'list field mutations are idempotent too'
);

reset role;

select extensions.is(
  (
    select count(*)
    from private.shopping_operations
    where operation_id = '00000000-0000-4000-8000-000000000005'
  ),
  1::bigint,
  'the operation ledger stores one row per operation_id'
);

select extensions.ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'group_members_receive_private_broadcasts'
  ),
  'private Broadcast subscriptions have a membership RLS policy'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'broadcast_shopping_intent_changes'
      and not tgisinternal
  ),
  'shopping intent changes are broadcast from PostgreSQL'
);

select * from extensions.finish();

rollback;
