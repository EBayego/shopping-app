begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

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


insert into public.shopping_intents(id, shopping_list_id, raw_text, normalized_name, requested_quantity, requested_unit)
values
  ('70000000-0000-4000-8000-000000000041', '70000000-0000-4000-8000-000000000002', 'Mi leche favorita', 'leche', 2, 'l'),
  ('70000000-0000-4000-8000-000000000042', '70000000-0000-4000-8000-000000000002', 'leche', 'leche', 2, 'l'),
  ('70000000-0000-4000-8000-000000000043', '70000000-0000-4000-8000-000000000002', 'leche', 'leche', 2, 'l'),
  ('70000000-0000-4000-8000-000000000044', '70000000-0000-4000-8000-000000000002', 'leche', 'leche', 2, 'l');

create function pg_temp.link_input(target_id uuid) returns jsonb language sql security definer as $$
  select private.shopping_link_input(item) from public.shopping_intents item where id = target_id;
$$;
insert into public.retailer_products(id, retailer_id, market_id, external_id, name, category, package_size, package_unit, observed_at, last_seen_at)
values
  ('70000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'custom-product', 'Postre especial de la casa', 'Otros', 125, 'g', now(), now()),
  ('70000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'rice', 'Arroz largo 1 kg', 'Arroz', 1, 'kg', now(), now()),
  ('70000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 'rice-drink', 'Bebida de arroz', 'Bebidas', 1, 'l', now(), now());
insert into public.product_offers(retailer_product_id, retailer_id, market_id, normal_price, observed_at)
values ('70000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', 3, now());
insert into public.shopping_intents(id, shopping_list_id, raw_text, normalized_name)
values ('70000000-0000-4000-8000-000000000045', '70000000-0000-4000-8000-000000000002', 'Mi capricho', 'capricho');
create function pg_temp.link_choice(target_id uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object('intentId', item.id, 'updatedAt', item.updated_at,
    'productId', '70000000-0000-4000-8000-000000000031', 'marketId', '70000000-0000-4000-8000-000000000011',
    'observedAt', offer.observed_at)
  from public.shopping_intents item cross join public.product_offers offer
  where item.id = target_id and offer.retailer_product_id = '70000000-0000-4000-8000-000000000031';
$$;
select set_config('request.jwt.claims', '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

select extensions.ok(exists(select 1 from public.retailer_product_concepts classification
  join public.product_concepts concept on concept.id = classification.product_concept_id
  where classification.retailer_product_id = '70000000-0000-4000-8000-000000000036'
    and classification.confidence = 'HIGH' and concept.normalized_name = 'arroz'), 'common grocery concepts classify compatible products');
select extensions.is((select count(*) from public.retailer_product_concepts where retailer_product_id = '70000000-0000-4000-8000-000000000037'),
  0::bigint, 'rice drinks are not classified as grocery rice');
select extensions.lives_ok($$select public.link_shopping_product_operation('70000000-0000-4000-8000-000000000061',
  '70000000-0000-4000-8000-000000000045', pg_temp.link_input('70000000-0000-4000-8000-000000000045'),
  '70000000-0000-4000-8000-000000000035', '70000000-0000-4000-8000-000000000011')$$,
  'manual linking supports products without a global classification');
select extensions.ok(jsonb_path_exists(public.get_basket_comparison_inputs('70000000-0000-4000-8000-000000000002'),
  '$.candidates[*] ? (@.intentId == "70000000-0000-4000-8000-000000000045" && @.productId == "70000000-0000-4000-8000-000000000035")'),
  'basket comparison honors a manually selected product without changing the global catalog');
select extensions.is((select (item->>'defaultAmount')::numeric
  from jsonb_array_elements(public.get_basket_comparison_inputs('70000000-0000-4000-8000-000000000002')->'intents') item
  where item->>'id' = '70000000-0000-4000-8000-000000000045'), 125::numeric,
  'a manually selected pack is the comparison reference for a generic request');

select extensions.is(public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000051', '70000000-0000-4000-8000-000000000041',
  pg_temp.link_input('70000000-0000-4000-8000-000000000041'),
  '70000000-0000-4000-8000-000000000031', '70000000-0000-4000-8000-000000000011'
)->'product_link'->>'productId', '70000000-0000-4000-8000-000000000031', 'manual linking stores a concrete product');
select extensions.is((select raw_text from public.shopping_intents where id = '70000000-0000-4000-8000-000000000041'),
  'Mi leche favorita', 'linking preserves the user name');
select extensions.is((select requested_quantity from public.shopping_intents where id = '70000000-0000-4000-8000-000000000041'),
  2::numeric, 'linking preserves the requested quantity');
select extensions.is(public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000051', '70000000-0000-4000-8000-000000000041',
  pg_temp.link_input('70000000-0000-4000-8000-000000000041'),
  '70000000-0000-4000-8000-000000000031', '70000000-0000-4000-8000-000000000011'
)->'product_link'->>'source', 'manual', 'replaying the same operation is idempotent');
select extensions.throws_ok($$select public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000051', '70000000-0000-4000-8000-000000000041',
  pg_temp.link_input('70000000-0000-4000-8000-000000000041'),
  '70000000-0000-4000-8000-000000000032', '70000000-0000-4000-8000-000000000013')$$,
  '22023', null, 'a reused operation cannot select a different product');
select extensions.throws_ok($$update public.shopping_intents set product_link = '{}' where id = '70000000-0000-4000-8000-000000000041'$$,
  '42501', null, 'clients cannot forge authoritative link snapshots');
select extensions.throws_ok($$select public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000052', '70000000-0000-4000-8000-000000000041', '{}',
  '70000000-0000-4000-8000-000000000031', '70000000-0000-4000-8000-000000000011')$$,
  '22023', 'El artículo ha cambiado. Revisa el enlace.', 'a stale manual selection cannot overwrite changed input');
select extensions.throws_ok($$select public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000053', '70000000-0000-4000-8000-000000000041',
  pg_temp.link_input('70000000-0000-4000-8000-000000000041'),
  '70000000-0000-4000-8000-000000000033', '70000000-0000-4000-8000-000000000012')$$,
  '22023', null, 'products from a different postal market cannot be linked');

