-- bis-call-history: جدول سجل المكالمات (جدول جديد فقط — لا مساس بأي جدول قائم)
-- يُنفَّذ مرة واحدة في محرر SQL بلوحة Supabase.
create table if not exists public.call_records (
  id           uuid primary key,
  chat_id      text not null,
  kind         text not null default 'dm' check (kind = 'dm'),
  call_type    text not null check (call_type in ('audio','video')),
  caller_uid   text not null,
  caller_name  text not null default '',
  callee_uid   text not null,
  callee_name  text not null default '',
  status       text not null default 'ringing'
               check (status in ('ringing','accepted','declined','busy','canceled','no_answer','ended','failed')),
  started_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz,
  duration_sec integer,
  updated_at   timestamptz not null default now()
);
create index if not exists call_records_caller_idx  on public.call_records (caller_uid, started_at desc);
create index if not exists call_records_callee_idx  on public.call_records (callee_uid, started_at desc);
create index if not exists call_records_chat_idx    on public.call_records (chat_id, started_at desc);
create index if not exists call_records_updated_idx on public.call_records (updated_at);

-- RLS مفعَّل بصفر سياسات: رفض كامل للوصول المباشر (anon/auth)؛ الوصول الوحيد عبر service_role في العامل
alter table public.call_records enable row level security;
revoke all on public.call_records from anon, authenticated;

-- Server worker role: only the operations used by this table.
grant select, insert, update on public.call_records to service_role;
