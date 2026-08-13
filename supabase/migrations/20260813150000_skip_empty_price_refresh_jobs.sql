create or replace function public.dispatch_due_provider_jobs()
returns table (enqueued_count integer, max_jobs_per_tick integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime public.ingestion_runtime_config%rowtype;
  schedule_row public.provider_job_schedules%rowtype;
  interval_minutes integer;
  dispatched integer := 0;
begin
  select * into strict runtime from public.ingestion_runtime_config where singleton;

  insert into public.provider_job_schedules (retailer_id, request_type, postal_code)
  select retailer.id, request_kind.request_type, scope.postal_code
  from public.retailers retailer
  cross join lateral (
    select 'PRICE_REFRESH'::public.refresh_request_type as request_type
    where 'PRICE_REFRESH' = any(retailer.capabilities)
    union all
    select 'CATALOG_SYNC'::public.refresh_request_type
    where 'CATALOG' = any(retailer.capabilities)
  ) request_kind
  cross join (
    select distinct postal_code from public.shopping_lists
    union
    select distinct postal_code from public.retailer_market_postal_codes
  ) scope
  where retailer.operational_status <> 'DISABLED'
  on conflict (retailer_id, request_type, postal_code) do nothing;

  for schedule_row in
    select schedule.*
    from public.provider_job_schedules schedule
    join public.retailers retailer on retailer.id = schedule.retailer_id
    where schedule.enabled
      and schedule.next_run_at <= now()
      and retailer.operational_status <> 'DISABLED'
    order by schedule.next_run_at, schedule.id
    for update of schedule skip locked
  loop
    interval_minutes := case schedule_row.request_type
      when 'PRICE_REFRESH' then runtime.price_refresh_interval_minutes
      when 'CATALOG_SYNC' then runtime.catalog_sync_interval_minutes
    end;

    if schedule_row.request_type = 'PRICE_REFRESH'
      and not exists (
        select 1
        from public.retailer_market_postal_codes mapping
        join public.retailer_products product
          on product.retailer_id = mapping.retailer_id
         and product.market_id = mapping.market_id
         and product.active
        where mapping.retailer_id = schedule_row.retailer_id
          and mapping.postal_code = schedule_row.postal_code
      ) then
      update public.provider_job_schedules
      set next_run_at = now() + make_interval(mins => interval_minutes)
      where id = schedule_row.id;
      continue;
    end if;

    begin
      insert into public.refresh_requests (
        retailer_id, request_type, postal_code, requested_by, metadata
      ) values (
        schedule_row.retailer_id,
        schedule_row.request_type,
        schedule_row.postal_code,
        'scheduler',
        jsonb_build_object('scheduleId', schedule_row.id)
      );
      dispatched := dispatched + 1;
    exception when unique_violation then
      null;
    end;

    update public.provider_job_schedules
    set last_dispatched_at = now(),
        next_run_at = now() + make_interval(mins => interval_minutes)
    where id = schedule_row.id;
  end loop;

  return query select dispatched, runtime.max_jobs_per_tick;
end;
$$;

comment on function public.dispatch_due_provider_jobs is
  'Atomically enqueues due provider jobs and skips price refreshes until an active product exists for the retailer market and postal code.';
