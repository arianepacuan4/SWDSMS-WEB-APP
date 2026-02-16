-- Run these statements in Supabase SQL editor to create required tables.

-- Users table
create table if not exists public.users (
  id bigserial primary key,
  full_name text not null,
  username text not null unique,
  email text not null,
  account_type text not null,
  password text not null,
  created_at timestamptz default now()
);

-- Reports table
create table if not exists public.reports (
  id bigserial primary key,
  name text,
  grade text,
  type text not null,
  description text not null,
  incident_date date not null,
  created_at timestamptz default now()
);

-- OPTIONAL: Allow anon role to insert/select for demo (only for prototypes)
-- WARNING: This makes your DB public. Use policies for production.

-- Grant privileges to anon
grant select, insert on public.users to anon;
grant select, insert on public.reports to anon;

-- You may also create RLS policies instead of granting blanket access.
