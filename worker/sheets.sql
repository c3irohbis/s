-- Sheets authority and atomic numbering. Private tables, service-only RPC boundary.
begin;
create table if not exists public.sheets_subjects(id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),name text not null check(length(trim(name))between 1 and 500),code text not null check(length(code)<=200),status text not null check(status in('active','archived')),sheets_count bigint not null default 0 check(sheets_count>=0),active_count bigint not null default 0 check(active_count>=0),created_at timestamptz not null default clock_timestamp(),archived_at timestamptz,created_by text not null,revision bigint not null default 1);
create table if not exists public.sheets_items(id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),subject_id text not null references public.sheets_subjects(id),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),ordinal bigint not null check(ordinal>0),page text not null check(length(trim(page))between 1 and 500),due_date timestamptz not null,note text check(length(note)<=10000),image text check(length(image)<=4096),created_at timestamptz not null default clock_timestamp(),created_by text not null,revision bigint not null default 1,deleted_at timestamptz,unique(subject_id,ordinal));
create index if not exists sheets_world_subject on public.sheets_subjects(world_id,created_at,id);
create index if not exists sheets_subject_page on public.sheets_items(subject_id,ordinal,id)where deleted_at is null;
-- No FK to items: historical completions survive deletion and source orphans.
-- Completion payload records are declared below before functions use them.
create table if not exists public.sheets_reads(uid text not null references public.app_authority(uid),world_id text not null,last_seen_at timestamptz not null,primary key(uid,world_id));
create table if not exists public.sheets_views(token text primary key,uid text not null,world_id text not null,observed_at timestamptz not null,expires_at timestamptz not null);
create table if not exists public.sheets_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.sheets_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,target_id text not null,revision bigint,at timestamptz not null default clock_timestamp());
create table if not exists public.sheets_completion_versions(uid text primary key references public.app_authority(uid),revision bigint not null default 0);
alter table public.sheets_completion_versions enable row level security;
revoke all on public.sheets_completion_versions from public,anon,authenticated,service_role;
create table if not exists public.sheets_versions(world_id text primary key,revision bigint not null default 0);
alter table public.sheets_versions enable row level security;
revoke all on public.sheets_versions from public,anon,authenticated,service_role;
create table if not exists public.sheets_signal(id integer primary key check(id=1));
alter table public.sheets_subjects enable row level security;
alter table public.sheets_items enable row level security;

