-- Authoritative Study Schedule. Service-only RPCs; every operation locks current authority. No FCM/inbox: reminders stay local.
create table if not exists public.studyschedule_items(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by text not null,revision bigint not null default 1,deleted_at timestamptz
);
create index if not exists studyschedule_page on public.studyschedule_items(world_id,created_at,id)where deleted_at is null;
create table if not exists public.studyschedule_reads(uid text not null references public.app_authority(uid),world_id text not null,last_seen_at timestamptz not null,primary key(uid,world_id));
create table if not exists public.studyschedule_views(uid text not null,token text primary key,world_id text not null,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.studyschedule_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.studyschedule_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,item_id text,revision bigint,at timestamptz not null default clock_timestamp(),detail jsonb not null default '{}');
create table if not exists public.studyschedule_versions(world_id text primary key,revision bigint not null default 0);
alter table public.studyschedule_views enable row level security;
alter table public.studyschedule_items enable row level security;
alter table public.studyschedule_reads enable row level security;
alter table public.studyschedule_requests enable row level security;
alter table public.studyschedule_audit enable row level security;
alter table public.studyschedule_versions enable row level security;
revoke all on public.studyschedule_views,public.studyschedule_items,public.studyschedule_reads,public.studyschedule_requests,public.studyschedule_audit,public.studyschedule_versions from public,anon,authenticated,service_role;
-- Isolated constant-only Realtime relation. Never put schedule data here.
create table if not exists public.studyschedule_signal(id integer primary key check(id=1));
alter table public.studyschedule_signal enable row level security;
revoke all on public.studyschedule_signal from public,anon,authenticated,service_role;
grant select on public.studyschedule_signal to anon,authenticated;
drop policy if exists studyschedule_signal_read on public.studyschedule_signal;
create policy studyschedule_signal_read on public.studyschedule_signal for select to anon,authenticated using(id=1);
insert into public.studyschedule_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='studyschedule_signal')then alter publication supabase_realtime add table public.studyschedule_signal;end if;end$$;

create or replace function public.studyschedule_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;
-- The whole world schedule is one bounded read (max 200 live rows enforced on create), so no cursors.
create or replace function public.studyschedule_list(p_uid text,p_world text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;stamp timestamptz;rows jsonb;ticket text;version bigint;
begin
 a:=public.studyschedule_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));stamp:=clock_timestamp();insert into public.studyschedule_versions values(p_world,0)on conflict do nothing;select revision into version from public.studyschedule_versions where world_id=p_world;
 if(select count(*)from public.studyschedule_items where world_id=p_world and deleted_at is null)>200 then raise exception 'invalid-overflow';end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at,x.id),'[]')into rows from(
  select id,world_id,payload,created_at,updated_at,updated_by,revision from public.studyschedule_items where world_id=p_world and deleted_at is null order by created_at,id limit 200
 )x;
 ticket:=gen_random_uuid()::text;delete from public.studyschedule_views where uid=p_uid and expires_at<stamp;
 insert into public.studyschedule_views values(p_uid,ticket,p_world,stamp,stamp+interval'10 minutes');
 return jsonb_build_object('items',rows,'viewToken',ticket,'observedAt',stamp,'revision',version);
