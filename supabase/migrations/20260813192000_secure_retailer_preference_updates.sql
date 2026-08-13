revoke insert, update on table public.shopping_list_retailer_preferences
  from authenticated;

drop policy if exists shopping_list_retailer_preferences_insert_members
  on public.shopping_list_retailer_preferences;
drop policy if exists shopping_list_retailer_preferences_update_members
  on public.shopping_list_retailer_preferences;

create function public.set_shopping_list_retailer_enabled(
  target_shopping_list_id uuid,
  target_retailer_id uuid,
  target_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not private.can_access_list(target_shopping_list_id) then
    raise exception using errcode = '42501', message = 'Not authorized for this shopping list';
  end if;
  if not exists (
    select 1
    from public.retailers retailer
    where retailer.id = target_retailer_id
      and retailer.active
  ) then
    raise exception using errcode = '22023', message = 'Unknown or inactive retailer';
  end if;

  insert into public.shopping_list_retailer_preferences (
    shopping_list_id,
    retailer_id,
    enabled
  ) values (
    target_shopping_list_id,
    target_retailer_id,
    target_enabled
  )
  on conflict (shopping_list_id, retailer_id) do update
  set enabled = excluded.enabled;
end;
$$;

revoke all on function public.set_shopping_list_retailer_enabled(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_shopping_list_retailer_enabled(uuid, uuid, boolean)
  to authenticated;

comment on function public.set_shopping_list_retailer_enabled(uuid, uuid, boolean) is
  'Updates one retailer display preference after verifying shopping-list membership.';
