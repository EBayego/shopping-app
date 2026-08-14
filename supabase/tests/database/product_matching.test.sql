begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.has_table('public', 'product_concepts', 'product concepts are stored independently from retailer SKUs');
select extensions.has_table('public', 'retailer_product_concepts', 'retailer SKUs are classified under concepts');
select extensions.has_index(
  'public', 'product_concepts', 'product_concepts_normalized_name_trgm_idx',
  'concept names have a trigram search index'
);
select extensions.has_column('public', 'product_concepts', 'aliases', 'concept aliases are persisted');
select extensions.has_column('public', 'product_concepts', 'selection_policy', 'each concept owns its selection policy');

insert into public.retailer_markets (id, retailer_id, external_id, name)
select '10000000-0000-4000-8000-000000000001', id, 'classification-test-market', 'Classification test market'
from public.retailers where code = 'DIA';

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, brand, package_size,
  package_unit, category, observed_at, last_seen_at
)
select product.id, retailer.id, '10000000-0000-4000-8000-000000000001',
  product.external_id, product.name, 'DIA', product.package_size,
  product.package_unit, product.category, now(), now()
from public.retailers retailer
cross join (values
  ('20000000-0000-4000-8000-000000000001'::uuid, 'milk-standard', 'Leche semidesnatada DIA 1 L', 1::numeric, 'l', 'Leche'),
  ('20000000-0000-4000-8000-000000000002'::uuid, 'milk-special', 'Leche sin lactosa DIA 1 L', 1::numeric, 'l', 'Leche'),
  ('20000000-0000-4000-8000-000000000003'::uuid, 'body-milk', 'Leche corporal hidratante', 400::numeric, 'ml', 'Higiene corporal'),
  ('20000000-0000-4000-8000-000000000004'::uuid, 'weak-name', 'Leche experimental', 1::numeric, 'l', 'Otros')
) product(id, external_id, name, package_size, package_unit, category)
where retailer.code = 'DIA';

select extensions.is(
  (select count(*) from public.product_concepts), 5::bigint,
  'the first five broad shopping concepts are seeded'
);
select extensions.is(
  (select product_concept_id from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'catalog ingestion classifies ordinary milk automatically'
);
select extensions.is(
  (select status from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000001'),
  'ACCEPTED', 'high-confidence classifications are immediately usable'
);
select extensions.is(
  (select is_standard from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000001'),
  true, 'ordinary milk is a standard candidate'
);
select extensions.is(
  (select is_standard from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000002'),
  false, 'specialty variants are retained but marked non-standard'
);
select extensions.is(
  (select count(*) from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000003'),
  0::bigint, 'excluded terms prevent body-care false positives'
);
select extensions.is(
  (select status from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000004'),
  'PROPOSED', 'weak name-only evidence is queued for review'
);

select extensions.lives_ok(
  $$select * from public.accept_retailer_product_concept((select id from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000004'))$$,
  'a proposed classification can be accepted'
);
select extensions.is(
  (select reviewed from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000004'),
  true, 'manual acceptance records review state'
);
select extensions.lives_ok(
  $$select * from public.change_retailer_product_concept(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000004',
    'MANUAL', 1, 'HIGH', '[]'::jsonb, true
  )$$,
  'a retailer SKU can be reassigned atomically'
);
select extensions.is(
  (select product_concept_id from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000004' and status = 'ACCEPTED'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'reassignment leaves one accepted target concept'
);
select extensions.is(
  (select count(*) from public.retailer_product_concepts where retailer_product_id = '20000000-0000-4000-8000-000000000004' and status = 'ACCEPTED'),
  1::bigint, 'only one accepted classification can exist per retailer SKU'
);

select * from extensions.finish();
rollback;
