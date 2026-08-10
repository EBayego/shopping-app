begin;

select plan(23);

select has_table('public', 'ingestion_runtime_config', 'central runtime configuration exists');
select has_table('public', 'provider_job_schedules', 'provider schedules exist');
select has_column('public', 'refresh_requests', 'next_attempt_at', 'refresh retries have a due time');
select has_function('public', 'dispatch_due_provider_jobs', '{}'::text[], 'scheduler dispatch RPC exists');
select is(
  (select price_refresh_interval_minutes < catalog_sync_interval_minutes from public.ingestion_runtime_config),
  true,
  'price refresh is configured more frequently than catalog sync'
);
select is(
  (select refresh_request_max_attempts from public.ingestion_runtime_config),
  3,
  'retry limit is centralized'
);

insert into public.retailer_markets (id, retailer_id, external_id)
values (
  '90000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'scheduler-lock-market'
);
insert into public.provider_sync_runs (retailer_id, market_id, sync_type)
values (
  '00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'price_refresh'
);
select throws_ok(
  $$insert into public.provider_sync_runs (retailer_id, market_id, sync_type) values ('00000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'price_refresh')$$,
  '23505',
  null::text,
  'provider, market and strategy cannot have duplicate active runs'
);
update public.provider_sync_runs
set status = 'succeeded', finished_at = now()
where market_id = '90000000-0000-4000-8000-000000000001';

insert into public.groups (id, name)
values ('91000000-0000-4000-8000-000000000001', 'Scheduled ingestion group');
insert into public.shopping_lists (id, group_id, name, postal_code)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Scheduled list',
  '50009'
);

select lives_ok(
  $$select * from public.dispatch_due_provider_jobs()$$,
  'scheduler atomically dispatches due scopes'
);
select is(
  (select count(*) from public.refresh_requests where status = 'PENDING'),
  5::bigint,
  'one independent price job per capable provider plus the catalog job is queued'
);
select is(
  (select count(*) from public.refresh_requests where request_type = 'CATALOG_SYNC'),
  1::bigint,
  'catalog is only scheduled for providers with catalog capability'
);

delete from public.refresh_requests;
delete from public.provider_job_schedules;
update public.ingestion_runtime_config
set refresh_request_max_attempts = 2,
    refresh_request_retry_delay_minutes = 1;

select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '50009', array['sku-1'], 'test')$$,
  'manual requests use the same queue'
);
select lives_ok($$select * from public.claim_refresh_request('worker:test')$$, 'first attempt is claimed');
select lives_ok(
  $$select * from public.complete_refresh_request((select id from public.refresh_requests), false, 'temporary failure')$$,
  'failed first attempt is completed'
);
select is((select status::text from public.refresh_requests), 'PENDING', 'first failure is scheduled for retry');
select is((select attempt_count from public.refresh_requests), 1, 'attempt count is persisted');
select ok((select next_attempt_at > now() from public.refresh_requests), 'retry applies the configured delay');

update public.refresh_requests set next_attempt_at = now();
select lives_ok($$select * from public.claim_refresh_request('worker:test')$$, 'retry attempt is claimed');
select lives_ok(
  $$select * from public.complete_refresh_request((select id from public.refresh_requests), false, 'permanent failure')$$,
  'last failed attempt is completed'
);
select is((select status::text from public.refresh_requests), 'FAILED', 'request fails after the configured attempt limit');

delete from public.refresh_requests;
select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000004', 'PRICE_REFRESH', '50009', '{}', 'test')$$,
  'Eroski refresh can be queued while active'
);
select * from public.admin_set_provider_status(
  '00000000-0000-4000-8000-000000000004', 'DISABLED', 'test'
);
select is(
  (select count(*) from public.claim_refresh_request('worker:test')),
  0::bigint,
  'disabled provider work is not executed'
);

select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '50009', '{}', 'test')$$,
  'degraded policy test work can be queued'
);
select * from public.admin_set_provider_status(
  '00000000-0000-4000-8000-000000000001', 'DEGRADED', 'test'
);
select is(
  (select count(*) from public.claim_refresh_request('worker:test')),
  1::bigint,
  'degraded providers still run through the existing resilience policy'
);

select * from finish();
rollback;
