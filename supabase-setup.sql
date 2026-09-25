-- PHOTO ARCHIVE v10 — база для настоящего входа и сохранения категорий/альбомов.
-- Выполните этот файл в Supabase SQL Editor ПОСЛЕ создания первого пользователя в Authentication → Users.
-- В конце файла замените YOUR_OWNER_USER_UUID на UUID этого пользователя.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  access text not null default 'public' check (access in ('public','password','link')),
  cover_url text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.albums enable row level security;

-- Проверка роли вынесена в security definer, чтобы политики profiles не зацикливались.
create or replace function public.is_archive_staff()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('owner','admin')
  );
$$;

revoke all on function public.is_archive_staff() from public;
grant execute on function public.is_archive_staff() to anon, authenticated;

-- Минимальные grants: посетитель только читает; вошедший пользователь пишет только если RLS разрешит.
revoke all on table public.profiles, public.categories, public.albums from anon, authenticated;
grant select on public.categories, public.albums to anon, authenticated;
grant insert, update, delete on public.categories, public.albums to authenticated;
grant select on public.profiles to authenticated;

-- Удаляем политики с такими именами, чтобы скрипт можно было выполнить повторно.
drop policy if exists "categories_public_read" on public.categories;
drop policy if exists "categories_staff_insert" on public.categories;
drop policy if exists "categories_staff_update" on public.categories;
drop policy if exists "categories_staff_delete" on public.categories;
drop policy if exists "albums_public_read" on public.albums;
drop policy if exists "albums_staff_read" on public.albums;
drop policy if exists "albums_staff_insert" on public.albums;
drop policy if exists "albums_staff_update" on public.albums;
drop policy if exists "albums_staff_delete" on public.albums;
drop policy if exists "profiles_self_read" on public.profiles;

create policy "categories_public_read" on public.categories for select to anon, authenticated using (true);
create policy "categories_staff_insert" on public.categories for insert to authenticated with check (public.is_archive_staff());
create policy "categories_staff_update" on public.categories for update to authenticated using (public.is_archive_staff()) with check (public.is_archive_staff());
create policy "categories_staff_delete" on public.categories for delete to authenticated using (public.is_archive_staff());

create policy "albums_public_read" on public.albums for select to anon using (access = 'public');
create policy "albums_staff_read" on public.albums for select to authenticated using (public.is_archive_staff() or access = 'public');
create policy "albums_staff_insert" on public.albums for insert to authenticated with check (public.is_archive_staff());
create policy "albums_staff_update" on public.albums for update to authenticated using (public.is_archive_staff()) with check (public.is_archive_staff());
create policy "albums_staff_delete" on public.albums for delete to authenticated using (public.is_archive_staff());

create policy "profiles_self_read" on public.profiles for select to authenticated using (id = (select auth.uid()));

-- ВАЖНО: замените UUID ниже на UUID владельца из Authentication → Users.
-- Пример: insert into public.profiles(id, role) values ('123e4567-e89b-12d3-a456-426614174000','owner');
-- insert into public.profiles(id, role) values ('YOUR_OWNER_USER_UUID','owner');
