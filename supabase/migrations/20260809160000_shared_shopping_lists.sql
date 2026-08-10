create table private.shopping_operations (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  request_payload jsonb not null,
  result_payload jsonb,
  created_at timestamptz not null default now()
);

create index shopping_operations_actor_created_at_idx
  on private.shopping_operations (actor_id, created_at desc);

revoke all on table private.shopping_operations from public, anon, authenticated;

create function public.apply_shopping_intent_operation(
  operation_id uuid,
  action text,
  shopping_list_id uuid default null,
  intent_id uuid default null,
  raw_text text default null,
  normalized_name text default null,
  checked boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  operation_request jsonb;
  existing_operation private.shopping_operations%rowtype;
  operation_claimed boolean;
  target_list_id uuid;
  affected_intent public.shopping_intents%rowtype;
  mutation_result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id is required';
  end if;

  operation_request := jsonb_build_object(
    'shopping_list_id', shopping_list_id,
    'intent_id', intent_id,
    'raw_text', raw_text,
    'normalized_name', normalized_name,
    'checked', checked
  );

  insert into private.shopping_operations (
    operation_id,
    actor_id,
    action,
    request_payload
  )
  values (operation_id, actor_id, action, operation_request)
  on conflict do nothing
  returning true into operation_claimed;

  if not coalesce(operation_claimed, false) then
    select *
    into existing_operation
    from private.shopping_operations
    where shopping_operations.operation_id = $1;

    if existing_operation.actor_id <> actor_id
      or existing_operation.action <> action
      or existing_operation.request_payload <> operation_request then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different mutation';
    end if;

    return existing_operation.result_payload;
  end if;

  if action = 'add' then
    if shopping_list_id is null
      or nullif(btrim(raw_text), '') is null
      or nullif(btrim(normalized_name), '') is null then
      raise exception using errcode = '22023', message = 'A list, name and normalized name are required';
    end if;
    if not private.can_access_list(shopping_list_id) then
      raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
    end if;

    insert into public.shopping_intents (
      shopping_list_id,
      raw_text,
      normalized_name,
      requested_quantity,
      created_by
    )
    values (
      shopping_list_id,
      btrim(raw_text),
      btrim(normalized_name),
      1,
      actor_id
    )
    returning * into affected_intent;
  else
    if intent_id is null then
      raise exception using errcode = '22023', message = 'intent_id is required';
    end if;

    select shopping_intents.shopping_list_id
    into target_list_id
    from public.shopping_intents
    where shopping_intents.id = intent_id;

    if target_list_id is null then
      raise exception using errcode = 'P0002', message = 'Shopping item not found';
    end if;
    if not private.can_access_list(target_list_id) then
      raise exception using errcode = '42501', message = 'Not authorized for this shopping item';
    end if;

    case action
      when 'edit' then
        if nullif(btrim(raw_text), '') is null
          or nullif(btrim(normalized_name), '') is null then
          raise exception using errcode = '22023', message = 'A name and normalized name are required';
        end if;
        update public.shopping_intents
        set raw_text = btrim(apply_shopping_intent_operation.raw_text),
            normalized_name = btrim(apply_shopping_intent_operation.normalized_name)
        where id = intent_id
        returning * into affected_intent;
      when 'set_checked' then
        if checked is null then
          raise exception using errcode = '22023', message = 'checked is required';
        end if;
        update public.shopping_intents
        set checked = apply_shopping_intent_operation.checked
        where id = intent_id
        returning * into affected_intent;
      when 'increment' then
        update public.shopping_intents
        set requested_quantity = coalesce(requested_quantity, 1) + 1
        where id = intent_id
        returning * into affected_intent;
      when 'decrement' then
        update public.shopping_intents
        set requested_quantity = greatest(coalesce(requested_quantity, 1) - 1, 1)
        where id = intent_id
        returning * into affected_intent;
      when 'delete' then
        delete from public.shopping_intents
        where id = intent_id
        returning * into affected_intent;
      else
        raise exception using errcode = '22023', message = 'Unsupported shopping item action';
    end case;

    if not found then
      raise exception using errcode = 'P0002', message = 'Shopping item not found';
    end if;
  end if;

  mutation_result := to_jsonb(affected_intent);
  update private.shopping_operations as operation
  set result_payload = mutation_result
  where operation.operation_id = $1;

  return mutation_result;
end;
$$;

create function public.apply_shopping_list_operation(
  operation_id uuid,
  shopping_list_id uuid,
  name text default null,
  postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  operation_request jsonb;
  existing_operation private.shopping_operations%rowtype;
  operation_claimed boolean;
  affected_list public.shopping_lists%rowtype;
  mutation_result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if operation_id is null or shopping_list_id is null then
    raise exception using errcode = '22023', message = 'operation_id and shopping_list_id are required';
  end if;

  operation_request := jsonb_build_object(
    'shopping_list_id', shopping_list_id,
    'name', name,
    'postal_code', postal_code
  );

  insert into private.shopping_operations (operation_id, actor_id, action, request_payload)
  values (operation_id, actor_id, 'update_list', operation_request)
  on conflict do nothing
  returning true into operation_claimed;

  if not coalesce(operation_claimed, false) then
    select * into existing_operation
    from private.shopping_operations
    where shopping_operations.operation_id = $1;

    if existing_operation.actor_id <> actor_id
      or existing_operation.action <> 'update_list'
      or existing_operation.request_payload <> operation_request then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different mutation';
    end if;
    return existing_operation.result_payload;
  end if;

  if not private.can_access_list(shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;
  if name is null and postal_code is null then
    raise exception using errcode = '22023', message = 'At least one list field is required';
  end if;

  update public.shopping_lists
  set name = coalesce(nullif(btrim(apply_shopping_list_operation.name), ''), shopping_lists.name),
      postal_code = coalesce(btrim(apply_shopping_list_operation.postal_code), shopping_lists.postal_code)
  where id = shopping_list_id
  returning * into affected_list;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shopping list not found';
  end if;

  mutation_result := to_jsonb(affected_list);
  update private.shopping_operations as operation
  set result_payload = mutation_result
  where operation.operation_id = $1;

  return mutation_result;
end;
$$;

revoke all on function public.apply_shopping_intent_operation(uuid, text, uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.apply_shopping_list_operation(uuid, uuid, text, text) from public, anon;
grant execute on function public.apply_shopping_intent_operation(uuid, text, uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.apply_shopping_list_operation(uuid, uuid, text, text) to authenticated;

create policy group_members_receive_private_broadcasts
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.is_group_member(
    case
      when realtime.topic() ~ '^group:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then substring(realtime.topic() from 7)::uuid
      else null
    end
  )
);

create function private.broadcast_shopping_list_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
begin
  target_group_id := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  perform realtime.broadcast_changes(
    'group:' || target_group_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

create function private.broadcast_shopping_intent_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_list_id uuid;
  target_group_id uuid;
begin
  target_list_id := case when tg_op = 'DELETE' then old.shopping_list_id else new.shopping_list_id end;
  select group_id into target_group_id
  from public.shopping_lists
  where id = target_list_id;

  if target_group_id is not null then
    perform realtime.broadcast_changes(
      'group:' || target_group_id::text,
      tg_op,
      tg_op,
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  end if;
  return null;
end;
$$;

revoke all on function private.broadcast_shopping_list_change() from public, anon, authenticated;
revoke all on function private.broadcast_shopping_intent_change() from public, anon, authenticated;

create trigger broadcast_shopping_list_changes
after insert or update or delete on public.shopping_lists
for each row execute function private.broadcast_shopping_list_change();

create trigger broadcast_shopping_intent_changes
after insert or update or delete on public.shopping_intents
for each row execute function private.broadcast_shopping_intent_change();

comment on table private.shopping_operations is
  'Idempotency ledger for authenticated shopping-list mutations. A UUID identifies one exact request and cached result.';
comment on function public.apply_shopping_intent_operation(uuid, text, uuid, uuid, text, text, boolean) is
  'Applies an authorized atomic and idempotent shopping item mutation.';
