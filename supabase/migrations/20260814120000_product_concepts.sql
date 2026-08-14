-- Replace the unused commercial-equivalence model with the concept
-- classification required by basket comparison. Existing list items are kept;
-- obsolete canonical rows and their classifications are deliberately discarded
-- because they represented a different identity model.

delete from public.canonical_products;

alter table public.canonical_products rename to product_concepts;
alter table public.product_matches rename to retailer_product_concepts;
alter table public.shopping_intents
  rename column canonical_product_id to product_concept_id;
alter table private.shopping_product_operation_context
  rename column canonical_product_id to product_concept_id;

alter table public.product_concepts
  rename constraint canonical_products_pkey to product_concepts_pkey;
alter table public.product_concepts
  rename constraint canonical_products_name_not_blank to product_concepts_name_not_blank;
alter table public.product_concepts
  rename constraint canonical_products_normalized_name_not_blank to product_concepts_normalized_name_not_blank;
alter table public.product_concepts
  rename constraint canonical_products_base_name_not_blank to product_concepts_base_name_not_blank;
alter table public.retailer_product_concepts
  rename constraint product_matches_pkey to retailer_product_concepts_pkey;
alter table public.retailer_product_concepts
  rename constraint product_matches_canonical_product_id_fkey to retailer_product_concepts_product_concept_id_fkey;
alter table public.retailer_product_concepts
  rename constraint product_matches_retailer_product_id_fkey to retailer_product_concepts_retailer_product_id_fkey;
alter table public.retailer_product_concepts
  rename constraint product_matches_matched_by_fkey to retailer_product_concepts_reviewed_by_fkey;
alter table public.retailer_product_concepts
  rename constraint product_matches_method_not_blank to retailer_product_concepts_method_not_blank;
alter table public.retailer_product_concepts
  rename constraint product_matches_score_range to retailer_product_concepts_score_range;
alter table public.retailer_product_concepts
  rename constraint product_matches_confidence_valid to retailer_product_concepts_confidence_valid;
alter table public.shopping_intents
  rename constraint shopping_intents_canonical_product_id_fkey to shopping_intents_product_concept_id_fkey;

drop index if exists public.canonical_products_gtin_key;
drop index if exists public.canonical_products_normalized_name_trgm_idx;
drop index if exists public.product_matches_canonical_product_id_idx;
drop index if exists public.product_matches_canonical_accepted_idx;
drop index if exists public.product_matches_one_accepted_per_retailer_idx;
drop index if exists public.shopping_intents_canonical_product_id_idx;