select public.set_shopping_list_retailer_enabled('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', false);
select extensions.throws_ok($$select public.link_shopping_product_operation(
  '70000000-0000-4000-8000-000000000054', '70000000-0000-4000-8000-000000000041',
  pg_temp.link_input('70000000-0000-4000-8000-000000000041'),
  '70000000-0000-4000-8000-000000000032', '70000000-0000-4000-8000-000000000013')$$,
  '22023', null, 'disabled retailers cannot be linked');
select extensions.ok(not jsonb_path_exists(public.get_product_link_inputs('70000000-0000-4000-8000-000000000002'),
  '$.candidates[*] ? (@.retailer == "MERCADONA")'), 'automatic candidates respect retailer selection on the server');
select extensions.ok(jsonb_path_exists(public.get_product_link_inputs('70000000-0000-4000-8000-000000000002'),
  '$.candidates[*] ? (@.marketId == "70000000-0000-4000-8000-000000000011")'), 'automatic candidates carry their exact market');
select extensions.is(public.apply_shopping_product_links('70000000-0000-4000-8000-000000000055',
  '70000000-0000-4000-8000-000000000002', jsonb_build_array(
    pg_temp.link_choice('70000000-0000-4000-8000-000000000041'),
    pg_temp.link_choice('70000000-0000-4000-8000-000000000042'),
    pg_temp.link_choice('70000000-0000-4000-8000-000000000043') || '{"updatedAt":"2000-01-01T00:00:00Z"}'::jsonb
  ))->>'applied', '1', 'batch preserves manual links and skips concurrently changed items');
select extensions.is((select product_link->>'source' from public.shopping_intents where id = '70000000-0000-4000-8000-000000000041'),
  'manual', 'manual choices survive automatic linking');
select extensions.is((select product_link->>'source' from public.shopping_intents where id = '70000000-0000-4000-8000-000000000042'),
  'automatic', 'the linked choice records its automatic origin');
select extensions.is(public.undo_shopping_product_links('70000000-0000-4000-8000-000000000056', '70000000-0000-4000-8000-000000000055'),
  1, 'undo restores the previous unlinked state');
select extensions.is(public.undo_shopping_product_links('70000000-0000-4000-8000-000000000056', '70000000-0000-4000-8000-000000000055'),
  1, 'undo replay is idempotent');
select extensions.ok((select product_link is null and linked_offer_id is null from public.shopping_intents where id = '70000000-0000-4000-8000-000000000042'),
  'undo clears both the reference and snapshot');
select extensions.is(public.apply_shopping_product_links('70000000-0000-4000-8000-000000000057',
  '70000000-0000-4000-8000-000000000002', jsonb_build_array(
    pg_temp.link_choice('70000000-0000-4000-8000-000000000042'), pg_temp.link_choice('70000000-0000-4000-8000-000000000044')
  ))->>'applied', '2', 'a later batch can link multiple items atomically');
update public.shopping_intents set checked = true where id = '70000000-0000-4000-8000-000000000042';
select extensions.is(public.undo_shopping_product_links('70000000-0000-4000-8000-000000000058', '70000000-0000-4000-8000-000000000057'),
  1, 'undo does not overwrite a later edit even inside the same database transaction');
update public.shopping_intents set requested_quantity = 3 where id = '70000000-0000-4000-8000-000000000041';
select extensions.ok((select product_link is null from public.shopping_intents where id = '70000000-0000-4000-8000-000000000041'),
  'quantity edits invalidate a prior commercial choice');
update public.shopping_lists set postal_code = '28002' where id = '70000000-0000-4000-8000-000000000002';
select extensions.ok((select product_link is null from public.shopping_intents where id = '70000000-0000-4000-8000-000000000042'),
  'changing location invalidates local commercial choices');
select set_config('request.jwt.claims', '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select extensions.throws_ok($$select public.apply_shopping_product_links('70000000-0000-4000-8000-000000000059',
  '70000000-0000-4000-8000-000000000002', '[]')$$, '42501', null, 'another user cannot auto-link this list');
select extensions.throws_ok($$select public.get_product_link_inputs('70000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'another user cannot read candidates');
select extensions.throws_ok($$select public.undo_shopping_product_links('70000000-0000-4000-8000-000000000060',
  '70000000-0000-4000-8000-000000000055')$$, '42501', null, 'another user cannot undo this batch');
reset role;
select * from extensions.finish();
rollback;
