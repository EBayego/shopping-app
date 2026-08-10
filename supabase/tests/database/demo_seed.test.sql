begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

select extensions.is(
  (select count(*)::integer from public.retailer_markets where metadata @> '{"fixture":true}'),
  4,
  'the local seed provides four isolated demo markets'
);

select extensions.is(
  (select count(*)::integer from public.retailer_market_postal_codes where postal_code = '50009'),
  4,
  'postal code 50009 resolves every demo retailer market'
);

select extensions.is(
  (select count(*)::integer from public.product_offers where id::text like 'd4000000-%'),
  4,
  'the demo milk has four offers'
);

select extensions.is(
  (select operational_status::text from public.retailers where code = 'DIA'),
  'ACTIVE',
  'DIA is active in the demo registry'
);

select extensions.is(
  (select operational_status::text from public.retailers where code = 'ALCAMPO'),
  'DEGRADED',
  'partial providers are not presented as fully active'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '50000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', '{}', '{}', true, now(), now()
);

insert into public.groups (id, name, created_by)
values ('50000000-0000-4000-8000-000000000002', 'Demo test', '50000000-0000-4000-8000-000000000001');

insert into public.group_members (group_id, profile_id, role, added_by)
values ('50000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'owner', '50000000-0000-4000-8000-000000000001');

insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'Compra', '50009', '50000000-0000-4000-8000-000000000001');

insert into public.shopping_intents (
  id, shopping_list_id, raw_text, normalized_name, requested_quantity,
  requested_unit, canonical_product_id, created_by
)
values (
  '50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000003',
  'Leche semidesnatada', 'leche semidesnatada', 1, 'l',
  'd2000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select extensions.is(
  public.search_products_for_list(
    '50000000-0000-4000-8000-000000000003',
    'leche semidesnatada'
  )->0->'canonicalProduct'->>'name',
  'Leche semidesnatada 1 l',
  'the expected beta search works from fixtures'
);

select extensions.is(
  jsonb_array_length(public.search_products_for_list(
    '50000000-0000-4000-8000-000000000003',
    'leche semidesnatada'
  )->0->'offers'),
  4,
  'search exposes all locally applicable offers'
);

select extensions.ok(
  jsonb_path_exists(
    public.search_products_for_list(
      '50000000-0000-4000-8000-000000000003',
      'leche semidesnatada'
    ),
    '$[*].offers[*] ? (@.freshness == "VERY_STALE")'
  ),
  'search makes very stale fixture prices explicit'
);

select extensions.ok(
  jsonb_path_exists(
    public.get_basket_comparison_inputs('50000000-0000-4000-8000-000000000003'),
    '$.candidates[*] ? (@.promoPrice == 0.95)'
  ),
  'comparison inputs preserve promotions'
);

select extensions.ok(
  jsonb_path_exists(
    public.get_basket_comparison_inputs('50000000-0000-4000-8000-000000000003'),
    '$.candidates[*] ? (@.available == false)'
  ),
  'comparison inputs preserve unavailable products for coverage reporting'
);

select * from extensions.finish();

rollback;
