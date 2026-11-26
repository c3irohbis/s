-- Attendance daily records (per-student). Students read/write only their own rows; the owner may
-- READ any student's rows (Firestore rules parity: read = owner or self, write = self only).
-- The active world is an authority context (membership or owner), never stored on the row, mirroring
-- Firestore users/{uid}/attendance/{date}. Service-only RPCs; all paths fail closed.
create table if not exists public.attendance_records(
 uid text not null,
 day date not null,
 status text not null check(status in('present','partial','absent')),
 total_subjects int not null check(total_subjects between 1 and 12),
 present_subjects int not null check(present_subjects between 0 and 12),
 absent_subjects int not null check(absent_subjects between 0 and 12),
 subjects jsonb not null check(jsonb_typeof(subjects)='array' and jsonb_array_length(subjects)between 1 and 12),
 completed_at timestamptz not null,
 primary key(uid,day),
 check(present_subjects+absent_subjects=total_subjects),
 check(total_subjects=jsonb_array_length(subjects)),
 check((status='present'and absent_subjects=0 and present_subjects=total_subjects)or(status='absent'and present_subjects=0 and absent_subjects=total_subjects)or(status='partial'and present_subjects>0 and absent_subjects>0)));
alter table public.attendance_records enable row level security;
revoke all on public.attendance_records from public,anon,authenticated,service_role;

drop function if exists public.attendance_records_list(text,text,date,date);
drop function if exists public.attendance_records_stats(text,text);

create or replace function public.attendance_records_list(p_uid text,p_world text,p_target text,p_from date,p_to date default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;rows jsonb;n int;begin
 a:=public.attendance_world(p_uid,p_world);
 if p_target is null or p_target=''or p_from is null or(p_to is not null and(p_to<=p_from or p_to>p_from+62))then raise exception 'invalid-input';end if;
 if p_target is distinct from p_uid and a.role<>'owner'then raise exception 'authority-denied';end if;
 select coalesce(jsonb_agg(jsonb_build_object('day',to_char(x.day,'YYYY-MM-DD'),'status',x.status,'totalSubjects',x.total_subjects,'presentSubjects',x.present_subjects,'absentSubjects',x.absent_subjects,'subjects',x.subjects,'completedAt',to_char(x.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))order by x.day),'[]'),count(*)into rows,n
  from(select day,status,total_subjects,present_subjects,absent_subjects,subjects,completed_at from public.attendance_records where uid=p_target and day>=p_from and(p_to is null or day<p_to)order by day limit 401)x;
 if n>400 then raise exception 'invalid-overflow';end if;
 return rows;end$$;

create or replace function public.attendance_records_stats(p_uid text,p_world text,p_target text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;p int;ab int;t int;begin
 a:=public.attendance_world(p_uid,p_world);
 if p_target is null or p_target=''then raise exception 'invalid-input';end if;
 if p_target is distinct from p_uid and a.role<>'owner'then raise exception 'authority-denied';end if;
 select count(*)filter(where status in('present','partial')),count(*)filter(where status='absent'),count(*)into p,ab,t from public.attendance_records where uid=p_target;
 return jsonb_build_object('present',p,'absent',ab,'total',t);end$$;

create or replace function public.attendance_record_save(p_uid text,p_world text,p_day date,p_record jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;today date;st text;tot int;pre int;abs int;subs jsonb;sub jsonb;stamp timestamptz;begin
 a:=public.attendance_world(p_uid,p_world);
 today:=(now()at time zone'Africa/Cairo')::date;
 if p_day is null or p_day>today or p_day<today-31 then raise exception 'invalid-input';end if;
 if p_record is null or jsonb_typeof(p_record)<>'object'or(p_record-array['status','totalSubjects','presentSubjects','absentSubjects','subjects','completedAt'])<>'{}'::jsonb then raise exception 'invalid-input';end if;
 if jsonb_typeof(p_record->'status')is distinct from 'string'or p_record->>'status'not in('present','partial','absent')then raise exception 'invalid-input';end if;
 if jsonb_typeof(p_record->'totalSubjects')is distinct from 'number'or jsonb_typeof(p_record->'presentSubjects')is distinct from 'number'or jsonb_typeof(p_record->'absentSubjects')is distinct from 'number'or jsonb_typeof(p_record->'completedAt')is distinct from 'string'or jsonb_typeof(p_record->'subjects')is distinct from 'array'or octet_length(p_record::text)>20000 then raise exception 'invalid-input';end if;
 if(p_record->>'totalSubjects')!~'^[0-9]{1,2}$'or(p_record->>'presentSubjects')!~'^[0-9]{1,2}$'or(p_record->>'absentSubjects')!~'^[0-9]{1,2}$'then raise exception 'invalid-input';end if;
 st:=p_record->>'status';tot:=(p_record->>'totalSubjects')::int;pre:=(p_record->>'presentSubjects')::int;abs:=(p_record->>'absentSubjects')::int;subs:=p_record->'subjects';
 if tot<1 or tot>12 or pre<0 or abs<0 or pre+abs<>tot or jsonb_array_length(subs)<>tot then raise exception 'invalid-input';end if;
 if(st='present'and(abs<>0 or pre<>tot))or(st='absent'and(pre<>0 or abs<>tot))or(st='partial'and(pre<1 or abs<1))then raise exception 'invalid-input';end if;
 for sub in select*from jsonb_array_elements(subs)loop
  if jsonb_typeof(sub)is distinct from 'object'or(sub-array['name','status'])<>'{}'::jsonb or jsonb_typeof(sub->'name')is distinct from 'string'or length(trim(sub->>'name'))not between 1 and 200 or jsonb_typeof(sub->'status')is distinct from 'string'or sub->>'status'not in('present','absent')then raise exception 'invalid-input';end if;
 end loop;
 if(select count(*)from jsonb_array_elements(subs)s where s.value->>'status'='present')<>pre then raise exception 'invalid-input';end if;
 if(p_record->>'completedAt')!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.\d{1,3})?Z$'then raise exception 'invalid-input';end if;
 begin stamp:=(p_record->>'completedAt')::timestamptz;exception when others then raise exception 'invalid-input';end;
 insert into public.attendance_records(uid,day,status,total_subjects,present_subjects,absent_subjects,subjects,completed_at)
  values(p_uid,p_day,st,tot,pre,abs,subs,stamp)
  on conflict(uid,day)do update set status=excluded.status,total_subjects=excluded.total_subjects,present_subjects=excluded.present_subjects,absent_subjects=excluded.absent_subjects,subjects=excluded.subjects,completed_at=excluded.completed_at;
 insert into public.attendance_audit(actor_uid,action,target_id)values(p_uid,'record-save',p_day::text);
 return jsonb_build_object('day',to_char(p_day,'YYYY-MM-DD'),'saved',true);end$$;

revoke all on function public.attendance_records_list(text,text,text,date,date),public.attendance_records_stats(text,text,text),public.attendance_record_save(text,text,date,jsonb)from public,anon,authenticated;
grant execute on function public.attendance_records_list(text,text,text,date,date),public.attendance_records_stats(text,text,text),public.attendance_record_save(text,text,date,jsonb)to service_role;
