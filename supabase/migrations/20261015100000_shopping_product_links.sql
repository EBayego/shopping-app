-- List-specific commercial choices. The snapshot is deliberately retained offline;
-- its observedAt is displayed so it is never presented as a live quote.
alter table public.shopping_intents
  add column linked_offer_id uuid references public.product_offers(id) on delete set null,
  add column product_link jsonb,
  add constraint shopping_intents_product_link_object
    check (product_link is null or jsonb_typeof(product_link) = 'object');
create index shopping_intents_linked_offer_idx on public.shopping_intents(linked_offer_id)
  where linked_offer_id is not null;

create function private.shopping_link_input(item public.shopping_intents)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('name', item.normalized_name, 'quantity', item.requested_quantity,
    'unit', item.requested_unit, 'count', item.package_count, 'size', item.package_size,
    'packageUnit', item.package_unit, 'packageType', item.package_type, 'total', item.total_amount,
    'brand', item.brand_preference, 'variant', item.variant);
$$;

create function private.invalidate_shopping_product_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.shopping_link_input(new) is distinct from private.shopping_link_input(old)
     or (new.linked_offer_id is null and old.linked_offer_id is not null) then
    new.linked_offer_id := null;
    new.product_link := null;
  end if;
  return new;
end;
$$;
create trigger invalidate_shopping_product_link before update on public.shopping_intents
  for each row execute function private.invalidate_shopping_product_link();

create function private.invalidate_list_location_links()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.postal_code is distinct from old.postal_code then
    update public.shopping_intents set linked_offer_id = null, product_link = null
      where shopping_list_id = new.id and linked_offer_id is not null;
  end if;
  return null;
end;
$$;
create trigger invalidate_list_location_links after update of postal_code on public.shopping_lists
  for each row execute function private.invalidate_list_location_links();
-- Preference changes use the same private group channel as list changes.
create trigger broadcast_shopping_retailer_preference_changes
  after insert or update or delete on public.shopping_list_retailer_preferences
  for each row execute function private.broadcast_shopping_intent_change();

-- Authoritative offer metadata, only for selected retailers and the list's location.
create function private.shopping_product_link_snapshot(
  target_list_id uuid, target_product_id uuid, target_market_id uuid,
  link_source text, batch_id uuid default null
) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'offerId', offer.id, 'productId', product.id, 'marketId', offer.market_id,
    'productName', product.name, 'retailerId', retailer.id,
    'retailerCode', retailer.code, 'retailerName', retailer.name,
    'imageUrl', product.image_url, 'packageSize', product.package_size,
    'packageUnit', product.package_unit, 'packageCount', product.package_count,
    'price', case when offer.requires_membership or offer.promotion_type in ('multi_buy', 'membership', 'other') then offer.normal_price
                  else coalesce(offer.promo_price, offer.normal_price) end,
    'observedAt', offer.observed_at, 'source', link_source, 'batchId', batch_id,
    'approximate', coalesce(market.metadata->>'pricesMayVaryByLocation', 'false') = 'true'
                   or product.variable_weight,
    'linkedAt', now()
  )
  from public.shopping_lists list
  join public.retailer_market_postal_codes mapping on mapping.postal_code = list.postal_code
  join public.retailer_markets market on market.id = mapping.market_id
  join public.retailers retailer on retailer.id = mapping.retailer_id and retailer.active
  join public.retailer_products product on product.id = target_product_id and product.active
    and product.retailer_id = retailer.id
    and (product.market_id is null or product.market_id = mapping.market_id)
  join public.product_offers offer on offer.retailer_product_id = product.id
    and offer.market_id = mapping.market_id and offer.retailer_id = retailer.id
  left join public.shopping_list_retailer_preferences preference
    on preference.shopping_list_id = list.id and preference.retailer_id = retailer.id
  where list.id = target_list_id and mapping.market_id = target_market_id
    and coalesce(preference.enabled, true) and offer.available;
$$;

