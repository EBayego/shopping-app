update public.shopping_intents
set requested_quantity = package_count,
    requested_unit = 'unit'
where package_count is not null;

create function private.sync_packaged_intent_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_count is not null and new.requested_quantity is not null then
    new.package_count := greatest(round(new.requested_quantity)::integer, 1);
    new.requested_quantity := new.package_count;
    new.requested_unit := 'unit';
    if new.package_size is not null then
      new.total_amount := new.package_count * new.package_size;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_packaged_intent_quantity() from public, anon, authenticated;

create trigger sync_packaged_intent_quantity
before update of requested_quantity on public.shopping_intents
for each row
when (new.package_count is not null)
execute function private.sync_packaged_intent_quantity();

comment on function private.sync_packaged_intent_quantity() is
  'Keeps the editable requested quantity, package count and calculated total aligned for packaged shopping intents.';
