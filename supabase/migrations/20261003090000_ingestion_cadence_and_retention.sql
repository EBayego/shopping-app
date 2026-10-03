-- Daily scheduler pulse, with catalog and price jobs due every 72 hours.
alter table public.ingestion_runtime_config
  drop constraint ingestion_runtime_config_positive_values;

alter table public.ingestion_runtime_config
  alter column price_refresh_interval_minutes set default 4320,
  alter column catalog_sync_interval_minutes set default 4320,
  add constraint ingestion_runtime_config_positive_values check (
    price_refresh_interval_minutes > 0
    and catalog_sync_interval_minutes >= price_refresh_interval_minutes
    and refresh_request_max_attempts > 0
    and refresh_request_retry_delay_minutes > 0
    and max_jobs_per_tick > 0
    and running_timeout_minutes > 0
  );

update public.ingestion_runtime_config
set price_refresh_interval_minutes = 4320,
    catalog_sync_interval_minutes = 4320
where singleton;

-- Start the new cadence on the first tick, including after a queue reset.
update public.provider_job_schedules
set next_run_at = now()
where enabled;

create index price_history_retention_idx
  on public.price_history (created_at, id);
create index provider_sync_runs_retention_idx
  on public.provider_sync_runs (finished_at, id)
  where status <> 'running' and finished_at is not null;
create index refresh_requests_retention_idx
  on public.refresh_requests (finished_at, id)
  where status in ('SUCCEEDED', 'FAILED') and finished_at is not null;

-- Bounded deletes avoid a large maintenance transaction or external Cron dependency.
create function private.cleanup_ingestion_history(batch_size integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
  result jsonb := '{}'::jsonb;
begin
  if batch_size is null or batch_size < 1 or batch_size > 10000 then
    raise exception using errcode = '22023',
      message = 'batch_size must be between 1 and 10000';
  end if;

  delete from public.price_history
  where id in (
    select id from public.price_history
    where created_at < now() - interval '90 days'
    order by created_at, id
    limit batch_size
    for update skip locked
  );
  get diagnostics deleted_count = row_count;
  result := result || jsonb_build_object('price_history', deleted_count);

  delete from public.provider_sync_runs
  where id in (
    select id from public.provider_sync_runs
    where status <> 'running'
      and finished_at < now() - interval '30 days'
    order by finished_at, id
    limit batch_size
    for update skip locked
  );
  get diagnostics deleted_count = row_count;
  result := result || jsonb_build_object('provider_sync_runs', deleted_count);

  delete from public.refresh_requests
  where id in (
    select id from public.refresh_requests
    where status in ('SUCCEEDED', 'FAILED')
      and finished_at < now() - interval '30 days'
    order by finished_at, id
    limit batch_size
    for update skip locked
  );
  get diagnostics deleted_count = row_count;
  result := result || jsonb_build_object('refresh_requests', deleted_count);

  delete from public.admin_audit_log
  where id in (
    select id from public.admin_audit_log
    where created_at < now() - interval '90 days'
    order by created_at, id
    limit batch_size
    for update skip locked
  );
  get diagnostics deleted_count = row_count;
  return result || jsonb_build_object('admin_audit_log', deleted_count);
end;
$$;

revoke all on function private.cleanup_ingestion_history(integer)
  from public, anon, authenticated, service_role;
comment on function private.cleanup_ingestion_history(integer) is
  'Deletes at most batch_size expired rows per table: prices/audit 90 days, completed runs/requests 30 days. Called by the scheduler; never deletes catalog, classifications, users or lists.';

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
  perform private.cleanup_ingestion_history();

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
  'Prunes expired ingestion history, atomically enqueues due provider jobs, and skips price refreshes until active products exist for the market and postal code.';

