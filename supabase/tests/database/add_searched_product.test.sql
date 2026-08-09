begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '81111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', '{}', '{}', true, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', '{}', '{}', true, now(), now());

insert into public.groups (id, name, created_by)
values ('80000000-0000-4000-8000-000000000001', 'Product group', '81111111-1111-4111-8111-111111111111');
insert into public.group_members (group_id, profile_id, role, added_by)
values ('80000000-0000-4000-8000-000000000001', '81111111-1111-4111-8111-111111111111', 'owner', '81111111-1111-4111-8111-111111111111');
insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values ('80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 'Product list', '28001', '81111111-1111-4111-8111-111111111111');
insert into public.canonical_products (id, name, normalized_name, base_name)
values ('80000000-0000-4000-8000-000000000003', 'Leche semidesnatada', 'leche semidesnatada', 'leche');

select set_config('request.jwt.claims', '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

select extensions.is(
  public.add_shopping_product_operation(
    '80000000-0000-4000-8000-000000000011',
    '80000000-0000-4000-8000-000000000002',
    'Leche semidesnatada', 'leche semidesnatada',
    '80000000-0000-4000-8000-000000000003'
  ) ->> 'canonical_product_id',
  '80000000-0000-4000-8000-000000000003',
  'a searched product is associated with its canonical product'
);

select extensions.is(
  public.add_shopping_product_operation(
    '80000000-0000-4000-8000-000000000012',
    '80000000-0000-4000-8000-000000000002',
    'Regalo para Marta', 'regalo para marta', null
  ) ->> 'canonical_product_id',
  null,
  'a free item remains valid without a canonical association'
);

with voice_intent as (
  select public.add_shopping_product_operation(
    '80000000-0000-4000-8000-000000000014',
    '80000000-0000-4000-8000-000000000002',
    'dos botellas de leche de dos litros', 'leche', null,
    null, null, 2, 2, 'l', 4, 'Pascual', 'semidesnatada'
  ) as result
)
select extensions.is(
  concat_ws(
    '|',
    result ->> 'package_count',
    result ->> 'package_size',
    result ->> 'package_unit',
    result ->> 'total_amount',
    result ->> 'brand_preference',
    result ->> 'variant'
  ),
  '2|2|l|4|Pascual|semidesnatada',
  'voice-parsed packaging, brand and variant are persisted'
)
from voice_intent;

select set_config('request.jwt.claims', '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}', true);
select extensions.throws_ok(
  $$select public.add_shopping_product_operation(
    '80000000-0000-4000-8000-000000000013',
    '80000000-0000-4000-8000-000000000002',
    'Leche', 'leche', null
  )$$,
  '42501',
  'Not authorized for this shopping list',
  'a user without list access cannot add through the product RPC'
);

select * from extensions.finish();
rollback;
