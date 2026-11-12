begin;

alter table public.products enable row level security;
grant insert, update, delete on public.products to authenticated;
grant usage on sequence public.products_id_seq to authenticated;

drop policy if exists "bot can insert products" on public.products;
drop policy if exists "bot can update products" on public.products;
drop policy if exists "bot can delete products" on public.products;

drop policy if exists "Talaria catalog administrators" on public.products;
create policy "Talaria catalog administrators" on public.products
  for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'talaria_role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'talaria_role') = 'admin');

commit;
