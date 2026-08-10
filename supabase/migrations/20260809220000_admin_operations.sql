create type public.provider_operational_status as enum (
  'ACTIVE', 'DEGRADED', 'DISABLED'
);

create type public.refresh_request_type as enum (
  'PRICE_REFRESH', 'CATALOG_SYNC'
);

create type public.refresh_request_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'
);

alter table public.retailers
  add column operational_status public.provider_operational_status not null default 'ACTIVE',
  add column capabilities text[] not null default '{}'::text[],
  add constraint retailers_active_operational_status_consistent check (
    (active and operational_status <> 'DISABLED')
    or (not active and operational_status = 'DISABLED')
  ),
  add constraint retailers_capabilities_valid check (
    capabilities <@ array['SEARCH', 'CATALOG', 'PRICE_REFRESH']::text[]
  );

update public.retailers
set operational_status = case
      when active then 'ACTIVE'::public.provider_operational_status
      else 'DISABLED'::public.provider_operational_status
    end,
    capabilities = case code
      when 'DIA' then array['SEARCH', 'PRICE_REFRESH']::text[]
      when 'MERCADONA' then array['CATALOG', 'PRICE_REFRESH']::text[]
      else '{}'::text[]
    end;

create table public.refresh_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  request_type public.refresh_request_type not null,
  postal_code text not null,
  product_ids text[] not null default '{}'::text[],
  status public.refresh_request_status not null default 'PENDING',
  requested_by text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  attempt_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint refresh_requests_postal_code_valid check (postal_code ~ '^[0-9]{5}$'),
  constraint refresh_requests_actor_not_blank check (btrim(requested_by) <> ''),
  constraint refresh_requests_product_ids_not_blank check (
    array_position(product_ids, '') is null
    and array_position(product_ids, null) is null
  ),
  constraint refresh_requests_attempt_count_nonnegative check (attempt_count >= 0),
  constraint refresh_requests_lifecycle_consistent check (
    (status = 'PENDING' and started_at is null and finished_at is null)
    or (status = 'RUNNING' and started_at is not null and finished_at is null)
    or (status in ('SUCCEEDED', 'FAILED') and started_at is not null and finished_at is not null)
  )
);

create index refresh_requests_status_requested_at_idx
  on public.refresh_requests (status, requested_at);

create unique index refresh_requests_one_open_scope_idx
  on public.refresh_requests (retailer_id, request_type, postal_code)
  where status in ('PENDING', 'RUNNING');

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_actor_not_blank check (btrim(actor) <> ''),
  constraint admin_audit_action_not_blank check (btrim(action) <> ''),
  constraint admin_audit_entity_not_blank check (
    btrim(entity_type) <> '' and btrim(entity_id) <> ''
  ),
  constraint admin_audit_no_secret_fields check (
    lower(coalesce(before_data::text, '') || coalesce(after_data::text, ''))
      !~ '"(service[_-]?role|api[_-]?key|authorization|password|secret|token)"[[:space:]]*:'
  )
);

create index admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, entity_id, created_at desc);

alter table public.refresh_requests enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on table public.refresh_requests from public, anon, authenticated;
revoke all on table public.admin_audit_log from public, anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from public, anon, authenticated;
grant select on table public.refresh_requests to service_role;
grant select on table public.admin_audit_log to service_role;

create function private.write_admin_audit(
  audit_actor text,
  audit_action text,
  audit_entity_type text,
  audit_entity_id text,
  audit_before jsonb default null,
  audit_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(audit_actor), '') is null then
    raise exception using errcode = '22023', message = 'Admin actor is required';
  end if;

  insert into public.admin_audit_log (
    actor, action, entity_type, entity_id, before_data, after_data
  ) values (
    audit_actor, audit_action, audit_entity_type, audit_entity_id,
    audit_before, audit_after
  );
end;
$$;

