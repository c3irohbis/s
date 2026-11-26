-- My Documents (subjects + items per world). Admin/owner write, signed-in users read their own world (owner all). Service-only RPCs.
create table if not exists public.mydocs_subjects(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 name text not null check(length(trim(name))between 1 and 500),code text not null check(length(code)<=200),
 status text not null check(status in('active','archived')),items_count bigint not null default 0,active_items_count bigint not null default 0 check(active_items_count>=0),
 created_at timestamptz not null default clock_timestamp(),archived_at timestamptz,created_by text not null,revision bigint not null default 1);
create table if not exists public.mydocs_items(
 id text primary key check(id~'^[A-Za-z0-9_-]{1,128}$'),subject_id text not null references public.mydocs_subjects(id),world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),
 ordinal bigint not null check(ordinal>0),type text not null check(type in('image','pdf','voice','link','text')),
 url text check(url is null or(length(url)<=4096 and url~'^https?://')),text text check(text is null or length(text)<=10000),file_name text check(file_name is null or length(file_name)<=500),duration numeric check(duration is null or(duration>=0 and duration<=36000)),
 created_at timestamptz not null default clock_timestamp(),created_by text not null,revision bigint not null default 1,deleted_at timestamptz);
create index if not exists mydocs_subjects_world on public.mydocs_subjects(world_id,created_at,id);
create unique index if not exists mydocs_items_ordinal on public.mydocs_items(subject_id,ordinal);
create index if not exists mydocs_items_page on public.mydocs_items(subject_id,ordinal)where deleted_at is null;
create table if not exists public.mydocs_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.mydocs_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,target_id text not null,revision bigint,at timestamptz not null default clock_timestamp());
alter table public.mydocs_subjects enable row level security;alter table public.mydocs_items enable row level security;alter table public.mydocs_requests enable row level security;alter table public.mydocs_audit enable row level security;
revoke all on public.mydocs_subjects,public.mydocs_items,public.mydocs_requests,public.mydocs_audit from public,anon,authenticated,service_role;

create or replace function public.mydocs_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;

create or replace function public.mydocs_list(p_uid text,p_world text,p_subject text default null,p_filter text default 'all',p_after bigint default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;rows jsonb;n int;s public.mydocs_subjects;desc_order boolean;kind text;begin
 a:=public.mydocs_world(p_uid,p_world);
 if p_subject is null then
  select count(*)into n from public.mydocs_subjects where world_id=p_world;
  if n>500 then raise exception 'invalid-overflow';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at,x.id),'[]')into rows from public.mydocs_subjects x where world_id=p_world;
  return jsonb_build_object('subjects',rows);
 end if;
 if p_subject!~'^[A-Za-z0-9_-]{1,128}$'or p_filter is null or p_filter not in('all','image','pdf','voice','link','newest','oldest')then raise exception 'invalid-input';end if;
 select *into s from public.mydocs_subjects where id=p_subject and world_id=p_world;if s.id is null then raise exception 'authority-denied';end if;
 desc_order:=p_filter='newest';kind:=case when p_filter in('image','pdf','voice','link')then p_filter else null end;
 select coalesce(jsonb_agg(to_jsonb(x)order by case when desc_order then -x.ordinal else x.ordinal end),'[]')into rows from(
  select i.* from public.mydocs_items i where i.subject_id=p_subject and i.world_id=p_world and i.deleted_at is null and(kind is null or i.type=kind)
   and(p_after is null or(case when desc_order then i.ordinal<p_after else i.ordinal>p_after end))
  order by case when desc_order then -i.ordinal else i.ordinal end limit 30)x;
 return jsonb_build_object('items',rows,'subject',to_jsonb(s),'pageSize',30);
end$$;

