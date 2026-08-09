create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.group_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  code_hash bytea not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint group_invites_expiry_after_creation check (expires_at > created_at),
  constraint group_invites_max_uses_positive check (max_uses > 0),
  constraint group_invites_use_count_valid check (use_count between 0 and max_uses)
);

create index group_invites_group_id_idx on private.group_invites (group_id);
create index group_invites_expires_at_idx on private.group_invites (expires_at);

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

insert into public.profiles (id, display_name)
select id, nullif(btrim(raw_user_meta_data ->> 'display_name'), '')
from auth.users
on conflict (id) do nothing;

create trigger create_profile_after_auth_user
after insert on auth.users
for each row execute function private.handle_new_user();

create function private.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and profile_id = auth.uid()
  );
$$;

create function private.is_group_owner(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and profile_id = auth.uid()
      and role = 'owner'
  );
$$;

create function private.can_access_list(target_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shopping_lists as shopping_list
    join public.group_members as membership
      on membership.group_id = shopping_list.group_id
    where shopping_list.id = target_list_id
      and membership.profile_id = auth.uid()
  );
$$;

create function private.shares_group_with(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as own_membership
    join public.group_members as target_membership
      on target_membership.group_id = own_membership.group_id
    where own_membership.profile_id = auth.uid()
      and target_membership.profile_id = target_profile_id
  );
$$;

