-- Beauty retail daily sales – schema, row-level security and reporting views.
-- Run in the Supabase SQL editor (or `supabase db push`).
-- Hierarchy: admin (HQ) → area_manager (region) → store_manager (store) → shift_lead → seller.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────

create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_id uuid not null references regions(id),
  -- opening hours per weekday, index 0 = Sunday: [{"open":10,"close":22}, …, null]
  hours jsonb not null default '[{"open":10,"close":22},{"open":10,"close":22},{"open":10,"close":22},{"open":10,"close":22},{"open":10,"close":22},{"open":9,"close":15},null]',
  lat double precision not null default 32.08,
  lng double precision not null default 34.78,
  headcount int not null default 3
);

do $$ begin
  create type app_role as enum ('seller', 'shift_lead', 'store_manager', 'area_manager', 'admin');
exception when duplicate_object then null; end $$;

-- A profile is created by a manager with an e-mail address; it is linked to the
-- auth user automatically on first login (see trigger below).
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique,
  name text not null,
  role app_role not null default 'seller',
  store_id uuid references stores(id),
  region_id uuid references regions(id),
  is_brand_promoter boolean not null default false,
  brand text,
  availability int[] not null default '{0,1,2,3,4,5}',
  shifts_per_week int not null default 5,
  home_lat double precision,
  home_lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id),
  store_id uuid not null references stores(id),
  date date not null,
  start_hour numeric(4,2) not null check (start_hour >= 0 and start_hour < 24),
  end_hour numeric(4,2) not null check (end_hour > start_hour and end_hour <= 24),
  target numeric(10,2) not null default 0,
  closed boolean not null default false
);
create index if not exists shifts_store_date on shifts(store_id, date);
create index if not exists shifts_seller_date on shifts(seller_id, date);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id),
  co_seller_id uuid references profiles(id),
  store_id uuid not null references stores(id),
  shift_id uuid references shifts(id) on delete set null,
  ts timestamptz not null default now(),
  amount numeric(10,2) not null check (amount > 0),
  units int not null default 1 check (units >= 1),
  categories text[] not null default '{}'
    check (categories <@ array['skincare','makeup','fragrance','hair','body']),
  upsell text not null default 'none' check (upsell in ('none','upsell','cross_sell','add_on')),
  club_signup boolean not null default false,
  is_return boolean not null default false,
  created_at timestamptz not null default now(),
  check (co_seller_id is null or co_seller_id <> seller_id)
);
create index if not exists sales_store_ts on sales(store_id, ts);
create index if not exists sales_seller_ts on sales(seller_id, ts);

-- customer approaches (one tap) – denominator for conversion
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(id),
  store_id uuid not null references stores(id),
  ts timestamptz not null default now()
);
create index if not exists interactions_store_ts on interactions(store_id, ts);

create table if not exists daily_targets (
  store_id uuid not null references stores(id),
  date date not null,
  target numeric(10,2) not null check (target >= 0),
  primary key (store_id, date)
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pairing','store','mentoring')),
  region_id uuid references regions(id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  title text not null,
  explanation text not null default '',
  score numeric not null default 0,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  payload jsonb not null default '{}'
);

-- ───────────────────────── who am I ─────────────────────────

create or replace function my_profile() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function my_id() returns uuid
language sql stable security definer set search_path = public as $$ select (my_profile()).id $$;

create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$ select (my_profile()).role $$;

create or replace function my_region() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.region_id, s.region_id) from profiles p left join stores s on s.id = p.store_id
  where p.auth_user_id = auth.uid() limit 1
$$;

create or replace function my_store() returns uuid
language sql stable security definer set search_path = public as $$ select (my_profile()).store_id $$;

