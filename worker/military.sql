-- Authoritative Military materials (global library, owner writes, every signed-in user reads). Service-only RPCs; every call locks current authority.
create table if not exists public.military_items(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8000),
 sort_order bigint not null default 0,pinned_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by text not null,revision bigint not null default 1,deleted_at timestamptz
);
create index if not exists military_page on public.military_items(created_at,id)where deleted_at is null;
create table if not exists public.military_reads(uid text primary key references public.app_authority(uid),last_seen_at timestamptz not null);
create table if not exists public.military_views(uid text not null,token text primary key,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.military_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.military_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,item_id text,revision bigint,at timestamptz not null default clock_timestamp(),detail jsonb not null default '{}');
create table if not exists public.military_versions(id integer primary key check(id=1),revision bigint not null default 0);
alter table public.military_views enable row level security;
alter table public.military_items enable row level security;
alter table public.military_reads enable row level security;
alter table public.military_requests enable row level security;
alter table public.military_audit enable row level security;
alter table public.military_versions enable row level security;
revoke all on public.military_views,public.military_items,public.military_reads,public.military_requests,public.military_audit,public.military_versions from public,anon,authenticated,service_role;
-- Isolated constant-only Realtime relation. Never put library data here.
create table if not exists public.military_signal(id integer primary key check(id=1));
alter table public.military_signal enable row level security;
revoke all on public.military_signal from public,anon,authenticated,service_role;
grant select on public.military_signal to anon,authenticated;
drop policy if exists military_signal_read on public.military_signal;
create policy military_signal_read on public.military_signal for select to anon,authenticated using(id=1);
insert into public.military_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='military_signal')then alter publication supabase_realtime add table public.military_signal;end if;end$$;

create or replace function public.military_payload_ok(p jsonb)returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p is not null and jsonb_typeof(p)='object' and octet_length(p::text)<=8000
 and not exists(select 1 from jsonb_object_keys(p)k where k not in('title','description','type','url','fileName','mimeType','size','cloudPublicId','cloudResourceType','sortOrder','pinned'))
 and jsonb_typeof(p->'title')='string' and length(btrim(p->>'title'))>0 and length(p->>'title')<=300
 and jsonb_typeof(p->'url')='string' and p->>'url'~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and length(p->>'url')<=2000
 and jsonb_typeof(p->'type')='string' and p->>'type' in('video','pdf','audio','other')
 and(not p?'description' or(jsonb_typeof(p->'description')='string' and length(p->>'description')<=2000))
 and(not p?'fileName' or(jsonb_typeof(p->'fileName')='string' and length(p->>'fileName')<=500))
 and(not p?'mimeType' or(jsonb_typeof(p->'mimeType')='string' and length(p->>'mimeType')<=200))
 and(not p?'cloudPublicId' or(jsonb_typeof(p->'cloudPublicId')='string' and length(p->>'cloudPublicId')<=500))
 and(not p?'cloudResourceType' or(jsonb_typeof(p->'cloudResourceType')='string' and length(p->>'cloudResourceType')<=50))
 and(not p?'size' or(jsonb_typeof(p->'size')='number' and(p->>'size')~'^[0-9]{1,12}$'))
 and(not p?'sortOrder' or(jsonb_typeof(p->'sortOrder')='number' and(p->>'sortOrder')~'^[0-9]{1,15}$'))
 and(not p?'pinned' or jsonb_typeof(p->'pinned')='boolean'),false)$$;
create or replace function public.military_list(p_uid text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;stamp timestamptz;rows jsonb;ticket text;version bigint;
begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(913);stamp:=clock_timestamp();insert into public.military_versions values(1,0)on conflict do nothing;select revision into version from public.military_versions where id=1;
 if(select count(*)from public.military_items where deleted_at is null)>500 then raise exception 'invalid-overflow';end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at,x.id),'[]')into rows from(
  select id,payload,sort_order,pinned_at,created_at,updated_at,updated_by,revision from public.military_items where deleted_at is null order by created_at,id limit 500
 )x;
 ticket:=gen_random_uuid()::text;delete from public.military_views where uid=p_uid and expires_at<stamp;
 insert into public.military_views values(p_uid,ticket,stamp,stamp+interval'10 minutes');
 return jsonb_build_object('items',rows,'viewToken',ticket,'observedAt',stamp,'revision',version);
end$$;
create or replace function public.military_mutate(p_uid text,p_action text,p_id text,p_payload jsonb,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.military_items;j public.military_requests;sig jsonb;result jsonb;stamp timestamptz;live bigint;pin timestamptz;srt bigint;
begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(913);if a.role<>'owner'then raise exception 'authority-denied';end if;
 if p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_action is null or p_action not in('create','update','delete')then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('action',p_action,'id',p_id,'payload',p_payload,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,911));
 select *into j from public.military_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id,912));select *into t from public.military_items where id=p_id for update;stamp:=clock_timestamp();
 if p_action='create'then
  if t.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  if public.military_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
  select count(*)into live from public.military_items where deleted_at is null;if live>=500 then raise exception 'invalid-limit';end if;
  srt:=coalesce((p_payload->>'sortOrder')::bigint,(extract(epoch from stamp)*1000)::bigint);
  insert into public.military_items(id,payload,sort_order,pinned_at,updated_by,created_at,updated_at)values(p_id,p_payload-'sortOrder'-'pinned',srt,case when (p_payload->>'pinned')::boolean is true then stamp end,p_uid,stamp,stamp)returning *into t;
 else
  if t.id is null or t.deleted_at is not null or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  if p_action='delete'then update public.military_items set deleted_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  else
   if public.military_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
   pin:=case when not p_payload?'pinned' then t.pinned_at when (p_payload->>'pinned')::boolean then coalesce(t.pinned_at,stamp) else null end;
   update public.military_items set payload=p_payload-'sortOrder'-'pinned',sort_order=coalesce((p_payload->>'sortOrder')::bigint,sort_order),pinned_at=pin,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  end if;
 end if;
 insert into public.military_audit(actor_uid,action,item_id,revision)values(p_uid,p_action,p_id,t.revision);
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'deleted',t.deleted_at is not null);
 insert into public.military_versions values(1,1)on conflict(id)do update set revision=military_versions.revision+1;
 insert into public.military_requests values(p_uid,p_request,sig,result);
 update public.military_signal set id=1 where id=1;
 return result;
end$$;
create or replace function public.military_badge(p_uid text,p_mark text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;seen timestamptz;n bigint;bound timestamptz;begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(913);
 insert into public.military_reads values(p_uid,clock_timestamp())on conflict do nothing;
 if p_mark is not null then select observed_at into bound from public.military_views where uid=p_uid and token=p_mark and expires_at>=clock_timestamp();if bound is null then raise exception 'invalid-read-ticket';end if;update public.military_reads set last_seen_at=greatest(last_seen_at,bound)where uid=p_uid;end if;
 select last_seen_at into seen from public.military_reads where uid=p_uid;
 select count(*)into n from public.military_items where deleted_at is null and created_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end$$;
revoke all on function public.military_list(text),public.military_mutate(text,text,text,jsonb,bigint,text),public.military_badge(text,text)from public,anon,authenticated;
grant execute on function public.military_list(text),public.military_mutate(text,text,text,jsonb,bigint,text),public.military_badge(text,text)to service_role;
