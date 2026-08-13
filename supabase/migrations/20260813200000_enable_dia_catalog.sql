update public.retailers
set capabilities = array['SEARCH', 'CATALOG', 'PRICE_REFRESH']::text[],
    updated_at = now()
where code = 'DIA';

comment on table public.retailers is
  'Operational provider registry. DIA, Mercadona and Alcampo expose confirmed catalog ingestion; product fixtures remain local-only seed data.';
