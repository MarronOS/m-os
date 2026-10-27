-- M · OS v10 — base de datos NUEVA (Supabase → SQL Editor → pegar y ejecutar una vez)
-- Una sola tabla clave/valor: cada módulo guarda sus documentos como jsonb.
-- Solo AGREGA: no borra nada. Es seguro ejecutarlo más de una vez.

create table if not exists public.mos_kv (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

create index if not exists mos_kv_updated_idx on public.mos_kv (updated_at desc);

alter table public.mos_kv enable row level security;

-- App de un solo usuario protegida por PIN en el cliente: acceso con la clave anon.
-- (Ver README: para protegerla de verdad, cambia estas políticas a Supabase Auth.)
drop policy if exists "mos_kv anon select" on public.mos_kv;
drop policy if exists "mos_kv anon insert" on public.mos_kv;
drop policy if exists "mos_kv anon update" on public.mos_kv;
create policy "mos_kv anon select" on public.mos_kv for select to anon using (true);
create policy "mos_kv anon insert" on public.mos_kv for insert to anon with check (true);
create policy "mos_kv anon update" on public.mos_kv for update to anon using (true) with check (true);
-- Sin política de DELETE a propósito: la app nunca borra, solo archiva.

grant usage on schema public to anon;
grant select, insert, update on public.mos_kv to anon;
