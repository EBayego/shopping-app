create table public.shopping_list_retailer_preferences (
  shopping_list_id uuid not null references public.shopping_lists (id) on delete cascade,
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shopping_list_id, retailer_id)
);

create index shopping_list_retailer_preferences_retailer_id_idx
  on public.shopping_list_retailer_preferences (retailer_id);

create trigger set_shopping_list_retailer_preferences_updated_at
before update on public.shopping_list_retailer_preferences
for each row execute function public.set_updated_at();

alter table public.shopping_list_retailer_preferences enable row level security;

revoke all on table public.shopping_list_retailer_preferences
  from public, anon, authenticated;
grant select on table public.shopping_list_retailer_preferences to authenticated;
grant insert (shopping_list_id, retailer_id, enabled)
  on table public.shopping_list_retailer_preferences to authenticated;
grant update (enabled)
  on table public.shopping_list_retailer_preferences to authenticated;
grant all on table public.shopping_list_retailer_preferences to service_role;

create policy shopping_list_retailer_preferences_select_members
on public.shopping_list_retailer_preferences
for select
to authenticated
using (private.can_access_list(shopping_list_id));

create policy shopping_list_retailer_preferences_insert_members
on public.shopping_list_retailer_preferences
for insert
to authenticated
with check (private.can_access_list(shopping_list_id));

create policy shopping_list_retailer_preferences_update_members
on public.shopping_list_retailer_preferences
for update
to authenticated
using (private.can_access_list(shopping_list_id))
with check (private.can_access_list(shopping_list_id));

comment on table public.shopping_list_retailer_preferences is
  'Per-list display preferences. Missing rows mean enabled so newly introduced retailers remain visible by default.';
