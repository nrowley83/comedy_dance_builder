-- Run this once in your Supabase project's SQL Editor (SQL Editor > New query).
-- It creates the tables the app needs and opens them up to the app's anon key.

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
  energy text not null default 'Medium',
  created_at timestamptz not null default now()
);

-- Migration safety net: adds columns/constraints if this script is being
-- re-run against a project created before they existed. No-op otherwise.
alter table pieces add column if not exists type text not null default 'normal';
alter table pieces add column if not exists archived boolean not null default false;
alter table pieces add column if not exists energy text not null default 'Medium';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pieces_type_check') then
    alter table pieces add constraint pieces_type_check check (type in ('normal', 'opener', 'closer'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pieces_energy_check') then
    alter table pieces add constraint pieces_energy_check check (energy in ('High', 'Medium', 'Low'));
  end if;
end $$;

-- "tracks" (a role/part within a piece) has been renamed to "roles" so the
-- name "tracks" is free for a new, unrelated concept below: a way to group
-- roles together. This migrates an existing project's table and data in
-- place; on a brand new project neither table exists yet, so this is a
-- no-op and "roles" gets created fresh right after.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'tracks')
     and not exists (select 1 from information_schema.tables where table_name = 'roles') then
    alter table tracks rename to roles;
  end if;
end $$;

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  piece_id uuid not null references pieces(id) on delete cascade,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

alter table roles add column if not exists required boolean not null default true;

-- New grouping entity: a Track groups several Roles together (e.g. roles
-- meant to be filled by the same performer across different pieces). The
-- name "tracks" was freed up by the rename above, so this is a fresh table.
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table roles add column if not exists track_id uuid references tracks(id) on delete set null;

-- "costumes" was renamed to "props" in an earlier update; this migrates an
-- existing project's table and data in place.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'costumes')
     and not exists (select 1 from information_schema.tables where table_name = 'props') then
    alter table costumes rename to props;
  end if;
end $$;

create table if not exists props (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  piece_id uuid not null references pieces(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Migration safety net: rename the old track_id column to role_id if this
-- script runs against a project created before the tracks->roles rename.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'assignments' and column_name = 'track_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'assignments' and column_name = 'role_id'
  ) then
    alter table assignments rename column track_id to role_id;
  end if;
end $$;

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
  track_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table saved_shows add column if not exists track_ids jsonb not null default '[]'::jsonb;

-- Direct Person <-> Track membership (separate from per-role assignments).
-- A track can have multiple people (rotating cast); this is used to check
-- which of a track's roles that person still needs to be assigned to.
create table if not exists track_assignments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Row Level Security ------------------------------------------------------
-- Only signed-in users may read or write these tables. Combined with
-- disabling public sign-up in Supabase Auth (see README), this means only
-- the account(s) you create yourself can access the data.

alter table people enable row level security;
alter table pieces enable row level security;
alter table roles enable row level security;
alter table tracks enable row level security;
alter table props enable row level security;
alter table assignments enable row level security;
alter table cast_presets enable row level security;
alter table saved_shows enable row level security;
alter table track_assignments enable row level security;

drop policy if exists "authenticated access" on people;
drop policy if exists "authenticated access" on pieces;
drop policy if exists "authenticated access" on roles;
drop policy if exists "authenticated access" on tracks;
drop policy if exists "authenticated access" on props;
drop policy if exists "authenticated access" on assignments;
drop policy if exists "authenticated access" on cast_presets;
drop policy if exists "authenticated access" on saved_shows;
drop policy if exists "authenticated access" on track_assignments;

create policy "authenticated access" on people for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on pieces for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on roles for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on tracks for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on props for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on assignments for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on cast_presets for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on saved_shows for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated access" on track_assignments for all using (auth.uid() is not null) with check (auth.uid() is not null);
