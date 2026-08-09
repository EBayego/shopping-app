begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(21);

select extensions.has_extension('pg_trgm', 'pg_trgm is enabled for candidate retrieval');

select extensions.has_index(
  'public',
  'canonical_products',
  'canonical_products_normalized_name_trgm_idx',
  'canonical product names have a targeted trigram index'
);

insert into public.retailer_markets (id, retailer_id, external_id, name)
select
  '10000000-0000-4000-8000-000000000001',
  id,
  'matching-test-market',
  'Matching test market'
from public.retailers
where code = 'DIA';

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, brand, package_size,
  package_unit, category, observed_at, last_seen_at
)
select
  product.id, retailer.id, '10000000-0000-4000-8000-000000000001',
  product.external_id, product.name, product.brand, product.package_size,
  product.package_unit, product.category, now(), now()
from public.retailers retailer
cross join (values
  ('20000000-0000-4000-8000-000000000001'::uuid, 'dia-milk', 'Leche semidesnatada Dia Lactea 1 L', 'DIA Lactea', 1::numeric, 'l', 'Leche'),
  ('20000000-0000-4000-8000-000000000002'::uuid, 'dia-cola', 'Coca-Cola Zero 2 L', 'Coca-Cola', 2::numeric, 'l', 'Refrescos')
) product(id, external_id, name, brand, package_size, package_unit, category)
where retailer.code = 'DIA';

insert into public.canonical_products (
  id, name, normalized_name, base_name, category, normalized_category,
  brand, normalized_brand, variant, gtin, package_size, package_unit
)
values
  (
    '30000000-0000-4000-8000-000000000001', 'Leche semidesnatada',
    'leche semidesnatada', 'leche', 'Leche', 'leche', 'Hacendado',
    'hacendado', 'semidesnatada', null, 1, 'l'
  ),
  (
    '30000000-0000-4000-8000-000000000002', 'Coca-Cola Zero',
    'coca cola zero', 'coca cola', 'Refrescos', 'refrescos', 'Coca-Cola',
    'coca cola', 'zero', '4006381333931', 2, 'l'
  );

select extensions.is(
  (
    select count(*)
    from public.search_product_match_candidates(null, 'leche semidesnatada', 'leche', 10)
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'trigram candidate retrieval finds normalized milk'
);

select extensions.is(
  (
    select id
    from public.search_product_match_candidates('4006381333931', 'nombre irrelevante', null, 10)
    limit 1
  ),
  '30000000-0000-4000-8000-000000000002'::uuid,
  'exact GTIN candidate has precedence over text'
);

insert into public.product_matches (
  id, canonical_product_id, retailer_product_id, match_type, method,
  score, confidence, reasons
)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'SUBSTITUTE', 'CATEGORY_NAME_FORMAT', 0.78, 'MEDIUM',
  '[{"feature":"brand","matched":false}]'
);

select extensions.is(
  (select status from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  'PROPOSED',
  'new candidate starts proposed'
);

select extensions.is(
  (select reviewed from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  false,
  'new candidate starts unreviewed'
);

select extensions.lives_ok(
  $$select * from public.accept_product_match('40000000-0000-4000-8000-000000000001')$$,
  'a proposed match can be accepted'
);

select extensions.is(
  (select status from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  'ACCEPTED',
  'acceptance persists accepted status'
);

select extensions.is(
  (select reviewed from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  true,
  'acceptance marks the match reviewed'
);

select extensions.ok(
  (select reviewed_at is not null from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  'acceptance records review time'
);

select extensions.lives_ok(
  $$select * from public.reject_product_match('40000000-0000-4000-8000-000000000001')$$,
  'an accepted match can be rejected'
);

select extensions.is(
  (select status from public.product_matches where id = '40000000-0000-4000-8000-000000000001'),
  'REJECTED',
  'rejection persists rejected status'
);

select extensions.lives_ok(
  $$
    select * from public.change_product_match(
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      'SUBSTITUTE', 'MANUAL', 0.7, 'MEDIUM', '[]'::jsonb
    )
  $$,
  'a retailer product association can be changed atomically'
);

select extensions.is(
  (
    select canonical_product_id
    from public.product_matches
    where retailer_product_id = '20000000-0000-4000-8000-000000000001'
      and status = 'ACCEPTED'
  ),
  '30000000-0000-4000-8000-000000000002'::uuid,
  'change accepts the replacement canonical product'
);

select extensions.is(
  (
    select count(*)
    from public.product_matches
    where retailer_product_id = '20000000-0000-4000-8000-000000000001'
      and status = 'ACCEPTED'
  ),
  1::bigint,
  'only one accepted canonical association exists per retailer SKU'
);

select extensions.throws_ok(
  $$
    insert into public.product_matches (
      canonical_product_id, retailer_product_id, match_type, method,
      score, confidence, status, reviewed, reviewed_at
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'SUBSTITUTE', 'MANUAL', 0.8, 'MEDIUM', 'ACCEPTED', true, now()
    )
  $$,
  '23505',
  null::text,
  'database prevents a second accepted association for one retailer SKU'
);

select extensions.lives_ok(
  $$
    insert into public.product_matches (
      canonical_product_id, retailer_product_id, match_type, method,
      score, confidence, reasons
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'SUBSTITUTE', 'TEXT_SIMILARITY', 0.5, 'LOW', '[]'
    )
  $$,
  'LOW confidence may be stored for review'
);

select extensions.is(
  (
    select status
    from public.product_matches
    where retailer_product_id = '20000000-0000-4000-8000-000000000002'
  ),
  'PROPOSED',
  'LOW confidence is not automatically accepted'
);

select extensions.throws_ok(
  $$
    insert into public.product_matches (
      canonical_product_id, retailer_product_id, match_type, method, score,
      confidence, status, reviewed
    ) values (
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',
      'EXACT_MATCH', 'GTIN_EXACT', 1, 'HIGH', 'ACCEPTED', false
    )
  $$,
  '23514',
  null::text,
  'accepted matches must be reviewed consistently'
);

select extensions.is(
  (
    select count(*)
    from public.product_matches
    where canonical_product_id = '30000000-0000-4000-8000-000000000002'
      and status = 'ACCEPTED'
  ),
  1::bigint,
  'equivalent-product query shape has one accepted association'
);

select extensions.is(
  (
    select method
    from public.product_matches
    where retailer_product_id = '20000000-0000-4000-8000-000000000001'
      and status = 'ACCEPTED'
  ),
  'MANUAL',
  'changed match preserves its explainable method'
);

select * from extensions.finish();

rollback;
