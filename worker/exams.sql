-- Authoritative Exams. Service-only RPCs; every operation locks current authority.
create table if not exists public.exams_items(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=60000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by text not null,revision bigint not null default 1,deleted_at timestamptz
);
create index if not exists exams_page on public.exams_items(world_id,created_at desc,id desc)where deleted_at is null;
create table if not exists public.exams_reads(uid text not null references public.app_authority(uid),world_id text not null,last_seen_at timestamptz not null,primary key(uid,world_id));
create table if not exists public.exams_prefs(uid text primary key references public.app_authority(uid),enabled boolean not null default true,valid boolean not null default true);
create table if not exists public.exams_inbox(
 id text primary key,legacy_id text unique,recipient_uid text not null references public.app_authority(uid),item_id text not null,
 world_id text not null,sender_uid text not null,title text not null,body text not null,tag text not null,
 created_at timestamptz not null,read_at timestamptz,dismissed_at timestamptz,os_claimed_at timestamptz,os_claimed_by text,
 unique(item_id,recipient_uid)
);
create index if not exists exams_inbox_recipient on public.exams_inbox(recipient_uid,created_at desc,id desc);
create table if not exists public.exams_views(uid text not null,token text primary key,world_id text not null,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.exams_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.exams_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,item_id text,revision bigint,at timestamptz not null default clock_timestamp(),detail jsonb not null default '{}');
alter table public.exams_views enable row level security;
alter table public.exams_items enable row level security;
alter table public.exams_reads enable row level security;
alter table public.exams_prefs enable row level security;
alter table public.exams_inbox enable row level security;
alter table public.exams_requests enable row level security;
alter table public.exams_audit enable row level security;
revoke all on public.exams_views,public.exams_items,public.exams_reads,public.exams_prefs,public.exams_inbox,public.exams_requests,public.exams_audit from public,anon,authenticated,service_role;
-- Isolated constant-only Realtime relation. Never put Exams data here.
create table if not exists public.exams_signal(id integer primary key check(id=1));
alter table public.exams_signal enable row level security;
revoke all on public.exams_signal from public,anon,authenticated,service_role;
grant select on public.exams_signal to anon,authenticated;
drop policy if exists exams_signal_read on public.exams_signal;
create policy exams_signal_read on public.exams_signal for select to anon,authenticated using(id=1);
insert into public.exams_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='exams_signal')then alter publication supabase_realtime add table public.exams_signal;end if;end$$;

create or replace function public.exams_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;
create table if not exists public.exams_versions(world_id text primary key,revision bigint not null default 0);
alter table public.exams_versions enable row level security;
revoke all on public.exams_versions from public,anon,authenticated,service_role;
create or replace function public.exams_list(p_uid text,p_world text,p_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;stamp timestamptz;edge_time timestamptz;edge_id text;rows jsonb;more boolean;ticket text;version bigint;direction text;prev boolean;
begin
 a:=public.exams_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));stamp:=clock_timestamp();insert into public.exams_versions values(p_world,0)on conflict do nothing;select revision into version from public.exams_versions where world_id=p_world;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object'or(p_cursor-array['world','at','id','revision','direction'])<>'{}'or p_cursor->>'world'is distinct from p_world or p_cursor->>'at'is null or p_cursor->>'id'is null then raise exception 'invalid-cursor';end if;
  if p_cursor->>'revision' is distinct from version::text then raise exception 'revision-conflict';end if;direction:=p_cursor->>'direction';if direction is null or direction not in('next','prev')then raise exception 'invalid-cursor';end if;
  begin edge_time:=(p_cursor->>'at')::timestamptz;exception when others then raise exception 'invalid-cursor';end;edge_id:=p_cursor->>'id';
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into rows from(
  select * from(select id,world_id,payload,created_at,updated_at,updated_by,revision from public.exams_items
  where world_id=p_world and deleted_at is null and(p_cursor is null or(direction='next'and(created_at,id)<(edge_time,edge_id))or(direction='prev'and(created_at,id)>(edge_time,edge_id)))
  order by case when direction='prev'then created_at end asc,case when direction='prev'then id end asc,created_at desc,id desc limit 60)y
 )x;
 select exists(select 1 from public.exams_items where world_id=p_world and deleted_at is null and jsonb_array_length(rows)>0 and(created_at,id)<((rows->-1->>'created_at')::timestamptz,rows->-1->>'id'))into more;
 ticket:=gen_random_uuid()::text;delete from public.exams_views where uid=p_uid and expires_at<stamp;
 insert into public.exams_views values(p_uid,ticket,p_world,stamp,stamp+interval'10 minutes');
 prev:=exists(select 1 from public.exams_items where world_id=p_world and deleted_at is null and jsonb_array_length(rows)>0 and(created_at,id)>((rows->0->>'created_at')::timestamptz,rows->0->>'id'));
 return jsonb_build_object('items',rows,'viewToken',ticket,'observedAt',stamp,'revision',version,'hasMore',more,'hasPrevious',prev,
  'nextCursor',case when more and jsonb_array_length(rows)>0 then jsonb_build_object('world',p_world,'at',rows->-1->>'created_at','id',rows->-1->>'id','revision',version,'direction','next')else null end,
  'prevCursor',case when prev and jsonb_array_length(rows)>0 then jsonb_build_object('world',p_world,'at',rows->0->>'created_at','id',rows->0->>'id','revision',version,'direction','prev')else null end);
