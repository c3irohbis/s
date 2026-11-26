-- Authoritative Tuition fees (one document per world). Students read their own world, owner reads and writes all 16. Service-only RPCs.
create table if not exists public.tuition_docs(
 world_id text primary key check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by text not null,revision bigint not null default 1,deleted_at timestamptz
);
create table if not exists public.tuition_reads(uid text not null references public.app_authority(uid),world_id text not null,last_seen_at timestamptz not null,primary key(uid,world_id));
create table if not exists public.tuition_views(uid text not null,token text primary key,world_id text not null,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.tuition_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.tuition_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,world_id text,revision bigint,at timestamptz not null default clock_timestamp(),detail jsonb not null default '{}');
create table if not exists public.tuition_versions(id integer primary key check(id=1),revision bigint not null default 0);
alter table public.tuition_docs enable row level security;
alter table public.tuition_reads enable row level security;
alter table public.tuition_views enable row level security;
alter table public.tuition_requests enable row level security;
alter table public.tuition_audit enable row level security;
alter table public.tuition_versions enable row level security;
revoke all on public.tuition_docs,public.tuition_reads,public.tuition_views,public.tuition_requests,public.tuition_audit,public.tuition_versions from public,anon,authenticated,service_role;
create table if not exists public.tuition_signal(id integer primary key check(id=1));
alter table public.tuition_signal enable row level security;
revoke all on public.tuition_signal from public,anon,authenticated,service_role;
grant select on public.tuition_signal to anon,authenticated;
drop policy if exists tuition_signal_read on public.tuition_signal;
create policy tuition_signal_read on public.tuition_signal for select to anon,authenticated using(id=1);
insert into public.tuition_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='tuition_signal')then alter publication supabase_realtime add table public.tuition_signal;end if;end$$;

create or replace function public.tuition_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;
create or replace function public.tuition_payload_ok(p jsonb)returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p is not null and jsonb_typeof(p)='object' and octet_length(p::text)<=8000
 and not exists(select 1 from jsonb_object_keys(p)k where k not in('year','cash','installments'))
 and jsonb_typeof(p->'year')='string' and coalesce(length(p->>'year'),999)<=50
 and jsonb_typeof(p->'cash')='number' and(p->>'cash')~'^[0-9]{1,9}(\.[0-9]{1,2})?$' and(p->>'cash')::numeric>0
 and jsonb_typeof(p->'installments')='array' and jsonb_array_length(p->'installments')<=24
 and not exists(select 1 from jsonb_array_elements(p->'installments')e where jsonb_typeof(e)<>'object'
   or exists(select 1 from jsonb_object_keys(e)k where k not in('label','amount'))
   or jsonb_typeof(e->'label') is distinct from 'string' or coalesce(length(e->>'label'),0)>200
   or jsonb_typeof(e->'amount') is distinct from 'number' or coalesce((e->>'amount')!~'^[0-9]{1,9}(\.[0-9]{1,2})?$',true) or coalesce((e->>'amount')::numeric<=0,true))
 and(jsonb_array_length(p->'installments')=0 or(select sum((e->>'amount')::numeric)from jsonb_array_elements(p->'installments')e)=(p->>'cash')::numeric),false)$$;
create or replace function public.tuition_list(p_uid text,p_world text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;stamp timestamptz;rows jsonb;ticket text;version bigint;w text;
begin
 if p_world is null then a:=public.authority_current(p_uid);if a.role<>'owner'then raise exception 'authority-denied';end if;w:='*';
 else a:=public.tuition_world(p_uid,p_world);w:=p_world;end if;
 perform pg_advisory_xact_lock(914);stamp:=clock_timestamp();insert into public.tuition_versions values(1,0)on conflict do nothing;select revision into version from public.tuition_versions where id=1;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.world_id),'[]')into rows from(
  select world_id,payload,created_at,updated_at,updated_by,revision from public.tuition_docs where deleted_at is null and(p_world is null or world_id=p_world)
 )x;
 ticket:=gen_random_uuid()::text;delete from public.tuition_views where uid=p_uid and expires_at<stamp;
 insert into public.tuition_views values(p_uid,ticket,w,stamp,stamp+interval'10 minutes');
 return jsonb_build_object('items',rows,'viewToken',ticket,'observedAt',stamp,'revision',version);
end$$;
create or replace function public.tuition_mutate(p_uid text,p_world text,p_action text,p_payload jsonb,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.tuition_docs;j public.tuition_requests;sig jsonb;result jsonb;stamp timestamptz;
begin
 a:=public.tuition_world(p_uid,p_world);perform pg_advisory_xact_lock(914);if a.role<>'owner'then raise exception 'authority-denied';end if;
 if p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_action is null or p_action not in('set','delete')then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'action',p_action,'payload',p_payload,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,911));
 select *into j from public.tuition_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 select *into t from public.tuition_docs where world_id=p_world for update;stamp:=clock_timestamp();
 if p_action='set'then
  if public.tuition_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
  if t.world_id is null then
   if p_expected is not null then raise exception 'revision-conflict';end if;
   insert into public.tuition_docs(world_id,payload,updated_by,created_at,updated_at)values(p_world,p_payload,p_uid,stamp,stamp)returning *into t;
  elsif t.deleted_at is not null then
   if p_expected is not null then raise exception 'revision-conflict';end if;
   update public.tuition_docs set payload=p_payload,deleted_at=null,created_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where world_id=p_world returning *into t;
  else
   if t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
   update public.tuition_docs set payload=p_payload,updated_at=stamp,updated_by=p_uid,revision=revision+1 where world_id=p_world returning *into t;
  end if;
 else
  if t.world_id is null or t.deleted_at is not null or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  update public.tuition_docs set deleted_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where world_id=p_world returning *into t;
 end if;
 insert into public.tuition_audit(actor_uid,action,world_id,revision)values(p_uid,p_action,p_world,t.revision);
 result:=jsonb_build_object('world',t.world_id,'revision',t.revision,'deleted',t.deleted_at is not null);
 insert into public.tuition_versions values(1,1)on conflict(id)do update set revision=tuition_versions.revision+1;
 insert into public.tuition_requests values(p_uid,p_request,sig,result);
 update public.tuition_signal set id=1 where id=1;
 return result;
end$$;
create or replace function public.tuition_badge(p_uid text,p_world text,p_mark text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;seen timestamptz;n bigint;bound timestamptz;begin
 a:=public.tuition_world(p_uid,p_world);perform pg_advisory_xact_lock(914);
 insert into public.tuition_reads values(p_uid,p_world,clock_timestamp())on conflict do nothing;
 if p_mark is not null then select observed_at into bound from public.tuition_views where uid=p_uid and token=p_mark and expires_at>=clock_timestamp()and(world_id=p_world or world_id='*');if bound is null then raise exception 'invalid-read-ticket';end if;update public.tuition_reads set last_seen_at=greatest(last_seen_at,bound)where uid=p_uid and world_id=p_world;end if;
 select last_seen_at into seen from public.tuition_reads where uid=p_uid and world_id=p_world;
 select count(*)into n from public.tuition_docs where world_id=p_world and deleted_at is null and updated_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end$$;
revoke all on function public.tuition_world(text,text),public.tuition_list(text,text),public.tuition_mutate(text,text,text,jsonb,bigint,text),public.tuition_badge(text,text,text)from public,anon,authenticated;
grant execute on function public.tuition_list(text,text),public.tuition_mutate(text,text,text,jsonb,bigint,text),public.tuition_badge(text,text,text)to service_role;
