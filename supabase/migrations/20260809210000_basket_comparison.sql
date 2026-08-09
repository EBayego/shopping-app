create function public.get_basket_comparison_inputs(shopping_list_id uuid)
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
  if shopping_list_id is null or not private.can_access_list(shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;

  with target_list as materialized (
    select id, postal_code
    from public.shopping_lists
    where id = shopping_list_id
  ),
  applicable_markets as materialized (
    select mapping.retailer_id, mapping.market_id
    from public.retailer_market_postal_codes mapping
    join target_list list on list.postal_code = mapping.postal_code
  ),
  open_intents as materialized (
    select intent.*
    from public.shopping_intents intent
    where intent.shopping_list_id = shopping_list_id
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

comment on function public.get_basket_comparison_inputs(uuid) is
  'Authorized, postal-code scoped inputs for deterministic full-retailer basket comparison. Only reviewed HIGH/MEDIUM accepted matches are returned.';
