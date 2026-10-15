-- Reference quantities are used only to compare generic requests. They do not
-- constrain free entry or require the user to choose a brand or package size.
insert into public.product_concepts (
  name, normalized_name, base_name, category, normalized_category, aliases,
  category_terms, excluded_terms, specialty_terms, default_dimension, default_amount, default_unit
) values
  ('Pan', 'pan', 'pan', 'Panadería', 'panaderia', array['pan','baguette'],
   array['pan','panaderia'], array['rallado','molde','tostado','hamburguesa','hot dog','perrito'],
   array['integral','sin gluten','semillas'], 'MASS', 250, 'g'),
  ('Arroz', 'arroz', 'arroz', 'Arroz y pasta', 'arroz y pasta', array['arroz'],
   array['arroz','cereales'], array['bebida','harina','tortitas','preparado','caldo','cocido','tres delicias','con pollo','con verduras','ensalada'],
   array['integral','basmati','vaporizado','bomba','sushi'], 'MASS', 1, 'kg'),
  ('Pasta', 'pasta', 'pasta', 'Arroz y pasta', 'arroz y pasta', array['pasta','macarrones','espaguetis','espagueti','spaghetti'],
   array['pasta','arroz y pasta'], array['dientes','dental','hojaldre','quebrada','untable','rellena'],
   array['integral','sin gluten','huevo'], 'MASS', 500, 'g'),
  ('Aceite de oliva', 'aceite de oliva', 'aceite', 'Aceites', 'aceites', array['aceite de oliva','aceite oliva'],
   array['aceite','aceites'], array['cosmetico','corporal'], array['virgen','ecologico'], 'VOLUME', 1, 'l'),
  ('Agua', 'agua', 'agua', 'Bebidas', 'bebidas', array['agua','agua mineral'],
   array['agua','aguas','bebidas'], array['oxigenada','colonia','micelar','agua de mar','agua de coco','azahar'],
   array['con gas','sabor','limon','fruta','vitamina'], 'VOLUME', 1, 'l'),
  ('Azúcar', 'azucar', 'azucar', 'Repostería', 'reposteria', array['azucar'],
   array['azucar','endulzantes','reposteria'], array['sin azucar','cero azucar','edulcorante','vainillado'],
   array['moreno','panela','glas'], 'MASS', 1, 'kg'),
  ('Sal', 'sal', 'sal', 'Condimentos', 'condimentos', array['sal'],
   array['sal','especias','condimentos'], array['sin sal','baja en sal','sales de bano','lavavajillas'],
   array['escamas','himalaya','ahumada'], 'MASS', 1, 'kg'),
  ('Harina', 'harina', 'harina', 'Repostería', 'reposteria', array['harina'],
   array['harina','harinas','reposteria'], array['sin harina'],
   array['sin gluten','integral','almendra','arroz','maiz','garbanzo'], 'MASS', 1, 'kg'),
  ('Plátanos', 'platano', 'platano', 'Fruta y verdura', 'fruta y verdura', array['platano','platanos','banana','bananas'],
   array['fruta','fruteria'], array['batido','bebida','yogur','helado','compota'],
   array['deshidratado','chips'], 'MASS', 175, 'g'),
  ('Manzanas', 'manzana', 'manzana', 'Fruta y verdura', 'fruta y verdura', array['manzana','manzanas'],
   array['fruta','fruteria'], array['zumo','bebida','yogur','helado','compota','vinagre','tarta'],
   array['deshidratada','chips'], 'MASS', 175, 'g'),
  ('Tomates', 'tomate', 'tomate', 'Fruta y verdura', 'fruta y verdura', array['tomate','tomates'],
   array['verdura','hortaliza','fruta y verdura'], array['triturado','frito','seco','salsa','ketchup','concentrado','pelado','conserva'],
   array['cherry'], 'MASS', 150, 'g'),
  ('Yogur natural', 'yogur natural', 'yogur', 'Lácteos', 'lacteos', array['yogur natural','yogurt natural','yogures naturales'],
   array['yogur','yogures','lacteos'], array['vegetal','soja','avena','almendra','coco'],
   array['griego','azucarado','sin lactosa','proteina'], 'MASS', 125, 'g')
on conflict (normalized_name) do nothing;

-- Preserve all existing classifications, including human rejections. Only
-- previously unclassified products matching the new concepts are backfilled.
do $$
declare product record;
begin
  for product in
    select item.id from public.retailer_products item
    where item.active and not exists (
      select 1 from public.retailer_product_concepts classification where classification.retailer_product_id = item.id
    ) and exists (
      select 1 from public.product_concepts concept cross join lateral unnest(concept.aliases) alias
      where concept.normalized_name in ('pan','arroz','pasta','aceite de oliva','agua','azucar','sal','harina','platano','manzana','tomate','yogur natural')
        and private.catalog_text_contains(private.normalize_catalog_search_text(item.name), alias)
    )
  loop
    perform private.classify_retailer_product(product.id);
  end loop;
end;
$$;

update public.shopping_intents item set normalized_name = item.normalized_name
where item.product_concept_id is null and exists (
  select 1 from private.resolve_product_concept(item.normalized_name)
);