alter table public.product_concepts
  drop constraint if exists canonical_products_commercial_identity_key,
  drop constraint if exists canonical_products_gtin_format,
  drop constraint if exists canonical_products_package_size_positive,
  drop constraint if exists canonical_products_package_unit_valid,
  drop constraint if exists canonical_products_package_shape,
  drop constraint if exists canonical_products_package_count_positive,
  drop constraint if exists canonical_products_total_amount_positive,
  drop column brand,
  drop column normalized_brand,
  drop column variant,
  drop column gtin,
  drop column package_size,
  drop column package_unit,
  drop column package_count,
  drop column total_amount,
  add column aliases text[] not null default array[]::text[],
  add column category_terms text[] not null default array[]::text[],
  add column excluded_terms text[] not null default array[]::text[],
  add column specialty_terms text[] not null default array[]::text[],
  add column parent_id uuid references public.product_concepts (id) on delete restrict,
  add column default_dimension text not null default 'COUNT',
  add column default_amount numeric,
  add column default_unit text,
  add column selection_policy text not null default 'CHEAPEST_COVERING',
  add constraint product_concepts_normalized_name_key unique (normalized_name),
  add constraint product_concepts_dimension_valid
    check (default_dimension in ('COUNT', 'MASS', 'VOLUME')),
  add constraint product_concepts_default_amount_positive
    check (default_amount is null or default_amount > 0),
  add constraint product_concepts_default_unit_valid
    check (default_unit is null or default_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  add constraint product_concepts_default_shape
    check ((default_amount is null) = (default_unit is null)),
  add constraint product_concepts_default_dimension_consistent check (
    default_unit is null
    or (default_dimension = 'COUNT' and default_unit = 'unit')
    or (default_dimension = 'MASS' and default_unit in ('g', 'kg'))
    or (default_dimension = 'VOLUME' and default_unit in ('ml', 'l'))
  ),
  add constraint product_concepts_selection_policy_valid
    check (selection_policy in ('CHEAPEST_COVERING', 'CLOSEST_AMOUNT'));

alter table public.retailer_product_concepts
  rename column canonical_product_id to product_concept_id;
alter table public.retailer_product_concepts
  rename column matched_by to reviewed_by;
alter table public.retailer_product_concepts
  drop constraint if exists product_matches_type_valid,
  drop constraint if exists product_matches_candidate_key,
  drop constraint if exists product_matches_reasons_array,
  drop constraint if exists product_matches_status_valid,
  drop constraint if exists product_matches_review_consistent,
  drop column match_type,
  add column is_standard boolean not null default true,
  add column attributes jsonb not null default '{}'::jsonb,
  add column classifier_version text not null default 'concept-rules-v1',
  add constraint retailer_product_concepts_candidate_key
    unique (product_concept_id, retailer_product_id),
  add constraint retailer_product_concepts_reasons_array
    check (jsonb_typeof(reasons) = 'array'),
  add constraint retailer_product_concepts_attributes_object
    check (jsonb_typeof(attributes) = 'object'),
  add constraint retailer_product_concepts_status_valid
    check (status in ('PROPOSED', 'ACCEPTED', 'REJECTED')),
  add constraint retailer_product_concepts_review_consistent check (
    (status = 'PROPOSED' and not reviewed and reviewed_at is null)
    or (status in ('ACCEPTED', 'REJECTED') and reviewed and reviewed_at is not null)
  );

create unique index retailer_product_concepts_one_accepted_idx
  on public.retailer_product_concepts (retailer_product_id)
  where status = 'ACCEPTED';
create index retailer_product_concepts_concept_accepted_idx
  on public.retailer_product_concepts (product_concept_id, retailer_product_id)
  where status = 'ACCEPTED';
create index product_concepts_normalized_name_trgm_idx
  on public.product_concepts
  using gin (normalized_name extensions.gin_trgm_ops);
create index shopping_intents_product_concept_id_idx
  on public.shopping_intents (product_concept_id);

alter table public.shopping_intents
  add column concept_resolution_method text,
  add column concept_resolution_score numeric(5, 4),
  add constraint shopping_intents_concept_resolution_score_range
    check (concept_resolution_score is null or concept_resolution_score between 0 and 1);

insert into public.product_concepts (
  id, name, normalized_name, base_name, category, normalized_category,
  aliases, category_terms, excluded_terms, specialty_terms,
  default_dimension, default_amount, default_unit, selection_policy
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Leche', 'leche', 'leche', 'Lácteos', 'lacteos',
    array['leche', 'leches'],
    array['leche', 'lacteo', 'lacteos', 'huevos leche y mantequilla'],
    array['leche corporal', 'leche limpiadora', 'leche condensada',
          'leche evaporada', 'leche en polvo', 'leche infantil',
          'batido', 'bebida de avena', 'bebida de soja',
          'bebida de almendra', 'bebida de coco'],
    array['sin lactosa', 'proteina', 'enriquecida', 'calcio', 'omega'],
    'VOLUME', 1, 'l', 'CHEAPEST_COVERING'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Huevos', 'huevo', 'huevo', 'Huevos', 'huevos',
    array['huevo', 'huevos'],
    array['huevo', 'huevos leche y mantequilla'],
    array['huevo de chocolate', 'huevos de chocolate', 'huevas'],
    array['codorniz', 'ecologico', 'campero'],
    'COUNT', 1, 'unit', 'CHEAPEST_COVERING'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Patatas', 'patata', 'patata', 'Fruta y verdura', 'fruta y verdura',
    array['patata', 'patatas', 'papa', 'papas'],
    array['patata', 'verdura', 'fruta y verdura'],
    array['patatas fritas', 'patata frita', 'tortilla', 'snack'],
    array['guarnicion', 'microondas'],
    'MASS', 175, 'g', 'CHEAPEST_COVERING'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'Tomate triturado', 'tomate triturado', 'tomate triturado',
    'Conservas', 'conservas',
    array['tomate triturado', 'tomates triturados'],
    array['tomate', 'conserva', 'conservas'],
    array['tomate frito', 'tomate entero', 'tomate concentrado',
          'salsa de tomate', 'ketchup'],
    array['ecologico', 'bio'],
    'MASS', null, null, 'CHEAPEST_COVERING'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'Carne fresca', 'carne', 'carne', 'Carne', 'carne',
    array['carne', 'ternera', 'vacuno', 'cerdo', 'pollo', 'pavo'],
    array['carne', 'carniceria', 'aves', 'pollo', 'cerdo', 'vacuno'],
    array['caldo', 'croqueta', 'pizza', 'salsa', 'hamburguesa vegetal',
          'comida para', 'pienso', 'embutido', 'fiambre'],
    array['adobado', 'marinado', 'relleno'],
    'MASS', null, null, 'CLOSEST_AMOUNT'
  );

create function private.catalog_text_contains(value text, term text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (' ' || coalesce(value, '') || ' ') like
    ('% ' || private.normalize_catalog_search_text(term) || ' %');
$$;

create function private.classify_retailer_product(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.retailer_products%rowtype;
  normalized_product_name text;
  normalized_product_category text;
  selected_concept_id uuid;
  selected_score numeric;
  selected_is_standard boolean;
  matched_alias text;
begin
  select * into product
  from public.retailer_products
  where id = target_product_id;
  if not found then return; end if;

  if exists (
    select 1 from public.retailer_product_concepts classification
    where classification.retailer_product_id = product.id
      and classification.status = 'ACCEPTED'
      and classification.method = 'MANUAL'
  ) then
    return;
  end if;

  normalized_product_name := private.normalize_catalog_search_text(product.name);
  normalized_product_category := private.normalize_catalog_search_text(
    concat_ws(' ', product.category, product.subcategory)
  );

  select candidate.id, candidate.score, candidate.is_standard, candidate.alias
  into selected_concept_id, selected_score, selected_is_standard, matched_alias
  from (
    select
      concept.id,
      alias,
      least(1::numeric,
        case
          when normalized_product_name = concept.normalized_name then 0.98
          when normalized_product_name = private.normalize_catalog_search_text(alias) then 0.97
          else 0.88
        end
        + case when exists (
            select 1 from unnest(concept.category_terms) category_term
            where private.catalog_text_contains(normalized_product_category, category_term)
               or position(private.normalize_catalog_search_text(category_term)
                           in normalized_product_category) > 0
          ) then 0.07 else 0 end
      ) as score,
      not exists (
        select 1 from unnest(concept.specialty_terms) specialty_term
        where position(private.normalize_catalog_search_text(specialty_term)
                       in normalized_product_name) > 0
      ) as is_standard
    from public.product_concepts concept
    cross join lateral unnest(concept.aliases) alias
    where private.catalog_text_contains(normalized_product_name, alias)
      and not exists (
        select 1 from unnest(concept.excluded_terms) excluded_term
        where position(private.normalize_catalog_search_text(excluded_term)
                       in normalized_product_name) > 0
      )
      and (
        concept.normalized_name <> 'carne'
        or exists (
          select 1 from unnest(concept.category_terms) category_term
          where position(private.normalize_catalog_search_text(category_term)
                         in normalized_product_category) > 0
        )
      )
  ) candidate
  order by candidate.score desc, length(candidate.alias) desc, candidate.id
  limit 1;

  delete from public.retailer_product_concepts classification
  where classification.retailer_product_id = product.id
    and classification.method <> 'MANUAL';

  if selected_concept_id is null then return; end if;

  insert into public.retailer_product_concepts (
    product_concept_id, retailer_product_id, method, score, confidence,
    reasons, status, reviewed, reviewed_at, is_standard, attributes,
    classifier_version
  ) values (
    selected_concept_id,
    product.id,
    'CONCEPT_RULES',
    selected_score,
    case when selected_score >= 0.92 then 'HIGH' else 'MEDIUM' end,
    jsonb_build_array(
      jsonb_build_object('feature', 'alias', 'matched', true,
                         'detail', matched_alias),
      jsonb_build_object('feature', 'category', 'matched',
                         normalized_product_category <> '',
                         'detail', normalized_product_category)
    ),
    case when selected_score >= 0.92 then 'ACCEPTED' else 'PROPOSED' end,
    selected_score >= 0.92,
    case when selected_score >= 0.92 then now() else null end,
    selected_is_standard,
    jsonb_strip_nulls(jsonb_build_object(
      'brand', product.brand,
      'category', product.category,
      'subcategory', product.subcategory
    )),
    'concept-rules-v1'
  );
end;
$$;

create function private.classify_retailer_product_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.classify_retailer_product(new.id);
  return new;
end;
$$;

create trigger classify_retailer_product_after_write
after insert or update of name, category, subcategory, brand,
  package_size, package_unit, package_count, total_amount
on public.retailer_products
for each row execute function private.classify_retailer_product_trigger();

select private.classify_retailer_product(product.id)
from public.retailer_products product
where product.active;

create function private.resolve_product_concept(normalized_query text)
returns table (product_concept_id uuid, method text, score numeric)
language sql
stable
set search_path = ''
as $$
  with normalized as (
    select private.normalize_catalog_search_text(normalized_query) as value
  ), candidates as (
    select
      concept.id,
      case
        when concept.normalized_name = normalized.value then 1::numeric
        when exists (
          select 1 from unnest(concept.aliases) alias
          where private.normalize_catalog_search_text(alias) = normalized.value
        ) then 0.99::numeric
        else extensions.strict_word_similarity(normalized.value, concept.normalized_name)::numeric
      end as candidate_score,
      case
        when concept.normalized_name = normalized.value then 'EXACT_NAME'
        when exists (
          select 1 from unnest(concept.aliases) alias
          where private.normalize_catalog_search_text(alias) = normalized.value
        ) then 'EXACT_ALIAS'
        else 'TEXT_SIMILARITY'
      end as candidate_method
    from public.product_concepts concept
    cross join normalized
  )
  select id, candidate_method, candidate_score
  from candidates
  where candidate_score >= 0.8
  order by candidate_score desc, id
  limit 1;
$$;

create function private.resolve_shopping_intent_concept_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolution record;
begin
  if new.product_concept_id is not null
    and (tg_op = 'INSERT' or new.normalized_name is not distinct from old.normalized_name) then
    return new;
  end if;

  select * into resolution
  from private.resolve_product_concept(new.normalized_name);
  new.product_concept_id := resolution.product_concept_id;
  new.concept_resolution_method := resolution.method;
  new.concept_resolution_score := resolution.score;
  return new;
end;
$$;

create trigger resolve_shopping_intent_concept_before_write
before insert or update of normalized_name, product_concept_id
on public.shopping_intents
for each row execute function private.resolve_shopping_intent_concept_trigger();

with resolutions as (
  select intent.id, resolution.product_concept_id, resolution.method, resolution.score
  from public.shopping_intents intent
  cross join lateral private.resolve_product_concept(intent.normalized_name) resolution
  where intent.product_concept_id is null
)
update public.shopping_intents intent
set product_concept_id = resolution.product_concept_id,
    concept_resolution_method = resolution.method,
    concept_resolution_score = resolution.score
from resolutions resolution
where intent.id = resolution.id;

-- Recreate the idempotent add RPC with concept terminology. The signature is
-- unchanged, so it must be dropped before the input parameter is renamed.
drop function public.add_shopping_product_operation(
  uuid, uuid, text, text, uuid, numeric, text, integer, numeric, text, numeric, text, text
);

create function public.add_shopping_product_operation(
  operation_id uuid,
  shopping_list_id uuid,
  raw_text text,
  normalized_name text,
  product_concept_id uuid default null,
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
    operation_id, actor_id, product_concept_id
  ) values (
    operation_id, auth.uid(), product_concept_id
  )
  on conflict do nothing
  returning true into context_claimed;

  if not coalesce(context_claimed, false) then
    select * into existing_context
    from private.shopping_product_operation_context context
    where context.operation_id = add_shopping_product_operation.operation_id;
    if existing_context.actor_id <> auth.uid()
      or existing_context.product_concept_id is distinct from product_concept_id then
      raise exception using errcode = '22023', message = 'operation_id was already used for a different product';
    end if;
  end if;

  created_intent := public.apply_shopping_intent_operation(
    operation_id, 'add', shopping_list_id, null, raw_text, normalized_name, null
  );

  update public.shopping_intents intent
  set product_concept_id = coalesce(add_shopping_product_operation.product_concept_id,
                                    intent.product_concept_id),
      requested_quantity = coalesce(add_shopping_product_operation.requested_quantity,
                                    intent.requested_quantity),
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

  select to_jsonb(intent) into created_intent
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

comment on table public.product_concepts is
  'User-facing grocery concepts used to classify retailer products and resolve shopping intents.';
comment on table public.retailer_product_concepts is
  'Explainable reviewed or automatic classifications from retailer SKUs to grocery concepts.';