end$$;
create or replace function public.exams_payload_ok(p jsonb)returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p is not null and jsonb_typeof(p)='object' and octet_length(p::text)<=60000
 and not exists(select 1 from jsonb_object_keys(p)k where k not in('subject','date','time','room'))
 and jsonb_typeof(p->'subject')='string' and length(btrim(p->>'subject'))>0
 and(not p?'date' or jsonb_typeof(p->'date')='string')
 and(not p?'time' or jsonb_typeof(p->'time')='string')
 and(not p?'room' or jsonb_typeof(p->'room')='string'),false)$$;
create or replace function public.exams_mutate(p_uid text,p_world text,p_action text,p_id text,p_payload jsonb,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.exams_items;j public.exams_requests;sig jsonb;result jsonb;stamp timestamptz;
begin
 a:=public.exams_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));if a.role not in('owner','admin')then raise exception 'authority-denied';end if;
 if p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_action is null or p_action not in('create','update','delete')then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'action',p_action,'id',p_id,'payload',p_payload,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,911));
 select *into j from public.exams_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id,912));select *into t from public.exams_items where id=p_id for update;stamp:=clock_timestamp();
 if p_action='create'then
  if t.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  if public.exams_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
  insert into public.exams_items(id,world_id,payload,updated_by,created_at,updated_at)values(p_id,p_world,p_payload,p_uid,stamp,stamp)returning *into t;
  perform 1 from public.app_authority where world_id=p_world or role='owner' order by uid for share;
  perform pg_advisory_xact_lock(hashtextextended(uid,914))from public.app_authority where world_id=p_world or role='owner' order by uid;
  -- Same recipients as legacy: same world plus owner, excluding author. Invalid preference fails closed per recipient.
  insert into public.exams_inbox(id,recipient_uid,item_id,world_id,sender_uid,title,body,tag,created_at)
   select 'exams-'||p_id||'-'||u.uid,u.uid,p_id,p_world,p_uid,'📅 امتحان جديد',left(coalesce(p_payload->>'subject',''),300),'exams-'||p_id,stamp
   from public.app_authority u left join public.exams_prefs p on p.uid=u.uid
   where not u.pending and not u.deleted and not u.is_banned and(u.world_id=p_world or u.role='owner')and u.uid<>p_uid
     and coalesce(p.valid,true)and coalesce(p.enabled,true);
  insert into public.exams_audit(actor_uid,action,item_id,revision,detail)select p_uid,'invalid-recipient-pref',p_id,1,jsonb_build_object('recipient',u.uid)from public.app_authority u join public.exams_prefs p on p.uid=u.uid where not p.valid and(u.world_id=p_world or u.role='owner');
 else
  if t.id is null or t.world_id is distinct from p_world or t.deleted_at is not null or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  if p_action='delete'then update public.exams_items set deleted_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  else
   if public.exams_payload_ok(p_payload) is not true then raise exception 'invalid-input';end if;
   update public.exams_items set payload=p_payload,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  end if;
 end if;
 insert into public.exams_audit(actor_uid,action,item_id,revision)values(p_uid,p_action,p_id,t.revision);
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'deleted',t.deleted_at is not null);
 insert into public.exams_versions values(p_world,1)on conflict(world_id)do update set revision=exams_versions.revision+1;
 insert into public.exams_requests values(p_uid,p_request,sig,result);
 update public.exams_signal set id=1 where id=1;
 return result;