alter table public.sheets_reads enable row level security;
alter table public.sheets_views enable row level security;
alter table public.sheets_requests enable row level security;
alter table public.sheets_audit enable row level security;
alter table public.sheets_signal enable row level security;
revoke all on public.sheets_subjects,public.sheets_items,public.sheets_reads,public.sheets_views,public.sheets_requests,public.sheets_audit,public.sheets_signal from public,anon,authenticated,service_role;
grant select on public.sheets_signal to anon,authenticated;
drop policy if exists sheets_signal_read on public.sheets_signal;
create policy sheets_signal_read on public.sheets_signal for select to anon,authenticated using(id=1);
insert into public.sheets_signal values(1)on conflict do nothing;
do $$begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and schemaname='public'and tablename='sheets_signal')then alter publication supabase_realtime add table public.sheets_signal;end if;
if exists(select 1 from pg_publication_tables where pubname='supabase_realtime'and(schemaname<>'public'or tablename not in('news_signal','sheets_signal')))then raise exception 'unexpected-realtime-publication';end if;end$$;
create table if not exists public.sheets_completion_records(uid text not null references public.app_authority(uid),sheet_id text not null,payload jsonb not null,primary key(uid,sheet_id));
alter table public.sheets_completion_records enable row level security;
revoke all on public.sheets_completion_records from public,anon,authenticated,service_role;
create or replace function public.sheets_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$declare a public.app_authority;begin
a:=public.authority_current(p_uid);if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;return a;end$$;
create or replace function public.sheets_list(p_uid text,p_world text,p_subject text default null,p_cursor jsonb default null)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;s public.sheets_subjects;rows jsonb;stamp timestamptz;ticket text;edge_time timestamptz;edge_order bigint;edge_id text;more boolean;version bigint;completion_version bigint;begin
 a:=public.sheets_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,813));perform pg_advisory_xact_lock(hashtextextended(p_uid,814));stamp:=clock_timestamp();select revision into version from public.sheets_versions where world_id=p_world;version:=coalesce(version,0);select revision into completion_version from public.sheets_completion_versions where uid=p_uid;completion_version:=coalesce(completion_version,0);
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object'or(p_cursor-array['world','subject','at','order','id','v','revision','completionRevision'])<>'{}'or p_cursor->>'world'is distinct from p_world or p_cursor->>'subject'is distinct from p_subject or p_cursor->>'id'is null then raise exception 'invalid-cursor';end if;
  if p_cursor->>'completionRevision'is distinct from completion_version::text or p_cursor->>'v'is distinct from '1'or p_cursor->>'revision'is distinct from version::text then raise exception 'revision-conflict';end if;
  begin edge_time:=(p_cursor->>'at')::timestamptz;edge_order:=(p_cursor->>'order')::bigint;exception when others then raise exception 'invalid-cursor';end;edge_id:=p_cursor->>'id';
  if(p_subject is null and edge_time is null)or(p_subject is not null and edge_order is null)then raise exception 'invalid-cursor';end if;
 end if;
 if p_subject is null then
  select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at,x.id),'[]')into rows from(select *from public.sheets_subjects where world_id=p_world and(p_cursor is null or(created_at,id)>(edge_time,edge_id))order by created_at,id limit 50)x;
  select exists(select 1 from public.sheets_subjects where world_id=p_world and jsonb_array_length(rows)=50 and(created_at,id)>((rows->-1->>'created_at')::timestamptz,rows->-1->>'id'))into more;
 else
  select *into s from public.sheets_subjects where id=p_subject and world_id=p_world;if s.id is null then raise exception 'authority-denied';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.ordinal,x.id),'[]')into rows from(
   select i.*,coalesce(c.payload->'completed'='true'::jsonb,false)completed,c.payload->>'completedAt'completed_at from public.sheets_items i left join public.sheets_completion_records c on c.sheet_id=i.id and c.uid=p_uid
   where i.subject_id=p_subject and i.world_id=p_world and i.deleted_at is null and(p_cursor is null or(i.ordinal,i.id)>(edge_order,edge_id))order by i.ordinal,i.id limit 50)x;
  select exists(select 1 from public.sheets_items where subject_id=p_subject and world_id=p_world and deleted_at is null and jsonb_array_length(rows)=50 and(ordinal,id)>((rows->-1->>'ordinal')::bigint,rows->-1->>'id'))into more;
 end if;
 ticket:=gen_random_uuid()::text;delete from public.sheets_views where uid=p_uid and expires_at<stamp;insert into public.sheets_views values(ticket,p_uid,p_world,stamp,stamp+interval'10minutes');
 return jsonb_build_object('items',rows,'subject',case when p_subject is not null then to_jsonb(s)else null end,'viewToken',ticket,'nextCursor',case when more then jsonb_build_object('completionRevision',completion_version,'v',1,'revision',version,'world',p_world,'subject',p_subject,'at',rows->-1->>'created_at','order',rows->-1->>'ordinal','id',rows->-1->>'id')else null end);
