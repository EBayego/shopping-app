-- Local/demo-only catalog. These deterministic fixtures make search and basket
-- comparison reproducible without contacting retailer services. `supabase db
-- push` does not run seeds, so these rows are never mixed into staging or
-- production unless an operator explicitly runs this file (which must not be
-- done outside a disposable demo project).

insert into public.retailer_markets (id, retailer_id, external_id, name, metadata)
values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'demo:50009', 'DIA demo Zaragoza', '{"fixture":true}'),
  ('d1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'demo:warehouse:50009', 'Mercadona demo Zaragoza', '{"fixture":true}'),
  ('d1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'demo:50009', 'Alcampo demo Zaragoza', '{"fixture":true}'),
  ('d1000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'demo:50009', 'Eroski demo Zaragoza', '{"fixture":true}')
on conflict (retailer_id, external_id) do update
set name = excluded.name,
    metadata = excluded.metadata;

insert into public.retailer_market_postal_codes (retailer_id, market_id, postal_code)
values
  ('00000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', '50009'),
  ('00000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', '50009'),
  ('00000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', '50009'),
  ('00000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', '50009')
on conflict (retailer_id, postal_code) do update
set market_id = excluded.market_id;

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, brand, package_size,
  package_unit, package_count, total_amount, category, raw_data, observed_at,
  last_seen_at, active
)
values
  ('d3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'demo-dia-leche-semi-1l', 'Leche semidesnatada DIA 1 l', 'DIA Láctea', 1, 'l', 1, 1, 'Lácteos', '{"fixture":true}', now(), now(), true),
  ('d3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'demo-mercadona-leche-semi-1l', 'Leche semidesnatada Hacendado 1 l', 'Hacendado', 1, 'l', 1, 1, 'Lácteos', '{"fixture":true}', now() - interval '7 hours', now(), true),
  ('d3000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'demo-alcampo-leche-semi-1l', 'Leche semidesnatada Auchan 1 l', 'Auchan', 1, 'l', 1, 1, 'Lácteos', '{"fixture":true}', now() - interval '30 hours', now(), true),
  ('d3000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', 'demo-eroski-leche-semi-1l', 'Leche semidesnatada Eroski 1 l', 'Eroski', 1, 'l', 1, 1, 'Lácteos', '{"fixture":true}', now(), now(), true)
on conflict (id) do update
set name = excluded.name,
    brand = excluded.brand,
    raw_data = excluded.raw_data,
    observed_at = excluded.observed_at,
    last_seen_at = excluded.last_seen_at,
    active = true;

insert into public.product_offers (
  id, retailer_id, retailer_product_id, market_id, normal_price, promo_price,
  price_per_unit, reference_unit, promotion_type, promotion_text,
  requires_membership, available, observed_at
)
values
  ('d4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 1.09, 0.95, 0.95, 'l', 'fixed_price', 'Precio demo promocional', false, true, now()),
  ('d4000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 1.02, null, 1.02, 'l', null, null, false, true, now() - interval '7 hours'),
  ('d4000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 1.15, 0.89, 0.89, 'l', 'membership', 'Precio demo con club', true, true, now() - interval '30 hours'),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', 1.05, null, 1.05, 'l', null, null, false, false, now())
on conflict (retailer_product_id, market_id) do update
set normal_price = excluded.normal_price,
    promo_price = excluded.promo_price,
    price_per_unit = excluded.price_per_unit,
    reference_unit = excluded.reference_unit,
    promotion_type = excluded.promotion_type,
    promotion_text = excluded.promotion_text,
    requires_membership = excluded.requires_membership,
    available = excluded.available,
    observed_at = excluded.observed_at;
