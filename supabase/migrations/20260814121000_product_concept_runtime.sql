-- Remove commercial-matching RPCs and replace them with concept
-- classification operations.
drop function if exists public.admin_accept_product_match(uuid, text);
drop function if exists public.admin_reject_product_match(uuid, text);
drop function if exists public.admin_reassign_product_match(uuid, uuid, text);
drop function if exists public.admin_update_canonical_product(uuid, jsonb, text);
drop function if exists public.accept_product_match(uuid);
drop function if exists public.reject_product_match(uuid);
drop function if exists public.change_product_match(uuid, uuid, text, text, numeric, text, jsonb);
drop function if exists public.search_product_match_candidates(text, text, text, integer);

create function public.accept_retailer_product_concept(target_classification_id uuid)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_product_id uuid;
begin
  select retailer_product_id into target_product_id
  from public.retailer_product_concepts
  where id = target_classification_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Product classification not found';
  end if;

  update public.retailer_product_concepts
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where retailer_product_id = target_product_id
    and status = 'ACCEPTED'
    and id <> target_classification_id;

  return query
  update public.retailer_product_concepts
  set status = 'ACCEPTED', reviewed = true, reviewed_at = now()
  where id = target_classification_id
  returning *;
end;
$$;

create function public.reject_retailer_product_concept(target_classification_id uuid)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.retailer_product_concepts
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where id = target_classification_id
  returning *;
  if not found then
    raise exception using errcode = 'P0002', message = 'Product classification not found';
  end if;
end;
$$;

create function public.change_retailer_product_concept(
  target_product_concept_id uuid,
  target_retailer_product_id uuid,
  target_method text,
  target_score numeric,
  target_confidence text,
  target_reasons jsonb,
  target_is_standard boolean default true
)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.retailer_product_concepts
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where retailer_product_id = target_retailer_product_id
    and status = 'ACCEPTED';

  return query
  insert into public.retailer_product_concepts (
    product_concept_id, retailer_product_id, method, score, confidence,
    reasons, status, reviewed, reviewed_at, is_standard, classifier_version
  ) values (
    target_product_concept_id, target_retailer_product_id, target_method,
    target_score, target_confidence, target_reasons,
    'ACCEPTED', true, now(), target_is_standard, 'manual-v1'
  )
  on conflict (product_concept_id, retailer_product_id) do update set
    method = excluded.method,
    score = excluded.score,
    confidence = excluded.confidence,
    reasons = excluded.reasons,
    status = 'ACCEPTED',
    reviewed = true,
    reviewed_at = now(),
    is_standard = excluded.is_standard,
    classifier_version = excluded.classifier_version
  returning *;
end;
$$;

create function public.admin_accept_product_classification(
  target_classification_id uuid,
  actor text
)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  select to_jsonb(classification.*) into before_row
  from public.retailer_product_concepts classification
  where id = target_classification_id for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Product classification not found';
  end if;
  select to_jsonb(result.*) into after_row
  from public.accept_retailer_product_concept(target_classification_id) result;
  perform private.write_admin_audit(
    actor, 'product_classification.accepted', 'product_classification',
    target_classification_id::text, before_row, after_row
  );
  return query select * from public.retailer_product_concepts
  where id = target_classification_id;
end;
$$;

create function public.admin_reject_product_classification(
  target_classification_id uuid,
  actor text
)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  select to_jsonb(classification.*) into before_row
  from public.retailer_product_concepts classification
  where id = target_classification_id for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Product classification not found';
  end if;
  select to_jsonb(result.*) into after_row
  from public.reject_retailer_product_concept(target_classification_id) result;
  perform private.write_admin_audit(
    actor, 'product_classification.rejected', 'product_classification',
    target_classification_id::text, before_row, after_row
  );
  return query select * from public.retailer_product_concepts
  where id = target_classification_id;
end;
$$;

