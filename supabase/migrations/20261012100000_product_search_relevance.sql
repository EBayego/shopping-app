create function private.catalog_search_document(
  product_name text, brand text, category text, subcategory text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector('spanish', private.normalize_catalog_search_text(product_name)), 'A')
    || setweight(to_tsvector('spanish', private.normalize_catalog_search_text(brand)), 'B')
    || setweight(to_tsvector('spanish', private.normalize_catalog_search_text(subcategory)), 'C')
    || setweight(to_tsvector('spanish', private.normalize_catalog_search_text(category)), 'D');
$$;

create index retailer_products_search_document_idx
  on public.retailer_products using gin (
    private.catalog_search_document(name, brand, category, subcategory)
  ) where active;

create function private.catalog_search_relevance(
  query text, product_name text, brand text, category text, subcategory text
)
returns table (match_quality integer, text_rank real)
language sql
immutable
parallel safe
set search_path = ''
as $$
  with normalized as (
    select private.normalize_catalog_search_text(query) as query,
      private.normalize_catalog_search_text(product_name) as name,
      plainto_tsquery('spanish', private.normalize_catalog_search_text(query)) as terms,
      to_tsvector('spanish', private.normalize_catalog_search_text(query)) as query_vector,
      to_tsvector('spanish', private.normalize_catalog_search_text(product_name)) as name_vector,
      private.catalog_search_document(product_name, brand, category, subcategory) as document
  )
  select
    case
      when (name_vector || to_tsvector('spanish', private.normalize_catalog_search_text(brand))) @@ terms then 3
      when document @@ terms then 2
      else 1
    end,
    (
      case when name = query then 6 else 0 end
      + case when numnode(terms) > 0 and tsvector_to_array(name_vector) = tsvector_to_array(query_vector) then 5 else 0 end
      + case when starts_with(name, query || ' ') then 2
             when private.catalog_text_contains(name, query) then 1 else 0 end
      + case when numnode(terms) > 0 and tsvector_to_array(to_tsvector('spanish', private.normalize_catalog_search_text(subcategory)))
                    = tsvector_to_array(query_vector) then 3 else 0 end
      + case when numnode(terms) > 0 and tsvector_to_array(to_tsvector('spanish', private.normalize_catalog_search_text(category)))
                    = tsvector_to_array(query_vector) then 2 else 0 end
      + 4 * ts_rank_cd(document, terms, 2 | 32)
      + 2 * extensions.strict_word_similarity(query, name)
      + extensions.similarity(query, name)
    )::real
  from normalized;
$$;

create function private.catalog_category_affinity(
  category text, subcategory text, anchor_category text, anchor_subcategory text
)
returns real
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (
    extensions.similarity(private.normalize_catalog_search_text(category),
                          private.normalize_catalog_search_text(anchor_category))
    + extensions.similarity(private.normalize_catalog_search_text(subcategory),
                            private.normalize_catalog_search_text(anchor_subcategory))
  ) / 2;
$$;

