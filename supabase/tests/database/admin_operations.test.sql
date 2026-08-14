begin;

select plan(47);

select has_table('public', 'refresh_requests', 'refresh request queue exists');
select has_table('public', 'admin_audit_log', 'admin audit trail exists');
select has_column('public', 'retailers', 'operational_status', 'providers have an operational status');
select has_column('public', 'retailers', 'capabilities', 'providers expose registered capabilities');
select has_function('public', 'admin_set_provider_status', array['uuid', 'provider_operational_status', 'text'], 'provider status RPC exists');
select has_function('public', 'admin_request_refresh', array['uuid', 'refresh_request_type', 'text', 'text[]', 'text'], 'refresh request RPC exists');
select has_function('public', 'claim_refresh_request', array['text'], 'worker claim RPC exists');
select has_function('public', 'complete_refresh_request', array['uuid', 'boolean', 'text'], 'worker completion RPC exists');
select has_function('public', 'admin_accept_product_classification', array['uuid', 'text'], 'audited accept RPC exists');
select has_function('public', 'admin_reject_product_classification', array['uuid', 'text'], 'audited reject RPC exists');
select has_function('public', 'admin_classify_retailer_product', array['uuid', 'uuid', 'boolean', 'text'], 'audited classification RPC exists');
select has_function('public', 'admin_update_product_concept', array['uuid', 'jsonb', 'text'], 'audited concept correction RPC exists');

select is((select relrowsecurity from pg_class where oid = 'public.refresh_requests'::regclass), true, 'refresh queue has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass), true, 'audit trail has RLS enabled');
select is(has_table_privilege('anon', 'public.refresh_requests', 'SELECT'), false, 'anon cannot read refresh requests');
select is(has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT'), false, 'authenticated users cannot read audit data');
select is(has_function_privilege('anon', 'public.admin_set_provider_status(uuid,provider_operational_status,text)', 'EXECUTE'), false, 'anon cannot change provider state');
select is(has_function_privilege('authenticated', 'public.admin_request_refresh(uuid,refresh_request_type,text,text[],text)', 'EXECUTE'), false, 'authenticated users cannot enqueue refreshes');
select is(has_function_privilege('service_role', 'public.admin_request_refresh(uuid,refresh_request_type,text,text[],text)', 'EXECUTE'), true, 'service role can enqueue refreshes');

insert into public.retailer_markets (id, retailer_id, external_id)
values (
  '81000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'admin-operations-market'
);

select lives_ok(
  $$select * from public.admin_set_provider_status('00000000-0000-4000-8000-000000000001', 'DISABLED', 'operator@example.com')$$,
  'admin can disable a provider'
);
select is((select operational_status::text from public.retailers where code = 'DIA'), 'DISABLED', 'disabled state is persisted');
select is((select active from public.retailers where code = 'DIA'), false, 'legacy active flag follows disabled state');
select is((select count(*) from public.retailer_markets where id = '81000000-0000-4000-8000-000000000001'), 1::bigint, 'disabling preserves provider configuration');
select is((select action from public.admin_audit_log order by id desc limit 1), 'provider.status_changed', 'provider state change is audited');

select throws_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '50009', '{}', 'operator@example.com')$$,
  '55000',
  'Disabled provider cannot accept refresh requests',
  'disabled provider rejects new work'
);
select lives_ok(
  $$select * from public.admin_set_provider_status('00000000-0000-4000-8000-000000000001', 'ACTIVE', 'operator@example.com')$$,
  'admin can reactivate a provider'
);
select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000001', 'PRICE_REFRESH', '50009', array['sku-1'], 'operator@example.com')$$,
  'supported price refresh can be queued'
);
select is((select count(*) from public.refresh_requests where status = 'PENDING'), 1::bigint, 'refresh request remains pending for a worker');
select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000004', 'CATALOG_SYNC', '50009', '{}', 'operator@example.com')$$,
  'Eroski public catalog sync can be queued'
);
select lives_ok(
  $$select * from public.admin_request_refresh('00000000-0000-4000-8000-000000000002', 'CATALOG_SYNC', '50009', '{}', 'operator@example.com')$$,
  'supported catalog sync can be queued'
);
select lives_ok($$select * from public.claim_refresh_request('worker:test')$$, 'worker can atomically claim one request');
select is((select count(*) from public.refresh_requests where status = 'RUNNING'), 1::bigint, 'exactly one request was claimed');
select lives_ok(
  $$select * from public.complete_refresh_request((select id from public.refresh_requests where status = 'RUNNING'), true, null)$$,
  'worker can complete a running request'
);
select is((select count(*) from public.refresh_requests where status = 'SUCCEEDED'), 1::bigint, 'completed request is persisted');
select ok((select count(*) >= 2 from public.admin_audit_log where action like 'refresh.%'), 'worker lifecycle is audited');

