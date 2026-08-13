update public.retailers
set capabilities = array[]::text[],
    updated_at = now()
where code = 'EROSKI';

update public.provider_job_schedules schedule
set enabled = false
from public.retailers retailer
where schedule.retailer_id = retailer.id
  and retailer.code = 'EROSKI';

comment on table public.retailers is
  'Operational provider registry. Eroski remains visible but exposes no ingestion capability until market resolution and public product access are reproducible.';
