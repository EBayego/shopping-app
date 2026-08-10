insert into public.retailers (id, code, name, operational_status, capabilities)
values
  ('00000000-0000-4000-8000-000000000001', 'DIA', 'DIA', 'ACTIVE', array['SEARCH', 'PRICE_REFRESH']),
  ('00000000-0000-4000-8000-000000000002', 'MERCADONA', 'Mercadona', 'ACTIVE', array['CATALOG', 'PRICE_REFRESH']),
  ('00000000-0000-4000-8000-000000000003', 'ALCAMPO', 'Alcampo', 'ACTIVE', array['PRICE_REFRESH']),
  ('00000000-0000-4000-8000-000000000004', 'EROSKI', 'Eroski', 'ACTIVE', array['PRICE_REFRESH'])
on conflict (code) do update
set name = excluded.name,
    active = true,
    operational_status = excluded.operational_status,
    capabilities = excluded.capabilities;
