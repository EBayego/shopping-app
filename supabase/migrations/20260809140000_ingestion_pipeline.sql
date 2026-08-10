alter table public.retailer_products
  add column active boolean not null default true,
  add column last_seen_at timestamptz,
  add column consecutive_misses integer not null default 0,
  add constraint retailer_products_consecutive_misses_nonnegative
    check (consecutive_misses >= 0);

update public.retailer_products
set last_seen_at = observed_at
where last_seen_at is null;

alter table public.retailer_products
  alter column last_seen_at set not null;

create index retailer_products_active_last_seen_idx
  on public.retailer_products (retailer_id, market_id, active, last_seen_at desc);

alter type public.provider_sync_status add value if not exists 'partial' after 'succeeded';

alter table public.provider_sync_runs
  drop constraint provider_sync_runs_status_finished_consistent,
  add constraint provider_sync_runs_status_finished_consistent check (
    (status::text = 'running' and finished_at is null)
    or (
      status::text in ('succeeded', 'partial', 'failed')
      and finished_at is not null
    )
  );

create function public.ingest_retailer_products_batch(
  target_retailer_id uuid,
  target_market_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(payload) is distinct from 'array' then
    raise exception 'payload must be a JSON array';
  end if;

  insert into public.retailer_products (
    retailer_id, market_id, external_id, name, brand, gtin,
    package_size, package_unit, package_count, total_amount, variable_weight,
    category, subcategory, image_url, product_url, raw_data, observed_at,
    last_seen_at, active, consecutive_misses
  )
  select
    target_retailer_id, target_market_id, item.external_id, item.name,
    item.brand, item.gtin, item.package_size, item.package_unit,
    item.package_count, item.total_amount, coalesce(item.variable_weight, false),
    item.category, item.subcategory, item.image_url, item.product_url,
    item.raw_data, item.observed_at, item.observed_at, true, 0
  from jsonb_to_recordset(payload) as item(
    external_id text,
    name text,
    brand text,
    gtin text,
    package_size numeric,
    package_unit text,
    package_count integer,
    total_amount numeric,
    variable_weight boolean,
    category text,
    subcategory text,
    image_url text,
    product_url text,
    raw_data jsonb,
    observed_at timestamptz
  )
  on conflict (retailer_id, market_id, external_id) do update set
    name = excluded.name,
    brand = excluded.brand,
    gtin = excluded.gtin,
    package_size = excluded.package_size,
    package_unit = excluded.package_unit,
    package_count = excluded.package_count,
    total_amount = excluded.total_amount,
    variable_weight = excluded.variable_weight,
    category = excluded.category,
    subcategory = excluded.subcategory,
    image_url = excluded.image_url,
    product_url = excluded.product_url,
    raw_data = excluded.raw_data,
    observed_at = excluded.observed_at,
    last_seen_at = greatest(public.retailer_products.last_seen_at, excluded.last_seen_at),
    active = true,
    consecutive_misses = 0
  where excluded.observed_at >= public.retailer_products.observed_at;
end;
$$;

create function public.ingest_product_offers_batch(
  target_retailer_id uuid,
  target_market_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(payload) is distinct from 'array' then
    raise exception 'payload must be a JSON array';
  end if;

  insert into public.product_offers (
    retailer_id, retailer_product_id, market_id, normal_price, promo_price,
    price_per_unit, reference_unit, promotion_type, promotion_text,
    requires_membership, available, observed_at
  )
  select
    target_retailer_id, product.id, target_market_id, item.normal_price,
    item.promo_price, item.price_per_unit, item.reference_unit,
    item.promotion_type, item.promotion_text,
    coalesce(item.requires_membership, false), coalesce(item.available, true),
    item.observed_at
  from jsonb_to_recordset(payload) as item(
    retailer_product_external_id text,
    normal_price numeric,
    promo_price numeric,
    price_per_unit numeric,
    reference_unit text,
    promotion_type text,
    promotion_text text,
    requires_membership boolean,
    available boolean,
    observed_at timestamptz
  )
  join public.retailer_products product
    on product.retailer_id = target_retailer_id
   and product.market_id = target_market_id
   and product.external_id = item.retailer_product_external_id
  on conflict (retailer_product_id, market_id) do update set
    normal_price = excluded.normal_price,
    promo_price = excluded.promo_price,
    price_per_unit = excluded.price_per_unit,
    reference_unit = excluded.reference_unit,
    promotion_type = excluded.promotion_type,
    promotion_text = excluded.promotion_text,
    requires_membership = excluded.requires_membership,
    available = excluded.available,
    observed_at = excluded.observed_at
  where excluded.observed_at >= public.product_offers.observed_at;

  if (select count(*) from jsonb_array_elements(payload)) <>
     (select count(*)
        from jsonb_to_recordset(payload) as item(retailer_product_external_id text)
        join public.retailer_products product
          on product.retailer_id = target_retailer_id
         and product.market_id = target_market_id
         and product.external_id = item.retailer_product_external_id)
  then
    raise exception 'one or more offers reference an unknown retailer product';
  end if;
end;
$$;

create function public.record_catalog_product_misses(
  target_retailer_id uuid,
  target_market_id uuid,
  seen_external_ids text[],
  required_misses integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if required_misses < 2 then
    raise exception 'required_misses must be at least 2';
  end if;

  update public.retailer_products
  set consecutive_misses = consecutive_misses + 1,
      active = (consecutive_misses + 1) < required_misses
  where retailer_id = target_retailer_id
    and market_id = target_market_id
    and not (external_id = any(coalesce(seen_external_ids, array[]::text[])));
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.list_price_refresh_candidates(
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
    and product.active;
$$;

comment on function public.record_catalog_product_misses is
  'Only call after a complete catalog scan. Search ingestion deliberately never calls it.';

revoke all on function public.ingest_retailer_products_batch(uuid, uuid, jsonb) from public;
revoke all on function public.ingest_product_offers_batch(uuid, uuid, jsonb) from public;
revoke all on function public.record_catalog_product_misses(uuid, uuid, text[], integer) from public;
revoke all on function public.list_price_refresh_candidates(uuid, uuid) from public;
grant execute on function public.ingest_retailer_products_batch(uuid, uuid, jsonb) to service_role;
grant execute on function public.ingest_product_offers_batch(uuid, uuid, jsonb) to service_role;
grant execute on function public.record_catalog_product_misses(uuid, uuid, text[], integer) to service_role;
grant execute on function public.list_price_refresh_candidates(uuid, uuid) to service_role;

comment on function public.list_price_refresh_candidates is
  'Returns known active products and reliable refresh facts. An unchecked matched shopping intent counts as active-list; last_used_at remains null until a real usage event source exists.';
