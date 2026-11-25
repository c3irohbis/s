-- Authoritative News. Service-only RPCs; every operation locks current authority.
create table if not exists public.news_items(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 title text not null check(length(trim(title))between 1 and 500),body text not null default '' check(length(body)<=10000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 updated_by text not null,revision bigint not null default 1,deleted_at timestamptz
);
create index if not exists news_page on public.news_items(world_id,created_at desc,id desc)where deleted_at is null;
create table if not exists public.news_reads(uid text not null references public.app_authority(uid),world_id text not null,last_seen_at timestamptz not null,primary key(uid,world_id));
create table if not exists public.news_prefs(uid text primary key references public.app_authority(uid),enabled boolean not null default true,valid boolean not null default true);
create table if not exists public.news_inbox(
 id text primary key,legacy_id text unique,recipient_uid text not null references public.app_authority(uid),item_id text not null,
 world_id text not null,sender_uid text not null,title text not null,body text not null,tag text not null,
 created_at timestamptz not null,read_at timestamptz,dismissed_at timestamptz,os_claimed_at timestamptz,os_claimed_by text,
 unique(item_id,recipient_uid)
);
create index if not exists news_inbox_recipient on public.news_inbox(recipient_uid,created_at desc,id desc);
create table if not exists public.news_views(uid text not null,token text primary key,world_id text not null,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.news_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.news_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,item_id text,revision bigint,at timestamptz not null default clock_timestamp(),detail jsonb not null default '{}');
alter table public.news_views enable row level security;
alter table public.news_items enable row level security;
alter table public.news_reads enable row level security;
alter table public.news_prefs enable row level security;
alter table public.news_inbox enable row level security;
alter table public.news_requests enable row level security;
alter table public.news_audit enable row level security;
revoke all on public.news_views,public.news_items,public.news_reads,public.news_prefs,public.news_inbox,public.news_requests,public.news_audit from public,anon,authenticated,service_role;
-- Isolated constant-only Realtime relation. Never put News data here.
create table if not exists public.news_signal(id integer primary key check(id=1));
alter table public.news_signal enable row level security;
revoke all on public.news_signal from public,anon,authenticated,service_role;
grant select on public.news_signal to anon,authenticated;
drop policy if exists news_signal_read on public.news_signal;
create policy news_signal_read on public.news_signal for select to anon,authenticated using(id=1);
insert into public.news_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='news_signal')then alter publication supabase_realtime add table public.news_signal;end if;end$$;
do $$begin if(select count(*)from pg_publication_tables where pubname='supabase_realtime')<>1 or not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='news_signal')then raise exception 'unexpected-realtime-publication';end if;end$$;
create or replace function public.news_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;
create or replace function public.news_list(p_uid text,p_world text,p_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;stamp timestamptz;edge_time timestamptz;edge_id text;rows jsonb;more boolean;ticket text;
begin
 a:=public.news_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,713));stamp:=clock_timestamp();
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object'or(p_cursor-array['world','at','id'])<>'{}'or p_cursor->>'world'is distinct from p_world or p_cursor->>'at'is null or p_cursor->>'id'is null then raise exception 'invalid-cursor';end if;
  begin edge_time:=(p_cursor->>'at')::timestamptz;exception when others then raise exception 'invalid-cursor';end;edge_id:=p_cursor->>'id';
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into rows from(
  select id,world_id,title,body,created_at,updated_at,updated_by,revision from public.news_items
  where world_id=p_world and deleted_at is null and(p_cursor is null or(created_at,id)<(edge_time,edge_id))order by created_at desc,id desc limit 25
 )x;
 select exists(select 1 from public.news_items where world_id=p_world and deleted_at is null and jsonb_array_length(rows)=25 and(created_at,id)<((rows->-1->>'created_at')::timestamptz,rows->-1->>'id'))into more;
 ticket:=gen_random_uuid()::text;delete from public.news_views where uid=p_uid and expires_at<stamp;
 insert into public.news_views values(p_uid,ticket,p_world,stamp,stamp+interval'10 minutes');
 return jsonb_build_object('items',rows,'viewToken',ticket,'observedAt',stamp,'nextCursor',case when more then jsonb_build_object('world',p_world,'at',rows->-1->>'created_at','id',rows->-1->>'id')else null end);
