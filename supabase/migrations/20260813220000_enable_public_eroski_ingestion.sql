update public.retailers
set capabilities = array['SEARCH', 'CATALOG', 'PRICE_REFRESH']::text[],
    updated_at = now()
where code = 'EROSKI';

insert into public.provider_job_schedules (
  retailer_id,
  request_type,
  postal_code,
  enabled,
  next_run_at
)
select
  retailer.id,
  request_kind.request_type,
  scope.postal_code,
  true,
  now()
from public.retailers retailer
cross join (
  values
    ('CATALOG_SYNC'::public.refresh_request_type),
    ('PRICE_REFRESH'::public.refresh_request_type)
) request_kind(request_type)
cross join (
  select distinct postal_code from public.shopping_lists
  union
  select distinct postal_code from public.retailer_market_postal_codes
  union
  select distinct postal_code from public.provider_job_schedules
) scope
where retailer.code = 'EROSKI'
on conflict (retailer_id, request_type, postal_code)
do update set enabled = true,
              next_run_at = least(public.provider_job_schedules.next_run_at, now()),
              updated_at = now();

comment on table public.retailers is
  'Operational provider registry. Eroski uses its anonymous public default grocery shop, so its prices may vary by location.';
