begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, brand, package_size,
  package_unit, package_count, total_amount, category, observed_at,
  last_seen_at, active
)
values (
  '91000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'integration-dia-milk-pack-2l', 'Leche DIA pack 2 x 1 l', 'DIA Láctea',
  1, 'l', 2, 2, 'Lácteos', now(), now(), true
);

insert into public.product_offers (
  id, retailer_id, retailer_product_id, market_id, normal_price,
  price_per_unit, reference_unit, requires_membership, available, observed_at
)
values (
  '91000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000001',
  1.80, 0.90, 'l', false, true, now()
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', '{}', '{}', true, now(), now()
);
insert into public.groups (id, name, created_by)
values (
  '91000000-0000-4000-8000-000000000002', 'Milk integration',
  '91000000-0000-4000-8000-000000000001'
);
insert into public.group_members (group_id, profile_id, role, added_by)
values (
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001', 'owner',
  '91000000-0000-4000-8000-000000000001'
);
insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values (
  '91000000-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000002', 'Compra 2 l', '50009',
  '91000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',
  true
);
set local role authenticated;

select public.add_shopping_product_operation(
  operation_id => '91000000-0000-4000-8000-000000000004',
  shopping_list_id => '91000000-0000-4000-8000-000000000003',
  raw_text => 'dos litros de leche',
  normalized_name => 'leche',
  requested_quantity => 2,
  requested_unit => 'l',
  total_amount => 2
);

select extensions.is(
  (select normalized_name from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  'leche', 'text or voice normalization persists milk'
);
select extensions.is(
  (select requested_quantity from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  2::numeric, 'requested quantity remains two'
);
select extensions.is(
  (select requested_unit from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  'l', 'requested unit remains litres'
);
select extensions.is(
  (select total_amount from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  2::numeric, 'total requested amount remains two litres'
);
select extensions.is(
  (select product_concept_id from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'the database resolves the intent to the milk concept'
);
select extensions.is(
  (select concept_resolution_method from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'),
  'EXACT_NAME', 'concept resolution records exact evidence'
);
select extensions.is(
  (select count(*) from public.retailer_product_concepts classification
    join public.retailer_products product on product.id = classification.retailer_product_id
    where classification.product_concept_id = '10000000-0000-4000-8000-000000000001'
      and classification.status = 'ACCEPTED'
      and product.market_id in (
        'd1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000002',
        'd1000000-0000-4000-8000-000000000003',
        'd1000000-0000-4000-8000-000000000004'
      )),
  5::bigint, 'catalog ingestion links all milk SKUs, including the 2 l pack'
);
select extensions.is(
  (select is_standard from public.retailer_product_concepts where retailer_product_id = '91000000-0000-4000-8000-000000000010'),
  true, 'the ordinary two-litre pack is a standard milk candidate'
);
select extensions.is(
  public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'intents'->0->>'productConceptId',
  '10000000-0000-4000-8000-000000000001',
  'comparison input keeps the resolved concept'
);
select extensions.is(
  concat_ws('|',
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'intents'->0->>'requestedQuantity',
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'intents'->0->>'requestedUnit',
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'intents'->0->>'totalAmount'
  ),
  '2|l|2', 'comparison input keeps the complete two-litre demand'
);
select extensions.is(
  jsonb_array_length(public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'candidates'),
  5, 'comparison receives every applicable classified milk offer'
);
select extensions.ok(
  jsonb_path_exists(
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003'),
    '$.candidates[*] ? (@.productId == "91000000-0000-4000-8000-000000000010" && @.packageCount == 2 && @.totalAmount == 2 && @.normalPrice == 1.80)'
  ),
  'the two-litre DIA pack reaches comparison with packaging and price intact'
);
select extensions.is(
  (select count(*) from jsonb_array_elements(
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'candidates'
  ) candidate where candidate->>'intentId' <> (
    select id::text from public.shopping_intents where shopping_list_id = '91000000-0000-4000-8000-000000000003'
  )),
  0::bigint, 'every supermarket candidate is linked to the created intent'
);
select extensions.is(
  (select count(distinct candidate->>'retailer') from jsonb_array_elements(
    public.get_basket_comparison_inputs('91000000-0000-4000-8000-000000000003')->'candidates'
  ) candidate),
  4::bigint, 'the linked candidates cover all four applicable supermarkets'
);

select * from extensions.finish();
rollback;
