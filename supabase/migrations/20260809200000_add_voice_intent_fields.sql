drop function public.add_shopping_product_operation(uuid, uuid, text, text, uuid);

create function public.add_shopping_product_operation(
  operation_id uuid,
  shopping_list_id uuid,
  raw_text text,
  normalized_name text,
  canonical_product_id uuid default null,
  requested_quantity numeric default null,
  requested_unit text default null,
  package_count integer default null,
  package_size numeric default null,
  package_unit text default null,
  total_amount numeric default null,
  brand_preference text default null,
  variant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_intent jsonb;
  context_claimed boolean;
  existing_context private.shopping_product_operation_context%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  insert into private.shopping_product_operation_context (
    operation_id, actor_id, canonical_product_id
  ) values (
    operation_id, auth.uid(), canonical_product_id
  )
  on conflict do nothing
  returning true into context_claimed;

  if not coalesce(context_claimed, false) then
    select * into existing_context
    from private.shopping_product_operation_context context
    where context.operation_id = add_shopping_product_operation.operation_id;

    if existing_context.actor_id <> auth.uid()
      or existing_context.canonical_product_id is distinct from canonical_product_id then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different product';
    end if;
  end if;

  created_intent := public.apply_shopping_intent_operation(
    operation_id,
    'add',
    shopping_list_id,
    null,
    raw_text,
    normalized_name,
    null
  );

  update public.shopping_intents intent
  set canonical_product_id = add_shopping_product_operation.canonical_product_id,
      requested_quantity = coalesce(add_shopping_product_operation.requested_quantity, intent.requested_quantity),
      requested_unit = add_shopping_product_operation.requested_unit,
      package_count = add_shopping_product_operation.package_count,
      package_size = add_shopping_product_operation.package_size,
      package_unit = add_shopping_product_operation.package_unit,
      total_amount = add_shopping_product_operation.total_amount,
      brand_preference = nullif(btrim(add_shopping_product_operation.brand_preference), ''),
      variant = nullif(btrim(add_shopping_product_operation.variant), '')
  where intent.id = (created_intent ->> 'id')::uuid
    and intent.shopping_list_id = add_shopping_product_operation.shopping_list_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shopping item not found';
  end if;

  select to_jsonb(intent)
  into created_intent
  from public.shopping_intents intent
  where intent.id = (created_intent ->> 'id')::uuid;

  return created_intent;
end;
$$;

revoke all on function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text
) from public, anon;
grant execute on function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text
) to authenticated;

comment on function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text
) is 'Idempotently adds a free, searched or voice-parsed shopping item.';