-- read access to a store's data: admin – all; area & store managers – their region
-- (store managers need the region to borrow sellers from other stores); others – own store.
create or replace function can_read_store(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case my_role()
    when 'admin' then true
    when 'area_manager' then (select region_id from stores where id = sid) = my_region()
    when 'store_manager' then (select region_id from stores where id = sid) = my_region()
    when 'shift_lead' then sid = my_store()
    when 'seller' then sid = my_store()
    else false end
$$;

-- manage = edit anyone's sales/shifts/targets in the store
create or replace function can_manage_store(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case my_role()
    when 'admin' then true
    when 'area_manager' then (select region_id from stores where id = sid) = my_region()
    when 'store_manager' then sid = my_store()
    when 'shift_lead' then sid = my_store()
    else false end
$$;

-- link a new auth user to the profile a manager created for that e-mail
create or replace function link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function link_profile();

-- ───────────────────────── row level security ─────────────────────────

alter table regions enable row level security;
alter table stores enable row level security;
alter table profiles enable row level security;
alter table shifts enable row level security;
alter table sales enable row level security;
alter table interactions enable row level security;
alter table daily_targets enable row level security;
alter table recommendations enable row level security;

-- reference data: every signed-in staff member can read, only admin writes
create policy regions_read on regions for select using (my_id() is not null);
create policy regions_admin on regions for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy stores_read on stores for select using (my_id() is not null);
create policy stores_admin on stores for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- profiles
create policy profiles_read on profiles for select using (
  id = my_id()
  or my_role() = 'admin'
  or (store_id is not null and can_read_store(store_id))
  or (my_role() = 'area_manager' and region_id = my_region())
);
create policy profiles_write on profiles for all using (
  my_role() = 'admin'
  or (my_role() = 'area_manager' and (region_id = my_region() or (store_id is not null and can_manage_store(store_id))))
) with check (
  my_role() = 'admin'
  or (my_role() = 'area_manager' and role not in ('admin', 'area_manager')
      and (region_id = my_region() or (store_id is not null and can_manage_store(store_id))))
);

-- shifts: a seller opens/closes her own shift; managers manage the store
create policy shifts_read on shifts for select using (seller_id = my_id() or can_read_store(store_id));
create policy shifts_insert on shifts for insert with check (seller_id = my_id() or can_manage_store(store_id));
create policy shifts_update on shifts for update using (seller_id = my_id() or can_manage_store(store_id));
create policy shifts_delete on shifts for delete using (can_manage_store(store_id));

-- sales: a seller reports her own sales and may fix them the same day; managers fix anything in the store
create policy sales_read on sales for select using (
  seller_id = my_id() or co_seller_id = my_id() or can_read_store(store_id)
);
create policy sales_insert on sales for insert with check (seller_id = my_id() or can_manage_store(store_id));
create policy sales_update on sales for update using (
  (seller_id = my_id() and (ts at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date) or can_manage_store(store_id)
);
create policy sales_delete on sales for delete using (
  (seller_id = my_id() and (ts at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date) or can_manage_store(store_id)
);

create policy interactions_read on interactions for select using (seller_id = my_id() or can_read_store(store_id));
create policy interactions_insert on interactions for insert with check (seller_id = my_id());
create policy interactions_delete on interactions for delete using (
  (seller_id = my_id() and (ts at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date) or can_manage_store(store_id)
);

create policy targets_read on daily_targets for select using (can_read_store(store_id));
create policy targets_write on daily_targets for all using (
  can_manage_store(store_id) and my_role() <> 'shift_lead'
) with check (can_manage_store(store_id) and my_role() <> 'shift_lead');

create policy recs_read on recommendations for select using (
  my_role() = 'admin' or (my_role() in ('area_manager', 'store_manager') and region_id = my_region())
);
create policy recs_write on recommendations for all using (
  my_role() = 'admin' or (my_role() in ('area_manager', 'store_manager') and region_id = my_region())
) with check (
  my_role() = 'admin' or (my_role() in ('area_manager', 'store_manager') and region_id = my_region())
);

-- ───────────────────────── reporting views (BI / Excel exports) ─────────────────────────

-- shared sales are credited 50/50; returns are deducted from the seller
create or replace view credited_sales with (security_invoker = true) as
  select id as sale_id, seller_id as person_id, store_id, ts, amount, units, upsell, club_signup, is_return,
         case when co_seller_id is null then 1.0 else 0.5 end as share
  from sales
  union all
  select id, co_seller_id, store_id, ts, amount, units, upsell, club_signup, is_return, 0.5
  from sales where co_seller_id is not null;

create or replace view daily_seller_kpis with (security_invoker = true) as
  select
    c.person_id as seller_id,
    c.store_id,
    (c.ts at time zone 'Asia/Jerusalem')::date as date,
    sum(case when c.is_return then -c.amount else c.amount end * c.share) as revenue,
    sum(case when c.is_return then 0 else c.share end) as transactions,
    sum(case when c.is_return then 0 else c.units * c.share end) as units,
    sum(case when c.is_return then 0 else c.amount * c.share end)
      / nullif(sum(case when c.is_return then 0 else c.share end), 0) as atv,
    sum(case when c.is_return then 0 else c.units * c.share end)
      / nullif(sum(case when c.is_return then 0 else c.share end), 0) as upt,
    sum(case when not c.is_return and c.upsell <> 'none' then c.share else 0 end)
      / nullif(sum(case when c.is_return then 0 else c.share end), 0) as upsell_rate,
    sum(case when c.club_signup then c.share else 0 end) as club_signups,
    min(case when not c.is_return then (c.ts at time zone 'Asia/Jerusalem')::time end) as first_sale_time
  from credited_sales c
  group by 1, 2, 3;

create or replace view daily_store_kpis with (security_invoker = true) as
  select
    s.store_id,
    (s.ts at time zone 'Asia/Jerusalem')::date as date,
    sum(case when s.is_return then -s.amount else s.amount end) as revenue,
    count(*) filter (where not s.is_return) as transactions,
    avg(s.amount) filter (where not s.is_return) as atv,
    avg(s.units) filter (where not s.is_return) as upt,
    min((s.ts at time zone 'Asia/Jerusalem')::time) filter (where not s.is_return) as first_sale_time,
    max(t.target) as target
  from sales s
  left join daily_targets t on t.store_id = s.store_id and t.date = (s.ts at time zone 'Asia/Jerusalem')::date
  group by 1, 2;
