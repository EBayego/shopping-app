begin;

select plan(25);

select is((select price_refresh_interval_minutes from public.ingestion_runtime_config), 4320, 'prices are due every 72 hours');
select is((select catalog_sync_interval_minutes from public.ingestion_runtime_config), 4320, 'catalog is due every 72 hours');
select ok(not has_function_privilege('anon', 'private.cleanup_ingestion_history(integer)', 'EXECUTE'), 'anon cannot delete history');
select ok(not has_function_privilege('authenticated', 'private.cleanup_ingestion_history(integer)', 'EXECUTE'), 'users cannot delete history');
select ok(not has_function_privilege('service_role', 'private.cleanup_ingestion_history(integer)', 'EXECUTE'), 'private cleanup is not a direct service RPC');
select ok(has_function_privilege('service_role', 'public.dispatch_due_provider_jobs()', 'EXECUTE'), 'scheduler retains dispatch permission');
select throws_ok($$select private.cleanup_ingestion_history(0)$$, '22023', 'batch_size must be between 1 and 10000', 'zero-size cleanup is rejected');
select throws_ok($$select private.cleanup_ingestion_history(10001)$$, '22023', 'batch_size must be between 1 and 10000', 'unbounded cleanup is rejected');
select throws_ok($$select private.cleanup_ingestion_history(null)$$, '22023', 'batch_size must be between 1 and 10000', 'null batch size is rejected');
select throws_ok(
  $$update public.ingestion_runtime_config set catalog_sync_interval_minutes = 1$$,
  '23514', null::text, 'catalog cannot run more frequently than prices'
);

insert into public.retailer_markets (id, retailer_id, external_id)
values ('93000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'retention-market');
insert into public.retailer_products (id, retailer_id, market_id, external_id, name, observed_at, last_seen_at)
values ('93000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001', 'retention-product', 'Leche semidesnatada', now(), now());
insert into public.product_offers (id, retailer_product_id, retailer_id, market_id, normal_price, observed_at)
values ('93000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1.25, now());

-- Two expired records per table verify both bounded cleanup and eventual drainage.
insert into public.price_history (product_offer_id, normal_price, observed_at, created_at)
select '93000000-0000-4000-8000-000000000003', 1.20, now() - interval '100 days', now() - interval '100 days'
from generate_series(1, 2);
-- Old observation arriving today must not be deleted based on observed_at.
insert into public.price_history (product_offer_id, normal_price, observed_at)
values ('93000000-0000-4000-8000-000000000003', 1.10, now() - interval '100 days');

insert into public.provider_sync_runs (retailer_id, market_id, sync_type, status, started_at, finished_at)
select '00000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
       'retention-test', state::public.provider_sync_status, now() - interval '41 days', now() - interval '40 days'
from unnest(array['succeeded', 'failed']) state;
insert into public.provider_sync_runs (retailer_id, market_id, sync_type, started_at)
values ('00000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
        'retention-running', now() - interval '40 days');
insert into public.provider_sync_runs (retailer_id, market_id, sync_type, status, started_at, finished_at)
values ('00000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001',
        'retention-recent', 'succeeded', now() - interval '2 days', now() - interval '1 day');

insert into public.refresh_requests (retailer_id, request_type, postal_code, status, requested_by, requested_at, started_at, finished_at)
select '00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', postal_code, state::public.refresh_request_status,
       'retention-test', now() - interval '41 days', now() - interval '41 days', now() - interval '40 days'
from (values ('SUCCEEDED', '59991'), ('FAILED', '59992')) fixture(state, postal_code);
insert into public.refresh_requests (retailer_id, request_type, postal_code, requested_by, requested_at)
values ('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '59993', 'retention-test', now() - interval '40 days');
insert into public.refresh_requests (retailer_id, request_type, postal_code, status, requested_by, requested_at, started_at)
values ('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '59994', 'RUNNING',
        'retention-test', now() - interval '40 days', now() - interval '40 days');
insert into public.refresh_requests (retailer_id, request_type, postal_code, status, requested_by, requested_at, started_at, finished_at)
values ('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '59995', 'SUCCEEDED',
        'retention-test', now() - interval '2 days', now() - interval '2 days', now() - interval '1 day');

insert into public.admin_audit_log (actor, action, entity_type, entity_id, created_at)
select 'retention-test', 'retention.test', 'test', 'expired', now() - interval '100 days'
from generate_series(1, 2);
insert into public.admin_audit_log (actor, action, entity_type, entity_id)
values ('retention-test', 'retention.test', 'test', 'recent');

create temporary table retention_result as select private.cleanup_ingestion_history(1) as counts;
select is((select counts from retention_result), '{"price_history":1,"provider_sync_runs":1,"refresh_requests":1,"admin_audit_log":1}'::jsonb, 'cleanup obeys per-table batch limit');
select is((select count(*) from public.price_history where product_offer_id = '93000000-0000-4000-8000-000000000003' and created_at < now() - interval '90 days'), 1::bigint, 'a bounded cleanup leaves excess expired prices for later');

select lives_ok($$select * from public.dispatch_due_provider_jobs()$$, 'daily dispatch automatically prunes remaining history');
select is((select count(*) from public.price_history where product_offer_id = '93000000-0000-4000-8000-000000000003' and created_at < now() - interval '90 days'), 0::bigint, 'expired prices are pruned');
select is((select count(*) from public.provider_sync_runs where sync_type = 'retention-test'), 0::bigint, 'expired completed runs are pruned');
select is((select count(*) from public.refresh_requests where requested_by = 'retention-test' and finished_at < now() - interval '30 days'), 0::bigint, 'expired terminal requests are pruned');
select is((select count(*) from public.admin_audit_log where actor = 'retention-test' and entity_id = 'expired'), 0::bigint, 'expired audit is pruned');
select is((select count(*) from public.provider_sync_runs where sync_type in ('retention-running', 'retention-recent')), 2::bigint, 'active and recent runs survive');
select is((select count(*) from public.refresh_requests where requested_by = 'retention-test'), 3::bigint, 'pending, running and recent terminal requests survive');
select is((select count(*) from public.admin_audit_log where actor = 'retention-test' and entity_id = 'recent'), 1::bigint, 'recent audit survives');
select is((select count(*) from public.price_history where product_offer_id = '93000000-0000-4000-8000-000000000003'), 2::bigint, 'recent price records survive, even with old observation dates');
select is((select normal_price from public.product_offers where id = '93000000-0000-4000-8000-000000000003'), 1.25::numeric, 'current offer survives cleanup');
select is((select count(*) from public.retailer_products where id = '93000000-0000-4000-8000-000000000002'), 1::bigint, 'catalog product survives cleanup');
select ok((select bool_and(next_run_at = now() + interval '72 hours') from public.provider_job_schedules where enabled), 'dispatched schedules are due again in 72 hours');
select is((select enqueued_count from public.dispatch_due_provider_jobs()), 0, 'another daily pulse does not enqueue a new full ingestion');

select * from finish();
rollback;
