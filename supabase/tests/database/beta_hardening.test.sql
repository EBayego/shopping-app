begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.has_function(
  'public',
  'record_catalog_product_misses_for_run',
  array['uuid', 'uuid', 'uuid', 'text[]', 'integer'],
  'run-scoped catalog disappearance RPC exists'
);
select extensions.is(
  has_function_privilege('service_role', 'public.record_catalog_product_misses(uuid,uuid,text[],integer)', 'EXECUTE'),
  false,
  'legacy unscoped disappearance RPC is unavailable to service role'
);
select extensions.is(
  has_function_privilege('anon', 'public.record_catalog_product_misses_for_run(uuid,uuid,uuid,text[],integer)', 'EXECUTE'),
  false,
  'anonymous role cannot record catalog misses'
);
select extensions.is(
  has_function_privilege('authenticated', 'public.record_catalog_product_misses_for_run(uuid,uuid,uuid,text[],integer)', 'EXECUTE'),
  false,
  'authenticated users cannot record catalog misses'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'authenticated', 'authenticated', '{}', '{}', true, now(), now()
);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;
select * from public.create_group_with_initial_list('Beta', 'Compra', '50009');
select extensions.lives_ok(
  $$select public.get_basket_comparison_inputs((select id from public.shopping_lists where name = 'Compra'))$$,
  'basket comparison RPC executes without ambiguous parameter references'
);
reset role;

insert into public.retailer_markets (id, retailer_id, external_id)
values (
  '81000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'beta-hardening-market'
);
insert into public.retailer_products (
  retailer_id, market_id, external_id, name, variable_weight,
  observed_at, last_seen_at
) values (
  '00000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  'missing-product', 'Missing product', false,
  now() - interval '1 day', now() - interval '1 day'
);
insert into public.provider_sync_runs (
  id, retailer_id, market_id, sync_type, started_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  'catalog_sync', now()
);

select extensions.is(
  public.record_catalog_product_misses_for_run(
    '00000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    array[]::text[], 3
  ),
  1,
  'active catalog run records one disappearance observation'
);
select extensions.is(
  public.record_catalog_product_misses_for_run(
    '00000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    array[]::text[], 3
  ),
  0,
  'repeating the same run is idempotent'
);
select extensions.is(
  (select consecutive_misses from public.retailer_products where external_id = 'missing-product'),
  1,
  'repeated delivery does not duplicate disappearance evidence'
);

update public.provider_sync_runs
set status = 'failed', finished_at = now()
where id = '82000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$select public.record_catalog_product_misses_for_run(
    '00000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    array[]::text[], 3
  )$$,
  '55000',
  'Catalog sync run is no longer active',
  'expired worker cannot record disappearance evidence'
);
select extensions.is(
  (select active from public.retailer_products where external_id = 'missing-product'),
  true,
  'one valid observation does not deactivate a product'
);

select * from extensions.finish();
rollback;