end$$;
create or replace function public.studyschedule_payload_ok(p jsonb)returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p is not null and jsonb_typeof(p)='object' and octet_length(p::text)<=8000
 and not exists(select 1 from jsonb_object_keys(p)k where k not in('subject','day','startTime','endTime','subject2','startTime2','endTime2','reminderMinutes','enabled'))
 and jsonb_typeof(p->'subject')='string' and length(btrim(p->>'subject'))>0 and length(p->>'subject')<=300
 and jsonb_typeof(p->'day')='string' and p->>'day' in('sat','sun','mon','tue','wed','thu','fri')
 and jsonb_typeof(p->'startTime')='string' and p->>'startTime'~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and(not p?'endTime' or(jsonb_typeof(p->'endTime')='string' and p->>'endTime'~'^(([01][0-9]|2[0-3]):[0-5][0-9])?$'))
 and(not p?'subject2' or(jsonb_typeof(p->'subject2')='string' and length(p->>'subject2')<=300))
 and(not p?'startTime2' or(jsonb_typeof(p->'startTime2')='string' and p->>'startTime2'~'^(([01][0-9]|2[0-3]):[0-5][0-9])?$'))
 and(not p?'endTime2' or(jsonb_typeof(p->'endTime2')='string' and p->>'endTime2'~'^(([01][0-9]|2[0-3]):[0-5][0-9])?$'))
 and(not p?'reminderMinutes' or(jsonb_typeof(p->'reminderMinutes')='number' and(p->>'reminderMinutes')~'^[0-9]{1,6}$'))
 and(not p?'enabled' or jsonb_typeof(p->'enabled')='boolean'),false)$$;
create or replace function public.studyschedule_mutate(p_uid text,p_world text,p_action text,p_id text,p_payload jsonb,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.studyschedule_items;j public.studyschedule_requests;sig jsonb;result jsonb;stamp timestamptz;live bigint;
begin
 a:=public.studyschedule_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));if a.role not in('owner','admin')then raise exception 'authority-denied';end if;
 if p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_action is null or p_action not in('create','update','delete')then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'action',p_action,'id',p_id,'payload',p_payload,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,911));
 select *into j from public.studyschedule_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id,912));select *into t from public.studyschedule_items where id=p_id for update;stamp:=clock_timestamp();
 if p_action='create'then
  if t.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  if public.studyschedule_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
  select count(*)into live from public.studyschedule_items where world_id=p_world and deleted_at is null;if live>=200 then raise exception 'invalid-limit';end if;
  insert into public.studyschedule_items(id,world_id,payload,updated_by,created_at,updated_at)values(p_id,p_world,p_payload,p_uid,stamp,stamp)returning *into t;
 else
  if t.id is null or t.world_id is distinct from p_world or t.deleted_at is not null or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  if p_action='delete'then update public.studyschedule_items set deleted_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  else
   if public.studyschedule_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
   update public.studyschedule_items set payload=p_payload,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  end if;
 end if;
 insert into public.studyschedule_audit(actor_uid,action,item_id,revision)values(p_uid,p_action,p_id,t.revision);
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'deleted',t.deleted_at is not null);
 insert into public.studyschedule_versions values(p_world,1)on conflict(world_id)do update set revision=studyschedule_versions.revision+1;
 insert into public.studyschedule_requests values(p_uid,p_request,sig,result);
 update public.studyschedule_signal set id=1 where id=1;
 return result;
end$$;
create or replace function public.studyschedule_badge(p_uid text,p_world text,p_mark text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;seen timestamptz;n bigint;bound timestamptz;begin
 a:=public.studyschedule_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));
 insert into public.studyschedule_reads values(p_uid,p_world,clock_timestamp())on conflict do nothing;
 if p_mark is not null then select observed_at into bound from public.studyschedule_views where uid=p_uid and world_id=p_world and token=p_mark and expires_at>=clock_timestamp();if bound is null then raise exception 'invalid-read-ticket';end if;update public.studyschedule_reads set last_seen_at=greatest(last_seen_at,bound)where uid=p_uid and world_id=p_world;end if;
 select last_seen_at into seen from public.studyschedule_reads where uid=p_uid and world_id=p_world;
 select count(*)into n from public.studyschedule_items where world_id=p_world and deleted_at is null and created_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end$$;
revoke all on function public.studyschedule_world(text,text),public.studyschedule_list(text,text),public.studyschedule_mutate(text,text,text,text,jsonb,bigint,text),public.studyschedule_badge(text,text,text)from public,anon,authenticated;
grant execute on function public.studyschedule_list(text,text),public.studyschedule_mutate(text,text,text,text,jsonb,bigint,text),public.studyschedule_badge(text,text,text)to service_role;
revoke execute on function public.studyschedule_world(text,text)from service_role;
