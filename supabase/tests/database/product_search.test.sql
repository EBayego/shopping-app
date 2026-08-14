begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', '{}', '{}', true, now(), now());

insert into public.groups (id, name, created_by)
values ('70000000-0000-4000-8000-000000000001', 'Search group', '71111111-1111-4111-8111-111111111111');

insert into public.group_members (group_id, profile_id, role, added_by)
values ('70000000-0000-4000-8000-000000000001', '71111111-1111-4111-8111-111111111111', 'owner', '71111111-1111-4111-8111-111111111111');

insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values ('70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'Search list', '28001', '71111111-1111-4111-8111-111111111111');

insert into public.retailer_markets (id, retailer_id, external_id, name)
values
  ('70000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'dia-madrid', 'DIA Madrid'),
  ('70000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'dia-barcelona', 'DIA Barcelona'),
  ('70000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000002', 'mercadona-madrid', 'Mercadona Madrid');

insert into public.retailer_market_postal_codes (retailer_id, market_id, postal_code)
values
  ('00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', '28001'),
  ('00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '08001'),
  ('00000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000013', '28001');

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, brand, package_size,
  package_unit, category, observed_at, last_seen_at
)
values
  ('70000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'dia-leche', 'Leche entera DIA 1 L', 'DIA', 1, 'l', 'Lácteos', now(), now()),
  ('70000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000013', 'h-leche', 'Leche entera Hacendado 1 L', 'Hacendado', 1, 'l', 'Lácteos', now(), now()),
  ('70000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', 'dia-leche', 'Leche entera DIA 1 L', 'DIA', 1, 'l', 'Lácteos', now(), now()),
  ('70000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'dia-low', 'Leche baja en lactosa DIA', 'DIA', 1, 'l', 'Lácteos', now(), now());

update public.retailer_product_concepts
set status = 'PROPOSED', confidence = 'LOW', reviewed = false, reviewed_at = null
where retailer_product_id = '70000000-0000-4000-8000-000000000034';

insert into public.product_offers (
  retailer_id, retailer_product_id, market_id, normal_price, promo_price,
  price_per_unit, reference_unit, promotion_type, promotion_text,
  requires_membership, available, observed_at
)
values
  ('00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000031', '70000000-0000-4000-8000-000000000011', 1.20, 1.00, 1.00, 'l', 'fixed_price', 'Oferta', false, true, now()),
  ('00000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000032', '70000000-0000-4000-8000-000000000013', 1.10, null, 1.10, 'l', null, null, false, true, now() - interval '7 hours'),
  ('00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000033', '70000000-0000-4000-8000-000000000012', 9.99, null, 9.99, 'l', null, null, false, true, now()),
  ('00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000034', '70000000-0000-4000-8000-000000000011', 1.30, null, 1.30, 'l', null, null, false, true, now());

select set_config('request.jwt.claims', '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

select extensions.is(
  public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera')->0->'concept'->>'name',
  'Leche',
  'exact product wording resolves to its broad concept'
);

select extensions.is(
  public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'lechee')->0->'concept'->>'name',
  'Leche',
  'a small typo still finds the concept'
);

select extensions.is(
  jsonb_array_length(public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'producto inexistente')),
  0,
  'an unknown query returns no results'
);

select extensions.is(
  jsonb_array_length(public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera')->0->'offers'),
  2,
  'one query returns offers from multiple applicable retailers'
);

select extensions.ok(
  not jsonb_path_exists(
    public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera'),
    '$[*].offers[*] ? (@.market.externalId == "dia-barcelona")'
  ),
  'offers from a market mapped to another postal code are excluded'
);

select extensions.is(
  jsonb_path_query_first(
    public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera'),
    '$[*].offers[*] ? (@.retailer.code == "MERCADONA").freshness'
  ) #>> '{}',
  'STALE',
  'offer freshness reuses the central six-hour staleness policy'
);

select extensions.ok(
  jsonb_path_exists(
    public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera'),
    '$[*].retailerProducts[*] ? (@.classificationConfidence == "HIGH" && @.standard == true)'
  ),
  'search exposes accepted standard classifications'
);

select extensions.ok(
  not jsonb_path_exists(
    public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche entera'),
    '$[*].retailerProducts[*] ? (@.id == "70000000-0000-4000-8000-000000000034")'
  ),
  'proposed classifications are not exposed as confirmed equivalents'
);

select extensions.is(
  public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche baja')->0->'concept',
  'null'::jsonb,
  'an unconfirmed SKU remains searchable without claiming concept equivalence'
);

select extensions.has_index(
  'public', 'retailer_products', 'retailer_products_search_name_trgm_idx',
  'the retailer text query has a matching partial trigram index'
);

select set_config('request.jwt.claims', '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}', true);

select extensions.throws_ok(
  $$select public.search_products_for_list('70000000-0000-4000-8000-000000000002', 'leche')$$,
  '42501',
  'Not authorized for this shopping list',
  'a user without list access cannot use its market context'
);

select * from extensions.finish();

rollback;