end$$;
create or replace function public.sheets_mutate(p_uid text,p_world text,p_kind text,p_action text,p_id text,p_data jsonb,p_expected bigint,p_request text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;s public.sheets_subjects;i public.sheets_items;j public.sheets_requests;sig jsonb;result jsonb;stamp timestamptz;due timestamptz;begin
 a:=public.sheets_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,813));
 if a.role not in('admin','owner')then raise exception 'authority-denied';end if;
 if p_kind is null or p_kind not in('subject','item')or p_action is null or p_action not in('create','update','delete','archive','reopen')or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_data is null or jsonb_typeof(p_data)<>'object'then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'kind',p_kind,'action',p_action,'id',p_id,'data',p_data,'expected',p_expected);perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,811));
 select *into j from public.sheets_requests where uid=p_uid and request_id=p_request;if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id,812));stamp:=clock_timestamp();
 if p_kind='subject'then
  select *into s from public.sheets_subjects where id=p_id for update;
  if s.id is not null and s.world_id<>p_world then raise exception 'authority-denied';end if;
  if p_action='create'then
   if s.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  elsif s.id is null or p_expected is distinct from s.revision then raise exception 'revision-conflict';end if;
  if p_action in('create','update')then
   if(p_data-array['name','code'])<>'{}'or jsonb_typeof(p_data->'name')is distinct from 'string'or jsonb_typeof(p_data->'code')is distinct from 'string'or length(trim(p_data->>'name'))not between 1 and 500 or length(p_data->>'code')>200 then raise exception 'invalid-input';end if;
   if p_action='create'then insert into public.sheets_subjects(id,world_id,name,code,status,created_by,created_at)values(p_id,p_world,p_data->>'name',p_data->>'code','active',p_uid,stamp)returning *into s;
   else update public.sheets_subjects set name=p_data->>'name',code=p_data->>'code',revision=revision+1 where id=p_id returning *into s;end if;
  elsif p_action in('archive','reopen')then
   if p_data<>'{}'then raise exception 'invalid-input';end if;
   update public.sheets_subjects set status=case when p_action='archive'then'archived'else'active'end,archived_at=case when p_action='archive'then stamp else null end,revision=revision+1 where id=p_id returning *into s;
  else raise exception 'invalid-input';end if;
  result:=jsonb_build_object('id',s.id,'revision',s.revision);
 else
  select *into i from public.sheets_items where id=p_id for update;
  if i.id is not null and i.world_id<>p_world then raise exception 'authority-denied';end if;
  if p_action='create'then
   if i.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
   select *into s from public.sheets_subjects where id=p_data->>'subjectId'and world_id=p_world for update;
   if s.id is null then raise exception 'authority-denied';end if;if s.status<>'active'then raise exception 'revision-conflict';end if;
  elsif p_action in('update','delete')then
   if i.id is null or i.deleted_at is not null or p_expected is distinct from i.revision then raise exception 'revision-conflict';end if;
   select *into s from public.sheets_subjects where id=i.subject_id and world_id=p_world for update;if s.id is null then raise exception 'authority-denied';end if;
  else raise exception 'invalid-input';end if;
  if p_action in('create','update')then
   if(p_data-array['subjectId','page','dueDate','note','image'])<>'{}'or(p_action='update'and p_data?'subjectId')or jsonb_typeof(p_data->'page')is distinct from 'string'or length(trim(p_data->>'page'))not between 1 and 500 or jsonb_typeof(p_data->'dueDate')is distinct from 'string'or(p_data->>'dueDate')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'or(coalesce(jsonb_typeof(p_data->'note'),'null')not in('string','null'))or(coalesce(jsonb_typeof(p_data->'image'),'null')not in('string','null'))or length(coalesce(p_data->>'note',''))>10000 or length(coalesce(p_data->>'image',''))>4096 then raise exception 'invalid-input';end if;
   begin due:=(p_data->>'dueDate')::timestamptz;exception when others then raise exception 'invalid-input';end;
   if p_data->>'image'is not null and(p_data->>'image')!~'^https://'then raise exception 'invalid-input';end if;
   if p_action='create'then
    insert into public.sheets_items(id,subject_id,world_id,ordinal,page,due_date,note,image,created_at,created_by)values(p_id,s.id,p_world,s.sheets_count+1,p_data->>'page',due,p_data->>'note',p_data->>'image',stamp,p_uid)returning *into i;
    update public.sheets_subjects set sheets_count=sheets_count+1,active_count=active_count+1,revision=revision+1 where id=s.id;
   else update public.sheets_items set page=p_data->>'page',due_date=due,note=case when p_data?'note'then p_data->>'note'else note end,image=case when p_data?'image'then p_data->>'image'else image end,revision=revision+1 where id=p_id returning *into i;end if;
  else
   if p_data<>'{}'then raise exception 'invalid-input';end if;
   update public.sheets_items set deleted_at=stamp,revision=revision+1 where id=p_id returning *into i;
   update public.sheets_subjects set active_count=active_count-1,revision=revision+1 where id=s.id;
  end if;
  result:=jsonb_build_object('id',i.id,'revision',i.revision,'order',i.ordinal);
 end if;
 insert into public.sheets_versions values(p_world,1)on conflict(world_id)do update set revision=public.sheets_versions.revision+1;insert into public.sheets_requests values(p_uid,p_request,sig,result);insert into public.sheets_audit(actor_uid,action,target_id,revision)values(p_uid,p_kind||':'||p_action,p_id,(result->>'revision')::bigint);update public.sheets_signal set id=1;return result;