end$$;
create or replace function public.news_mutate(p_uid text,p_world text,p_action text,p_id text,p_title text,p_body text,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.news_items;j public.news_requests;sig jsonb;result jsonb;stamp timestamptz;
begin
 a:=public.news_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,713));if a.role not in('owner','admin')then raise exception 'authority-denied';end if;
 if p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_action is null or p_action not in('create','update','delete')then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'action',p_action,'id',p_id,'title',p_title,'body',p_body,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,711));
 select *into j from public.news_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id,712));select *into t from public.news_items where id=p_id for update;stamp:=clock_timestamp();
 if p_action='create'then
  if t.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  if p_title is null or length(trim(p_title))not between 1 and 500 or p_body is null or length(p_body)>10000 then raise exception 'invalid-input';end if;
  insert into public.news_items(id,world_id,title,body,updated_by,created_at,updated_at)values(p_id,p_world,trim(p_title),p_body,p_uid,stamp,stamp)returning *into t;
  perform 1 from public.app_authority where world_id=p_world or role='owner' order by uid for share;
  perform pg_advisory_xact_lock(hashtextextended(uid,714))from public.app_authority where world_id=p_world or role='owner' order by uid;
  -- Same recipients as legacy: same world plus owner, excluding author. Invalid preference fails closed per recipient.
  insert into public.news_inbox(id,recipient_uid,item_id,world_id,sender_uid,title,body,tag,created_at)
   select 'news-'||p_id||'-'||u.uid,u.uid,p_id,p_world,p_uid,'📰 خبر جديد',left(trim(p_title),300),'news-'||p_id,stamp
   from public.app_authority u left join public.news_prefs p on p.uid=u.uid
   where not u.pending and not u.deleted and not u.is_banned and(u.world_id=p_world or u.role='owner')and u.uid<>p_uid
     and coalesce(p.valid,true)and coalesce(p.enabled,true);
  insert into public.news_audit(actor_uid,action,item_id,revision,detail)select p_uid,'invalid-recipient-pref',p_id,1,jsonb_build_object('recipient',u.uid)from public.app_authority u join public.news_prefs p on p.uid=u.uid where not p.valid and(u.world_id=p_world or u.role='owner');
 else
  if t.id is null or t.world_id is distinct from p_world or t.deleted_at is not null or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  if p_action='delete'then update public.news_items set deleted_at=stamp,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  else
   if p_title is null or length(trim(p_title))not between 1 and 500 or p_body is null or length(p_body)>10000 then raise exception 'invalid-input';end if;
   update public.news_items set title=trim(p_title),body=p_body,updated_at=stamp,updated_by=p_uid,revision=revision+1 where id=p_id returning *into t;
  end if;
 end if;
 insert into public.news_audit(actor_uid,action,item_id,revision)values(p_uid,p_action,p_id,t.revision);
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'deleted',t.deleted_at is not null);
 insert into public.news_requests values(p_uid,p_request,sig,result);
 update public.news_signal set id=1 where id=1;
 return result;
end$$;
create or replace function public.news_badge(p_uid text,p_world text,p_mark text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;seen timestamptz;n bigint;bound timestamptz;begin
 a:=public.news_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,713));
 insert into public.news_reads values(p_uid,p_world,clock_timestamp())on conflict do nothing;
 if p_mark is not null then select observed_at into bound from public.news_views where uid=p_uid and world_id=p_world and token=p_mark and expires_at>=clock_timestamp();if bound is null then raise exception 'invalid-read-ticket';end if;update public.news_reads set last_seen_at=greatest(last_seen_at,bound)where uid=p_uid and world_id=p_world;end if;
 select last_seen_at into seen from public.news_reads where uid=p_uid and world_id=p_world;
 select count(*)into n from public.news_items where world_id=p_world and deleted_at is null and created_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end$$;
create or replace function public.news_pref(p_uid text,p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;p public.news_prefs;begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(hashtextextended(p_uid,714));
 if p_enabled is not null then insert into public.news_prefs values(p_uid,p_enabled,true)on conflict(uid)do update set enabled=excluded.enabled,valid=true;end if;
 select *into p from public.news_prefs where uid=p_uid;return jsonb_build_object('enabled',coalesce(p.enabled,true)and coalesce(p.valid,true));end$$;
create or replace function public.news_notifications(p_uid text,p_action text default 'list',p_id text default null,p_context text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;outbox jsonb;claimed boolean:=false;begin
 a:=public.authority_current(p_uid);perform pg_advisory_xact_lock(hashtextextended(p_uid,714));
 if p_action is null or p_action not in('list','read','dismiss','claim')then raise exception 'invalid-input';end if;
 if p_action<>'list'then
  if p_id is null then raise exception 'invalid-input';end if;
  if p_action='read'then update public.news_inbox set read_at=coalesce(read_at,clock_timestamp())where id=p_id and recipient_uid=p_uid and(a.role='owner'or world_id=a.world_id);
  elsif p_action='dismiss'then update public.news_inbox set dismissed_at=coalesce(dismissed_at,clock_timestamp())where id=p_id and recipient_uid=p_uid and(a.role='owner'or world_id=a.world_id);
  else
   if p_context is null or length(p_context)not between 1 and 128 then raise exception 'invalid-input';end if;
   update public.news_inbox b set os_claimed_at=clock_timestamp(),os_claimed_by=p_context where b.id=p_id and recipient_uid=p_uid and os_claimed_at is null and dismissed_at is null and read_at is null
    and(a.role='owner'or b.world_id=a.world_id)and exists(select 1 from public.news_items n where n.id=b.item_id and n.deleted_at is null)
    and not exists(select 1 from public.news_prefs p where p.uid=p_uid and(not p.enabled or not p.valid));claimed:=found;
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into outbox from(
  select b.id,b.item_id,b.world_id,b.sender_uid,b.title,b.body,b.tag,b.created_at,b.read_at,b.os_claimed_at,(n.id is null or n.deleted_at is not null)as removed
  from public.news_inbox b left join public.news_items n on n.id=b.item_id
  where recipient_uid=p_uid and dismissed_at is null and(a.role='owner'or b.world_id=a.world_id)
  order by b.created_at desc,b.id desc limit 100
 )x;
 return jsonb_build_object('items',outbox,'claimed',claimed);
end$$;
revoke all on function public.news_world(text,text),public.news_list(text,text,jsonb),public.news_mutate(text,text,text,text,text,text,bigint,text),public.news_badge(text,text,text),public.news_pref(text,boolean),public.news_notifications(text,text,text,text)from public,anon,authenticated;
grant execute on function public.news_list(text,text,jsonb),public.news_mutate(text,text,text,text,text,text,bigint,text),public.news_badge(text,text,text),public.news_pref(text,boolean),public.news_notifications(text,text,text,text)to service_role;
revoke execute on function public.news_world(text,text)from service_role;
