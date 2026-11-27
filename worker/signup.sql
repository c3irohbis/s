-- Pending email sign-ups: no Firebase Auth account exists until the emailed link is used.
-- Only a SHA-256 hash of the link token is stored. Passwords are never stored (set after the link click).
create table if not exists public.signup_pending(
 token_hash text primary key check(token_hash~'^[0-9a-f]{64}$'),
 email text not null check(length(email)between 5 and 254 and email=lower(email)),
 ip_hash text not null default '',
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 used_at timestamptz);
create index if not exists signup_pending_email on public.signup_pending(email,created_at);
create index if not exists signup_pending_created on public.signup_pending(created_at);
-- Quota ledger: independent of token lifecycle (rows here survive signup_finish / consume / expiry cleanup of signup_pending).
create table if not exists public.signup_log(
 id bigserial primary key,
 email text not null,
 ip_hash text not null default '',
 created_at timestamptz not null default clock_timestamp());
create index if not exists signup_log_email on public.signup_log(email,created_at);
create index if not exists signup_log_ip on public.signup_log(ip_hash,created_at);
create index if not exists signup_log_created on public.signup_log(created_at);
alter table public.signup_log enable row level security;
revoke all on public.signup_log from public,anon,authenticated,service_role;
alter table public.signup_pending enable row level security;
revoke all on public.signup_pending from public,anon,authenticated,service_role;

-- Start: serialized by one advisory lock (small volume), so every limit below is race-free.
-- Limits: cooldown 60s per email, 5 per email/24h, 10 per ip/hour, 300 total/24h (Gmail cap safety).
-- Older links stay valid until the new email is really sent (signup_activate).
create or replace function public.signup_start(p_email text,p_hash text,p_ip text,p_ttl int)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare n int;begin
 perform pg_advisory_xact_lock(hashtextextended('signup_start',0));
 delete from public.signup_pending where created_at<clock_timestamp()-interval '2 days';
 delete from public.signup_log where created_at<clock_timestamp()-interval '2 days';
 if p_email is null or p_email<>lower(p_email)then return jsonb_build_object('error','invalid');end if;
 if exists(select 1 from public.signup_log where email=encode(sha256(convert_to(p_email,'UTF8')),'hex') and created_at>clock_timestamp()-interval '60 seconds')then return jsonb_build_object('error','cooldown');end if;
 select count(*) into n from public.signup_log where email=encode(sha256(convert_to(p_email,'UTF8')),'hex') and created_at>clock_timestamp()-interval '24 hours';
 if n>=5 then return jsonb_build_object('error','limit');end if;
 select count(*) into n from public.signup_log where ip_hash=p_ip and p_ip<>'' and created_at>clock_timestamp()-interval '1 hour';
 if n>=10 then return jsonb_build_object('error','limit');end if;
 select count(*) into n from public.signup_log where created_at>clock_timestamp()-interval '24 hours';
 if n>=300 then return jsonb_build_object('error','busy');end if;
 insert into public.signup_log(email,ip_hash)values(encode(sha256(convert_to(p_email,'UTF8')),'hex'),coalesce(p_ip,''));
 insert into public.signup_pending(token_hash,email,ip_hash,expires_at)values(p_hash,p_email,coalesce(p_ip,''),clock_timestamp()+make_interval(secs=>least(greatest(p_ttl,300),3600)));
 return jsonb_build_object('ok',true);end$$;

-- After the email was really sent. Earlier unused links stay valid until their TTL: each token is single-use (atomic consume),
-- so ordering between concurrent background sends cannot invalidate the newest link.
create or replace function public.signup_activate(p_hash text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if not exists(select 1 from public.signup_pending where token_hash=p_hash and used_at is null)then return jsonb_build_object('error','invalid');end if;
 return jsonb_build_object('ok',true);end$$;

create or replace function public.signup_peek(p_hash text)returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select coalesce((select jsonb_build_object('email',email)from public.signup_pending where token_hash=p_hash and used_at is null and expires_at>clock_timestamp()),jsonb_build_object('error','invalid'))$$;

-- Atomic single use.
create or replace function public.signup_consume(p_hash text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare e text;begin
 update public.signup_pending set used_at=clock_timestamp() where token_hash=p_hash and used_at is null and expires_at>clock_timestamp() returning email into e;
 if e is null then return jsonb_build_object('error','invalid');end if;
 return jsonb_build_object('email',e);end$$;

create or replace function public.signup_restore(p_hash text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin update public.signup_pending set used_at=null where token_hash=p_hash and used_at is not null and expires_at>clock_timestamp();return jsonb_build_object('ok',true);end$$;

-- Used link row removed once the account exists.
create or replace function public.signup_finish(p_hash text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin delete from public.signup_pending where token_hash=p_hash;return jsonb_build_object('ok',true);end$$;

revoke all on function public.signup_start(text,text,text,int),public.signup_peek(text),public.signup_consume(text),public.signup_restore(text),public.signup_finish(text),public.signup_activate(text) from public,anon,authenticated;
grant execute on function public.signup_start(text,text,text,int),public.signup_peek(text),public.signup_consume(text),public.signup_restore(text),public.signup_finish(text),public.signup_activate(text) to service_role;

-- Minimal data: the quota ledger keeps only a hash of the address, never the address itself.
-- (signup_start below stores encode(sha256(email),'hex'); older plaintext rows are hashed in place.)
create or replace function public.signup_purge()returns int
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a int;b int;begin
 delete from public.signup_pending where expires_at<clock_timestamp() or used_at is not null;get diagnostics a=row_count;
 delete from public.signup_log where created_at<clock_timestamp()-interval '2 days';get diagnostics b=row_count;
 return a+b;end$$;
revoke all on function public.signup_purge() from public,anon,authenticated;
grant execute on function public.signup_purge() to service_role;
