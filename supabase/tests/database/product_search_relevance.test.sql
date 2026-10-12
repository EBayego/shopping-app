begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  is_anonymous, created_at, updated_at
)
values ('00000000-0000-0000-0000-000000000000', 'a7111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', '{}', '{}', true, now(), now());
insert into public.groups (id, name, created_by)
values ('a7000000-0000-4000-8000-000000000001', 'Relevance group', 'a7111111-1111-4111-8111-111111111111');
insert into public.group_members (group_id, profile_id, role, added_by)
values ('a7000000-0000-4000-8000-000000000001', 'a7111111-1111-4111-8111-111111111111', 'owner', 'a7111111-1111-4111-8111-111111111111');
insert into public.shopping_lists (id, group_id, name, postal_code, created_by)
values ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'Relevance list', '28001', 'a7111111-1111-4111-8111-111111111111');
insert into public.retailer_markets (id, retailer_id, external_id, name)
values ('a7000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'relevance-madrid', 'Relevance Madrid');
insert into public.retailer_market_postal_codes (retailer_id, market_id, postal_code)
values ('00000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000011', '28001');

insert into public.retailer_products (
  retailer_id, market_id, external_id, name, brand, category, subcategory,
  observed_at, last_seen_at
)
select '00000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000011',
  product.external_id, product.name, product.brand, product.category, product.subcategory, now(), now()
from (values
  ('milk', 'Leche entera DIA 1 L', 'DIA', 'Huevos, leche y mantequilla', 'Leche'),
  ('milk-special', 'Leche sin lactosa DIA 1 L', 'DIA', 'Huevos, leche y mantequilla', 'Leche sin lactosa y enriquecidas'),
  ('milk-unconfirmed', 'Leche fresca de granja 1 L', 'Granja', null, null),
  ('bread', '6 Panes de leche 3%', null, 'Pan de horno', 'Pan de bocadillo'),
  ('baby-food', 'Alimento infantil con puré de mango, plátano, leche y avena Nestlé 110 g', 'Nestlé', 'Infantil', 'Bolsitas y snacks'),
  ('condensed-milk', 'Leche condensada DIA', 'DIA', 'Huevos, leche y mantequilla', 'Leche condensada y evaporada'),
  ('body-milk', 'Leche corporal hidratante', null, 'Cuidado corporal', 'Crema corporal'),
  ('potatoes', 'Patatas para freír 3 kg', null, 'Verduras', 'Patatas y zanahorias'),
  ('potatoes-unconfirmed', 'Patatas nuevas 1 kg', null, null, null),
  ('chips', 'LAY''S Al punto de sal Patatas fritas lisas de bolsa 150 g', 'LAY''S', 'Aperitivos y frutos secos', 'Patatas fritas'),
  ('frozen-potatoes', 'Patatas congeladas para freír 1 kg', null, 'Congelados y helados', 'Verduras y patatas'),
  ('potato-puree', 'Puré de patatas 250 g', null, 'Conservas, caldos y cremas', 'Cremas y purés'),
  ('oats', 'Avena molida Hacendado', null, 'Cereales', 'Cereales integrales y muesli'),
  ('oat-flakes', 'Copos de avena Brüggen', null, 'Cereales', 'Cereales integrales y muesli'),
  ('oat-drink', 'Bebida de avena Alitey', 'Alitey', 'Leche y bebidas vegetales', 'Bebidas vegetales'),
  ('oat-gel', 'Gel de ducha avena 1 L', null, 'Higiene y cuidado del cuerpo', 'Gel de ducha y esponjas'),
  ('oat-cookies', 'Galletas avena Hacendado', null, 'Galletas', 'Galletas integrales y digestive'),
  ('water', 'Agua mineral Dia 1 L', 'Dia', 'Agua y refrescos', 'Agua'),
  ('branded-water', 'BEZOYA Agua mineral 1,5 L', 'Bezoya', 'Agua y refrescos', 'Agua'),
  ('micellar-water', 'Agua micelar hidratante', null, 'Cuidado e higiene facial', 'Limpieza de cara'),
  ('cleaning-water', 'Agua fuerte Dia 1 L', 'Dia', 'Limpieza y hogar', 'Lejía y desinfectantes'),
  ('apples', 'Manzanas Golden 1 kg', null, 'Fruta', 'Manzanas'),
  ('apple-cake', 'Bizcocho con manzanas 500 g', null, 'Panadería', 'Bizcochos'),
  ('rice', 'Arroz largo 1 kg', null, 'Arroz, pastas y legumbres', 'Arroz'),
  ('rice-dessert', 'Arroz con leche 200 g', null, 'Yogures y postres', 'Natillas, flan y arroz con leche'),
  ('brand-only', 'Copos integrales 500 g', 'Brüggen', 'Cereales', 'Cereales integrales y muesli'),
  ('unknown-category', 'Quinoa blanca 500 g', null, null, null)
) product(external_id, name, brand, category, subcategory);

insert into public.product_offers (retailer_id, retailer_product_id, market_id, normal_price, available, observed_at)
select retailer_id, id, market_id, 1.50, true, now()
from public.retailer_products where market_id = 'a7000000-0000-4000-8000-000000000011';

-- Compare result positions across standalone and grouped products.
create function pg_temp.product_position(results jsonb, external_id text)
returns numeric language sql as $$
  select min(result.ordinality + product.ordinality / 1000::numeric)
  from jsonb_array_elements(results) with ordinality result(item, ordinality)
  cross join lateral jsonb_array_elements(result.item->'retailerProducts') with ordinality product(item, ordinality)
  where product.item->>'externalId' = external_id;
$$;

select extensions.has_index('public', 'retailer_products', 'retailer_products_search_document_idx', 'weighted full-text retrieval has a GIN index');
select extensions.ok(
  (select not ('panes de leche' = any(excluded_terms)) from public.product_concepts where normalized_name = 'leche'),
  'ranking adds no product-specific exclusion rules'
);
select set_config('request.jwt.claims', '{"sub":"a7111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}', true);
set local role authenticated;

create temp table relevance_results as
select term, public.search_products_for_list('a7000000-0000-4000-8000-000000000002', term, 50) as results
from unnest(array['leche', 'patatas', 'avena', 'agua', 'manzanas', 'arroz', 'patatas fritas',
  'bebida de avena', 'agua micelar', 'leche condensada', 'pan de leche', 'copos de avena',
  'bruggen', 'quinoa', 'patata', 'papas', 'lechee', '  LECHE  ', 'leche sin lactosa']) term;

select extensions.is(
  public.search_products_for_list('a7000000-0000-4000-8000-000000000002', 'leche', 1)->0->'concept'->>'name',
  'Leche', 'ordinary milk ranks first before the limit'
);
select extensions.ok((select pg_temp.product_position(results, 'milk') < pg_temp.product_position(results, 'bread') from relevance_results where term = 'leche'), 'milk ranks above bread with milk');
select extensions.ok((select pg_temp.product_position(results, 'milk') < pg_temp.product_position(results, 'baby-food') from relevance_results where term = 'leche'), 'milk ranks above an ingredient mention in baby food');
select extensions.ok((select pg_temp.product_position(results, 'bread') is not null from relevance_results where term = 'leche'), 'related milk bread remains discoverable');
select extensions.ok((select pg_temp.product_position(results, 'body-milk') is not null from relevance_results where term = 'leche'), 'body milk is ranked rather than excluded');
select extensions.is(
  public.search_products_for_list('a7000000-0000-4000-8000-000000000002', 'patatas', 1)->0->'concept'->>'name',
  'Patatas', 'fresh potatoes rank first before the limit'
);
select extensions.ok((select pg_temp.product_position(results, 'potatoes') < pg_temp.product_position(results, 'chips') from relevance_results where term = 'patatas'), 'fresh potatoes rank above Lays');
select extensions.ok((select pg_temp.product_position(results, 'chips') is not null from relevance_results where term = 'patatas'), 'related chips remain discoverable');
select extensions.ok((select pg_temp.product_position(results, 'potatoes-unconfirmed') is not null from relevance_results where term = 'patatas'), 'missing categories do not hide fresh potatoes');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'avena'), 'oats', 'oats rank first without a predefined concept');
select extensions.ok((select pg_temp.product_position(results, 'oat-flakes') < pg_temp.product_position(results, 'oat-drink') from relevance_results where term = 'avena'), 'inferred category context puts oat flakes above oat drinks');
select extensions.ok((select pg_temp.product_position(results, 'oat-flakes') < pg_temp.product_position(results, 'oat-gel') from relevance_results where term = 'avena'), 'oats rank above oat cosmetics');
select extensions.ok((select pg_temp.product_position(results, 'oat-cookies') is not null from relevance_results where term = 'avena'), 'related oat cookies remain discoverable');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'agua'), 'water', 'drinking water ranks first without a predefined concept');
select extensions.ok((select pg_temp.product_position(results, 'water') < pg_temp.product_position(results, 'micellar-water') from relevance_results where term = 'agua'), 'category evidence separates drinking water from cosmetics');
select extensions.ok((select pg_temp.product_position(results, 'branded-water') < pg_temp.product_position(results, 'cleaning-water') from relevance_results where term = 'agua'), 'category evidence works when a brand precedes the product name');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'manzanas'), 'apples', 'the same ranking works for fruit');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'arroz'), 'rice', 'rice ranks above rice desserts');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'patatas fritas'), 'chips', 'explicit chips outrank partial fresh-potato matches');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'bebida de avena'), 'oat-drink', 'a specific drink query changes the category context');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'agua micelar'), 'micellar-water', 'a specific cosmetic query outranks generic drinking water');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'leche condensada'), 'condensed-milk', 'all query words outrank a partial concept match');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'pan de leche'), 'bread', 'Spanish stemming matches singular bread to plural names');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'copos de avena'), 'oat-flakes', 'an explicit oat format ranks first');
select extensions.ok((select pg_temp.product_position(results, 'brand-only') is not null from relevance_results where term = 'bruggen'), 'brands are searchable even when absent from the name');
select extensions.is((select results->0->'retailerProducts'->0->>'externalId' from relevance_results where term = 'quinoa'), 'unknown-category', 'missing taxonomy falls back to text relevance');
select extensions.is((select results->0->'concept'->>'name' from relevance_results where term = 'papas'), 'Patatas', 'existing concept aliases are preserved');
select extensions.is((select results->0->'concept'->>'name' from relevance_results where term = 'lechee'), 'Leche', 'trigram fallback preserves typo tolerance');
select extensions.is((select results->0->'concept'->>'name' from relevance_results where term = '  LECHE  '), 'Leche', 'case and whitespace are normalized');

select * from extensions.finish();
rollback;