create function public.admin_classify_retailer_product(
  target_retailer_product_id uuid,
  target_product_concept_id uuid,
  target_is_standard boolean,
  actor text
)
returns setof public.retailer_product_concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  result public.retailer_product_concepts%rowtype;
begin
  select to_jsonb(classification.*) into before_row
  from public.retailer_product_concepts classification
  where classification.retailer_product_id = target_retailer_product_id
  order by (classification.status = 'ACCEPTED') desc, classification.updated_at desc
  limit 1
  for update;

  select * into result
  from public.change_retailer_product_concept(
    target_product_concept_id,
    target_retailer_product_id,
    'MANUAL', 1, 'HIGH',
    jsonb_build_array(jsonb_build_object('feature', 'admin', 'matched', true)),
    target_is_standard
  );
  perform private.write_admin_audit(
    actor, 'product_classification.assigned', 'product_classification',
    result.id::text, before_row, to_jsonb(result)
  );
  return next result;
end;
$$;

create function public.admin_update_product_concept(
  target_product_concept_id uuid,
  changes jsonb,
  actor text
)
returns setof public.product_concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  allowed_keys constant text[] := array[
    'name', 'base_name', 'category', 'aliases', 'category_terms',
    'excluded_terms', 'specialty_terms', 'default_dimension',
    'default_amount', 'default_unit', 'selection_policy'
  ];
begin
  if jsonb_typeof(changes) is distinct from 'object' or changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Concept changes must be a non-empty object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(changes) key
    where not (key = any(allowed_keys))
  ) then
    raise exception using errcode = '22023', message = 'Concept changes contain unsupported fields';
  end if;

  select to_jsonb(concept.*) into before_row
  from public.product_concepts concept
  where id = target_product_concept_id for update;
  if before_row is null then
    raise exception using errcode = 'P0002', message = 'Product concept not found';
  end if;

  update public.product_concepts
  set name = case when changes ? 'name' then btrim(changes ->> 'name') else name end,
      normalized_name = case when changes ? 'name'
        then private.normalize_catalog_search_text(changes ->> 'name')
        else normalized_name end,
      base_name = case when changes ? 'base_name'
        then btrim(changes ->> 'base_name') else base_name end,
      category = case when changes ? 'category'
        then nullif(btrim(changes ->> 'category'), '') else category end,
      normalized_category = case when changes ? 'category'
        then nullif(private.normalize_catalog_search_text(changes ->> 'category'), '')
        else normalized_category end,
      aliases = case when changes ? 'aliases'
        then array(select jsonb_array_elements_text(changes -> 'aliases')) else aliases end,
      category_terms = case when changes ? 'category_terms'
        then array(select jsonb_array_elements_text(changes -> 'category_terms')) else category_terms end,
      excluded_terms = case when changes ? 'excluded_terms'
        then array(select jsonb_array_elements_text(changes -> 'excluded_terms')) else excluded_terms end,
      specialty_terms = case when changes ? 'specialty_terms'
        then array(select jsonb_array_elements_text(changes -> 'specialty_terms')) else specialty_terms end,
      default_dimension = case when changes ? 'default_dimension'
        then changes ->> 'default_dimension' else default_dimension end,
      default_amount = case when changes ? 'default_amount'
        then nullif(changes ->> 'default_amount', '')::numeric else default_amount end,
      default_unit = case when changes ? 'default_unit'
        then nullif(changes ->> 'default_unit', '') else default_unit end,
      selection_policy = case when changes ? 'selection_policy'
        then changes ->> 'selection_policy' else selection_policy end
  where id = target_product_concept_id;

  select to_jsonb(concept.*) into after_row
  from public.product_concepts concept where id = target_product_concept_id;
  perform private.write_admin_audit(
    actor, 'product_concept.updated', 'product_concept',
    target_product_concept_id::text, before_row, after_row
  );
  return query select * from public.product_concepts
  where id = target_product_concept_id;
end;
$$;