end$$;
create or replace function public.exams_badge(p_uid text,p_world text,p_mark text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;seen timestamptz;n bigint;bound timestamptz;begin
 a:=public.exams_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,913));
 insert into public.exams_reads values(p_uid,p_world,clock_timestamp())on conflict do nothing;
 if p_mark is not null then select observed_at into bound from public.exams_views where uid=p_uid and world_id=p_world and token=p_mark and expires_at>=clock_timestamp();if bound is null then raise exception 'invalid-read-ticket';end if;update public.exams_reads set last_seen_at=greatest(last_seen_at,bound)where uid=p_uid and world_id=p_world;end if;
 select last_seen_at into seen from public.exams_reads where uid=p_uid and world_id=p_world;
 select count(*)into n from public.exams_items where world_id=p_world and deleted_at is null and created_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end$$;
create or replace function public.exams_pref(p_uid text,p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;p public.exams_prefs;begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(hashtextextended(p_uid,914));
 if p_enabled is not null then insert into public.exams_prefs values(p_uid,p_enabled,true)on conflict(uid)do update set enabled=excluded.enabled,valid=true;end if;
 select *into p from public.exams_prefs where uid=p_uid;return jsonb_build_object('enabled',coalesce(p.enabled,true)and coalesce(p.valid,true));end$$;
create or replace function public.exams_notifications(p_uid text,p_action text default 'list',p_id text default null,p_context text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;outbox jsonb;claimed boolean:=false;begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(hashtextextended(p_uid,914));
 if p_action is null or p_action not in('list','read','dismiss','claim')then raise exception 'invalid-input';end if;
 if p_action<>'list'then
  if p_id is null then raise exception 'invalid-input';end if;
  if p_action='read'then update public.exams_inbox set read_at=coalesce(read_at,clock_timestamp())where id=p_id and recipient_uid=p_uid and(a.role='owner'or world_id=a.world_id);
  elsif p_action='dismiss'then update public.exams_inbox set dismissed_at=coalesce(dismissed_at,clock_timestamp())where id=p_id and recipient_uid=p_uid and(a.role='owner'or world_id=a.world_id);
  else
   if p_context is null or length(p_context)not between 1 and 128 then raise exception 'invalid-input';end if;
   update public.exams_inbox b set os_claimed_at=clock_timestamp(),os_claimed_by=p_context where b.id=p_id and recipient_uid=p_uid and os_claimed_at is null and dismissed_at is null and read_at is null
    and(a.role='owner'or b.world_id=a.world_id)and exists(select 1 from public.exams_items n where n.id=b.item_id and n.deleted_at is null)
    and not exists(select 1 from public.exams_prefs p where p.uid=p_uid and(not p.enabled or not p.valid));claimed:=found;
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into outbox from(
  select b.id,b.item_id,b.world_id,b.sender_uid,b.title,b.body,b.tag,b.created_at,b.read_at,b.os_claimed_at,(n.id is null or n.deleted_at is not null)as removed
  from public.exams_inbox b left join public.exams_items n on n.id=b.item_id
  where recipient_uid=p_uid and dismissed_at is null and(a.role='owner'or b.world_id=a.world_id)
  order by b.created_at desc,b.id desc limit 100
 )x;
 return jsonb_build_object('items',outbox,'claimed',claimed);
end$$;
revoke all on function public.exams_world(text,text),public.exams_list(text,text,jsonb),public.exams_mutate(text,text,text,text,jsonb,bigint,text),public.exams_badge(text,text,text),public.exams_pref(text,boolean),public.exams_notifications(text,text,text,text)from public,anon,authenticated;
grant execute on function public.exams_list(text,text,jsonb),public.exams_mutate(text,text,text,text,jsonb,bigint,text),public.exams_badge(text,text,text),public.exams_pref(text,boolean),public.exams_notifications(text,text,text,text)to service_role;
revoke execute on function public.exams_world(text,text)from service_role;