revoke all on function private.catalog_search_document(text, text, text, text) from public, anon, authenticated;
revoke all on function private.catalog_search_relevance(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.catalog_category_affinity(text, text, text, text) from public, anon, authenticated;
grant execute on function private.catalog_search_document(text, text, text, text) to service_role;

create or replace function public.search_products_for_list(
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
  ), retailer_matches as materialized (
    select product.id, relevance.match_quality, relevance.text_rank
    from public.retailer_products product
    join public.retailers retailer
      on retailer.id = product.retailer_id and retailer.active
    cross join lateral private.catalog_search_relevance(
      normalized_query, product.name, product.brand, product.category, product.subcategory
    ) relevance
    where product.active
      and (product.market_id is null or product.market_id in (select market_id from applicable_markets))
      and (
        private.catalog_search_document(product.name, product.brand, product.category, product.subcategory)
          @@ plainto_tsquery('spanish', normalized_query)
        or normalized_query operator(extensions.<<%) private.normalize_catalog_search_text(product.name)
      )
  ), category_anchor as materialized (
    -- Infer context from the strongest direct name match, within this list's markets.
    select product.category, product.subcategory
    from retailer_matches matched
    join public.retailer_products product on product.id = matched.id
    where to_tsvector('spanish', private.normalize_catalog_search_text(product.name))
            @@ plainto_tsquery('spanish', normalized_query)
      and (
        numnode(plainto_tsquery('spanish', normalized_query)) > 1
        or starts_with(private.normalize_catalog_search_text(product.name), normalized_query || ' ')
        or tsvector_to_array(to_tsvector('spanish', private.normalize_catalog_search_text(product.name)))
             = tsvector_to_array(to_tsvector('spanish', normalized_query))
        or tsvector_to_array(to_tsvector('spanish', private.normalize_catalog_search_text(product.category)))
             = tsvector_to_array(to_tsvector('spanish', normalized_query))
        or tsvector_to_array(to_tsvector('spanish', private.normalize_catalog_search_text(product.subcategory)))
             = tsvector_to_array(to_tsvector('spanish', normalized_query))
      )
      and not exists (
        select 1 from retailer_matches brand_hit
        join public.retailer_products branded on branded.id = brand_hit.id
        where private.normalize_catalog_search_text(branded.brand) = normalized_query
      )
    order by matched.match_quality desc, matched.text_rank desc, product.id
    limit 1
  ), ranked_products as materialized (
    select matched.id,
      100 * matched.match_quality + matched.text_rank
        + 4 * coalesce(private.catalog_category_affinity(
          product.category, product.subcategory, anchor.category, anchor.subcategory
        ), 0) as rank
    from retailer_matches matched
    join public.retailer_products product on product.id = matched.id
    left join category_anchor anchor on true
  ), concept_matches as materialized (
    select concept.id,
      max(100 * relevance.match_quality + relevance.text_rank) as rank,
      bool_or(
        private.normalize_catalog_search_text(wording.name) = normalized_query
        or (numnode(plainto_tsquery('spanish', normalized_query)) = 1
            and normalized_query operator(extensions.<<%) private.normalize_catalog_search_text(wording.name))
      ) as generic_query
    from public.product_concepts concept
    cross join lateral (
      select concept.name
      union all
      select alias from unnest(concept.aliases) alias
    ) wording
    cross join lateral private.catalog_search_relevance(
      normalized_query, wording.name, null, concept.category, null
    ) relevance
    where to_tsvector('spanish', private.normalize_catalog_search_text(wording.name))
            @@ plainto_tsquery('spanish', normalized_query)
       or normalized_query operator(extensions.<<%) private.normalize_catalog_search_text(wording.name)
       or exists (
         select 1 from public.retailer_product_concepts classification
         join ranked_products product_hit on product_hit.id = classification.retailer_product_id
         where classification.product_concept_id = concept.id and classification.status = 'ACCEPTED'
       )
    group by concept.id
  ), concept_products as materialized (
    select matched.id as concept_id, product.id,
      coalesce(product_hit.rank,
        100 * relevance.match_quality + relevance.text_rank
          + 4 * coalesce(private.catalog_category_affinity(
            product.category, product.subcategory, anchor.category, anchor.subcategory
          ), 0)
      ) as rank
    from concept_matches matched
    join public.retailer_product_concepts classification
      on classification.product_concept_id = matched.id and classification.status = 'ACCEPTED'
    join public.retailer_products product
      on product.id = classification.retailer_product_id and product.active
    join public.retailers retailer
      on retailer.id = product.retailer_id and retailer.active
    left join ranked_products product_hit on product_hit.id = product.id
    left join category_anchor anchor on true
    cross join lateral private.catalog_search_relevance(
      normalized_query, product.name, product.brand, product.category, product.subcategory
    ) relevance
    where (product.market_id is null or product.market_id in (select market_id from applicable_markets))
      and (matched.generic_query or product_hit.id is not null)
  ), concept_hits as materialized (
    select matched.id, greatest(matched.rank, coalesce(max(product_hit.rank), 0)) as rank
    from concept_matches matched
    join public.product_concepts concept on concept.id = matched.id
    left join concept_products product_hit on product_hit.concept_id = matched.id
    group by matched.id, matched.rank, concept.name
    order by rank desc, concept.name, matched.id
    limit bounded_limit
  ), retailer_hits as materialized (
    select hit.id, hit.rank
    from ranked_products hit
    join public.retailer_products product on product.id = hit.id
    where not exists (
      select 1 from concept_products grouped
      join concept_hits concept_hit on concept_hit.id = grouped.concept_id
      where grouped.id = hit.id
    )
    order by hit.rank desc, product.name, product.id
    limit bounded_limit
  ), concept_results as (
    select hit.rank, concept.name as tie_name, concept.id as tie_id,
      jsonb_build_object(
        'concept', jsonb_build_object(
          'id', concept.id, 'name', concept.name,
          'normalizedName', concept.normalized_name,
          'category', concept.category,
          'defaultAmount', concept.default_amount,
          'defaultUnit', concept.default_unit,
          'selectionPolicy', concept.selection_policy
        ),
        'retailerProducts', coalesce(products.items, '[]'::jsonb),
        'offers', coalesce(offers.items, '[]'::jsonb)
      ) as item
    from concept_hits hit
    join public.product_concepts concept on concept.id = hit.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', product.id, 'retailerId', product.retailer_id,
        'externalId', product.external_id, 'name', product.name,
        'brand', product.brand, 'packageSize', product.package_size,
        'packageUnit', product.package_unit, 'packageCount', product.package_count,
        'imageUrl', product.image_url, 'productUrl', product.product_url,
        'classificationConfidence', classification.confidence,
        'standard', classification.is_standard
      ) order by selected.rank desc, retailer.code, product.name, product.id) as items
      from public.retailer_product_concepts classification
      join concept_products selected
        on selected.id = classification.retailer_product_id
       and selected.concept_id = classification.product_concept_id
      join public.retailer_products product
        on product.id = classification.retailer_product_id and product.active
      join public.retailers retailer
        on retailer.id = product.retailer_id and retailer.active
      where classification.product_concept_id = concept.id
        and classification.status = 'ACCEPTED'
        and (product.market_id is null or product.market_id in (select market_id from applicable_markets))
    ) products on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'retailer', jsonb_build_object('id', retailer.id, 'code', retailer.code, 'name', retailer.name),
        'retailerProduct', jsonb_build_object(
          'id', product.id, 'externalId', product.external_id, 'name', product.name,
          'brand', product.brand, 'imageUrl', product.image_url, 'productUrl', product.product_url
        ),
        'price', coalesce(offer.promo_price, offer.normal_price),
        'normalPrice', offer.normal_price, 'promoPrice', offer.promo_price,
        'pricePerUnit', offer.price_per_unit, 'referenceUnit', offer.reference_unit,
        'promotion', case when offer.promotion_type is null and offer.promotion_text is null
          then null else jsonb_build_object('type', offer.promotion_type, 'text', offer.promotion_text) end,
        'requiresMembership', offer.requires_membership,
        'availability', offer.available, 'observedAt', offer.observed_at,
        'freshness', private.offer_freshness(offer.observed_at),
        'market', jsonb_build_object('id', market.id, 'externalId', market.external_id, 'name', market.name)
      ) order by selected.rank desc, coalesce(offer.promo_price, offer.normal_price), retailer.code, product.name) as items
      from public.retailer_product_concepts classification
      join concept_products selected
        on selected.id = classification.retailer_product_id
       and selected.concept_id = classification.product_concept_id
      join public.retailer_products product
        on product.id = classification.retailer_product_id and product.active
      join public.product_offers offer on offer.retailer_product_id = product.id
      join applicable_markets applicable on applicable.market_id = offer.market_id
      join public.retailer_markets market on market.id = offer.market_id
      join public.retailers retailer on retailer.id = offer.retailer_id and retailer.active
      where classification.product_concept_id = concept.id
        and classification.status = 'ACCEPTED'
    ) offers on true
  ), standalone_results as (
    select hit.rank, product.name as tie_name, product.id as tie_id,
      jsonb_build_object(
        'concept', null,
        'retailerProducts', jsonb_build_array(jsonb_build_object(
          'id', product.id, 'retailerId', product.retailer_id,
          'externalId', product.external_id, 'name', product.name,
          'brand', product.brand, 'packageSize', product.package_size,
          'packageUnit', product.package_unit, 'packageCount', product.package_count,
          'imageUrl', product.image_url, 'productUrl', product.product_url,
          'classificationConfidence', null, 'standard', true
        )),
        'offers', coalesce(offers.items, '[]'::jsonb)
      ) as item
    from retailer_hits hit
    join public.retailer_products product on product.id = hit.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'retailer', jsonb_build_object('id', retailer.id, 'code', retailer.code, 'name', retailer.name),
        'retailerProduct', jsonb_build_object(
          'id', product.id, 'externalId', product.external_id, 'name', product.name,
          'brand', product.brand, 'imageUrl', product.image_url, 'productUrl', product.product_url
        ),
        'price', coalesce(offer.promo_price, offer.normal_price),
        'normalPrice', offer.normal_price, 'promoPrice', offer.promo_price,
        'pricePerUnit', offer.price_per_unit, 'referenceUnit', offer.reference_unit,
        'promotion', case when offer.promotion_type is null and offer.promotion_text is null
          then null else jsonb_build_object('type', offer.promotion_type, 'text', offer.promotion_text) end,
        'requiresMembership', offer.requires_membership,
        'availability', offer.available, 'observedAt', offer.observed_at,
        'freshness', private.offer_freshness(offer.observed_at),
        'market', jsonb_build_object('id', market.id, 'externalId', market.external_id, 'name', market.name)
      ) order by coalesce(offer.promo_price, offer.normal_price), retailer.code) as items
      from public.product_offers offer
      join applicable_markets applicable on applicable.market_id = offer.market_id
      join public.retailer_markets market on market.id = offer.market_id
      join public.retailers retailer on retailer.id = offer.retailer_id and retailer.active
      where offer.retailer_product_id = product.id
    ) offers on true
  )
  select coalesce(jsonb_agg(item order by rank desc, tie_name, tie_id), '[]'::jsonb)
  into result
  from (
    select *
    from (
      select * from concept_results
      union all
      select * from standalone_results
    ) combined
    order by rank desc, tie_name, tie_id
    limit bounded_limit
  ) limited;
  return result;
end;
$$;

revoke all on function public.search_products_for_list(uuid, text, integer) from public, anon;
grant execute on function public.search_products_for_list(uuid, text, integer) to authenticated;
