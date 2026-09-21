-- Daliesk command-deck mirror: the rows the pushing container writes through
-- the `ingest` function and the public `feed` function reads. Row level
-- security with no policies keeps the anon role out; both functions use the
-- service role.
create table if not exists public.feed_config (
  key text primary key,
  value text not null
);

create table if not exists public.feed_json (
  path text primary key,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.feed_events (
  id bigserial primary key,
  run_id text not null,
  session_id text not null,
  seq integer not null,
  body jsonb not null,
  unique (run_id, session_id, seq)
);

create index if not exists feed_events_run_id_idx on public.feed_events (run_id, id);

create table if not exists public.feed_requests (
  id bigserial primary key,
  target text not null,
  model text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  run_id text,
  error text
);

alter table public.feed_config enable row level security;
alter table public.feed_json enable row level security;
alter table public.feed_events enable row level security;
alter table public.feed_requests enable row level security;

insert into storage.buckets (id, name, public)
values ('deck', 'deck', true)
on conflict (id) do nothing;
