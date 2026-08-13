begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

select extensions.has_table(
  'public',
  'shopping_list_retailer_preferences',
  'shopping list retailer preferences exist'
);

select extensions.has_column(
  'public',
  'shopping_list_retailer_preferences',
  'enabled',
  'retailer preferences expose an enabled flag'
);

select extensions.col_default_is(
  'public',
  'shopping_list_retailer_preferences',
  'enabled',
  'true',
  'retailers are enabled by default'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.shopping_list_retailer_preferences'::regclass),
  'retailer preferences enable row level security'
);

select extensions.ok(
  has_table_privilege('authenticated', 'public.shopping_list_retailer_preferences', 'SELECT'),
  'authenticated users can read authorized retailer preferences'
);

select extensions.has_function(
  'public',
  'set_shopping_list_retailer_enabled',
  array['uuid', 'uuid', 'boolean'],
  'retailer preferences expose an authorized update RPC'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.set_shopping_list_retailer_enabled(uuid, uuid, boolean)',
    'EXECUTE'
  ),
  'authenticated users can execute the authorized preference RPC'
);

select * from extensions.finish();

rollback;