revoke all on function public.accept_retailer_product_concept(uuid) from public;
revoke all on function public.reject_retailer_product_concept(uuid) from public;
revoke all on function public.change_retailer_product_concept(uuid, uuid, text, numeric, text, jsonb, boolean) from public;
revoke all on function public.admin_accept_product_classification(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_reject_product_classification(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_classify_retailer_product(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_update_product_concept(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_accept_product_classification(uuid, text) to service_role;
grant execute on function public.admin_reject_product_classification(uuid, text) to service_role;
grant execute on function public.admin_classify_retailer_product(uuid, uuid, boolean, text) to service_role;
grant execute on function public.admin_update_product_concept(uuid, jsonb, text) to service_role;

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
      from public.retailer_product_concepts classification
      join public.shopping_intents intent
        on intent.product_concept_id = classification.product_concept_id
       and not intent.checked
      where classification.retailer_product_id = product.id
        and classification.status = 'ACCEPTED'
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
        'name', intent.raw_text,
        'productConceptId', intent.product_concept_id,
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
        'productId', product.id,
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
        'freshness', private.offer_freshness(offer.observed_at),
        'pricePerUnit', offer.price_per_unit,
        'referenceUnit', offer.reference_unit,
        'promotionText', offer.promotion_text
      )) order by retailer.code, intent.created_at,
                  coalesce(offer.promo_price, offer.normal_price), product.id)
      from open_intents intent
      join eligible_classifications classification
        on classification.product_concept_id = intent.product_concept_id
      join public.retailer_products product
        on product.id = classification.retailer_product_id and product.active
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

revoke all on function public.get_basket_comparison_inputs(uuid) from public, anon;
grant execute on function public.get_basket_comparison_inputs(uuid) to authenticated;

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
  ), concept_hits as materialized (
    select concept.id,
      greatest(
        extensions.strict_word_similarity(normalized_query, concept.normalized_name),
        coalesce((select max(extensions.strict_word_similarity(
          normalized_query, private.normalize_catalog_search_text(alias)
        )) from unnest(concept.aliases) alias), 0)
      ) as rank
    from public.product_concepts concept
    where concept.normalized_name = normalized_query
       or private.catalog_text_contains(normalized_query, concept.normalized_name)
       or normalized_query operator(extensions.<<%) concept.normalized_name
       or exists (
         select 1 from unnest(concept.aliases) alias
         where private.normalize_catalog_search_text(alias) = normalized_query
            or private.catalog_text_contains(normalized_query, alias)
            or normalized_query operator(extensions.<<%) private.normalize_catalog_search_text(alias)
       )
    order by rank desc, concept.name, concept.id
    limit bounded_limit
  ), retailer_hits as materialized (
    select product.id,
      extensions.strict_word_similarity(
        normalized_query, private.normalize_catalog_search_text(product.name)
      ) as rank
    from public.retailer_products product
    join public.retailers retailer
      on retailer.id = product.retailer_id and retailer.active
    where product.active
      and (product.market_id is null or product.market_id in (select market_id from applicable_markets))
      and (
        private.normalize_catalog_search_text(product.name) = normalized_query
        or normalized_query operator(extensions.<<%) private.normalize_catalog_search_text(product.name)
      )
      and not exists (
        select 1
        from public.retailer_product_concepts classification
        where classification.retailer_product_id = product.id
          and classification.status = 'ACCEPTED'
      )
    order by rank desc, product.name, product.id
    limit bounded_limit
  ), concept_results as (
    select hit.rank, concept.name as tie_name,
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
      ) order by retailer.code, product.name, product.id) as items
      from public.retailer_product_concepts classification
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
      ) order by coalesce(offer.promo_price, offer.normal_price), retailer.code, product.name) as items
      from public.retailer_product_concepts classification
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
    select hit.rank, product.name as tie_name,
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
  select coalesce(jsonb_agg(item order by rank desc, tie_name), '[]'::jsonb)
  into result
  from (
    select *
    from (
      select * from concept_results
      union all
      select * from standalone_results
    ) combined
    order by rank desc, tie_name
    limit bounded_limit
  ) limited;
  return result;
end;
$$;

revoke all on function public.search_products_for_list(uuid, text, integer) from public, anon;
grant execute on function public.search_products_for_list(uuid, text, integer) to authenticated;
