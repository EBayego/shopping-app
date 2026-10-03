begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

insert into auth.users (instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111119', 'authenticated', 'authenticated', '{}', '{}', true, now(), now());
insert into public.groups (id, name, created_by)
values ('90000000-0000-4000-8000-0000000000a1', 'Voice AI test', '91111111-1111-4111-8111-111111111119');
insert into public.group_members (group_id, profile_id, role, added_by)
values ('90000000-0000-4000-8000-0000000000a1', '91111111-1111-4111-8111-111111111119', 'owner', '91111111-1111-4111-8111-111111111119');
insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values ('90000000-0000-4000-8000-0000000000a2', '90000000-0000-4000-8000-0000000000a1', 'Voice list', '28001', '91111111-1111-4111-8111-111111111119');
select set_config('request.jwt.claims', '{"sub":"91111111-1111-4111-8111-111111111119","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

create temporary table voice_test_intent as select public.add_shopping_product_operation(
  operation_id => '90000000-0000-4000-8000-0000000000b1',
  shopping_list_id => '90000000-0000-4000-8000-0000000000a2',
  raw_text => 'dos briks de leche de un litro', normalized_name => 'leche',
  package_count => 2, package_size => 1, package_unit => 'l', package_type => 'carton'
) as payload;
select extensions.is((select payload ->> 'package_type' from voice_test_intent), 'carton', 'container type is persisted');
select extensions.is((select payload ->> 'package_count' from voice_test_intent), '2', 'packaging count is not overwritten by the default quantity');
select extensions.is((select payload ->> 'total_amount' from voice_test_intent), '2', 'packaging total is derived consistently');

select public.edit_shopping_product_operation(
  operation_id => '90000000-0000-4000-8000-0000000000b2',
  intent_id => (select (payload ->> 'id')::uuid from voice_test_intent),
  raw_text => 'leche', normalized_name => 'leche', requested_quantity => 3,
  package_count => 3, package_size => 1, package_unit => 'l', package_type => 'bottle'
);
select extensions.is((select package_type::text from public.shopping_intents where id = (select (payload ->> 'id')::uuid from voice_test_intent)), 'bottle', 'editing changes the stored container');
select public.add_shopping_product_operation(
  operation_id => '90000000-0000-4000-8000-0000000000b1',
  shopping_list_id => '90000000-0000-4000-8000-0000000000a2',
  raw_text => 'dos briks de leche de un litro', normalized_name => 'leche',
  package_count => 2, package_size => 1, package_unit => 'l', package_type => 'carton'
);
select extensions.is((select package_type::text from public.shopping_intents where id = (select (payload ->> 'id')::uuid from voice_test_intent)), 'bottle', 'a duplicate add does not overwrite later edits');
select public.edit_shopping_product_operation(
  operation_id => '90000000-0000-4000-8000-0000000000b3',
  intent_id => (select (payload ->> 'id')::uuid from voice_test_intent),
  raw_text => 'leche', normalized_name => 'leche', requested_quantity => 1
);
select extensions.is((select package_type::text from public.shopping_intents where id = (select (payload ->> 'id')::uuid from voice_test_intent)), null, 'editing can clear the optional container');
select public.edit_shopping_product_operation(
  operation_id => '90000000-0000-4000-8000-0000000000b2',
  intent_id => (select (payload ->> 'id')::uuid from voice_test_intent),
  raw_text => 'leche', normalized_name => 'leche', requested_quantity => 3,
  package_count => 3, package_size => 1, package_unit => 'l', package_type => 'bottle'
);
select extensions.is((select package_type::text from public.shopping_intents where id = (select (payload ->> 'id')::uuid from voice_test_intent)), null, 'a duplicate edit does not restore stale metadata');
select extensions.is(pg_column_size('carton'::public.shopping_package_type), 4, 'container enum uses four bytes');
select extensions.ok(not has_function_privilege('authenticated', 'public.consume_voice_ai_quota(uuid,text)', 'execute'), 'mobile users cannot consume or bypass server quota directly');
select extensions.ok(not has_function_privilege('anon', 'public.consume_voice_ai_quota(uuid,text)', 'execute'), 'unauthenticated callers cannot access quota RPC');
reset role;
set local role service_role;
select extensions.ok(public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'server can reserve quota');
select public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract') from generate_series(1,5);
select extensions.ok(not public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'seventh request in a minute is denied');
reset role;
update private.voice_ai_usage set minute_window = now() - interval '2 minutes';
set local role service_role;
select extensions.ok(public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'minute window resets');
reset role;
update private.voice_ai_usage set daily_requests = 60;
set local role service_role;
select extensions.ok(not public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'per-user daily limit is enforced');
reset role;
update private.voice_ai_usage set usage_day = current_date - 2;
update private.voice_ai_global_usage set daily_requests = 500;
set local role service_role;
select extensions.ok(not public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'global daily limit is enforced');
reset role;
update private.voice_ai_global_usage set usage_day = current_date - 2;
set local role service_role;
select extensions.ok(public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'extract'), 'daily counters reset rather than creating new rows');
reset role;
select extensions.is((select count(*) from private.voice_ai_usage where actor_id = '91111111-1111-4111-8111-111111111119'), 1::bigint, 'quota rows do not accumulate by day');
set local role service_role;
select extensions.throws_ok(
  $$select public.consume_voice_ai_quota('91111111-1111-4111-8111-111111111119', 'transcribe')$$,
  '22023', 'Invalid voice quota scope', 'obsolete audio requests cannot reserve paid quota'
);
reset role;
select extensions.throws_ok(
  $$insert into private.voice_ai_global_usage values ('transcribe', current_date, 0)$$,
  '23514', null::text, 'only extraction can occupy the single global quota row'
);
delete from auth.users where id = '91111111-1111-4111-8111-111111111119';
select extensions.is((select count(*) from private.voice_ai_usage where actor_id = '91111111-1111-4111-8111-111111111119'), 0::bigint, 'quota rows are removed with the user');
select * from extensions.finish();
rollback;
