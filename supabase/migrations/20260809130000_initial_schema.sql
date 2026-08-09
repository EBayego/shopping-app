create extension if not exists pgcrypto with schema extensions;

create type public.group_member_role as enum ('owner', 'member');
create type public.provider_health_status as enum ('healthy', 'degraded', 'unavailable');
create type public.provider_sync_status as enum ('running', 'succeeded', 'failed');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_not_blank check (display_name is null or btrim(display_name) <> '')
);

create table public.groups (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_not_blank check (btrim(name) <> '')
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_member_role not null default 'member',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index group_members_profile_id_idx on public.group_members (profile_id);

create table public.canonical_products (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_products_name_not_blank check (btrim(name) <> ''),
  constraint canonical_products_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint canonical_products_normalized_name_key unique (normalized_name)
);

create table public.shopping_lists (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  postal_code text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_lists_name_not_blank check (btrim(name) <> ''),
  constraint shopping_lists_spanish_postal_code check (postal_code ~ '^[0-9]{5}$')
);

create index shopping_lists_group_id_idx on public.shopping_lists (group_id);
create index shopping_lists_postal_code_idx on public.shopping_lists (postal_code);

create table public.shopping_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists (id) on delete cascade,
  raw_text text not null,
  normalized_name text not null,
  requested_quantity numeric,
  requested_unit text,
  package_count integer,
  package_size numeric,
  package_unit text,
  total_amount numeric,
  brand_preference text,
  variant text,
  canonical_product_id uuid references public.canonical_products (id) on delete set null,
  checked boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_intents_raw_text_not_blank check (btrim(raw_text) <> ''),
  constraint shopping_intents_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint shopping_intents_requested_quantity_positive check (requested_quantity is null or requested_quantity > 0),
  constraint shopping_intents_requested_unit_valid check (requested_unit is null or requested_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  constraint shopping_intents_package_count_positive check (package_count is null or package_count > 0),
  constraint shopping_intents_package_size_positive check (package_size is null or package_size > 0),
  constraint shopping_intents_package_unit_valid check (package_unit is null or package_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  constraint shopping_intents_package_shape check ((package_size is null) = (package_unit is null)),
  constraint shopping_intents_total_amount_positive check (total_amount is null or total_amount > 0)
);

create index shopping_intents_list_id_idx on public.shopping_intents (shopping_list_id);
create index shopping_intents_canonical_product_id_idx on public.shopping_intents (canonical_product_id);
create index shopping_intents_created_by_idx on public.shopping_intents (created_by);
create index shopping_intents_open_idx on public.shopping_intents (shopping_list_id, created_at) where not checked;

create table public.retailers (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailers_code_format check (code ~ '^[A-Z][A-Z0-9_]*$'),
  constraint retailers_name_not_blank check (btrim(name) <> '')
);

create table public.retailer_markets (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  external_id text not null,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_markets_external_id_not_blank check (btrim(external_id) <> ''),
  constraint retailer_markets_retailer_external_id_key unique (retailer_id, external_id),
  constraint retailer_markets_id_retailer_id_key unique (id, retailer_id)
);

create index retailer_markets_retailer_id_idx on public.retailer_markets (retailer_id);

create table public.retailer_market_postal_codes (
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  market_id uuid not null,
  postal_code text not null,
  created_at timestamptz not null default now(),
  primary key (market_id, postal_code),
  constraint retailer_market_postal_codes_market_fk
    foreign key (market_id, retailer_id)
    references public.retailer_markets (id, retailer_id)
    on delete cascade,
  constraint retailer_market_postal_codes_retailer_postal_key unique (retailer_id, postal_code),
  constraint retailer_market_postal_codes_spanish_postal_code check (postal_code ~ '^[0-9]{5}$')
);

create index retailer_market_postal_codes_postal_code_idx
  on public.retailer_market_postal_codes (postal_code);

create table public.retailer_products (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  market_id uuid,
  external_id text not null,
  name text not null,
  brand text,
  gtin text,
  package_size numeric,
  package_unit text,
  package_count integer,
  total_amount numeric,
  variable_weight boolean not null default false,
  category text,
  subcategory text,
  image_url text,
  product_url text,
  raw_data jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_products_market_fk
    foreign key (market_id, retailer_id)
    references public.retailer_markets (id, retailer_id)
    on delete cascade,
  constraint retailer_products_external_id_not_blank check (btrim(external_id) <> ''),
  constraint retailer_products_name_not_blank check (btrim(name) <> ''),
  constraint retailer_products_gtin_format check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  constraint retailer_products_package_size_positive check (package_size is null or package_size > 0),
  constraint retailer_products_package_unit_valid check (package_unit is null or package_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  constraint retailer_products_package_shape check ((package_size is null) = (package_unit is null)),
  constraint retailer_products_package_count_positive check (package_count is null or package_count > 0),
  constraint retailer_products_total_amount_positive check (total_amount is null or total_amount > 0),
  constraint retailer_products_identity_key unique nulls not distinct (retailer_id, market_id, external_id),
  constraint retailer_products_id_retailer_id_key unique (id, retailer_id)
);

create index retailer_products_retailer_id_idx on public.retailer_products (retailer_id);
create index retailer_products_market_id_idx on public.retailer_products (market_id) where market_id is not null;
create index retailer_products_gtin_idx on public.retailer_products (gtin) where gtin is not null;

create table public.product_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  retailer_product_id uuid not null,
  market_id uuid not null,
  normal_price numeric(12, 4) not null,
  promo_price numeric(12, 4),
  price_per_unit numeric(12, 4),
  reference_unit text,
  promotion_type text,
  promotion_text text,
  requires_membership boolean not null default false,
  available boolean not null default true,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_offers_product_fk
    foreign key (retailer_product_id, retailer_id)
    references public.retailer_products (id, retailer_id)
    on delete cascade,
  constraint product_offers_market_fk
    foreign key (market_id, retailer_id)
    references public.retailer_markets (id, retailer_id)
    on delete cascade,
  constraint product_offers_product_market_key unique (retailer_product_id, market_id),
  constraint product_offers_normal_price_nonnegative check (normal_price >= 0),
  constraint product_offers_promo_price_nonnegative check (promo_price is null or promo_price >= 0),
  constraint product_offers_price_per_unit_nonnegative check (price_per_unit is null or price_per_unit >= 0),
  constraint product_offers_reference_unit_valid check (reference_unit is null or reference_unit in ('unit', 'g', 'kg', 'ml', 'l')),
  constraint product_offers_promotion_type_valid check (promotion_type is null or promotion_type in ('percentage', 'fixed_price', 'multi_buy', 'membership', 'other'))
);

create index product_offers_market_available_idx on public.product_offers (market_id, available);
create index product_offers_observed_at_idx on public.product_offers (observed_at desc);

create table public.price_history (
  id bigint generated always as identity primary key,
  product_offer_id uuid not null references public.product_offers (id) on delete cascade,
  normal_price numeric(12, 4) not null,
  promo_price numeric(12, 4),
  price_per_unit numeric(12, 4),
  reference_unit text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint price_history_normal_price_nonnegative check (normal_price >= 0),
  constraint price_history_promo_price_nonnegative check (promo_price is null or promo_price >= 0),
  constraint price_history_price_per_unit_nonnegative check (price_per_unit is null or price_per_unit >= 0),
  constraint price_history_reference_unit_valid check (reference_unit is null or reference_unit in ('unit', 'g', 'kg', 'ml', 'l'))
);

create index price_history_offer_observed_at_idx
  on public.price_history (product_offer_id, observed_at desc);

create table public.product_matches (
  id uuid primary key default extensions.gen_random_uuid(),
  canonical_product_id uuid not null references public.canonical_products (id) on delete cascade,
  retailer_product_id uuid not null references public.retailer_products (id) on delete cascade,
  match_method text not null default 'manual',
  confidence numeric(5, 4),
  matched_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_matches_retailer_product_key unique (retailer_product_id),
  constraint product_matches_method_valid check (match_method in ('manual', 'gtin', 'provider')),
  constraint product_matches_confidence_range check (confidence is null or confidence between 0 and 1)
);

create index product_matches_canonical_product_id_idx on public.product_matches (canonical_product_id);

create table public.provider_health (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  market_id uuid,
  status public.provider_health_status not null,
  checked_at timestamptz not null,
  latency_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_health_market_fk
    foreign key (market_id, retailer_id)
    references public.retailer_markets (id, retailer_id)
    on delete cascade,
  constraint provider_health_scope_key unique nulls not distinct (retailer_id, market_id),
  constraint provider_health_latency_nonnegative check (latency_ms is null or latency_ms >= 0)
);

create index provider_health_status_idx on public.provider_health (status, checked_at desc);

create table public.provider_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  market_id uuid,
  status public.provider_sync_status not null default 'running',
  sync_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  products_seen integer not null default 0,
  offers_seen integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_sync_runs_market_fk
    foreign key (market_id, retailer_id)
    references public.retailer_markets (id, retailer_id)
    on delete set null (market_id),
  constraint provider_sync_runs_sync_type_not_blank check (btrim(sync_type) <> ''),
  constraint provider_sync_runs_products_seen_nonnegative check (products_seen >= 0),
  constraint provider_sync_runs_offers_seen_nonnegative check (offers_seen >= 0),
  constraint provider_sync_runs_finished_after_start check (finished_at is null or finished_at >= started_at),
  constraint provider_sync_runs_status_finished_consistent check (
    (status = 'running' and finished_at is null)
    or (status in ('succeeded', 'failed') and finished_at is not null)
  )
);

create index provider_sync_runs_retailer_started_at_idx
  on public.provider_sync_runs (retailer_id, started_at desc);
create index provider_sync_runs_running_idx
  on public.provider_sync_runs (retailer_id, started_at)
  where status = 'running';

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'groups', 'canonical_products', 'shopping_lists',
    'shopping_intents', 'retailers', 'retailer_markets', 'retailer_products',
    'product_offers', 'product_matches', 'provider_health', 'provider_sync_runs'
  ]
  loop
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

comment on table public.shopping_intents is 'User demand as entered or parsed, independent from catalog products.';
comment on table public.canonical_products is 'Retailer-independent normalized product concepts; no fuzzy matching is implemented.';
comment on table public.retailer_products is 'Provider catalog records; external identity may be global or market-scoped.';
comment on table public.product_offers is 'Current market-specific commercial state for a retailer product.';
