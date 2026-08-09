insert into public.retailers (id, code, name)
values
  ('00000000-0000-4000-8000-000000000001', 'DIA', 'DIA'),
  ('00000000-0000-4000-8000-000000000002', 'MERCADONA', 'Mercadona'),
  ('00000000-0000-4000-8000-000000000003', 'ALCAMPO', 'Alcampo'),
  ('00000000-0000-4000-8000-000000000004', 'EROSKI', 'Eroski')
on conflict (code) do update
set name = excluded.name,
    active = true;
