create extension if not exists pg_trgm with schema extensions;

alter table public.canonical_products
  add column base_name text,
  add column normalized_category text,
  add column brand text,
  add column normalized_brand text,
  add column variant text,
  add column gtin text,
  add column package_size numeric,
  add column package_unit text,
  add column package_count integer,
  add column total_amount numeric;

update public.canonical_products
set base_name = normalized_name,
    normalized_category = lower(category)
where base_name is null;

alter table public.canonical_products
  alter column base_name set not null,
  drop constraint canonical_products_normalized_name_key,
  add constraint canonical_products_base_name_not_blank check (btrim(base_name) <> ''),
  add constraint canonical_products_gtin_format check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  add constraint canonical_products_package_size_positive check (package_size is null or package_size > 0),
  add constraint canonical_products_package_unit_valid check (package_unit is null or package_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  add constraint canonical_products_package_shape check ((package_size is null) = (package_unit is null)),
  add constraint canonical_products_package_count_positive check (package_count is null or package_count > 0),
  add constraint canonical_products_total_amount_positive check (total_amount is null or total_amount > 0),
  add constraint canonical_products_commercial_identity_key
    unique nulls not distinct (normalized_name, normalized_brand, variant, package_size, package_unit, package_count);

create unique index canonical_products_gtin_key
  on public.canonical_products (gtin)
  where gtin is not null;

create index canonical_products_normalized_name_trgm_idx
  on public.canonical_products
  using gin (normalized_name extensions.gin_trgm_ops);

alter table public.product_matches
  rename column match_method to method;

alter table public.product_matches
  rename column confidence to legacy_confidence;

alter table public.product_matches
  drop constraint product_matches_retailer_product_key,
  drop constraint product_matches_method_valid,
  drop constraint product_matches_confidence_range,
  add column match_type text not null default 'SUBSTITUTE',
  add column score numeric(5, 4) not null default 0,
  add column confidence text not null default 'LOW',
  add column reasons jsonb not null default '[]'::jsonb,
  add column status text not null default 'PROPOSED',
  add column reviewed boolean not null default false,
  add column reviewed_at timestamptz;

update public.product_matches
set match_type = case when method = 'gtin' then 'EXACT_MATCH' else 'SUBSTITUTE' end,
    score = coalesce(legacy_confidence, 0),
    confidence = case
      when legacy_confidence >= 0.85 then 'HIGH'
      when legacy_confidence >= 0.65 then 'MEDIUM'
      else 'LOW'
    end,
    status = 'ACCEPTED',
    reviewed = true,
    reviewed_at = updated_at;

alter table public.product_matches
  drop column legacy_confidence,
  add constraint product_matches_type_valid check (match_type in ('EXACT_MATCH', 'SUBSTITUTE')),
  add constraint product_matches_method_not_blank check (btrim(method) <> ''),
  add constraint product_matches_score_range check (score between 0 and 1),
  add constraint product_matches_confidence_valid check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  add constraint product_matches_reasons_array check (jsonb_typeof(reasons) = 'array'),
  add constraint product_matches_status_valid check (status in ('PROPOSED', 'ACCEPTED', 'REJECTED')),
  add constraint product_matches_review_consistent check (
    (status = 'PROPOSED' and not reviewed and reviewed_at is null)
    or (status in ('ACCEPTED', 'REJECTED') and reviewed and reviewed_at is not null)
  ),
  add constraint product_matches_candidate_key unique (canonical_product_id, retailer_product_id);

create unique index product_matches_one_accepted_per_retailer_idx
  on public.product_matches (retailer_product_id)
  where status = 'ACCEPTED';

create index product_matches_canonical_accepted_idx
  on public.product_matches (canonical_product_id, retailer_product_id)
  where status = 'ACCEPTED';

create function public.search_product_match_candidates(
  query_gtin text,
  query_normalized_name text,
  query_normalized_category text default null,
  candidate_limit integer default 50
)
returns setof public.canonical_products
language sql
stable
security definer
set search_path = ''
as $$
  select canonical.*
  from public.canonical_products canonical
  where
    (query_gtin is not null and canonical.gtin = query_gtin)
    or canonical.normalized_name operator(extensions.%) query_normalized_name
  order by
    (query_gtin is not null and canonical.gtin = query_gtin) desc,
    (query_normalized_category is not null and canonical.normalized_category = query_normalized_category) desc,
    extensions.similarity(canonical.normalized_name, query_normalized_name) desc,
    canonical.id
  limit greatest(1, least(candidate_limit, 100));
$$;

create function public.accept_product_match(target_match_id uuid)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_retailer_product_id uuid;
begin
  select retailer_product_id into target_retailer_product_id
  from public.product_matches
  where id = target_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Product match not found';
  end if;

  update public.product_matches
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where retailer_product_id = target_retailer_product_id
    and status = 'ACCEPTED'
    and id <> target_match_id;

  return query
  update public.product_matches
  set status = 'ACCEPTED', reviewed = true, reviewed_at = now()
  where id = target_match_id
  returning *;
end;
$$;

create function public.reject_product_match(target_match_id uuid)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.product_matches
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where id = target_match_id
  returning *;

  if not found then
    raise exception using errcode = 'P0002', message = 'Product match not found';
  end if;
end;
$$;

create function public.change_product_match(
  target_canonical_product_id uuid,
  target_retailer_product_id uuid,
  target_match_type text,
  target_method text,
  target_score numeric,
  target_confidence text,
  target_reasons jsonb
)
returns setof public.product_matches
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_matches
  set status = 'REJECTED', reviewed = true, reviewed_at = now()
  where retailer_product_id = target_retailer_product_id
    and status = 'ACCEPTED';

  return query
  insert into public.product_matches (
    canonical_product_id, retailer_product_id, match_type, method, score,
    confidence, reasons, status, reviewed, reviewed_at
  ) values (
    target_canonical_product_id, target_retailer_product_id, target_match_type,
    target_method, target_score, target_confidence, target_reasons,
    'ACCEPTED', true, now()
  )
  on conflict (canonical_product_id, retailer_product_id) do update set
    match_type = excluded.match_type,
    method = excluded.method,
    score = excluded.score,
    confidence = excluded.confidence,
    reasons = excluded.reasons,
    status = 'ACCEPTED',
    reviewed = true,
    reviewed_at = now()
  returning *;
end;
$$;

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
        and product_match.status = 'ACCEPTED'
    ),
    null::timestamptz
  from public.retailer_products product
  left join public.product_offers offer
    on offer.retailer_product_id = product.id
   and offer.market_id = target_market_id
  where product.retailer_id = target_retailer_id
    and product.market_id = target_market_id
    and product.active;
$$;

revoke all on function public.search_product_match_candidates(text, text, text, integer) from public;
revoke all on function public.accept_product_match(uuid) from public;
revoke all on function public.reject_product_match(uuid) from public;
revoke all on function public.change_product_match(uuid, uuid, text, text, numeric, text, jsonb) from public;
grant execute on function public.search_product_match_candidates(text, text, text, integer) to service_role;
grant execute on function public.accept_product_match(uuid) to service_role;
grant execute on function public.reject_product_match(uuid) to service_role;
grant execute on function public.change_product_match(uuid, uuid, text, text, numeric, text, jsonb) to service_role;

comment on table public.canonical_products is
  'Retailer-independent comparable concepts. Commercial identity fields are optional and never replace retailer SKU identity.';
comment on table public.product_matches is
  'Explainable proposals and reviewed associations between retailer SKUs and canonical concepts.';
comment on function public.search_product_match_candidates is
  'Bounded GTIN/trigram candidate retrieval; deterministic business scoring remains in the application layer.';
