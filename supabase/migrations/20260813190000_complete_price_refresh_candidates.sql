create or replace function public.list_price_refresh_candidates(
  target_retailer_id uuid,
  target_market_id uuid
)
returns table (
  retailer_product_external_id text,
  offer_observed_at timestamptz,
  in_active_list boolean,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.external_id,
    offer.observed_at,
    exists (
      select 1
      from public.product_matches product_match
      join public.shopping_intents intent
        on intent.canonical_product_id = product_match.canonical_product_id
       and not intent.checked
      where product_match.retailer_product_id = product.id
    ),
    null::timestamptz
  from public.retailer_products product
  left join public.product_offers offer
    on offer.retailer_product_id = product.id
   and offer.market_id = target_market_id
  where product.retailer_id = target_retailer_id
    and product.market_id = target_market_id
    and product.active
  order by product.external_id;
$$;

create function public.deactivate_retailer_products(
  target_retailer_id uuid,
  target_market_id uuid,
  target_external_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.retailer_products
  set active = false,
      updated_at = now()
  where retailer_id = target_retailer_id
    and market_id = target_market_id
    and external_id = any(coalesce(target_external_ids, array[]::text[]))
    and active;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.deactivate_retailer_products(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.deactivate_retailer_products(uuid, uuid, text[])
  to service_role;

comment on function public.deactivate_retailer_products(uuid, uuid, text[]) is
  'Deactivates products confirmed missing by a retailer detail endpoint; a later catalog observation reactivates them.';
