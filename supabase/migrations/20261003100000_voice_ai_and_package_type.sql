-- A nullable enum occupies four bytes when present; no index, audio or AI payload is stored.
create type public.shopping_package_type as enum (
  'bottle', 'can', 'carton', 'bag', 'tray', 'jar', 'box', 'pack', 'tub', 'tube', 'jug'
);
alter table public.shopping_intents add column package_type public.shopping_package_type;

-- Replace signatures instead of overloading default arguments (PostgREST ambiguity).
drop function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text
);
create function public.add_shopping_product_operation(
  operation_id uuid, shopping_list_id uuid, raw_text text, normalized_name text,
  product_concept_id uuid default null, requested_quantity numeric default null,
  requested_unit text default null, package_count integer default null,
  package_size numeric default null, package_unit text default null,
  total_amount numeric default null, brand_preference text default null,
  variant text default null, package_type public.shopping_package_type default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  created_intent jsonb;
  context_claimed boolean;
  was_processed boolean;
  existing_context private.shopping_product_operation_context%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 1));
  select exists(select 1 from private.shopping_operations operation
    where operation.operation_id = add_shopping_product_operation.operation_id
      and operation.actor_id = auth.uid()) into was_processed;
  insert into private.shopping_product_operation_context (operation_id, actor_id, product_concept_id)
  values (operation_id, auth.uid(), product_concept_id)
  on conflict do nothing returning true into context_claimed;
  if not coalesce(context_claimed, false) then
    select * into existing_context from private.shopping_product_operation_context context
    where context.operation_id = add_shopping_product_operation.operation_id;
    if existing_context.actor_id <> auth.uid()
      or existing_context.product_concept_id is distinct from product_concept_id then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different product';
    end if;
  end if;
  created_intent := public.apply_shopping_intent_operation(
    operation_id, 'add', shopping_list_id, null, raw_text, normalized_name, null
  );
  -- A sync retry must not overwrite an item subsequently edited by another member.
  if was_processed then return created_intent; end if;
  update public.shopping_intents intent
  set product_concept_id = coalesce(add_shopping_product_operation.product_concept_id, intent.product_concept_id),
      requested_quantity = coalesce(add_shopping_product_operation.package_count, add_shopping_product_operation.requested_quantity, intent.requested_quantity),
      requested_unit = case when add_shopping_product_operation.package_count is not null then 'unit' else add_shopping_product_operation.requested_unit end,
      package_count = add_shopping_product_operation.package_count,
      package_size = add_shopping_product_operation.package_size,
      package_unit = add_shopping_product_operation.package_unit,
      package_type = add_shopping_product_operation.package_type,
      total_amount = add_shopping_product_operation.total_amount,
      brand_preference = nullif(btrim(add_shopping_product_operation.brand_preference), ''),
      variant = nullif(btrim(add_shopping_product_operation.variant), '')
  where intent.id = (created_intent ->> 'id')::uuid
    and intent.shopping_list_id = add_shopping_product_operation.shopping_list_id
  returning to_jsonb(intent) into created_intent;
  if not found then raise exception using errcode = 'P0002', message = 'Shopping item not found'; end if;
  update private.shopping_operations operation set result_payload = created_intent
  where operation.operation_id = add_shopping_product_operation.operation_id and operation.actor_id = auth.uid();
  return created_intent;
end;
$$;