create or replace function public.mydocs_mutate(p_uid text,p_world text,p_kind text,p_action text,p_id text,p_data jsonb,p_expected bigint,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;s public.mydocs_subjects;i public.mydocs_items;j public.mydocs_requests;sig jsonb;result jsonb;stamp timestamptz;ty text;
begin
 a:=public.mydocs_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,821));
 if a.role not in('admin','owner')then raise exception 'authority-denied';end if;
 if p_kind is null or p_kind not in('subject','item')or p_action is null or p_action not in('create','update','delete','archive','reopen')or p_id is null or p_id!~'^[A-Za-z0-9_-]{1,128}$'or p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_data is null or jsonb_typeof(p_data)<>'object'or octet_length(p_data::text)>20000 then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'kind',p_kind,'action',p_action,'id',p_id,'data',p_data,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||p_request,822));
 select *into j from public.mydocs_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 stamp:=clock_timestamp();
 if p_kind='subject'then
  select *into s from public.mydocs_subjects where id=p_id for update;
  if s.id is not null and s.world_id<>p_world then raise exception 'authority-denied';end if;
  if p_action='create'then if s.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
  elsif p_action in('update','archive','reopen')then if s.id is null or p_expected is distinct from s.revision then raise exception 'revision-conflict';end if;
  else raise exception 'invalid-input';end if;
  if p_action in('create','update')then
   if(p_data-array['name','code'])<>'{}'or jsonb_typeof(p_data->'name')is distinct from 'string'or jsonb_typeof(p_data->'code')is distinct from 'string'or length(trim(p_data->>'name'))not between 1 and 500 or length(p_data->>'code')>200 then raise exception 'invalid-input';end if;
   if p_action='create'then if(select count(*)from public.mydocs_subjects where world_id=p_world)>=500 then raise exception 'invalid-overflow';end if;insert into public.mydocs_subjects(id,world_id,name,code,status,created_by,created_at)values(p_id,p_world,p_data->>'name',p_data->>'code','active',p_uid,stamp)returning *into s;
   else update public.mydocs_subjects set name=p_data->>'name',code=p_data->>'code',revision=revision+1 where id=p_id returning *into s;end if;
  else
   if p_data<>'{}'then raise exception 'invalid-input';end if;
   update public.mydocs_subjects set status=case when p_action='archive'then'archived'else'active'end,archived_at=case when p_action='archive'then stamp else null end,revision=revision+1 where id=p_id returning *into s;
  end if;
  result:=jsonb_build_object('id',s.id,'revision',s.revision);
 else
  select *into i from public.mydocs_items where id=p_id for update;
  if i.id is not null and i.world_id<>p_world then raise exception 'authority-denied';end if;
  if p_action='create'then
   if i.id is not null or p_expected is not null then raise exception 'revision-conflict';end if;
   if jsonb_typeof(p_data->'subjectId')is distinct from 'string'then raise exception 'invalid-input';end if;
   select *into s from public.mydocs_subjects where id=p_data->>'subjectId'and world_id=p_world for update;
   if s.id is null then raise exception 'authority-denied';end if;if s.status<>'active'then raise exception 'revision-conflict';end if;
  elsif p_action in('update','delete')then
   if i.id is null or i.deleted_at is not null or p_expected is distinct from i.revision then raise exception 'revision-conflict';end if;
   select *into s from public.mydocs_subjects where id=i.subject_id and world_id=p_world for update;if s.id is null then raise exception 'authority-denied';end if;
  else raise exception 'invalid-input';end if;
  if p_action='create'then
   if(p_data-array['subjectId','type','url','text','fileName','duration'])<>'{}'then raise exception 'invalid-input';end if;
   ty:=p_data->>'type';if jsonb_typeof(p_data->'type')is distinct from 'string'or ty not in('image','pdf','voice','link','text')then raise exception 'invalid-input';end if;
   if coalesce(jsonb_typeof(p_data->'url'),'null')not in('string','null')or coalesce(jsonb_typeof(p_data->'text'),'null')not in('string','null')or coalesce(jsonb_typeof(p_data->'fileName'),'null')not in('string','null')or coalesce(jsonb_typeof(p_data->'duration'),'null')not in('number','null')then raise exception 'invalid-input';end if;
   if ty in('image','pdf','voice','link')and(p_data->>'url'is null or length(trim(p_data->>'url'))=0)then raise exception 'invalid-input';end if;
   if ty='text'and(p_data->>'text'is null or length(trim(p_data->>'text'))=0)then raise exception 'invalid-input';end if;
   if p_data->>'url'is not null and(length(p_data->>'url')>4096 or(p_data->>'url')!~'^https?://')then raise exception 'invalid-input';end if;
   if length(coalesce(p_data->>'text',''))>10000 or length(coalesce(p_data->>'fileName',''))>500 then raise exception 'invalid-input';end if;
   if p_data->>'duration'is not null and((p_data->>'duration')::numeric<0 or(p_data->>'duration')::numeric>36000)then raise exception 'invalid-input';end if;
   insert into public.mydocs_items(id,subject_id,world_id,ordinal,type,url,text,file_name,duration,created_at,created_by)values(p_id,s.id,p_world,s.items_count+1,ty,p_data->>'url',p_data->>'text',p_data->>'fileName',(p_data->>'duration')::numeric,stamp,p_uid)returning *into i;
   update public.mydocs_subjects set items_count=items_count+1,active_items_count=active_items_count+1,revision=revision+1 where id=s.id;
  elsif p_action='update'then
   if(p_data-array['text','url','fileName'])<>'{}'or coalesce(jsonb_typeof(p_data->'url'),'null')not in('string','null')or coalesce(jsonb_typeof(p_data->'text'),'null')not in('string','null')or coalesce(jsonb_typeof(p_data->'fileName'),'null')not in('string','null')then raise exception 'invalid-input';end if;
   if(p_data->>'url'is not null and(length(p_data->>'url')>4096 or(p_data->>'url')!~'^https?://'))or length(coalesce(p_data->>'text',''))>10000 or length(coalesce(p_data->>'fileName',''))>500 then raise exception 'invalid-input';end if;
   update public.mydocs_items set text=case when p_data?'text'then p_data->>'text'else text end,url=case when p_data?'url'then p_data->>'url'else url end,file_name=case when p_data?'fileName'then p_data->>'fileName'else file_name end,revision=revision+1 where id=p_id returning *into i;
  else
   if p_data<>'{}'then raise exception 'invalid-input';end if;
   update public.mydocs_items set deleted_at=stamp,revision=revision+1 where id=p_id returning *into i;
   update public.mydocs_subjects set active_items_count=active_items_count-1,revision=revision+1 where id=s.id;
  end if;
  result:=jsonb_build_object('id',i.id,'revision',i.revision,'order',i.ordinal);
 end if;
 insert into public.mydocs_requests values(p_uid,p_request,sig,result);insert into public.mydocs_audit(actor_uid,action,target_id,revision)values(p_uid,p_kind||':'||p_action,p_id,(result->>'revision')::bigint);
 return result;
end$$;
revoke all on function public.mydocs_world(text,text),public.mydocs_list(text,text,text,text,bigint),public.mydocs_mutate(text,text,text,text,text,jsonb,bigint,text)from public,anon,authenticated;
grant execute on function public.mydocs_list(text,text,text,text,bigint),public.mydocs_mutate(text,text,text,text,text,jsonb,bigint,text)to service_role;
