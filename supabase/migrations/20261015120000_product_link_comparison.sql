-- Reuse the existing comparison and add the list's commercial choices without
-- changing global catalog classifications or the cross-retailer arithmetic.
alter function public.get_basket_comparison_inputs(uuid) set schema private;
alter function private.get_basket_comparison_inputs(uuid) rename to get_basket_comparison_base_inputs;
revoke all on function private.get_basket_comparison_base_inputs(uuid) from public, anon, authenticated;

create function public.get_basket_comparison_inputs(shopping_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inputs jsonb;
  candidates jsonb;
  linked_candidates jsonb;
  intents jsonb;
begin
  -- The base contract checks authentication and list membership.
  inputs := private.get_basket_comparison_base_inputs($1);
  select coalesce(jsonb_agg(candidate), '[]'::jsonb) into candidates
  from jsonb_array_elements(inputs->'candidates') candidate
  where not exists (
    select 1 from public.shopping_intents intent
    join public.product_offers offer on offer.id = intent.linked_offer_id
    join public.retailers retailer on retailer.id = offer.retailer_id
    where intent.id = (candidate->>'intentId')::uuid and retailer.code = candidate->>'retailer'
  );
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'intentId', intent.id, 'retailer', retailer.code, 'productId', product.id,
    'productName', product.name, 'brand', product.brand,
    'classificationConfidence', 'HIGH', 'classificationAccepted', true, 'standard', true,
    'packageCount', product.package_count, 'packageSize', product.package_size,
    'packageUnit', product.package_unit, 'totalAmount', product.total_amount,
    'variableWeight', product.variable_weight, 'normalPrice', offer.normal_price,
    'promoPrice', offer.promo_price, 'requiresMembership', offer.requires_membership,
    'available', offer.available, 'freshness', private.offer_freshness(offer.observed_at),
    'pricePerUnit', offer.price_per_unit, 'referenceUnit', offer.reference_unit,
    'promotionText', offer.promotion_text
  ))), '[]'::jsonb) into linked_candidates
  from public.shopping_intents intent
  join public.shopping_lists list on list.id = intent.shopping_list_id
  join public.product_offers offer on offer.id = intent.linked_offer_id
  join public.retailer_products product on product.id = offer.retailer_product_id and product.active
  join public.retailers retailer on retailer.id = offer.retailer_id and retailer.active
  join public.retailer_market_postal_codes mapping on mapping.market_id = offer.market_id
    and mapping.retailer_id = offer.retailer_id and mapping.postal_code = list.postal_code
  where intent.shopping_list_id = $1 and not intent.checked;

  -- A manually selected pack is the reference for a generic count request.
  -- Explicit weights/volumes and the original text remain untouched.
  select coalesce(jsonb_agg(item || case when intent.product_link->>'source' = 'manual'
    and coalesce(intent.requested_unit, 'unit') = 'unit' and intent.package_size is null
    and coalesce(product.total_amount, product.package_size * coalesce(product.package_count, 1),
      case when product.package_unit is null then product.package_count end) is not null
    then jsonb_build_object('defaultAmount', coalesce(product.total_amount,
      product.package_size * coalesce(product.package_count, 1),
      case when product.package_unit is null then product.package_count end), 'defaultUnit', coalesce(product.package_unit, 'unit'))
    else '{}'::jsonb end order by entry.position), '[]'::jsonb) into intents
  from jsonb_array_elements(inputs->'intents') with ordinality as entry(item, position)
  join public.shopping_intents intent on intent.id = (item->>'id')::uuid
  left join public.product_offers offer on offer.id = intent.linked_offer_id
  left join public.retailer_products product on product.id = offer.retailer_product_id;
  return inputs || jsonb_build_object('intents', intents, 'candidates', candidates || linked_candidates);
end;
$$;
revoke all on function public.get_basket_comparison_inputs(uuid) from public, anon;
grant execute on function public.get_basket_comparison_inputs(uuid) to authenticated;
