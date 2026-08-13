-- Retailers are operational reference data required by ingestion in every
-- environment. Demo markets, products and offers remain in seed.sql.
insert into public.retailers (
  id,
  code,
  name,
  active,
  operational_status,
  capabilities
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'DIA',
    'DIA',
    true,
    'ACTIVE',
    array['SEARCH', 'PRICE_REFRESH']
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'MERCADONA',
    'Mercadona',
    true,
    'ACTIVE',
    array['CATALOG', 'PRICE_REFRESH']
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'ALCAMPO',
    'Alcampo',
    true,
    'DEGRADED',
    array['CATALOG', 'PRICE_REFRESH']
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'EROSKI',
    'Eroski',
    true,
    'DEGRADED',
    array['PRICE_REFRESH']
  )
on conflict (code) do update
set name = excluded.name,
    capabilities = excluded.capabilities,
    updated_at = now();

comment on table public.retailers is
  'Operational provider registry provisioned by migrations in every environment; product fixtures belong in local seeds only.';
