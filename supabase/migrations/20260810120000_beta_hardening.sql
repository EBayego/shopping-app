-- Fix a runtime ambiguity reported by plpgsql_check. Keep the public parameter
-- name stable for PostgREST clients and refer to it positionally in SQL.
create or replace function public.get_basket_comparison_inputs(shopping_list_id uuid)
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
    from public.shopping_lists list
    where list.id = $1
  ),
  applicable_markets as materialized (
    select mapping.retailer_id, mapping.market_id
    from public.retailer_market_postal_codes mapping
    join target_list list on list.postal_code = mapping.postal_code
  ),
  open_intents as materialized (
    select intent.*
    from public.shopping_intents intent
    where intent.shopping_list_id = $1
      and not intent.checked
  ),
  eligible_matches as materialized (
    select match.*
    from public.product_matches match
    where match.status = 'ACCEPTED'
      and match.reviewed
      and match.confidence in ('HIGH', 'MEDIUM')
  )
  select jsonb_build_object(
    'retailers', coalesce((
      select jsonb_agg(retailer.code order by retailer.code)
      from public.retailers retailer
      where retailer.active
    ), '[]'::jsonb),
    'intents', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', intent.id,
        'name', intent.raw_text,
        'canonicalProductId', intent.canonical_product_id,
        'requestedQuantity', intent.requested_quantity,
        'requestedUnit', intent.requested_unit,
        'packageCount', intent.package_count,
        'packageSize', intent.package_size,
        'packageUnit', intent.package_unit,
        'totalAmount', intent.total_amount
      )) order by intent.created_at, intent.id)
      from open_intents intent
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'intentId', intent.id,
        'retailer', retailer.code,
        'productId', product.id,
        'productName', product.name,
        'matchConfidence', match.confidence,
        'matchAccepted', true,
        'packageCount', product.package_count,
        'packageSize', product.package_size,
        'packageUnit', product.package_unit,
        'totalAmount', product.total_amount,
        'variableWeight', product.variable_weight,
        'normalPrice', offer.normal_price,
        'promoPrice', offer.promo_price,
        'requiresMembership', offer.requires_membership,
        'available', offer.available,
        'freshness', private.offer_freshness(offer.observed_at),
        'pricePerUnit', offer.price_per_unit,
        'referenceUnit', offer.reference_unit,
        'promotionText', offer.promotion_text
      )) order by retailer.code, intent.created_at, coalesce(offer.promo_price, offer.normal_price), product.id)
      from open_intents intent
      join eligible_matches match on match.canonical_product_id = intent.canonical_product_id
      join public.retailer_products product
        on product.id = match.retailer_product_id
       and product.active
      join applicable_markets market
        on market.retailer_id = product.retailer_id
       and (product.market_id is null or product.market_id = market.market_id)
      join public.product_offers offer
        on offer.retailer_product_id = product.id
       and offer.retailer_id = market.retailer_id
       and offer.market_id = market.market_id
      join public.retailers retailer
        on retailer.id = product.retailer_id
       and retailer.active
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_basket_comparison_inputs(uuid) from public, anon;
grant execute on function public.get_basket_comparison_inputs(uuid) to authenticated;

-- A complete catalog scan may record disappearance evidence exactly once and
-- only while its own run lease is active. This blocks stale workers from
-- deactivating products after a newer observation or run.
alter table public.provider_sync_runs
  add column catalog_miss_evidence_recorded_at timestamptz;

create function public.record_catalog_product_misses_for_run(
  target_retailer_id uuid,
  target_market_id uuid,
  target_sync_run_id uuid,
  seen_external_ids text[],
  required_misses integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sync_run public.provider_sync_runs%rowtype;
  affected integer;
begin
  if required_misses < 2 then
    raise exception using errcode = '22023', message = 'required_misses must be at least 2';
  end if;
  if seen_external_ids is null or array_position(seen_external_ids, null) is not null then
    raise exception using errcode = '22023', message = 'seen_external_ids must not contain nulls';
  end if;

  select * into sync_run
  from public.provider_sync_runs run
  where run.id = target_sync_run_id
    and run.retailer_id = target_retailer_id
    and run.market_id = target_market_id
    and run.sync_type = 'catalog_sync'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Catalog sync run not found for scope';
  end if;
  if sync_run.status <> 'running' then
    raise exception using errcode = '55000', message = 'Catalog sync run is no longer active';
  end if;
  if sync_run.catalog_miss_evidence_recorded_at is not null then
    return 0;
  end if;

  update public.retailer_products product
  set consecutive_misses = product.consecutive_misses + 1,
      active = (product.consecutive_misses + 1) < required_misses
  where product.retailer_id = target_retailer_id
    and product.market_id = target_market_id
    and product.last_seen_at <= sync_run.started_at
    and not (product.external_id = any(seen_external_ids));
  get diagnostics affected = row_count;

  update public.provider_sync_runs
  set catalog_miss_evidence_recorded_at = now()
  where id = target_sync_run_id;

  return affected;
end;
$$;

revoke all on function public.record_catalog_product_misses(uuid, uuid, text[], integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_catalog_product_misses_for_run(uuid, uuid, uuid, text[], integer)
  from public, anon, authenticated;
grant execute on function public.record_catalog_product_misses_for_run(uuid, uuid, uuid, text[], integer)
  to service_role;

comment on function public.record_catalog_product_misses_for_run(uuid, uuid, uuid, text[], integer) is
  'Records disappearance evidence once for a still-running complete catalog sync; stale or repeated runs cannot deactivate products.';
