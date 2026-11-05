-- Project BARGAIN production persistence baseline.
-- Development may use the adapter-shaped in-memory store in
-- src/lib/negotiation/sessionStore.ts. Production requires these tables and
-- must not fall back to process-local state.

create table if not exists listings (
  id text primary key,
  title text not null,
  price_jpy bigint not null check (price_jpy >= 0),
  category text not null,
  image_url text not null,
  description text not null default '',
  days_listed integer not null default 0 check (days_listed >= 0),
  likes_count integer not null default 0 check (likes_count >= 0),
  views_count integer not null default 0 check (views_count >= 0),
  market_median_price_jpy bigint not null check (market_median_price_jpy >= 0),
  competing_listings_count integer not null default 0 check (competing_listings_count >= 0),
  recent_demand text not null check (recent_demand in ('low', 'moderate', 'high')),
  seller_name text not null,
  condition text not null check (condition in ('new', 'like_new', 'good', 'fair')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists negotiations (
  id text primary key,
  thread_id text not null unique,
  listing_id text not null references listings(id),
  listing_snapshot jsonb not null,
  buyer_id text not null,
  seller_id text not null,
  status text not null check (status in ('initializing', 'active', 'waiting', 'awaiting_commit', 'deal', 'rejected', 'paused_for_human')),
  current_turn text not null check (current_turn in ('buyer', 'seller')),
  current_offer_price_jpy bigint check (current_offer_price_jpy >= 0),
  deadline_at timestamptz,
  waiting_until_at timestamptz,
  version integer not null default 0 check (version >= 0),
  deal_summary jsonb,
  agent_memory jsonb,
  -- Pending purchase intent, signed grants, receipt and rejected intents.
  commit_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists negotiation_policies (
  negotiation_id text primary key references negotiations(id) on delete cascade,
  -- Deliberately nullable: private policies live only inside the encrypted envelope.
  buyer_policy jsonb,
  seller_policy jsonb,
  encrypted_private_state bytea,
  updated_at timestamptz not null default now()
);

create table if not exists negotiation_offers (
  id text primary key,
  negotiation_id text not null references negotiations(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  proposal_hash text,
  target_offer_id text,
  target_offer_version integer,
  round integer not null check (round > 0),
  sender_role text not null check (sender_role in ('buyer_agent', 'seller_agent', 'buyer_human', 'seller_human')),
  sender_name text not null,
  action_type text not null check (action_type in ('make_offer', 'counter_offer', 'accept_offer', 'reject_offer', 'wait', 'ask_user')),
  price_jpy bigint not null check (price_jpy >= 0),
  wait_time_hours integer check (wait_time_hours is null or wait_time_hours between 1 and 72),
  public_message text not null,
  terms jsonb,
  reasoning jsonb,
  decision jsonb,
  alternatives jsonb,
  created_at timestamptz not null default now()
);

create table if not exists negotiation_events (
  negotiation_id text not null references negotiations(id) on delete cascade,
  sequence bigint not null,
  event_type text not null,
  actor_id text,
  public_payload jsonb not null,
  -- Hash chain: entry_hash = sha256(prev_hash | canonical(event)). Editing any
  -- row breaks verification from that row on (see src/lib/negotiation/auditLog.ts).
  prev_hash text,
  entry_hash text,
  created_at timestamptz not null default now(),
  primary key (negotiation_id, sequence)
);

create table if not exists simulation_runs (
  id uuid primary key,
  negotiation_id text not null references negotiations(id) on delete cascade,
  scenario text not null,
  seed text not null,
  clock_mode text not null check (clock_mode in ('real', 'virtual')),
  current_step integer not null default -1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists negotiations_buyer_updated_idx on negotiations (buyer_id, updated_at desc);
create index if not exists negotiations_seller_updated_idx on negotiations (seller_id, updated_at desc);
create index if not exists negotiation_events_sequence_idx on negotiation_events (negotiation_id, sequence);

create table if not exists negotiation_idempotency (
  idempotency_key text not null,
  negotiation_id text not null references negotiations(id) on delete cascade,
  version integer not null,
  request_hash text not null default '',
  response jsonb not null,
  created_at timestamptz not null default now()
  ,primary key (negotiation_id, idempotency_key)
);

-- Workflow extensions: human approval, contract drafts and agent telemetry.
create table if not exists approval_tasks (
  id text primary key,
  negotiation_id text not null references negotiations(id) on delete cascade,
  owner_id text not null,
  kind text not null check (kind in ('reply', 'contract', 'commit')),
  status text not null check (status in ('pending', 'approved', 'rejected', 'expired')),
  title text not null,
  payload jsonb not null,
  subject_type text not null check (subject_type in ('offer', 'contract', 'commit')),
  subject_id text not null,
  subject_version integer not null default 1 check (subject_version > 0),
  proposal_hash text not null default '',
  requested_by text not null default '',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create table if not exists negotiation_contracts (
  id text primary key,
  negotiation_id text not null references negotiations(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);

-- Commit Gate outbox. One row per irreversible intent; the primary key makes a
-- second execution of the same intent impossible across instances.
create table if not exists effect_outbox (
  intent_hash text primary key,
  effect_id text not null unique,
  kind text not null,
  subject_id text not null,
  amount bigint not null check (amount >= 0),
  currency text not null,
  payload jsonb not null,
  authorization_record jsonb not null,
  executor text not null,
  status text not null check (status in ('reserved', 'executed', 'failed')),
  external_ref text,
  error text,
  created_at timestamptz not null default now(),
  reserved_at timestamptz not null,
  executed_at timestamptz
);

-- Operator safety controls (kill switch).
create table if not exists safety_controls (
  key text primary key,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists negotiation_agent_runs (
  id text primary key,
  negotiation_id text not null references negotiations(id) on delete cascade,
  provider text not null check (provider in ('google', 'openai', 'heuristic')),
  model text,
  latency_ms integer not null check (latency_ms >= 0),
  fallback boolean not null default false,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  selected_candidate integer not null default 0 check (selected_candidate >= 0),
  guardrail_corrections integer not null default 0 check (guardrail_corrections >= 0),
  created_at timestamptz not null default now()
);

alter table negotiations add column if not exists agent_memory jsonb;
alter table negotiation_policies alter column buyer_policy drop not null;
alter table negotiation_policies alter column seller_policy drop not null;
alter table negotiation_offers add column if not exists decision jsonb;
alter table negotiation_offers add column if not exists alternatives jsonb;
alter table negotiation_offers add column if not exists version integer not null default 1;
alter table negotiation_offers add column if not exists proposal_hash text;
alter table negotiation_offers add column if not exists target_offer_id text;
alter table negotiation_offers add column if not exists target_offer_version integer;
alter table negotiation_idempotency add column if not exists request_hash text not null default '';
alter table approval_tasks add column if not exists owner_id text not null default '';
alter table approval_tasks add column if not exists subject_type text not null default 'contract';
alter table approval_tasks add column if not exists subject_id text not null default '';
alter table approval_tasks add column if not exists subject_version integer not null default 1;
alter table approval_tasks add column if not exists proposal_hash text not null default '';
alter table approval_tasks add column if not exists requested_by text not null default '';
alter table approval_tasks add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');
alter table approval_tasks add column if not exists resolved_by text;

-- Replace the unsafe global idempotency key with a negotiation-scoped key.
alter table negotiation_idempotency drop constraint if exists negotiation_idempotency_pkey;
alter table negotiation_idempotency add primary key (negotiation_id, idempotency_key);

-- Commit Gate migration for databases created before awaiting_commit existed.
alter table negotiations add column if not exists commit_state jsonb;
alter table negotiations drop constraint if exists negotiations_status_check;
alter table negotiations add constraint negotiations_status_check
  check (status in ('initializing', 'active', 'waiting', 'awaiting_commit', 'deal', 'rejected', 'paused_for_human'));
alter table negotiation_events add column if not exists prev_hash text;
alter table negotiation_events add column if not exists entry_hash text;
alter table approval_tasks drop constraint if exists approval_tasks_kind_check;
alter table approval_tasks add constraint approval_tasks_kind_check check (kind in ('reply', 'contract', 'commit'));
alter table approval_tasks drop constraint if exists approval_tasks_subject_type_check;
alter table approval_tasks add constraint approval_tasks_subject_type_check check (subject_type in ('offer', 'contract', 'commit'));

create index if not exists effect_outbox_subject_idx on effect_outbox (subject_id, created_at);
create index if not exists approval_tasks_pending_subject_idx on approval_tasks (negotiation_id, kind, owner_id, proposal_hash) where status = 'pending';
create index if not exists approval_tasks_status_idx on approval_tasks (status, created_at desc);
create index if not exists approval_tasks_negotiation_idx on approval_tasks (negotiation_id, created_at desc);
create index if not exists approval_tasks_owner_idx on approval_tasks (owner_id, status, created_at desc);
create index if not exists negotiation_contracts_negotiation_idx on negotiation_contracts (negotiation_id, updated_at desc);
create index if not exists negotiation_agent_runs_negotiation_idx on negotiation_agent_runs (negotiation_id, created_at desc);