end$$;
-- Preserve legacy self-only record CRUD, including orphan contexts. No foreign UID parameter.
-- Missing or arbitrary historical payload fields are retained in payload, not silently dropped.
create or replace function public.sheets_completion_record(p_uid text,p_action text,p_id text,p_data jsonb default null)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;r jsonb;begin
 a:=public.authority_current(p_uid);if p_action is null or p_action not in('get','set','delete')or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'then raise exception 'invalid-input';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_uid,814));
 if p_action='set'then
  if p_data is null or jsonb_typeof(p_data)<>'object'or octet_length(p_data::text)>32768 then raise exception 'invalid-input';end if;
  insert into public.sheets_completion_records values(p_uid,p_id,p_data)on conflict(uid,sheet_id)do update set payload=excluded.payload;
 elsif p_action='delete'then delete from public.sheets_completion_records where uid=p_uid and sheet_id=p_id;
 end if;
 if p_action<>'get'then insert into public.sheets_completion_versions values(p_uid,1)on conflict(uid)do update set revision=public.sheets_completion_versions.revision+1;end if;
 select payload into r from public.sheets_completion_records where uid=p_uid and sheet_id=p_id;return jsonb_build_object('id',p_id,'exists',r is not null,'data',r);
end$$;
create or replace function public.sheets_complete(p_uid text,p_world text,p_id text,p_completed boolean)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$declare a public.app_authority;i public.sheets_items;old jsonb;stamp text;begin
 a:=public.sheets_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,813));perform pg_advisory_xact_lock(hashtextextended(p_uid,814));if p_completed is null then raise exception 'invalid-input';end if;
 select *into i from public.sheets_items where id=p_id and world_id=p_world and deleted_at is null for share;if i.id is null then raise exception 'authority-denied';end if;
 select payload into old from public.sheets_completion_records where uid=p_uid and sheet_id=p_id;
 stamp:=case when not p_completed then null when old->'completed'='true'::jsonb then old->>'completedAt'else clock_timestamp()::text end;
 perform public.sheets_completion_record(p_uid,'set',p_id,coalesce(old,'{}')||jsonb_build_object('sheetId',p_id,'subjectId',i.subject_id,'completed',p_completed,'completedAt',stamp));
 return jsonb_build_object('id',p_id,'completed',p_completed);end$$;
create or replace function public.sheets_badge(p_uid text,p_world text,p_ticket text default null)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$declare a public.app_authority;stamp timestamptz;n bigint;v public.sheets_views;begin
 a:=public.sheets_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,813));stamp:=clock_timestamp();
 if p_ticket is not null then select *into v from public.sheets_views where token=p_ticket and uid=p_uid and world_id=p_world and expires_at>stamp;if v.token is null then raise exception 'invalid-ticket';end if;
 insert into public.sheets_reads values(p_uid,p_world,v.observed_at)on conflict(uid,world_id)do update set last_seen_at=greatest(public.sheets_reads.last_seen_at,excluded.last_seen_at);
 end if;
 insert into public.sheets_reads values(p_uid,p_world,stamp)on conflict do nothing;
 select count(*)into n from public.sheets_items i join public.sheets_reads r on r.uid=p_uid and r.world_id=p_world where i.world_id=p_world and i.deleted_at is null and i.created_at>r.last_seen_at;return jsonb_build_object('count',n);end$$;
revoke all on function public.sheets_world(text,text),public.sheets_list(text,text,text,jsonb),public.sheets_mutate(text,text,text,text,text,jsonb,bigint,text),public.sheets_complete(text,text,text,boolean),public.sheets_completion_record(text,text,text,jsonb),public.sheets_badge(text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.sheets_list(text,text,text,jsonb),public.sheets_mutate(text,text,text,text,text,jsonb,bigint,text),public.sheets_complete(text,text,text,boolean),public.sheets_completion_record(text,text,text,jsonb),public.sheets_badge(text,text,text)to service_role;
commit;
