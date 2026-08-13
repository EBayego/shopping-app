create function public.edit_shopping_product_operation(
  operation_id uuid,
  intent_id uuid,
  raw_text text,
  normalized_name text,
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
  edited_intent jsonb;
begin
  edited_intent := public.apply_shopping_intent_operation(
    operation_id,
    'edit',
    null,
    intent_id,
    raw_text,
    normalized_name,
    null
  );

  update public.shopping_intents intent
  set requested_quantity = edit_shopping_product_operation.requested_quantity,
      requested_unit = edit_shopping_product_operation.requested_unit,
      package_count = edit_shopping_product_operation.package_count,
      package_size = edit_shopping_product_operation.package_size,
      package_unit = edit_shopping_product_operation.package_unit,
      total_amount = edit_shopping_product_operation.total_amount,
      brand_preference = nullif(btrim(edit_shopping_product_operation.brand_preference), ''),
      variant = nullif(btrim(edit_shopping_product_operation.variant), '')
  where intent.id = edit_shopping_product_operation.intent_id
  returning to_jsonb(intent) into edited_intent;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shopping item not found';
  end if;

  update private.shopping_operations operation
  set result_payload = edited_intent
  where operation.operation_id = edit_shopping_product_operation.operation_id
    and operation.actor_id = auth.uid();

  return edited_intent;
end;
$$;

revoke all on function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text
) from public, anon;
grant execute on function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text
) to authenticated;

comment on function public.edit_shopping_product_operation(
  uuid, uuid, text, text, numeric, text, integer, numeric, text, numeric, text, text
) is 'Idempotently edits every user-facing field of a shopping item.';
