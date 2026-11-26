create table if not exists public.attendance_settings(world_id text primary key check(world_id~'^(is|lt|th|ba)_[1-4]$'),enabled boolean,use_study_schedule boolean,updated_at timestamptz not null default clock_timestamp());
create table if not exists public.attendance_schedules(world_id text not null check(world_id~'^(is|lt|th|ba)_[1-4]$'),day text not null check(day in('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),enabled boolean,start_time text check(start_time is null or start_time~'^([01][0-9]|2[0-3]):[0-5][0-9]$'),end_time text check(end_time is null or end_time~'^([01][0-9]|2[0-3]):[0-5][0-9]$'),subjects jsonb check(subjects is null or(jsonb_typeof(subjects)='array' and jsonb_array_length(subjects)<=12)),updated_at timestamptz not null default clock_timestamp(),primary key(world_id,day));
create table if not exists public.attendance_requests(uid text not null,request_id text not null,signature jsonb not null,result jsonb not null,primary key(uid,request_id));
create table if not exists public.attendance_audit(id bigint generated always as identity primary key,actor_uid text not null,action text not null,target_id text not null,at timestamptz not null default clock_timestamp());
alter table public.attendance_settings enable row level security;alter table public.attendance_schedules enable row level security;alter table public.attendance_requests enable row level security;alter table public.attendance_audit enable row level security;
revoke all on public.attendance_settings,public.attendance_schedules,public.attendance_requests,public.attendance_audit from public,anon,authenticated,service_role;

create or replace function public.attendance_world(p_uid text,p_world text)returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;begin
 a:=public.authority_current(p_uid);
 if p_world is null or p_world!~'^(is|lt|th|ba)_[1-4]$'then raise exception 'invalid-world';end if;
 if a.role<>'owner'and a.world_id is distinct from p_world then raise exception 'authority-denied';end if;
 return a;end$$;

create or replace function public.attendance_config(p_uid text,p_world text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;st jsonb;sc jsonb;begin
 a:=public.attendance_world(p_uid,p_world);
 select jsonb_build_object('enabled',enabled,'useStudySchedule',use_study_schedule)into st from public.attendance_settings where world_id=p_world;
 select coalesce(jsonb_object_agg(day,jsonb_strip_nulls(jsonb_build_object('enabled',enabled,'startTime',start_time,'endTime',end_time,'subjects',subjects))),'{}')into sc from public.attendance_schedules where world_id=p_world;
 return jsonb_build_object('settings',st,'schedules',sc);
end$$;

create or replace function public.attendance_mutate(p_uid text,p_world text,p_action text,p_data jsonb,p_request text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;j public.attendance_requests;sig jsonb;result jsonb;k text;v jsonb;sub jsonb;n int;d text;
begin
 a:=public.attendance_world(p_uid,p_world);perform pg_advisory_xact_lock(hashtextextended(p_world,831));
 if a.role not in('admin','owner')then raise exception 'authority-denied';end if;
 if p_action is null or p_action not in('settings','schedules','delete')or p_request is null or p_request!~'^[A-Za-z0-9_-]{16,128}$'or p_data is null or jsonb_typeof(p_data)<>'object'or octet_length(p_data::text)>40000 then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('world',p_world,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_uid||':'||p_request,832));
 select *into j from public.attendance_requests where uid=p_uid and request_id=p_request;
 if j.uid is not null then if j.signature is distinct from sig then raise exception 'request-conflict';end if;return j.result;end if;
 if p_action='settings'then
  if(p_data-array['enabled','useStudySchedule'])<>'{}'or p_data='{}'::jsonb or(p_data?'enabled'and jsonb_typeof(p_data->'enabled')is distinct from 'boolean')or(p_data?'useStudySchedule'and jsonb_typeof(p_data->'useStudySchedule')is distinct from 'boolean')then raise exception 'invalid-input';end if;
  insert into public.attendance_settings(world_id,enabled,use_study_schedule)values(p_world,(p_data->>'enabled')::boolean,(p_data->>'useStudySchedule')::boolean)
   on conflict(world_id)do update set enabled=case when p_data?'enabled'then(p_data->>'enabled')::boolean else attendance_settings.enabled end,use_study_schedule=case when p_data?'useStudySchedule'then(p_data->>'useStudySchedule')::boolean else attendance_settings.use_study_schedule end,updated_at=clock_timestamp();
 elsif p_action='schedules'then
  if(p_data-array['days'])<>'{}'or jsonb_typeof(p_data->'days')is distinct from 'object'or(select count(*)from jsonb_object_keys(p_data->'days'))not between 1 and 7 then raise exception 'invalid-input';end if;
  for k,v in select*from jsonb_each(p_data->'days')loop
   if k not in('sunday','monday','tuesday','wednesday','thursday','friday','saturday')or jsonb_typeof(v)is distinct from 'object'or v='{}'::jsonb or(v-array['enabled','startTime','endTime','subjects'])<>'{}'
    or(v?'enabled'and jsonb_typeof(v->'enabled')is distinct from 'boolean')or(v?'startTime'and(jsonb_typeof(v->'startTime')is distinct from 'string'or(v->>'startTime')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'))or(v?'endTime'and(jsonb_typeof(v->'endTime')is distinct from 'string'or(v->>'endTime')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'))
    or(v?'subjects'and jsonb_typeof(v->'subjects')is distinct from 'array')then raise exception 'invalid-input';end if;
   if v?'subjects'then
    if jsonb_array_length(v->'subjects')>12 then raise exception 'invalid-input';end if;
    for sub in select*from jsonb_array_elements(v->'subjects')loop
     if jsonb_typeof(sub)is distinct from 'object'or(sub-array['id','name','order'])<>'{}'or jsonb_typeof(sub->'id')is distinct from 'string'or jsonb_typeof(sub->'name')is distinct from 'string'or jsonb_typeof(sub->'order')is distinct from 'number'
      or length(sub->>'id')not between 1 and 64 or length(trim(sub->>'name'))not between 1 and 200 or(sub->>'order')!~'^[0-9]{1,3}$'then raise exception 'invalid-input';end if;
    end loop;
   end if;
   insert into public.attendance_schedules(world_id,day,enabled,start_time,end_time,subjects)values(p_world,k,(v->>'enabled')::boolean,v->>'startTime',v->>'endTime',v->'subjects')
    on conflict(world_id,day)do update set enabled=case when v?'enabled'then(v->>'enabled')::boolean else attendance_schedules.enabled end,start_time=case when v?'startTime'then v->>'startTime' else attendance_schedules.start_time end,end_time=case when v?'endTime'then v->>'endTime' else attendance_schedules.end_time end,subjects=case when v?'subjects'then v->'subjects' else attendance_schedules.subjects end,updated_at=clock_timestamp();
  end loop;
 else
  if a.role<>'owner'then raise exception 'authority-denied';end if;
  if(p_data-array['days'])<>'{}'or jsonb_typeof(p_data->'days')is distinct from 'array'or jsonb_array_length(p_data->'days')not between 1 and 7 then raise exception 'invalid-input';end if;
  for d in select*from jsonb_array_elements_text(p_data->'days')loop
   if d not in('sunday','monday','tuesday','wednesday','thursday','friday','saturday')then raise exception 'invalid-input';end if;
   delete from public.attendance_schedules where world_id=p_world and day=d;
  end loop;
 end if;
 result:=public.attendance_config(p_uid,p_world);
 insert into public.attendance_audit(actor_uid,action,target_id)values(p_uid,p_action,p_world);
 insert into public.attendance_requests(uid,request_id,signature,result)values(p_uid,p_request,sig,result);
 return result;
end$$;
revoke all on function public.attendance_world(text,text),public.attendance_config(text,text),public.attendance_mutate(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.attendance_config(text,text),public.attendance_mutate(text,text,text,jsonb,text) to service_role;
