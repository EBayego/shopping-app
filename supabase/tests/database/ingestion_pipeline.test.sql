begin;
select plan(32);

select has_column('public', 'retailer_products', 'last_seen_at', 'products track last_seen_at');
select has_column('public', 'retailer_products', 'active', 'products track active state');
select has_function('public', 'ingest_retailer_products_batch', array['uuid', 'uuid', 'jsonb'], 'product batch RPC exists');
select has_function('public', 'ingest_product_offers_batch', array['uuid', 'uuid', 'jsonb'], 'offer batch RPC exists');
select has_function('public', 'list_price_refresh_candidates', array['uuid', 'uuid'], 'price refresh selection RPC exists');

insert into public.retailer_markets (id, retailer_id, external_id)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'test-market');

insert into public.provider_sync_runs (
  retailer_id, market_id, status, sync_type, finished_at
) values (
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'partial',
  'price_refresh',
  now()
);
select is(
  (select status::text from public.provider_sync_runs where sync_type = 'price_refresh'),
  'partial',
  'sync runs support partial completion'
);

select public.ingest_retailer_products_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"external_id":"milk-1","name":"Leche","variable_weight":false,"observed_at":"2026-08-09T10:00:00Z"}]'
);
select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.25,"available":true,"observed_at":"2026-08-09T10:00:00Z"}]'
);

select is((select count(*)::integer from public.retailer_products where external_id = 'milk-1'), 1, 'first ingestion creates one product');
select is((select count(*)::integer from public.product_offers), 1, 'first ingestion creates one offer');
select is((select count(*)::integer from public.price_history), 1, 'first offer creates one price history row');

insert into public.groups (id, name)
values ('20000000-0000-4000-8000-000000000001', 'Refresh test group');
insert into public.shopping_lists (id, group_id, name, postal_code)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Active list',
  '50009'
);
insert into public.canonical_products (id, name, normalized_name, base_name)
values ('40000000-0000-4000-8000-000000000001', 'Leche', 'leche', 'leche');
insert into public.product_matches (
  canonical_product_id, retailer_product_id, status, reviewed, reviewed_at
)
select
  '40000000-0000-4000-8000-000000000001',
  id,
  'ACCEPTED',
  true,
  now()
from public.retailer_products
where external_id = 'milk-1';
insert into public.shopping_intents (
  shopping_list_id, raw_text, normalized_name, canonical_product_id, checked
) values (
  '30000000-0000-4000-8000-000000000001',
  'leche',
  'leche',
  '40000000-0000-4000-8000-000000000001',
  false
);
select is(
  (select count(*)::integer from public.list_price_refresh_candidates(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  )),
  1,
  'known active product is a refresh candidate'
);
select is(
  (select in_active_list from public.list_price_refresh_candidates(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ) where retailer_product_external_id = 'milk-1'),
  true,
  'unchecked matched shopping intent marks a refresh candidate as active-list'
);

select public.ingest_retailer_products_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"external_id":"milk-1","name":"Leche","variable_weight":false,"observed_at":"2026-08-09T10:00:00Z"}]'
);
select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.25,"available":true,"observed_at":"2026-08-09T10:00:00Z"}]'
);

select is((select count(*)::integer from public.retailer_products where external_id = 'milk-1'), 1, 'identical ingestion does not duplicate product');
select is((select count(*)::integer from public.product_offers), 1, 'identical ingestion does not duplicate offer');
select is((select count(*)::integer from public.price_history), 1, 'identical price does not duplicate history');

select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.35,"available":false,"observed_at":"2026-08-09T11:00:00Z"}]'
);

select is((select count(*)::integer from public.price_history), 2, 'real price change appends history');
select is((select available from public.product_offers limit 1), false, 'availability is updated');
select is((select active from public.retailer_products where external_id = 'milk-1'), true, 'unavailable offer does not deactivate its retailer product');

select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.35,"available":true,"observed_at":"2026-08-09T12:00:00Z"}]'
);
select is((select count(*)::integer from public.price_history), 2, 'availability-only change does not append price history');
select is((select available from public.product_offers limit 1), true, 'availability-only change is persisted');

select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.35,"promo_price":1.10,"available":true,"observed_at":"2026-08-09T13:00:00Z"}]'
);
select is((select count(*)::integer from public.price_history), 3, 'new promotion appends price history');
select is((select promo_price from public.product_offers limit 1), 1.10::numeric, 'new promotion is persisted');

select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":1.35,"available":true,"observed_at":"2026-08-09T14:00:00Z"}]'
);
select is((select count(*)::integer from public.price_history), 4, 'promotion removal appends price history');
select ok((select promo_price is null from public.product_offers limit 1), 'promotion removal persists null');

select public.ingest_product_offers_batch(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '[{"retailer_product_external_id":"milk-1","normal_price":9.99,"promo_price":0.50,"available":false,"observed_at":"2026-08-09T13:00:00Z"}]'
);
select is((select normal_price from public.product_offers limit 1), 1.35::numeric, 'older observation cannot overwrite price');
select ok((select promo_price is null from public.product_offers limit 1), 'older observation cannot restore a removed promotion');
select is((select available from public.product_offers limit 1), true, 'older observation cannot overwrite availability');
select is((select observed_at from public.product_offers limit 1), '2026-08-09T14:00:00Z'::timestamptz, 'older observation cannot overwrite observed_at');
select is((select count(*)::integer from public.price_history), 4, 'ignored old observation does not append history');

select public.record_catalog_product_misses(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  array[]::text[],
  3
);
select is((select active from public.retailer_products where external_id = 'milk-1'), true, 'one catalog miss does not deactivate product');
select is((select consecutive_misses from public.retailer_products where external_id = 'milk-1'), 1, 'catalog miss records evidence');

select public.record_catalog_product_misses(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  array[]::text[],
  3
);
select public.record_catalog_product_misses(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  array[]::text[],
  3
);
select is((select active from public.retailer_products where external_id = 'milk-1'), false, 'three complete catalog misses deactivate product');
select is((select consecutive_misses from public.retailer_products where external_id = 'milk-1'), 3, 'deactivation retains the evidence count');

select * from finish();
rollback;
