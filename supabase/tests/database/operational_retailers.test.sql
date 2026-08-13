begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

select extensions.is(
  (select count(*)::integer from public.retailers where code in ('DIA', 'MERCADONA', 'ALCAMPO', 'EROSKI')),
  4,
  'all operational retailers exist independently from catalog fixtures'
);

select extensions.is(
  (select capabilities from public.retailers where code = 'DIA'),
  array['SEARCH', 'CATALOG', 'PRICE_REFRESH']::text[],
  'DIA exposes its confirmed search, catalog and price refresh capabilities'
);

select extensions.is(
  (select capabilities from public.retailers where code = 'MERCADONA'),
  array['CATALOG', 'PRICE_REFRESH']::text[],
  'Mercadona supports catalog ingestion'
);

select extensions.is(
  (select capabilities from public.retailers where code = 'ALCAMPO'),
  array['CATALOG', 'PRICE_REFRESH']::text[],
  'Alcampo supports catalog ingestion'
);

select extensions.is(
  (select capabilities from public.retailers where code = 'EROSKI'),
  array['PRICE_REFRESH']::text[],
  'Eroski is not advertised as a full catalog provider'
);

select extensions.is(
  (select operational_status::text from public.retailers where code = 'ALCAMPO'),
  'DEGRADED',
  'Alcampo starts degraded while retaining its catalog capability'
);

select extensions.is(
  (select operational_status::text from public.retailers where code = 'EROSKI'),
  'DEGRADED',
  'Eroski starts degraded'
);

select * from extensions.finish();

rollback;
