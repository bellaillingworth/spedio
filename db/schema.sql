-- Spendio — Supabase schema
-- Run this in the Supabase SQL editor for your project.

create extension if not exists "pgcrypto";

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  transaction_date date not null,
  category text not null,
  description text,
  amount numeric(10, 2) not null,
  source text check (source in ('manual', 'upload'))
);

create index if not exists transactions_date_idx
  on public.transactions (transaction_date desc);

create index if not exists transactions_category_idx
  on public.transactions (category);

-- Row-level security: Spendio is a single-user anonymous app for now.
-- The policies below let the anon key read & insert. Tighten these up
-- (add auth.uid() checks, delete/update policies, etc.) before opening
-- the app to multiple users.
alter table public.transactions enable row level security;

drop policy if exists "anon can read transactions" on public.transactions;
create policy "anon can read transactions"
  on public.transactions
  for select
  to anon
  using (true);

drop policy if exists "anon can insert transactions" on public.transactions;
create policy "anon can insert transactions"
  on public.transactions
  for insert
  to anon
  with check (
    category in ('Food','Transport','Social','Subscriptions','Shopping','Other')
    and amount > 0
    and source in ('manual','upload')
  );
