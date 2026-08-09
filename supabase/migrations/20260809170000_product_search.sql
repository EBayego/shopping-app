create table private.offer_freshness_policy (
  singleton boolean primary key default true check (singleton),
  stale_after interval not null check (stale_after > interval '0 seconds'),
  very_stale_after interval not null check (very_stale_after > stale_after),
  updated_at timestamptz not null default now()
);

insert into private.offer_freshness_policy (stale_after, very_stale_after)
values (interval '6 hours', interval '24 hours');

revoke all on table private.offer_freshness_policy from public, anon, authenticated;

create function private.offer_freshness(observed_at timestamptz, evaluated_at timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when observed_at is null then 'VERY_STALE'
    when greatest(interval '0 seconds', evaluated_at - observed_at) < policy.stale_after then 'FRESH'
    when greatest(interval '0 seconds', evaluated_at - observed_at) < policy.very_stale_after then 'STALE'
    else 'VERY_STALE'
  end
  from private.offer_freshness_policy policy
  where policy.singleton;
$$;

create function public.get_offer_freshness_policy()
returns table (stale_after_ms bigint, very_stale_after_ms bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (extract(epoch from policy.stale_after) * 1000)::bigint,
    (extract(epoch from policy.very_stale_after) * 1000)::bigint
  from private.offer_freshness_policy policy
  where policy.singleton;
$$;

revoke all on function private.offer_freshness(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_offer_freshness_policy() from public, anon, authenticated;
grant execute on function public.get_offer_freshness_policy() to service_role;

create function private.normalize_catalog_search_text(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(lower(coalesce(value, '')), 'áéíóúüñç', 'aeiouunc'),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create index retailer_products_search_name_trgm_idx
  on public.retailer_products
  using gin (private.normalize_catalog_search_text(name) extensions.gin_trgm_ops)
  where active;

create function public.search_products_for_list(
  shopping_list_id uuid,
  query text,
  result_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := private.normalize_catalog_search_text(query);
  bounded_limit integer := greatest(1, least(coalesce(result_limit, 20), 50));
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if shopping_list_id is null or not private.can_access_list(shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;
  if length(normalized_query) < 2 then
    raise exception using errcode = '22023', message = 'Search query must contain at least two characters';
  end if;

  with applicable_markets as materialized (
    select mapping.market_id
    from public.shopping_lists list
    join public.retailer_market_postal_codes mapping
      on mapping.postal_code = list.postal_code
    where list.id = shopping_list_id
  ),
  canonical_hits as materialized (
    select
      canonical.id,
      case when canonical.normalized_name = normalized_query then 2.0
        else extensions.similarity(canonical.normalized_name, normalized_query)
      end as rank
    from public.canonical_products canonical
    where canonical.normalized_name = normalized_query
       or canonical.normalized_name operator(extensions.%) normalized_query
    order by rank desc, canonical.name, canonical.id
    limit bounded_limit
  ),
  retailer_hits as materialized (
    select
      product.id,
      case when private.normalize_catalog_search_text(product.name) = normalized_query then 2.0
        else extensions.similarity(private.normalize_catalog_search_text(product.name), normalized_query)
      end as rank
    from public.retailer_products product
    where product.active
      and (product.market_id is null or product.market_id in (select market_id from applicable_markets))
      and (
        private.normalize_catalog_search_text(product.name) = normalized_query
        or private.normalize_catalog_search_text(product.name) operator(extensions.%) normalized_query
      )
    order by rank desc, product.name, product.id
    limit bounded_limit
  ),
  confirmed_matches as materialized (
    select match.*
    from public.product_matches match
    where match.status = 'ACCEPTED'
      and match.confidence <> 'LOW'
  ),
  canonical_result_ids as materialized (
    select hit.id, hit.rank
    from canonical_hits hit
    union
    select match.canonical_product_id, hit.rank
    from retailer_hits hit
    join confirmed_matches match on match.retailer_product_id = hit.id
  ),
  ranked_canonical_ids as materialized (
    select id, max(rank) as rank
    from canonical_result_ids
    group by id
    order by rank desc, id
    limit bounded_limit
  ),
  canonical_results as (
    select
      ranked.rank,
      canonical.name as tie_name,
      jsonb_build_object(
        'canonicalProduct', jsonb_build_object(
          'id', canonical.id,
          'name', canonical.name,
          'normalizedName', canonical.normalized_name,
          'brand', canonical.brand,
          'category', canonical.category,
          'variant', canonical.variant,
          'gtin', canonical.gtin,
          'packageSize', canonical.package_size,
          'packageUnit', canonical.package_unit,
          'packageCount', canonical.package_count
        ),
        'retailerProducts', coalesce(products.items, '[]'::jsonb),
        'offers', coalesce(offers.items, '[]'::jsonb)
      ) as item
    from ranked_canonical_ids ranked
    join public.canonical_products canonical on canonical.id = ranked.id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', product.id,
          'retailerId', product.retailer_id,
          'externalId', product.external_id,
          'name', product.name,
          'brand', product.brand,
          'gtin', product.gtin,
          'packageSize', product.package_size,
          'packageUnit', product.package_unit,
          'packageCount', product.package_count,
          'imageUrl', product.image_url,
          'productUrl', product.product_url,
          'matchType', case match.match_type when 'EXACT_MATCH' then 'EXACT' else 'SUBSTITUTE' end,
          'matchConfidence', match.confidence
        ) order by retailer.code, product.name, product.id
      ) as items
      from confirmed_matches match
      join public.retailer_products product on product.id = match.retailer_product_id and product.active
      join public.retailers retailer on retailer.id = product.retailer_id and retailer.active
      where match.canonical_product_id = canonical.id
        and (product.market_id is null or product.market_id in (select market_id from applicable_markets))
    ) products on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'retailer', jsonb_build_object('id', retailer.id, 'code', retailer.code, 'name', retailer.name),
          'retailerProduct', jsonb_build_object(
            'id', product.id, 'externalId', product.external_id, 'name', product.name,
            'brand', product.brand, 'imageUrl', product.image_url, 'productUrl', product.product_url
          ),
          'price', coalesce(offer.promo_price, offer.normal_price),
          'normalPrice', offer.normal_price,
          'promoPrice', offer.promo_price,
          'pricePerUnit', offer.price_per_unit,
          'referenceUnit', offer.reference_unit,
          'promotion', case when offer.promotion_type is null and offer.promotion_text is null then null else
            jsonb_build_object('type', offer.promotion_type, 'text', offer.promotion_text) end,
          'requiresMembership', offer.requires_membership,
          'availability', offer.available,
          'observedAt', offer.observed_at,
          'freshness', private.offer_freshness(offer.observed_at),
          'market', jsonb_build_object('id', market.id, 'externalId', market.external_id, 'name', market.name)
        ) order by coalesce(offer.promo_price, offer.normal_price), retailer.code, product.name
      ) as items
      from confirmed_matches match
      join public.retailer_products product on product.id = match.retailer_product_id and product.active
      join public.product_offers offer on offer.retailer_product_id = product.id
      join applicable_markets applicable on applicable.market_id = offer.market_id
      join public.retailer_markets market on market.id = offer.market_id
      join public.retailers retailer on retailer.id = offer.retailer_id and retailer.active
      where match.canonical_product_id = canonical.id
    ) offers on true
  ),
  standalone_results as (
    select
      hit.rank,
      product.name as tie_name,
      jsonb_build_object(
        'canonicalProduct', null,
        'retailerProducts', jsonb_build_array(jsonb_build_object(
          'id', product.id, 'retailerId', product.retailer_id, 'externalId', product.external_id,
          'name', product.name, 'brand', product.brand, 'gtin', product.gtin,
          'packageSize', product.package_size, 'packageUnit', product.package_unit,
          'packageCount', product.package_count, 'imageUrl', product.image_url,
          'productUrl', product.product_url, 'matchType', null, 'matchConfidence', null
        )),
        'offers', coalesce(offers.items, '[]'::jsonb)
      ) as item
    from retailer_hits hit
    join public.retailer_products product on product.id = hit.id
    left join confirmed_matches match on match.retailer_product_id = product.id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'retailer', jsonb_build_object('id', retailer.id, 'code', retailer.code, 'name', retailer.name),
          'retailerProduct', jsonb_build_object(
            'id', product.id, 'externalId', product.external_id, 'name', product.name,
            'brand', product.brand, 'imageUrl', product.image_url, 'productUrl', product.product_url
          ),
          'price', coalesce(offer.promo_price, offer.normal_price),
          'normalPrice', offer.normal_price, 'promoPrice', offer.promo_price,
          'pricePerUnit', offer.price_per_unit, 'referenceUnit', offer.reference_unit,
          'promotion', case when offer.promotion_type is null and offer.promotion_text is null then null else
            jsonb_build_object('type', offer.promotion_type, 'text', offer.promotion_text) end,
          'requiresMembership', offer.requires_membership, 'availability', offer.available,
          'observedAt', offer.observed_at, 'freshness', private.offer_freshness(offer.observed_at),
          'market', jsonb_build_object('id', market.id, 'externalId', market.external_id, 'name', market.name)
        ) order by coalesce(offer.promo_price, offer.normal_price), retailer.code
      ) as items
      from public.product_offers offer
      join applicable_markets applicable on applicable.market_id = offer.market_id
      join public.retailer_markets market on market.id = offer.market_id
      join public.retailers retailer on retailer.id = offer.retailer_id and retailer.active
      where offer.retailer_product_id = product.id
    ) offers on true
    where match.id is null
  ),
  all_results as (
    select * from canonical_results
    union all
    select * from standalone_results
  )
  select coalesce(jsonb_agg(item order by rank desc, tie_name), '[]'::jsonb)
  into result
  from (select * from all_results order by rank desc, tie_name limit bounded_limit) limited;

  return result;
end;
$$;

revoke all on function public.search_products_for_list(uuid, text, integer) from public, anon;
grant execute on function public.search_products_for_list(uuid, text, integer) to authenticated;

comment on table private.offer_freshness_policy is
  'Single source of truth for offer staleness used by ingestion and query RPCs.';
comment on function public.search_products_for_list(uuid, text, integer) is
  'Authorized, market-safe product search returning canonical groups, confirmed equivalents and current offers in one query.';