create function public.link_shopping_product_operation(
  operation_id uuid, intent_id uuid, expected_input jsonb,
  product_id uuid default null, market_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item public.shopping_intents%rowtype;
  previous private.shopping_operations%rowtype;
  request jsonb := jsonb_build_object('intentId', intent_id, 'input', expected_input,
                                     'productId', product_id, 'marketId', market_id);
  claimed boolean;
  snapshot jsonb;
  result jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if operation_id is null or expected_input is null or (product_id is null) <> (market_id is null) then
    raise exception using errcode = '22023', message = 'Invalid product link request';
  end if;
  select * into item from public.shopping_intents where id = intent_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Shopping item not found'; end if;
  if not private.can_access_list(item.shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping item';
  end if;
  insert into private.shopping_operations(operation_id, actor_id, action, request_payload)
    values ($1, auth.uid(), 'link_product', request) on conflict do nothing returning true into claimed;
  if not coalesce(claimed, false) then
    select * into previous from private.shopping_operations operation where operation.operation_id = $1;
    if previous.actor_id <> auth.uid() or previous.action <> 'link_product' or previous.request_payload <> request then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different mutation';
    end if;
    return previous.result_payload;
  end if;
  if private.shopping_link_input(item) <> expected_input then
    raise exception using errcode = '22023', message = 'El artículo ha cambiado. Revisa el enlace.';
  end if;
  if product_id is not null then
    snapshot := private.shopping_product_link_snapshot(item.shopping_list_id, product_id, market_id, 'manual');
    if snapshot is null then
      raise exception using errcode = '22023', message = 'El producto ya no está disponible en los supermercados seleccionados.';
    end if;
  end if;
  update public.shopping_intents set linked_offer_id = (snapshot->>'offerId')::uuid, product_link = snapshot
    where id = intent_id returning to_jsonb(shopping_intents.*) into result;
  update private.shopping_operations operation set result_payload = result where operation.operation_id = $1;
  return result;
end;
$$;

create function public.apply_shopping_product_links(operation_id uuid, shopping_list_id uuid, choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item public.shopping_intents%rowtype;
  previous private.shopping_operations%rowtype;
  request jsonb := jsonb_build_object('listId', shopping_list_id, 'choices', choices);
  claimed boolean;
  choice jsonb;
  snapshot jsonb;
  before_items jsonb := '[]';
  after_items jsonb := '[]';
  result jsonb;
  current_item jsonb;
begin
  if auth.uid() is null or not private.can_access_list(shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;
  if operation_id is null or choices is null or jsonb_typeof(choices) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid link choices';
  end if;
  if jsonb_array_length(choices) > 500 then
    raise exception using errcode = '22023', message = 'Too many link choices';
  end if;
  insert into private.shopping_operations(operation_id, actor_id, action, request_payload)
    values ($1, auth.uid(), 'auto_link_products', request) on conflict do nothing returning true into claimed;
  if not coalesce(claimed, false) then
    select * into previous from private.shopping_operations operation where operation.operation_id = $1;
    if previous.actor_id <> auth.uid() or previous.action <> 'auto_link_products' or previous.request_payload <> request then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different mutation';
    end if;
    return previous.result_payload;
  end if;
  -- Stable lock order avoids deadlocks between simultaneous batch operations.
  for choice in select value from jsonb_array_elements(choices) order by value->>'intentId' loop
    select * into item from public.shopping_intents
      where id = (choice->>'intentId')::uuid and shopping_intents.shopping_list_id = $2 for update;
    if not found or item.checked or item.product_link->>'source' = 'manual'
       or item.updated_at is distinct from (choice->>'updatedAt')::timestamptz then continue; end if;
    if not exists (select 1 from public.retailer_product_concepts classification
      where classification.product_concept_id = item.product_concept_id
        and classification.retailer_product_id = (choice->>'productId')::uuid
        and classification.status = 'ACCEPTED' and classification.reviewed and classification.confidence = 'HIGH') then
      continue;
    end if;
    snapshot := private.shopping_product_link_snapshot($2, (choice->>'productId')::uuid,
      (choice->>'marketId')::uuid, 'automatic', $1);
    if snapshot is null or (snapshot->>'observedAt')::timestamptz is distinct from (choice->>'observedAt')::timestamptz
      or private.offer_freshness((snapshot->>'observedAt')::timestamptz) = 'VERY_STALE' then continue; end if;
    if exists (select 1 from public.retailer_markets market where market.id = (choice->>'marketId')::uuid
      and market.metadata->>'pricesMayVaryByLocation' = 'true') then continue; end if;
    if coalesce(item.requested_unit, 'unit') = 'unit' and item.package_size is null then
      select snapshot || jsonb_build_object('referenceAmount', concept.default_amount * coalesce(item.requested_quantity, 1),
        'referenceUnit', concept.default_unit) into snapshot
      from public.product_concepts concept where concept.id = item.product_concept_id;
    end if;
    before_items := before_items || jsonb_build_array(to_jsonb(item));
    update public.shopping_intents set linked_offer_id = (snapshot->>'offerId')::uuid, product_link = snapshot
      where id = item.id returning to_jsonb(shopping_intents.*) into current_item;
    after_items := after_items || jsonb_build_array(current_item);
  end loop;
  result := jsonb_build_object('batchId', $1, 'before', before_items, 'items', after_items,
    'applied', jsonb_array_length(after_items), 'skipped', jsonb_array_length(choices) - jsonb_array_length(after_items));
  update private.shopping_operations operation set result_payload = result where operation.operation_id = $1;
  return result;
end;
$$;

create function public.undo_shopping_product_links(operation_id uuid, batch_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  batch private.shopping_operations%rowtype;
  previous private.shopping_operations%rowtype;
  old_item jsonb;
  new_item jsonb;
  affected integer := 0;
  row_count integer;
  claimed boolean;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select * into batch from private.shopping_operations operation where operation.operation_id = batch_id;
  if not found or batch.actor_id <> auth.uid() or batch.action <> 'auto_link_products'
    or not private.can_access_list((batch.request_payload->>'listId')::uuid) then
    raise exception using errcode = '42501', message = 'Not authorized for this batch';
  end if;
  if operation_id is null then raise exception using errcode = '22023', message = 'operation_id is required'; end if;
  insert into private.shopping_operations(operation_id, actor_id, action, request_payload)
    values ($1, auth.uid(), 'undo_product_links', jsonb_build_object('batchId', batch_id))
    on conflict do nothing returning true into claimed;
  if not coalesce(claimed, false) then
    select * into previous from private.shopping_operations operation where operation.operation_id = $1;
    if previous.actor_id <> auth.uid() or previous.action <> 'undo_product_links'
      or previous.request_payload <> jsonb_build_object('batchId', batch_id) then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different mutation';
    end if;
    return (previous.result_payload->>'restored')::integer;
  end if;
  for old_item in select value from jsonb_array_elements(batch.result_payload->'before') order by value->>'id' loop
    select value into new_item from jsonb_array_elements(batch.result_payload->'items') where value->>'id' = old_item->>'id';
    update public.shopping_intents set linked_offer_id = (old_item->>'linked_offer_id')::uuid,
      product_link = nullif(old_item->'product_link', 'null'::jsonb)
      where id = (old_item->>'id')::uuid
        and updated_at = (new_item->>'updated_at')::timestamptz
        and to_jsonb(shopping_intents.*) = new_item
        and product_link->>'batchId' = batch_id::text
        and ((old_item->>'linked_offer_id') is null or exists
          (select 1 from public.product_offers offer where offer.id = (old_item->>'linked_offer_id')::uuid));
    get diagnostics row_count = row_count;
    affected := affected + row_count;
  end loop;
  update private.shopping_operations operation set result_payload = jsonb_build_object('restored', affected)
    where operation.operation_id = $1;
  return affected;
end;
$$;

revoke all on function private.shopping_link_input(public.shopping_intents) from public, anon, authenticated;
revoke all on function private.invalidate_shopping_product_link() from public, anon, authenticated;
revoke all on function private.invalidate_list_location_links() from public, anon, authenticated;
revoke all on function private.shopping_product_link_snapshot(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.link_shopping_product_operation(uuid, uuid, jsonb, uuid, uuid) from public, anon;
revoke all on function public.apply_shopping_product_links(uuid, uuid, jsonb) from public, anon;
revoke all on function public.undo_shopping_product_links(uuid, uuid) from public, anon;
grant execute on function public.link_shopping_product_operation(uuid, uuid, jsonb, uuid, uuid) to authenticated;
grant execute on function public.apply_shopping_product_links(uuid, uuid, jsonb) to authenticated;
grant execute on function public.undo_shopping_product_links(uuid, uuid) to authenticated;

-- Reuse the comparison input contract, retaining the market identity for linking.
create or replace function public.get_product_link_inputs(shopping_list_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if $1 is null or not private.can_access_list($1) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;

  with target_list as materialized (
    select list.id, list.postal_code
    from public.shopping_lists list where list.id = $1
  ), applicable_markets as materialized (
    select mapping.retailer_id, mapping.market_id
    from public.retailer_market_postal_codes mapping
    join target_list list on list.postal_code = mapping.postal_code
  ), open_intents as materialized (
    select intent.* from public.shopping_intents intent
    where intent.shopping_list_id = $1 and not intent.checked
  ), eligible_classifications as materialized (
    select classification.*
    from public.retailer_product_concepts classification
    where classification.status = 'ACCEPTED'
      and classification.reviewed
      and classification.confidence in ('HIGH', 'MEDIUM')
  )
  select jsonb_build_object(
    'retailers', coalesce((
      select jsonb_agg(retailer.code order by retailer.code)
      from public.retailers retailer
      where retailer.active
        and exists (
          select 1 from applicable_markets market
          where market.retailer_id = retailer.id
        )
    ), '[]'::jsonb),
    'intents', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', intent.id,
        'name', intent.raw_text, 'normalizedName', intent.normalized_name, 'updatedAt', intent.updated_at, 'linkSource', intent.product_link->>'source',
        'productConceptId', intent.product_concept_id, 'conceptName', concept.normalized_name,
        'requestedQuantity', intent.requested_quantity,
        'requestedUnit', intent.requested_unit,
        'packageCount', intent.package_count,
        'packageSize', intent.package_size,
        'packageUnit', intent.package_unit,
        'totalAmount', intent.total_amount,
        'brandPreference', intent.brand_preference,
        'variant', intent.variant,
        'defaultAmount', concept.default_amount,
        'defaultUnit', concept.default_unit,
        'selectionPolicy', concept.selection_policy
      )) order by intent.created_at, intent.id)
      from open_intents intent
      left join public.product_concepts concept on concept.id = intent.product_concept_id
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'intentId', intent.id,
        'retailer', retailer.code,
        'productId', product.id, 'offerId', offer.id, 'marketId', offer.market_id, 'observedAt', offer.observed_at,
        'productName', product.name,
        'brand', product.brand,
        'classificationConfidence', classification.confidence,
        'classificationAccepted', true,
        'standard', classification.is_standard,
        'packageCount', product.package_count,
        'packageSize', product.package_size,
        'packageUnit', product.package_unit,
        'totalAmount', product.total_amount,
        'variableWeight', product.variable_weight,
        'normalPrice', offer.normal_price,
        'promoPrice', offer.promo_price,
        'requiresMembership', offer.requires_membership,
        'available', offer.available,
        'freshness', private.offer_freshness(offer.observed_at), 'locationApproximate', coalesce((select market_row.metadata->>'pricesMayVaryByLocation' = 'true' from public.retailer_markets market_row where market_row.id = offer.market_id), false),
        'pricePerUnit', offer.price_per_unit,
        'referenceUnit', offer.reference_unit,
        'promotionText', offer.promotion_text, 'promotionType', offer.promotion_type
      )) order by retailer.code, intent.created_at,
                  coalesce(offer.promo_price, offer.normal_price), product.id)
      from open_intents intent
      join eligible_classifications classification
        on classification.product_concept_id = intent.product_concept_id
      join public.retailer_products product
        on product.id = classification.retailer_product_id and product.active and not exists (select 1 from public.shopping_list_retailer_preferences preference where preference.shopping_list_id = $1 and preference.retailer_id = product.retailer_id and not preference.enabled)
      join applicable_markets market
        on market.retailer_id = product.retailer_id
       and (product.market_id is null or product.market_id = market.market_id)
      join public.product_offers offer
        on offer.retailer_product_id = product.id
       and offer.retailer_id = market.retailer_id
       and offer.market_id = market.market_id
      join public.retailers retailer
        on retailer.id = product.retailer_id and retailer.active
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;


revoke all on function public.get_product_link_inputs(uuid) from public, anon; grant execute on function public.get_product_link_inputs(uuid) to authenticated;
