create table if not exists public.instruction_reads(uid text primary key,last_seen_at timestamptz not null default now());
alter table public.instruction_reads enable row level security;
revoke all on public.instruction_reads from anon,authenticated;
grant select,insert,update on public.instruction_reads to service_role;
create or replace function public.instruction_badge(p_uid text,p_mark boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare seen timestamptz; n integer;
begin
 if p_uid is null or length(p_uid)=0 or length(p_uid)>128 then raise exception 'invalid-uid';end if;
 perform pg_advisory_xact_lock(hashtext('instructions-authoritative-v1'));
 insert into public.instruction_reads(uid,last_seen_at) values(p_uid,clock_timestamp()) on conflict(uid) do nothing;
 if p_mark then update public.instruction_reads set last_seen_at=greatest(last_seen_at,clock_timestamp()) where uid=p_uid;end if;
 select last_seen_at into seen from public.instruction_reads where uid=p_uid;
 select count(*) into n from public.instructions where deleted_at is null and updated_at>seen;
 return jsonb_build_object('count',n,'lastSeenAt',seen);
end $$;
revoke all on function public.instruction_badge(text,boolean) from public,anon,authenticated;
grant execute on function public.instruction_badge(text,boolean) to service_role;
