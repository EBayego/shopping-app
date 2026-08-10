create table public.ingestion_runtime_config (
  singleton boolean primary key default true check (singleton),
  price_refresh_interval_minutes integer not null default 60,
  catalog_sync_interval_minutes integer not null default 1440,
  refresh_request_max_attempts integer not null default 3,
  refresh_request_retry_delay_minutes integer not null default 15,
  max_jobs_per_tick integer not null default 50,
  running_timeout_minutes integer not null default 120,
  updated_at timestamptz not null default now(),
  constraint ingestion_runtime_config_positive_values check (
    price_refresh_interval_minutes > 0
    and catalog_sync_interval_minutes > price_refresh_interval_minutes
    and refresh_request_max_attempts > 0
    and refresh_request_retry_delay_minutes > 0
    and max_jobs_per_tick > 0
    and running_timeout_minutes > 0
  )
);

update public.retailers
set capabilities = array_append(capabilities, 'PRICE_REFRESH')
where code in ('ALCAMPO', 'EROSKI')
  and not ('PRICE_REFRESH' = any(capabilities));

insert into public.ingestion_runtime_config (singleton) values (true);

create trigger set_ingestion_runtime_config_updated_at
before update on public.ingestion_runtime_config
for each row execute function public.set_updated_at();

create table public.provider_job_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  request_type public.refresh_request_type not null,
  postal_code text not null,
  enabled boolean not null default true,
  next_run_at timestamptz not null default now(),
  last_dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_job_schedules_postal_code_valid
    check (postal_code ~ '^[0-9]{5}$'),
  constraint provider_job_schedules_scope_key
    unique (retailer_id, request_type, postal_code)
);

create index provider_job_schedules_due_idx
  on public.provider_job_schedules (next_run_at)
  where enabled;

create trigger set_provider_job_schedules_updated_at
before update on public.provider_job_schedules
for each row execute function public.set_updated_at();

alter table public.refresh_requests
  add column next_attempt_at timestamptz not null default now();

create unique index provider_sync_runs_one_running_scope_idx
  on public.provider_sync_runs (retailer_id, market_id, sync_type)
  where status = 'running';

alter table public.ingestion_runtime_config enable row level security;
alter table public.provider_job_schedules enable row level security;
revoke all on table public.ingestion_runtime_config from public, anon, authenticated;
revoke all on table public.provider_job_schedules from public, anon, authenticated;
grant select, update on table public.ingestion_runtime_config to service_role;
grant select, insert, update, delete on table public.provider_job_schedules to service_role;

create or replace function public.claim_refresh_request(claiming_worker_id text)
returns setof public.refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  claimed_row public.refresh_requests%rowtype;
  runtime public.ingestion_runtime_config%rowtype;
begin
  if nullif(btrim(claiming_worker_id), '') is null then
    raise exception using errcode = '22023', message = 'Worker id is required';
  end if;

  select * into strict runtime from public.ingestion_runtime_config where singleton;

  update public.provider_sync_runs
  set status = 'failed',
      finished_at = now(),
      error_message = 'Execution lease expired',
      metadata = metadata || jsonb_build_object('leaseExpired', true)
  where status = 'running'
    and started_at < now() - make_interval(mins => runtime.running_timeout_minutes);

  update public.refresh_requests
  set status = case
        when attempt_count < runtime.refresh_request_max_attempts
          then 'PENDING'::public.refresh_request_status
        else 'FAILED'::public.refresh_request_status
      end,
      started_at = case
        when attempt_count < runtime.refresh_request_max_attempts then null
        else started_at
      end,
      finished_at = case
        when attempt_count < runtime.refresh_request_max_attempts then null
        else now()
      end,
      worker_id = case
        when attempt_count < runtime.refresh_request_max_attempts then null
        else worker_id
      end,
      next_attempt_at = now(),
      error_message = 'Worker lease expired'
  where status = 'RUNNING'
    and started_at < now() - make_interval(mins => runtime.running_timeout_minutes);

  select request.id into target_id
  from public.refresh_requests request
  join public.retailers retailer on retailer.id = request.retailer_id
  where request.status = 'PENDING'
    and request.next_attempt_at <= now()
    and retailer.operational_status <> 'DISABLED'
  order by request.requested_at, request.id
  for update of request skip locked
  limit 1;

  if target_id is null then
    return;
  end if;

  update public.refresh_requests
  set status = 'RUNNING',
      started_at = now(),
      worker_id = claiming_worker_id,
      attempt_count = attempt_count + 1,
      error_message = null
  where id = target_id
  returning * into claimed_row;

  perform private.write_admin_audit(
    claiming_worker_id, 'refresh.started', 'refresh_request', claimed_row.id::text,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', claimed_row.status, 'attemptCount', claimed_row.attempt_count)
  );
  return next claimed_row;
end;
$$;

create or replace function public.complete_refresh_request(
  target_request_id uuid,
  succeeded boolean,
  completion_error text default null
)
returns setof public.refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.refresh_requests%rowtype;
  completed_row public.refresh_requests%rowtype;
  runtime public.ingestion_runtime_config%rowtype;
  will_retry boolean;
begin
  select * into strict runtime from public.ingestion_runtime_config where singleton;
  select * into request_row
  from public.refresh_requests
  where id = target_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Refresh request not found';
  end if;
  if request_row.status <> 'RUNNING' then
    raise exception using errcode = '55000', message = 'Only running refresh requests can be completed';
  end if;

  will_retry := not succeeded
    and request_row.attempt_count < runtime.refresh_request_max_attempts;

  update public.refresh_requests
  set status = case
        when succeeded then 'SUCCEEDED'::public.refresh_request_status
        when will_retry then 'PENDING'::public.refresh_request_status
        else 'FAILED'::public.refresh_request_status
      end,
      started_at = case when will_retry then null else started_at end,
      finished_at = case when succeeded or not will_retry then now() else null end,
      worker_id = case when will_retry then null else worker_id end,
      next_attempt_at = case
        when will_retry then now() + make_interval(mins => runtime.refresh_request_retry_delay_minutes)
        else next_attempt_at
      end,
      error_message = case
        when succeeded then null
        else left(coalesce(completion_error, 'Refresh failed'), 2000)
      end
  where id = target_request_id
  returning * into completed_row;

  perform private.write_admin_audit(
    coalesce(request_row.worker_id, 'worker'),
    case
      when succeeded then 'refresh.succeeded'
      when will_retry then 'refresh.retry_scheduled'
      else 'refresh.failed'
    end,
    'refresh_request', completed_row.id::text,
    jsonb_build_object('status', request_row.status),
    jsonb_build_object(
      'status', completed_row.status,
      'attemptCount', completed_row.attempt_count,
      'nextAttemptAt', completed_row.next_attempt_at
    )
  );
  return next completed_row;
end;
$$;

create function public.dispatch_due_provider_jobs()
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

revoke all on function public.dispatch_due_provider_jobs() from public, anon, authenticated;
grant execute on function public.dispatch_due_provider_jobs() to service_role;

comment on table public.ingestion_runtime_config is
  'Central scheduler cadence, retry and lease configuration. The single row is operational configuration, not a secret store.';
comment on table public.provider_job_schedules is
  'Per-provider and postal-code job scopes. Rows are auto-discovered from shopping lists and known markets and may be disabled individually.';
comment on function public.dispatch_due_provider_jobs is
  'Atomically enqueues due provider jobs. Invoke from the ephemeral scheduler tick; it never calls providers itself.';
