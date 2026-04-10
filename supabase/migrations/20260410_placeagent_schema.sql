create extension if not exists "pgcrypto";

create table if not exists public.users (
  id text primary key,
  email text unique,
  role text not null check (role in ('student', 'tpc', 'hr')),
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.student_profiles (
  id text primary key,
  user_id text references public.users(id) on delete cascade,
  name text not null,
  degree text not null,
  branch text not null,
  graduation_year integer not null,
  placement_target text,
  target_roles jsonb not null default '[]'::jsonb,
  preferred_companies jsonb not null default '[]'::jsonb,
  parsed_skills jsonb not null default '[]'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  improvement_priorities jsonb not null default '[]'::jsonb,
  summary text not null default '',
  recent_resume_name text,
  parsed_resume_excerpt text,
  resume_score integer not null default 0,
  interview_score integer not null default 0,
  confidence_score integer not null default 0,
  readiness_score integer not null default 0,
  alerts_count integer not null default 0,
  last_login_at timestamptz,
  last_task_completion_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.skill_gaps (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references public.student_profiles(id) on delete cascade,
  skill text not null,
  domain text not null default 'general',
  gap_level text not null check (gap_level in ('none', 'low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create table if not exists public.preparation_plans (
  id text primary key,
  student_id text not null references public.student_profiles(id) on delete cascade,
  domain text,
  plan_title text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  plan_payload jsonb not null default '[]'::jsonb,
  matches_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  plan_id text references public.preparation_plans(id) on delete cascade,
  student_id text not null references public.student_profiles(id) on delete cascade,
  week integer not null default 1,
  title text not null,
  description text,
  resource_url text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'done', 'missed')),
  domain text,
  created_at timestamptz not null default now()
);

create table if not exists public.mock_interviews (
  id text primary key,
  student_id text not null references public.student_profiles(id) on delete cascade,
  mode text not null default 'text' check (mode in ('text', 'voice')),
  interview_type text not null default 'general',
  tone text not null default 'supportive' check (tone in ('supportive', 'challenging')),
  current_question text,
  turns_json jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed')),
  report_summary text,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id text primary key,
  student_id text not null references public.student_profiles(id) on delete cascade,
  student_name text not null,
  type text not null check (type in ('missed_deadline', 'score_drop', 'inactive', 'support_needed')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  title text not null,
  detail text not null,
  resolved boolean not null default false,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id text primary key,
  student_id text not null references public.student_profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_descriptions (
  id text primary key,
  company_id text,
  company_name text not null,
  role_title text not null,
  requirements text not null,
  extracted_skills jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.resume_embeddings (
  student_id text primary key references public.student_profiles(id) on delete cascade,
  embedding jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  channel text not null check (channel in ('email', 'sms')),
  subject text,
  body text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_skill_gaps_profile_id on public.skill_gaps(profile_id);
create index if not exists idx_tasks_student_id on public.tasks(student_id);
create index if not exists idx_tasks_plan_id on public.tasks(plan_id);
create index if not exists idx_tasks_status_due_date on public.tasks(status, due_date);
create index if not exists idx_mock_interviews_student_id on public.mock_interviews(student_id);
create index if not exists idx_alerts_student_id on public.alerts(student_id);
create index if not exists idx_alerts_resolved on public.alerts(resolved);
create index if not exists idx_chat_messages_student_id on public.chat_messages(student_id);

create or replace view public.cohort_student_metrics as
select
  sp.id as student_id,
  sp.name,
  sp.branch,
  sp.graduation_year,
  sp.readiness_score,
  sp.interview_score,
  sp.resume_score,
  sp.confidence_score,
  coalesce((
    select round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0))
    from public.tasks t
    where t.student_id = sp.id
  ), 0) as task_completion_rate,
  coalesce((
    select round(avg(mi.score))
    from public.mock_interviews mi
    where mi.student_id = sp.id
  ), 0) as avg_mock_score,
  (
    sp.readiness_score * 0.4 +
    coalesce((select avg(mi.score) from public.mock_interviews mi where mi.student_id = sp.id), 0) * 0.4 +
    coalesce((
      select 100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0)
      from public.tasks t
      where t.student_id = sp.id
    ), 0) * 0.2
  )::integer as placement_prediction_score
from public.student_profiles sp;

create or replace view public.branch_analytics as
select
  branch,
  count(*) as student_count,
  round(avg(readiness_score))::integer as avg_readiness,
  round(avg(interview_score))::integer as avg_interview_score,
  round(avg(confidence_score))::integer as avg_confidence_score
from public.student_profiles
group by branch;
