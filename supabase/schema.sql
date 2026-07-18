-- Run this once in your Supabase project's SQL Editor (SQL Editor > New query).
-- It creates the 5 tables the app needs and opens them up to the app's anon key.

create extension if not exists "pgcrypto";

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists pieces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  length_seconds integer not null default 0,
  type text not null default 'normal',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Migration safety net: adds the column/constraint if this script is being
-- re-run against a project created before "type"/"archived" existed. No-op otherwise.
alter table pieces add column if not exists type text not null default 'normal';
alter table pieces add column if not exists archived boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pieces_type_check') then
    alter table pieces add constraint pieces_type_check check (type in ('normal', 'opener', 'closer'));
  end if;
end $$;

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  piece_id uuid not null references pieces(id) on delete cascade,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

-- Migration safety net for projects created before "required" existed.
alter table tracks add column if not exists required boolean not null default true;

create table if not exists costumes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  piece_id uuid not null references pieces(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  track_id uuid not null references tracks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists cast_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  person_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists saved_shows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  piece_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Row Level Security ------------------------------------------------------
-- Only signed-in users may read or write these tables. Combined with
-- disabling public sign-up in Supabase Auth (see README), this means only
-- the account(s) you create yourself can access the data.

alter table people enable row level security;
alter table pieces enable row level security;
alter table tracks enable row level security;
alter table costumes enable row level security;
alter table assignments enable row level security;
alter table cast_presets enable row level security;
alter table saved_shows enable row level security;

drop policy if exists "public access" on people;
drop policy if exists "public access" on pieces;
drop policy if exists "public access" on tracks;
drop policy if exists "public access" on costumes;
drop policy if exists "public access" on assignments;

drop policy if exists "authenticated access" on people;
drop policy if exists "authenticated access" on pieces;
drop policy if exists "authenticated access" on tracks;
drop policy if exists "authenticated access" on costumes;
drop policy if exists "authenticated access" on assignments;
drop policy if exists "authenticated access" on cast_presets;
drop policy if exists "authenticated access" on saved_shows;

create policy "authenticated access" on people for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on pieces for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on tracks for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on costumes for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on assignments for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on cast_presets for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on saved_shows for all using (auth.uid() is not null) with check (auth.uid() is not null);
