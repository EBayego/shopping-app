create function public.record_product_offer_price_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or old.normal_price is distinct from new.normal_price
    or old.promo_price is distinct from new.promo_price
    or old.price_per_unit is distinct from new.price_per_unit
    or old.reference_unit is distinct from new.reference_unit
  then
    insert into public.price_history (
      product_offer_id,
      normal_price,
      promo_price,
      price_per_unit,
      reference_unit,
      observed_at
    ) values (
      new.id,
      new.normal_price,
      new.promo_price,
      new.price_per_unit,
      new.reference_unit,
      new.observed_at
    );
  end if;

  return new;
end;
$$;

create trigger record_product_offer_price_change
after insert or update on public.product_offers
for each row execute function public.record_product_offer_price_change();

comment on table public.price_history is 'Append-only price changes captured from product_offers; identical observations are not duplicated.';