revoke all on function private.is_group_member(uuid) from public, anon;
revoke all on function private.is_group_owner(uuid) from public, anon;
revoke all on function private.can_access_list(uuid) from public, anon;
revoke all on function private.shares_group_with(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_owner(uuid) to authenticated;
grant execute on function private.can_access_list(uuid) to authenticated;
grant execute on function private.shares_group_with(uuid) to authenticated;

alter table public.shopping_lists
  alter column created_by set default auth.uid();
alter table public.shopping_intents
  alter column created_by set default auth.uid();

create function public.create_group_with_initial_list(
  group_name text,
  list_name text,
  postal_code text
)
returns table (group_id uuid, shopping_list_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_group_id uuid;
  created_list_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if nullif(btrim(group_name), '') is null then
    raise exception using errcode = '22023', message = 'Group name is required';
  end if;

  if nullif(btrim(list_name), '') is null then
    raise exception using errcode = '22023', message = 'List name is required';
  end if;

  if postal_code is null or postal_code !~ '^[0-9]{5}$' then
    raise exception using errcode = '22023', message = 'Postal code must contain five digits';
  end if;

  if not exists (select 1 from public.profiles where id = actor_id) then
    raise exception using errcode = '42501', message = 'Authenticated profile not found';
  end if;

  insert into public.groups (name, created_by)
  values (btrim(group_name), actor_id)
  returning id into created_group_id;

  insert into public.group_members (group_id, profile_id, role, added_by)
  values (created_group_id, actor_id, 'owner', actor_id);

  insert into public.shopping_lists (group_id, name, postal_code, created_by)
  values (created_group_id, btrim(list_name), postal_code, actor_id)
  returning id into created_list_id;

  return query select created_group_id, created_list_id;
end;
$$;

create function public.generate_group_invite(
  target_group_id uuid,
  expires_in interval default interval '7 days',
  allowed_uses integer default 1
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invite_code text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and profile_id = actor_id
      and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Only a group owner can create invites';
  end if;

  if expires_in < interval '5 minutes' or expires_in > interval '30 days' then
    raise exception using errcode = '22023', message = 'Invite expiry must be between 5 minutes and 30 days';
  end if;

  if allowed_uses < 1 or allowed_uses > 100 then
    raise exception using errcode = '22023', message = 'Allowed uses must be between 1 and 100';
  end if;

  invite_code := encode(extensions.gen_random_bytes(24), 'hex');

  insert into private.group_invites (
    group_id,
    code_hash,
    created_by,
    expires_at,
    max_uses
  ) values (
    target_group_id,
    extensions.digest(invite_code, 'sha256'),
    actor_id,
    now() + expires_in,
    allowed_uses
  );

  return invite_code;
end;
$$;

create function public.join_group_by_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invitation private.group_invites%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if nullif(btrim(invite_code), '') is null then
    raise exception using errcode = '22023', message = 'Invite code is required';
  end if;

  select *
  into invitation
  from private.group_invites
  where code_hash = extensions.digest(btrim(invite_code), 'sha256')
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Invite code is invalid or expired';
  end if;

  if exists (
    select 1
    from public.group_members
    where group_id = invitation.group_id
      and profile_id = actor_id
  ) then
    return invitation.group_id;
  end if;

  if invitation.expires_at <= now() or invitation.use_count >= invitation.max_uses then
    raise exception using errcode = '22023', message = 'Invite code is invalid or expired';
  end if;

  insert into public.group_members (group_id, profile_id, role, added_by)
  values (invitation.group_id, actor_id, 'member', invitation.created_by);

  update private.group_invites
  set use_count = use_count + 1
  where id = invitation.id;

  return invitation.group_id;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.record_product_offer_price_change() from public, anon, authenticated;
revoke all on function public.create_group_with_initial_list(text, text, text) from public, anon;
revoke all on function public.generate_group_invite(uuid, interval, integer) from public, anon;
revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.create_group_with_initial_list(text, text, text) to authenticated;
grant execute on function public.generate_group_invite(uuid, interval, integer) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, delete on public.groups to authenticated;
grant update (name) on public.groups to authenticated;

grant select on public.group_members to authenticated;

grant select, delete on public.shopping_lists to authenticated;
grant insert (group_id, name, postal_code, created_by) on public.shopping_lists to authenticated;
grant update (name, postal_code) on public.shopping_lists to authenticated;

grant select, delete on public.shopping_intents to authenticated;
grant insert (
  shopping_list_id,
  raw_text,
  normalized_name,
  requested_quantity,
  requested_unit,
  package_count,
  package_size,
  package_unit,
  total_amount,
  brand_preference,
  variant,
  canonical_product_id,
  checked,
  created_by
) on public.shopping_intents to authenticated;
grant update (
  raw_text,
  normalized_name,
  requested_quantity,
  requested_unit,
  package_count,
  package_size,
  package_unit,
  total_amount,
  brand_preference,
  variant,
  canonical_product_id,
  checked
) on public.shopping_intents to authenticated;

grant select on public.canonical_products to authenticated;
grant select on public.retailers to authenticated;
grant select on public.retailer_markets to authenticated;
grant select on public.retailer_market_postal_codes to authenticated;
grant select on public.retailer_products to authenticated;
grant select on public.product_offers to authenticated;
grant select on public.price_history to authenticated;
grant select on public.product_matches to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_intents enable row level security;
alter table public.canonical_products enable row level security;
alter table public.retailers enable row level security;
alter table public.retailer_markets enable row level security;
alter table public.retailer_market_postal_codes enable row level security;
alter table public.retailer_products enable row level security;
alter table public.product_offers enable row level security;
alter table public.price_history enable row level security;
alter table public.product_matches enable row level security;
alter table public.provider_health enable row level security;
alter table public.provider_sync_runs enable row level security;

create policy profiles_select_shared_groups
on public.profiles
for select
to authenticated
using (id = auth.uid() or private.shares_group_with(id));

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy groups_select_members
on public.groups
for select
to authenticated
using (private.is_group_member(id));

create policy groups_update_owners
on public.groups
for update
to authenticated
using (private.is_group_owner(id))
with check (private.is_group_owner(id));

create policy groups_delete_owners
on public.groups
for delete
to authenticated
using (private.is_group_owner(id));

create policy group_members_select_group_members
on public.group_members
for select
to authenticated
using (private.is_group_member(group_id));

create policy shopping_lists_select_members
on public.shopping_lists
for select
to authenticated
using (private.is_group_member(group_id));

create policy shopping_lists_insert_members
on public.shopping_lists
for insert
to authenticated
with check (private.is_group_member(group_id) and created_by = auth.uid());

create policy shopping_lists_update_members
on public.shopping_lists
for update
to authenticated
using (private.is_group_member(group_id))
with check (private.is_group_member(group_id));

create policy shopping_lists_delete_members
on public.shopping_lists
for delete
to authenticated
using (private.is_group_member(group_id));

create policy shopping_intents_select_members
on public.shopping_intents
for select
to authenticated
using (private.can_access_list(shopping_list_id));

create policy shopping_intents_insert_members
on public.shopping_intents
for insert
to authenticated
with check (private.can_access_list(shopping_list_id) and created_by = auth.uid());

create policy shopping_intents_update_members
on public.shopping_intents
for update
to authenticated
using (private.can_access_list(shopping_list_id))
with check (private.can_access_list(shopping_list_id));

create policy shopping_intents_delete_members
on public.shopping_intents
for delete
to authenticated
using (private.can_access_list(shopping_list_id));

create policy canonical_products_read_authenticated
on public.canonical_products for select to authenticated using (true);
create policy retailers_read_authenticated
on public.retailers for select to authenticated using (true);
create policy retailer_markets_read_authenticated
on public.retailer_markets for select to authenticated using (true);
create policy retailer_market_postal_codes_read_authenticated
on public.retailer_market_postal_codes for select to authenticated using (true);
create policy retailer_products_read_authenticated
on public.retailer_products for select to authenticated using (true);
create policy product_offers_read_authenticated
on public.product_offers for select to authenticated using (true);
create policy price_history_read_authenticated
on public.price_history for select to authenticated using (true);
create policy product_matches_read_authenticated
on public.product_matches for select to authenticated using (true);

comment on table private.group_invites is 'Invite codes are stored only as SHA-256 hashes outside exposed API schemas.';
comment on function public.create_group_with_initial_list(text, text, text) is 'Atomically creates a group, owner membership, and initial shopping list for auth.uid().';
comment on function public.generate_group_invite(uuid, interval, integer) is 'Creates a cryptographically random invite code; only its hash is persisted.';
comment on function public.join_group_by_invite(text) is 'Atomically validates and consumes an invite without exposing invite storage.';