revoke all on function private.write_admin_audit(text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;

create function public.admin_set_provider_status(
  target_retailer_id uuid,
  target_status public.provider_operational_status,
  actor text
)
returns setof public.retailers
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  select to_jsonb(retailer.*) into before_row
  from public.retailers retailer
  where retailer.id = target_retailer_id
  for update;

  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Retailer not found';
  end if;

  update public.retailers
  set operational_status = target_status,
      active = target_status <> 'DISABLED'
  where id = target_retailer_id;

  select to_jsonb(retailer.*) into after_row
  from public.retailers retailer where retailer.id = target_retailer_id;

  perform private.write_admin_audit(
    actor, 'provider.status_changed', 'retailer', target_retailer_id::text,
    before_row, after_row
  );

  return query select * from public.retailers where id = target_retailer_id;
end;
$$;

create function public.admin_request_refresh(
  target_retailer_id uuid,
  target_request_type public.refresh_request_type,
  target_postal_code text,
  target_product_ids text[],
  actor text
)
returns setof public.refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  retailer_row public.retailers%rowtype;
  request_row public.refresh_requests%rowtype;
  required_capability text;
begin
  select * into retailer_row
  from public.retailers
  where id = target_retailer_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Retailer not found';
  end if;
  if retailer_row.operational_status = 'DISABLED' then
    raise exception using errcode = '55000', message = 'Disabled provider cannot accept refresh requests';
  end if;
  if target_postal_code is null or target_postal_code !~ '^[0-9]{5}$' then
    raise exception using errcode = '22023', message = 'A valid Spanish postal code is required';
  end if;

  required_capability := case target_request_type
    when 'PRICE_REFRESH' then 'PRICE_REFRESH'
    when 'CATALOG_SYNC' then 'CATALOG'
  end;
  if not (required_capability = any(retailer_row.capabilities)) then
    raise exception using errcode = '0A000',
      message = format('Provider %s does not support %s', retailer_row.code, target_request_type);
  end if;

  insert into public.refresh_requests (
    retailer_id, request_type, postal_code, product_ids, requested_by
  ) values (
    target_retailer_id,
    target_request_type,
    target_postal_code,
    case when target_request_type = 'PRICE_REFRESH'
      then coalesce(target_product_ids, '{}'::text[])
      else '{}'::text[]
    end,
    actor
  )
  returning * into request_row;

  perform private.write_admin_audit(
    actor, 'refresh.requested', 'refresh_request', request_row.id::text,
    null,
    jsonb_build_object(
      'retailerId', request_row.retailer_id,
      'requestType', request_row.request_type,
      'postalCode', request_row.postal_code,
      'productIds', request_row.product_ids,
      'status', request_row.status
    )
  );

  return next request_row;
end;
$$;

create function public.claim_refresh_request(claiming_worker_id text)
returns setof public.refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  claimed_row public.refresh_requests%rowtype;
begin
  if nullif(btrim(claiming_worker_id), '') is null then
    raise exception using errcode = '22023', message = 'Worker id is required';
  end if;

  select request.id into target_id
  from public.refresh_requests request
  join public.retailers retailer on retailer.id = request.retailer_id
  where request.status = 'PENDING'
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

create function public.complete_refresh_request(
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
begin
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

  update public.refresh_requests
  set status = case
        when succeeded then 'SUCCEEDED'::public.refresh_request_status
        else 'FAILED'::public.refresh_request_status
      end,
      finished_at = now(),
      error_message = case when succeeded then null else left(completion_error, 2000) end
  where id = target_request_id
  returning * into completed_row;

  perform private.write_admin_audit(
    coalesce(completed_row.worker_id, 'worker'),
    case when succeeded then 'refresh.succeeded' else 'refresh.failed' end,
    'refresh_request', completed_row.id::text,
    jsonb_build_object('status', request_row.status),
    jsonb_build_object('status', completed_row.status, 'attemptCount', completed_row.attempt_count)
  );
  return next completed_row;
end;
$$;

create function public.admin_accept_product_match(target_match_id uuid, actor text)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  select to_jsonb(match.*) into before_row
  from public.product_matches match where id = target_match_id for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Product match not found';
  end if;

  select to_jsonb(result.*) into after_row
  from public.accept_product_match(target_match_id) result;
  perform private.write_admin_audit(
    actor, 'product_match.accepted', 'product_match', target_match_id::text,
    before_row, after_row
  );
  return query select * from public.product_matches where id = target_match_id;
end;
$$;

create function public.admin_reject_product_match(target_match_id uuid, actor text)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  select to_jsonb(match.*) into before_row
  from public.product_matches match where id = target_match_id for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Product match not found';
  end if;

  select to_jsonb(result.*) into after_row
  from public.reject_product_match(target_match_id) result;
  perform private.write_admin_audit(
    actor, 'product_match.rejected', 'product_match', target_match_id::text,
    before_row, after_row
  );
  return query select * from public.product_matches where id = target_match_id;
end;
$$;

create function public.admin_reassign_product_match(
  target_match_id uuid,
  target_canonical_product_id uuid,
  actor text
)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_match public.product_matches%rowtype;
  replacement public.product_matches%rowtype;
begin
  select * into current_match
  from public.product_matches where id = target_match_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Product match not found';
  end if;
  if not exists (
    select 1 from public.canonical_products where id = target_canonical_product_id
  ) then
    raise exception using errcode = 'P0002', message = 'Canonical product not found';
  end if;

  select * into replacement
  from public.change_product_match(
    target_canonical_product_id,
    current_match.retailer_product_id,
    current_match.match_type,
    'MANUAL',
    1,
    'HIGH',
    jsonb_build_array(jsonb_build_object('reason', 'admin_reassignment'))
  );

  perform private.write_admin_audit(
    actor, 'product_match.reassigned', 'product_match', replacement.id::text,
    to_jsonb(current_match), to_jsonb(replacement)
  );
  return next replacement;
end;
$$;

create function public.admin_update_canonical_product(
  target_canonical_product_id uuid,
  changes jsonb,
  actor text
)
returns setof public.canonical_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  allowed_keys constant text[] := array[
    'name', 'base_name', 'category', 'brand', 'variant', 'gtin',
    'package_size', 'package_unit', 'package_count', 'total_amount'
  ];
begin
  if jsonb_typeof(changes) is distinct from 'object' or changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Canonical changes must be a non-empty object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(changes) key where not (key = any(allowed_keys))
  ) then
    raise exception using errcode = '22023', message = 'Canonical changes contain unsupported fields';
  end if;

  select to_jsonb(canonical.*) into before_row
  from public.canonical_products canonical
  where id = target_canonical_product_id
  for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Canonical product not found';
  end if;

  update public.canonical_products
  set name = case when changes ? 'name' then btrim(changes ->> 'name') else name end,
      normalized_name = case when changes ? 'name'
        then private.normalize_catalog_search_text(changes ->> 'name') else normalized_name end,
      base_name = case when changes ? 'base_name' then btrim(changes ->> 'base_name') else base_name end,
      category = case when changes ? 'category' then nullif(btrim(changes ->> 'category'), '') else category end,
      normalized_category = case when changes ? 'category'
        then nullif(private.normalize_catalog_search_text(changes ->> 'category'), '')
        else normalized_category end,
      brand = case when changes ? 'brand' then nullif(btrim(changes ->> 'brand'), '') else brand end,
      normalized_brand = case when changes ? 'brand'
        then nullif(private.normalize_catalog_search_text(changes ->> 'brand'), '')
        else normalized_brand end,
      variant = case when changes ? 'variant' then nullif(btrim(changes ->> 'variant'), '') else variant end,
      gtin = case when changes ? 'gtin' then nullif(btrim(changes ->> 'gtin'), '') else gtin end,
      package_size = case when changes ? 'package_size'
        then nullif(changes ->> 'package_size', '')::numeric else package_size end,
      package_unit = case when changes ? 'package_unit'
        then nullif(btrim(changes ->> 'package_unit'), '') else package_unit end,
      package_count = case when changes ? 'package_count'
        then nullif(changes ->> 'package_count', '')::integer else package_count end,
      total_amount = case when changes ? 'total_amount'
        then nullif(changes ->> 'total_amount', '')::numeric else total_amount end
  where id = target_canonical_product_id;

  select to_jsonb(canonical.*) into after_row
  from public.canonical_products canonical
  where canonical.id = target_canonical_product_id;

  perform private.write_admin_audit(
    actor, 'canonical_product.updated', 'canonical_product',
    target_canonical_product_id::text, before_row, after_row
  );
  return query select * from public.canonical_products where id = target_canonical_product_id;
end;
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.admin_set_provider_status(uuid,public.provider_operational_status,text)',
    'public.admin_request_refresh(uuid,public.refresh_request_type,text,text[],text)',
    'public.claim_refresh_request(text)',
    'public.complete_refresh_request(uuid,boolean,text)',
    'public.admin_accept_product_match(uuid,text)',
    'public.admin_reject_product_match(uuid,text)',
    'public.admin_reassign_product_match(uuid,uuid,text)',
    'public.admin_update_canonical_product(uuid,jsonb,text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

comment on table public.refresh_requests is
  'Durable admin-created queue; workers claim requests and execute provider pipelines server-side.';
comment on table public.admin_audit_log is
  'Append-only audit trail for privileged operational actions; secret-shaped payloads are rejected.';