drop function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text
);
create function public.edit_shopping_product_operation(
  operation_id uuid, intent_id uuid, raw_text text, normalized_name text,
  requested_quantity numeric default null, requested_unit text default null,
  package_count integer default null, package_size numeric default null,
  package_unit text default null, total_amount numeric default null,
  brand_preference text default null, variant text default null,
  package_type public.shopping_package_type default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare edited_intent jsonb; was_processed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 1));
  select exists(select 1 from private.shopping_operations operation
    where operation.operation_id = edit_shopping_product_operation.operation_id
      and operation.actor_id = auth.uid()) into was_processed;
  edited_intent := public.apply_shopping_intent_operation(
    operation_id, 'edit', null, intent_id, raw_text, normalized_name, null
  );
  if was_processed then return edited_intent; end if;
  update public.shopping_intents intent
  set requested_quantity = coalesce(edit_shopping_product_operation.package_count, edit_shopping_product_operation.requested_quantity),
      requested_unit = case when edit_shopping_product_operation.package_count is not null then 'unit' else edit_shopping_product_operation.requested_unit end,
      package_count = edit_shopping_product_operation.package_count,
      package_size = edit_shopping_product_operation.package_size,
      package_unit = edit_shopping_product_operation.package_unit,
      package_type = edit_shopping_product_operation.package_type,
      total_amount = edit_shopping_product_operation.total_amount,
      brand_preference = nullif(btrim(edit_shopping_product_operation.brand_preference), ''),
      variant = nullif(btrim(edit_shopping_product_operation.variant), '')
  where intent.id = edit_shopping_product_operation.intent_id
  returning to_jsonb(intent) into edited_intent;
  if not found then raise exception using errcode = 'P0002', message = 'Shopping item not found'; end if;
  update private.shopping_operations operation set result_payload = edited_intent
  where operation.operation_id = edit_shopping_product_operation.operation_id and operation.actor_id = auth.uid();
  return edited_intent;
end;
$$;
revoke all on function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text, public.shopping_package_type
) from public, anon;
grant execute on function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text, public.shopping_package_type
) to authenticated;
revoke all on function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text, public.shopping_package_type
) from public, anon;
grant execute on function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text, public.shopping_package_type
) to authenticated;

-- Fixed-size counters, not a growing log: at most two rows per user and two global rows.
create table private.voice_ai_usage (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('transcribe', 'extract')),
  minute_window timestamptz not null,
  minute_requests integer not null default 0,
  usage_day date not null,
  daily_requests integer not null default 0,
  primary key (actor_id, operation)
);
create table private.voice_ai_global_usage (
  operation text primary key check (operation in ('transcribe', 'extract')),
  usage_day date not null,
  daily_requests integer not null default 0
);
revoke all on table private.voice_ai_usage, private.voice_ai_global_usage from public, anon, authenticated;

create function public.consume_voice_ai_quota(actor_id uuid, operation text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_minute timestamptz := date_trunc('minute', clock_timestamp());
  current_day date := (clock_timestamp() at time zone 'UTC')::date;
  user_usage private.voice_ai_usage%rowtype;
  global_usage private.voice_ai_global_usage%rowtype;
begin
  if actor_id is null or operation is null or operation not in ('transcribe', 'extract') then
    raise exception using errcode = '22023', message = 'Invalid voice quota scope';
  end if;
  insert into private.voice_ai_global_usage values (operation, current_day, 0) on conflict do nothing;
  select * into global_usage from private.voice_ai_global_usage usage
    where usage.operation = consume_voice_ai_quota.operation for update;
  insert into private.voice_ai_usage values (actor_id, operation, current_minute, 0, current_day, 0) on conflict do nothing;
  select * into user_usage from private.voice_ai_usage usage
    where usage.actor_id = consume_voice_ai_quota.actor_id and usage.operation = consume_voice_ai_quota.operation for update;
  if global_usage.usage_day <> current_day then global_usage.daily_requests := 0; end if;
  if user_usage.usage_day <> current_day then user_usage.daily_requests := 0; end if;
  if user_usage.minute_window <> current_minute then user_usage.minute_requests := 0; end if;
  -- Count reservations (including upstream failures) to bound retries and expense.
  if user_usage.minute_requests >= 6 or user_usage.daily_requests >= 60 or global_usage.daily_requests >= 500 then return false; end if;
  update private.voice_ai_global_usage usage
    set usage_day = current_day, daily_requests = global_usage.daily_requests + 1
    where usage.operation = consume_voice_ai_quota.operation;
  update private.voice_ai_usage usage
    set minute_window = current_minute, usage_day = current_day,
        minute_requests = user_usage.minute_requests + 1, daily_requests = user_usage.daily_requests + 1
    where usage.actor_id = consume_voice_ai_quota.actor_id and usage.operation = consume_voice_ai_quota.operation;
  return true;
end;
$$;
revoke all on function public.consume_voice_ai_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_voice_ai_quota(uuid, text) to service_role;