insert into public.retailer_products (
  id, retailer_id, market_id, external_id, name, observed_at, last_seen_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'admin-match-sku', 'Leche admin', now(), now()
);
update public.retailer_product_concepts
set status = 'PROPOSED', confidence = 'LOW', reviewed = false, reviewed_at = null
where retailer_product_id = '82000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select * from public.admin_accept_product_classification((select id from public.retailer_product_concepts where retailer_product_id = '82000000-0000-4000-8000-000000000001'), 'operator@example.com')$$,
  'admin accepts a classification through audited RPC'
);
select is((select status from public.retailer_product_concepts where retailer_product_id = '82000000-0000-4000-8000-000000000001'), 'ACCEPTED', 'classification is accepted');
select lives_ok(
  $$select * from public.admin_reject_product_classification((select id from public.retailer_product_concepts where retailer_product_id = '82000000-0000-4000-8000-000000000001'), 'operator@example.com')$$,
  'admin rejects a classification through audited RPC'
);
select is((select status from public.retailer_product_concepts where retailer_product_id = '82000000-0000-4000-8000-000000000001'), 'REJECTED', 'classification is rejected');
select lives_ok(
  $$select * from public.admin_classify_retailer_product('82000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true, 'operator@example.com')$$,
  'admin assigns a retailer product to another concept'
);
select is(
  (select product_concept_id from public.retailer_product_concepts where retailer_product_id = '82000000-0000-4000-8000-000000000001' and status = 'ACCEPTED'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'replacement concept is accepted'
);
select lives_ok(
  $$select * from public.admin_update_product_concept('10000000-0000-4000-8000-000000000002', '{"name":"Huevos corregidos","base_name":"huevo","aliases":["huevo","huevos"]}', 'operator@example.com')$$,
  'admin corrects a product concept'
);
select is((select name from public.product_concepts where id = '10000000-0000-4000-8000-000000000002'), 'Huevos corregidos', 'concept correction is persisted');
select ok((select count(*) >= 4 from public.admin_audit_log where action like 'product_classification.%' or action = 'product_concept.updated'), 'classification actions are audited');
select ok((select bool_and(before_data is not null and after_data is not null) from public.admin_audit_log where action in ('provider.status_changed', 'product_classification.accepted', 'product_classification.rejected', 'product_classification.assigned', 'product_concept.updated')), 'before and after data are stored where appropriate');
select throws_ok(
  $$insert into public.admin_audit_log(actor, action, entity_type, entity_id, after_data) values ('operator', 'unsafe', 'test', '1', '{"token":"do-not-store"}')$$,
  '23514',
  null::text,
  'audit trail rejects secret-shaped payloads'
);
select is((select count(*) from public.admin_audit_log where lower(coalesce(before_data::text, '') || coalesce(after_data::text, '')) ~ '"(password|secret|token|authorization|api[_-]?key|service[_-]?role)"[[:space:]]*:'), 0::bigint, 'audit trail contains no secret-shaped fields');

select * from finish();
rollback;
