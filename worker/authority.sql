-- Private service-only authority. News RPCs must call authority_current
-- inside the same transaction as their content read or mutation.
create table if not exists public.app_authority (
 uid text primary key check(length(uid) between 1 and 128),
 role text not null check(role in ('owner','admin','user')),
 world_id text check(world_id ~ '^(is|lt|th|ba)_[1-4]$'),
 is_banned boolean not null default false,
 deleted boolean not null default false,
 revision bigint not null check(revision > 0),
 pending boolean not null default true,
 updated_at timestamptz not null default clock_timestamp(),
 check (role='owner' or world_id is not null)
);
create table if not exists public.authority_projection_jobs (
 request_id text primary key,
 actor_uid text not null,
 target_uid text not null references public.app_authority(uid),
 revision bigint not null,
 signature jsonb not null,
 payload jsonb not null,
 applied boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 applied_at timestamptz,
 unique(target_uid,revision)
);
create table if not exists public.authority_audit (
 request_id text primary key,actor_uid text not null,target_uid text not null,
 action text not null,revision bigint not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.authority_audit enable row level security;
revoke all on public.authority_audit from public,anon,authenticated,service_role;
alter table public.app_authority enable row level security;
alter table public.authority_projection_jobs enable row level security;
revoke all on public.app_authority,public.authority_projection_jobs from public,anon,authenticated;
-- Worker reads via RPC only, not arbitrary direct table access.
revoke all on public.app_authority,public.authority_projection_jobs from service_role;
create or replace function public.authority_current(p_uid text)
returns public.app_authority language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;
begin
 select * into a from public.app_authority where uid=p_uid for share;
 if a.uid is null or a.pending or a.deleted or a.is_banned then raise exception 'authority-denied';end if;
 return a;
end $$;
create or replace function public.authority_prepare(p_actor text,p_target text,p_action text,p_value jsonb,p_expected bigint,p_request text,p_owner text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.app_authority;j public.authority_projection_jobs;
 sig jsonb;body jsonb;newrole text;newworld text;newban boolean;newdeleted boolean; profile jsonb;
begin

 if p_actor is null or p_target is null or p_request is null or length(p_request) not between 16 and 128
  or length(p_actor) not between 1 and 128 or length(p_target) not between 1 and 128
  or p_action is null or (p_value is null and p_action<>'delete') or p_owner is null then raise exception 'invalid-input';end if;
 sig:=jsonb_build_object('actor',p_actor,'target',p_target,'action',p_action,'value',p_value,'expected',p_expected);
 select * into j from public.authority_projection_jobs where request_id=p_request;
 if j.request_id is not null then
  if j.signature is distinct from sig then raise exception 'request-conflict';end if;
  -- Returning this private job grants no new mutation. Worker must still bind caller.
  return jsonb_build_object('requestId',j.request_id,'targetUid',j.target_uid,'revision',j.revision,'payload',j.payload,'applied',j.applied);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request,913774));
 select * into j from public.authority_projection_jobs where request_id=p_request;
 if j.request_id is not null then
  if j.signature is distinct from sig then raise exception 'request-conflict';end if;
  -- Returning this private job grants no new mutation. Worker must still bind caller.
  return jsonb_build_object('requestId',j.request_id,'targetUid',j.target_uid,'revision',j.revision,'payload',j.payload,'applied',j.applied);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_target,487196421));
 perform 1 from public.app_authority where uid in (p_actor,p_target) order by uid for update;
 select * into t from public.app_authority where uid=p_target;
 if p_action='provision' then
  if p_actor<>p_target or t.uid is not null or p_expected is not null then raise exception 'provision-conflict';end if;
  if jsonb_typeof(p_value) is distinct from 'object' or (p_value - array['name','email','gender','worldId'])<>'{}'::jsonb
    or jsonb_typeof(p_value->'name') is distinct from 'string' or length(trim(p_value->>'name')) not between 1 and 100
    or jsonb_typeof(p_value->'email') is distinct from 'string' or length(p_value->>'email') not between 1 and 254
    or p_value->>'gender' is null or p_value->>'gender' not in ('male','female') then raise exception 'invalid-profile';end if;
  newworld:=p_value->>'worldId';
  if p_actor<>p_owner and (newworld is null or newworld !~ '^(is|lt|th|ba)_[1-4]$') then raise exception 'invalid-world';end if;
  if p_actor=p_owner then newworld:=null;end if;
  newrole:=case when p_actor=p_owner then 'owner' else 'user' end;
  insert into public.app_authority(uid,role,world_id,revision,pending) values(p_target,newrole,newworld,1,true) returning * into t;
  profile:=jsonb_build_object('uid',p_target,'name',trim(p_value->>'name'),'email',p_value->>'email','gender',p_value->>'gender','publicId','','photo','','bio','','banReason','','agreedToTerms',true);
 else
  a:=public.authority_current(p_actor);
  if t.uid is null or t.deleted or t.pending or t.revision is distinct from p_expected then raise exception 'revision-conflict';end if;
  if p_target=p_owner then raise exception 'protected-target';end if;
  newrole:=t.role;newworld:=t.world_id;newban:=t.is_banned;newdeleted:=t.deleted;
  if p_action='role' then
   if p_actor<>p_owner or jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' not in ('admin','user') then raise exception 'authority-denied';end if;
   newrole:=p_value#>>'{}';
  elsif p_action='world' then
   if p_actor<>p_owner or jsonb_typeof(p_value) is distinct from 'string' or (p_value#>>'{}') !~ '^(is|lt|th|ba)_[1-4]$' then raise exception 'authority-denied';end if;
   newworld:=p_value#>>'{}';
  elsif p_action='ban' then
   if p_actor=p_target or jsonb_typeof(p_value) is distinct from 'boolean' then raise exception 'authority-denied';end if;
   if p_actor<>p_owner and (a.role<>'admin' or t.role<>'user' or a.world_id is null or a.world_id is distinct from t.world_id) then raise exception 'authority-denied';end if;
   newban:=(p_value#>>'{}')::boolean;
  elsif p_action='delete' then
   if p_actor<>p_owner and p_actor<>p_target then raise exception 'authority-denied';end if;
   newdeleted:=true;newban:=true;newrole:='user';
  else raise exception 'unsupported-action';end if;
  update public.app_authority set role=newrole,world_id=newworld,is_banned=newban,deleted=newdeleted,revision=revision+1,pending=true,updated_at=clock_timestamp()
   where uid=p_target returning * into t;
 end if;
 body:=jsonb_build_object('uid',t.uid,'role',t.role,'worldId',t.world_id,'isBanned',t.is_banned,'authorityRevision',t.revision,'authorityDeleted',t.deleted);
 if p_action='provision' then body:=body||jsonb_build_object('profile',profile);end if;
 insert into public.authority_projection_jobs(request_id,actor_uid,target_uid,revision,signature,payload) values(p_request,p_actor,p_target,t.revision,sig,body) returning * into j;
 insert into public.authority_audit(request_id,actor_uid,target_uid,action,revision) values(p_request,p_actor,p_target,p_action,t.revision);
 return jsonb_build_object('requestId',j.request_id,'targetUid',j.target_uid,'revision',j.revision,'payload',j.payload,'applied',false);
end $$;
create or replace function public.authority_ack(p_request text,p_revision bigint,p_observed jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare j public.authority_projection_jobs;t public.app_authority;expected jsonb;
begin

 select * into j from public.authority_projection_jobs where request_id=p_request for update;
 if j.request_id is null or j.revision is distinct from p_revision then raise exception 'ack-conflict';end if;
 select * into t from public.app_authority where uid=j.target_uid for update;
 if t.revision is distinct from p_revision then raise exception 'ack-conflict';end if;
 expected:=j.payload-'profile';
 if expected is distinct from p_observed then raise exception 'projection-mismatch';end if;
 update public.authority_projection_jobs set applied=true,applied_at=coalesce(applied_at,clock_timestamp()) where request_id=p_request;
 update public.app_authority set pending=false where uid=j.target_uid and revision=p_revision;
 return true;
end $$;
revoke all on function public.authority_current(text),public.authority_prepare(text,text,text,jsonb,bigint,text,text),public.authority_ack(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.authority_current(text),public.authority_prepare(text,text,text,jsonb,bigint,text,text),public.authority_ack(text,bigint,jsonb) to service_role;
-- Private inspection for authority management only, not a directory listing.
create or replace function public.authority_target(p_actor text,p_target text,p_owner text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.app_authority;t public.app_authority;
begin

 perform 1 from public.app_authority where uid in (p_actor,p_target) order by uid for share;
 if p_actor is distinct from p_target then a:=public.authority_current(p_actor);end if;
 select * into t from public.app_authority where uid=p_target;
 if t.uid is null then raise exception 'authority-denied';end if;
 if p_actor<>p_target and p_actor<>p_owner and (a.role<>'admin' or t.role<>'user' or a.world_id is null or a.world_id is distinct from t.world_id) then raise exception 'authority-denied';end if;
 return jsonb_build_object('uid',t.uid,'role',t.role,'worldId',t.world_id,'isBanned',t.is_banned,'revision',t.revision,'pending',t.pending,'deleted',t.deleted);
end $$;
revoke all on function public.authority_target(text,text,text) from public,anon,authenticated;
grant execute on function public.authority_target(text,text,text) to service_role;
-- Recover an already-authorized outbox job after a lost browser request id.
-- Completing the exact latest projection creates no new permission decision.
create or replace function public.authority_recover(p_actor text,p_target text,p_owner text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare j public.authority_projection_jobs;t public.app_authority;
begin

 select * into t from public.app_authority where uid=p_target;
 if t.uid is null or not t.pending then raise exception 'no-pending-job';end if;
 select * into j from public.authority_projection_jobs where target_uid=p_target and revision=t.revision;
 if j.request_id is null or (p_actor is distinct from p_owner and p_actor is distinct from j.actor_uid and p_actor is distinct from j.target_uid) then raise exception 'authority-denied';end if;
 return jsonb_build_object('requestId',j.request_id,'targetUid',j.target_uid,'revision',j.revision,'payload',j.payload,'applied',j.applied);
end $$;
revoke all on function public.authority_recover(text,text,text) from public,anon,authenticated;
grant execute on function public.authority_recover(text,text,text) to service_role;
-- Server-only bounded consumer for the latest pending revision per user.
create or replace function public.authority_pending_jobs()
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('requestId',j.request_id,'targetUid',j.target_uid,'revision',j.revision,'payload',j.payload,'applied',j.applied)),'[]'::jsonb)
 from (select jobs.* from public.authority_projection_jobs jobs join public.app_authority a
  on a.uid=jobs.target_uid and a.revision=jobs.revision
  where a.pending and not jobs.applied order by jobs.created_at limit 5) j;
$$;
revoke all on function public.authority_pending_jobs() from public,anon,authenticated;
grant execute on function public.authority_pending_jobs() to service_role;

create table if not exists public.authority_drain_lease(id boolean primary key default true check(id),lease text,until_at timestamptz);
alter table public.authority_drain_lease enable row level security;
revoke all on public.authority_drain_lease from public,anon,authenticated,service_role;
insert into public.authority_drain_lease(id) values(true) on conflict do nothing;
create or replace function public.authority_claim_drain() returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare result text;
begin
 update public.authority_drain_lease set lease=md5(random()::text||clock_timestamp()::text),until_at=clock_timestamp()+interval '90 seconds'
 where id and (until_at is null or until_at<clock_timestamp()) returning lease into result;
 return result;
end $$;
create or replace function public.authority_release_drain(p_lease text) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 update public.authority_drain_lease set lease=null,until_at=null where id and lease=p_lease;
 return found;
end $$;
revoke all on function public.authority_claim_drain(),public.authority_release_drain(text) from public,anon,authenticated;
grant execute on function public.authority_claim_drain(),public.authority_release_drain(text) to service_role;
