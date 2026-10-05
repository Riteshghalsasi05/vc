-- Virtual Classroom database. Safe to run again after the first installation.
-- Passwords are managed only by Supabase Auth. User-created files are private.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'teacher', 'student')),
  class_name text,
  school_name text,
  account_status text not null default 'active' check (account_status in ('pending', 'active', 'suspended')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists class_name text;
alter table public.profiles add column if not exists school_name text;
alter table public.profiles add column if not exists account_status text not null default 'active';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_status_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_account_status_check check (account_status in ('pending', 'active', 'suspended'));
  end if;
end $$;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  description text not null default '',
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_id, code)
);
create table if not exists public.subject_memberships (
  subject_id uuid not null references public.subjects(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (subject_id, student_id)
);
create table if not exists public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  resource_type text not null check (resource_type in ('video', 'note')),
  title text not null,
  description text not null default '',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.video_watch_events (
  resource_id uuid not null references public.learning_resources(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  watched_at timestamptz not null default now(),
  primary key (resource_id, student_id)
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null,
  description text not null default '',
  due_at timestamptz,
  attachment_path text,
  created_at timestamptz not null default now()
);
create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  response_text text not null default '',
  storage_path text,
  submitted_at timestamptz not null default now(),
  grade numeric(5,2) check (grade between 0 and 100),
  feedback text not null default '',
  unique (assignment_id, student_id)
);
create table if not exists public.mock_tests (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null,
  description text not null default '',
  duration_minutes integer not null default 30 check (duration_minutes between 1 and 300),
  created_at timestamptz not null default now()
);
create table if not exists public.mock_test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.mock_tests(id) on delete cascade,
  position integer not null,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  unique (test_id, position)
);
create table if not exists public.mock_test_answer_keys (
  question_id uuid primary key references public.mock_test_questions(id) on delete cascade,
  correct_option integer not null check (correct_option between 0 and 5)
);
create table if not exists public.mock_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.mock_tests(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null,
  score integer not null check (score >= 0),
  total_questions integer not null check (total_questions > 0),
  submitted_at timestamptz not null default now(),
  unique (test_id, student_id)
);

create index if not exists subjects_teacher_idx on public.subjects(teacher_id);
create index if not exists memberships_student_idx on public.subject_memberships(student_id);
create index if not exists resources_subject_type_idx on public.learning_resources(subject_id, resource_type, created_at desc);
create index if not exists video_watch_student_idx on public.video_watch_events(student_id, watched_at desc);
create index if not exists assignments_subject_due_idx on public.assignments(subject_id, due_at);
create index if not exists tests_subject_idx on public.mock_tests(subject_id, created_at desc);
create index if not exists attempts_student_idx on public.mock_test_attempts(student_id, submitted_at desc);

-- These SECURITY DEFINER helpers avoid recursive profile/subject policies.
create or replace function public.classroom_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;
create or replace function public.classroom_teaches(p_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subjects s where s.id = p_subject_id and s.teacher_id = (select auth.uid()));
$$;
create or replace function public.classroom_enrolled(p_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subject_memberships m where m.subject_id = p_subject_id and m.student_id = (select auth.uid()));
$$;
create or replace function public.classroom_can_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.classroom_is_admin() or exists (
    select 1 from public.subject_memberships m join public.subjects s on s.id = m.subject_id
    where m.student_id = p_profile_id and s.teacher_id = (select auth.uid())
  );
$$;
revoke all on function public.classroom_is_admin() from public, anon;
revoke all on function public.classroom_teaches(uuid) from public, anon;
revoke all on function public.classroom_enrolled(uuid) from public, anon;
revoke all on function public.classroom_can_view_profile(uuid) from public, anon;
grant execute on function public.classroom_is_admin() to authenticated;
grant execute on function public.classroom_teaches(uuid) to authenticated;
grant execute on function public.classroom_enrolled(uuid) to authenticated;
grant execute on function public.classroom_can_view_profile(uuid) to authenticated;

drop policy if exists "members read own profile" on public.profiles;
drop policy if exists "admins read classroom profiles" on public.profiles;
drop policy if exists "classroom users read allowed profiles" on public.profiles;
create policy "classroom users read allowed profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.classroom_can_view_profile(id));

drop function if exists public.update_my_profile(text, text);
create or replace function public.update_my_profile(p_full_name text, p_class_name text default null, p_school_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if length(trim(coalesce(p_full_name, ''))) not between 1 and 120 then raise exception 'Enter a name up to 120 characters'; end if;
  update public.profiles set full_name = trim(p_full_name),
    class_name = case when role = 'student' then nullif(trim(coalesce(p_class_name, '')), '') else class_name end,
    school_name = case when role = 'teacher' then nullif(trim(coalesce(p_school_name, '')), '') else school_name end
    where id = (select auth.uid());
end;
$$;
revoke all on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

create or replace function public.sync_classroom_invite_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set account_status = 'active' where id = new.id and account_status = 'pending';
  end if;
  return new;
end;
$$;
drop trigger if exists sync_classroom_invite_status on auth.users;
create trigger sync_classroom_invite_status after update of email_confirmed_at on auth.users
  for each row execute function public.sync_classroom_invite_status();

alter table public.subjects enable row level security;
alter table public.subject_memberships enable row level security;
alter table public.learning_resources enable row level security;
alter table public.video_watch_events enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.mock_tests enable row level security;
alter table public.mock_test_questions enable row level security;
alter table public.mock_test_answer_keys enable row level security;
alter table public.mock_test_attempts enable row level security;
revoke all on public.subjects, public.subject_memberships, public.learning_resources, public.assignments,
  public.assignment_submissions, public.mock_tests, public.mock_test_questions,
  public.mock_test_answer_keys, public.mock_test_attempts, public.video_watch_events from anon;
grant select, insert, update, delete on public.subjects, public.subject_memberships,
  public.learning_resources, public.assignments, public.assignment_submissions,
  public.mock_tests, public.mock_test_questions, public.mock_test_answer_keys,
  public.mock_test_attempts, public.video_watch_events to authenticated;

drop policy if exists "subject visibility" on public.subjects;
create policy "subject visibility" on public.subjects for select to authenticated
  using (teacher_id = (select auth.uid()) or public.classroom_is_admin() or public.classroom_enrolled(id));
drop policy if exists "teachers create subjects" on public.subjects;
create policy "teachers create subjects" on public.subjects for insert to authenticated
  with check (teacher_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'teacher'));
drop policy if exists "teachers update subjects" on public.subjects;
create policy "teachers update subjects" on public.subjects for update to authenticated
  using (teacher_id = (select auth.uid()) or public.classroom_is_admin())
  with check (teacher_id = (select auth.uid()) or public.classroom_is_admin());
drop policy if exists "teachers delete subjects" on public.subjects;
create policy "teachers delete subjects" on public.subjects for delete to authenticated
  using (teacher_id = (select auth.uid()) or public.classroom_is_admin());

drop policy if exists "membership visibility" on public.subject_memberships;
create policy "membership visibility" on public.subject_memberships for select to authenticated
  using (student_id = (select auth.uid()) or public.classroom_teaches(subject_id) or public.classroom_is_admin());
drop policy if exists "teachers manage memberships" on public.subject_memberships;
create policy "teachers manage memberships" on public.subject_memberships for all to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin())
  with check (public.classroom_teaches(subject_id) or public.classroom_is_admin());

create or replace function public.guard_classroom_student_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.student_id and p.role = 'student') then
    raise exception 'Only student accounts can be enrolled in a subject';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_classroom_student_membership() from public, anon, authenticated;
drop trigger if exists guard_classroom_student_membership on public.subject_memberships;
create trigger guard_classroom_student_membership before insert or update on public.subject_memberships
  for each row execute function public.guard_classroom_student_membership();

create or replace function public.enroll_student_by_email(p_subject_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_student_id uuid;
begin
  if not public.classroom_is_admin() and not public.classroom_teaches(p_subject_id) then raise exception 'Teacher access required'; end if;
  select id into v_student_id from public.profiles where lower(email) = lower(trim(p_email)) and role = 'student';
  if v_student_id is null then raise exception 'No student account was found for that email'; end if;
  insert into public.subject_memberships(subject_id, student_id) values (p_subject_id, v_student_id) on conflict do nothing;
end;
$$;
revoke all on function public.enroll_student_by_email(uuid, text) from public, anon;
grant execute on function public.enroll_student_by_email(uuid, text) to authenticated;

drop policy if exists "resources visible to class" on public.learning_resources;
create policy "resources visible to class" on public.learning_resources for select to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin() or public.classroom_enrolled(subject_id));
drop policy if exists "teachers manage resources" on public.learning_resources;
create policy "teachers manage resources" on public.learning_resources for all to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin())
  with check ((public.classroom_teaches(subject_id) or public.classroom_is_admin()) and created_by = (select auth.uid()));

drop policy if exists "video watch history visible to student and teacher" on public.video_watch_events;
create policy "video watch history visible to student and teacher" on public.video_watch_events for select to authenticated
  using (student_id = (select auth.uid()) or public.classroom_is_admin() or exists (
    select 1 from public.learning_resources r where r.id = resource_id and public.classroom_teaches(r.subject_id)
  ));
drop policy if exists "students record own video completion" on public.video_watch_events;
create policy "students record own video completion" on public.video_watch_events for insert to authenticated
  with check (student_id = (select auth.uid()) and exists (
    select 1 from public.learning_resources r where r.id = resource_id and r.resource_type = 'video' and public.classroom_enrolled(r.subject_id)
  ));
drop policy if exists "students maintain own video completion" on public.video_watch_events;
create policy "students maintain own video completion" on public.video_watch_events for update to authenticated
  using (student_id = (select auth.uid()) and exists (
    select 1 from public.learning_resources r where r.id = resource_id and r.resource_type = 'video' and public.classroom_enrolled(r.subject_id)
  ))
  with check (student_id = (select auth.uid()) and exists (
    select 1 from public.learning_resources r where r.id = resource_id and r.resource_type = 'video' and public.classroom_enrolled(r.subject_id)
  ));

drop policy if exists "assignments visible to class" on public.assignments;
create policy "assignments visible to class" on public.assignments for select to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin() or public.classroom_enrolled(subject_id));
drop policy if exists "teachers manage assignments" on public.assignments;
create policy "teachers manage assignments" on public.assignments for all to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin())
  with check ((public.classroom_teaches(subject_id) or public.classroom_is_admin()) and created_by = (select auth.uid()));

drop policy if exists "submissions visible to owner or teacher" on public.assignment_submissions;
create policy "submissions visible to owner or teacher" on public.assignment_submissions for select to authenticated
  using (student_id = (select auth.uid()) or exists (select 1 from public.assignments a where a.id = assignment_id and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin())));
drop policy if exists "students submit own work" on public.assignment_submissions;
create policy "students submit own work" on public.assignment_submissions for insert to authenticated
  with check (student_id = (select auth.uid()) and exists (select 1 from public.assignments a where a.id = assignment_id and public.classroom_enrolled(a.subject_id)));
drop policy if exists "students update own ungraded work" on public.assignment_submissions;
create policy "students update own ungraded work" on public.assignment_submissions for update to authenticated
  using (student_id = (select auth.uid()) and grade is null)
  with check (student_id = (select auth.uid()) and grade is null and exists (select 1 from public.assignments a where a.id = assignment_id and public.classroom_enrolled(a.subject_id)));
drop policy if exists "teachers grade work" on public.assignment_submissions;
create policy "teachers grade work" on public.assignment_submissions for update to authenticated
  using (exists (select 1 from public.assignments a where a.id = assignment_id and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin())))
  with check (exists (select 1 from public.assignments a where a.id = assignment_id and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin())));

drop policy if exists "tests visible to class" on public.mock_tests;
create policy "tests visible to class" on public.mock_tests for select to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin() or public.classroom_enrolled(subject_id));
drop policy if exists "teachers manage tests" on public.mock_tests;
create policy "teachers manage tests" on public.mock_tests for all to authenticated
  using (public.classroom_teaches(subject_id) or public.classroom_is_admin())
  with check ((public.classroom_teaches(subject_id) or public.classroom_is_admin()) and created_by = (select auth.uid()));
drop policy if exists "questions visible to class" on public.mock_test_questions;
create policy "questions visible to class" on public.mock_test_questions for select to authenticated
  using (exists (select 1 from public.mock_tests t where t.id = test_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin() or public.classroom_enrolled(t.subject_id))));
drop policy if exists "teachers manage questions" on public.mock_test_questions;
create policy "teachers manage questions" on public.mock_test_questions for all to authenticated
  using (exists (select 1 from public.mock_tests t where t.id = test_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin())))
  with check (exists (select 1 from public.mock_tests t where t.id = test_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin())));
drop policy if exists "teachers manage answer keys" on public.mock_test_answer_keys;
create policy "teachers manage answer keys" on public.mock_test_answer_keys for all to authenticated
  using (exists (select 1 from public.mock_test_questions q join public.mock_tests t on t.id = q.test_id where q.id = question_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin())))
  with check (exists (select 1 from public.mock_test_questions q join public.mock_tests t on t.id = q.test_id where q.id = question_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin())));
drop policy if exists "attempts visible to owner or teacher" on public.mock_test_attempts;
create policy "attempts visible to owner or teacher" on public.mock_test_attempts for select to authenticated
  using (student_id = (select auth.uid()) or exists (select 1 from public.mock_tests t where t.id = test_id and (public.classroom_teaches(t.subject_id) or public.classroom_is_admin())));

-- Students cannot write attempt scores. The database checks all answers and scores the attempt.
create or replace function public.submit_mock_test(p_test_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_score integer;
  v_attempt public.mock_test_attempts;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if not exists (
    select 1 from public.mock_tests t join public.subject_memberships m on m.subject_id = t.subject_id
    where t.id = p_test_id and m.student_id = (select auth.uid())
  ) then raise exception 'This test is not available to your account'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object'; end if;
  select count(*) into v_total from public.mock_test_questions q where q.test_id = p_test_id;
  if v_total = 0 then raise exception 'This test has no questions'; end if;
  select count(*) into v_score
    from public.mock_test_questions q
    join public.mock_test_answer_keys k on k.question_id = q.id
    where q.test_id = p_test_id and (p_answers ->> q.id::text)::integer = k.correct_option;
  insert into public.mock_test_attempts(test_id, student_id, answers, score, total_questions)
    values (p_test_id, (select auth.uid()), p_answers, v_score, v_total)
    on conflict (test_id, student_id) do update set answers = excluded.answers, score = excluded.score,
      total_questions = excluded.total_questions, submitted_at = now()
    returning * into v_attempt;
  return jsonb_build_object('score', v_score, 'total', v_total, 'submitted_at', v_attempt.submitted_at);
end;
$$;
revoke all on function public.submit_mock_test(uuid, jsonb) from public, anon;
grant execute on function public.submit_mock_test(uuid, jsonb) to authenticated;

-- Insert a test and its private answer key in one transaction.
create or replace function public.create_classroom_mock_test(
  p_subject_id uuid, p_title text, p_description text, p_duration_minutes integer, p_questions jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_test_id uuid := gen_random_uuid();
  v_item jsonb;
  v_question_id uuid;
  v_position integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if not public.classroom_is_admin() and not public.classroom_teaches(p_subject_id) then raise exception 'Teacher access required'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Enter a test title'; end if;
  if p_duration_minutes not between 1 and 300 then raise exception 'Test duration must be between 1 and 300 minutes'; end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'Questions must be provided as a list'; end if;
  if jsonb_array_length(p_questions) not between 1 and 30 then raise exception 'A test needs between 1 and 30 questions'; end if;
  insert into public.mock_tests(id, subject_id, created_by, title, description, duration_minutes)
    values (v_test_id, p_subject_id, (select auth.uid()), trim(p_title), coalesce(p_description, ''), p_duration_minutes);
  for v_item in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_item->'options') <> 'array' then raise exception 'Question choices must be provided as a list'; end if;
    if jsonb_array_length(v_item->'options') not between 2 and 6 then raise exception 'Each question needs 2 to 6 options'; end if;
    if length(trim(coalesce(v_item->>'prompt', ''))) = 0 then raise exception 'Every question needs text'; end if;
    if coalesce(v_item->>'correct', '') !~ '^[0-9]+$' or (v_item->>'correct')::integer >= jsonb_array_length(v_item->'options') then raise exception 'Choose a valid correct answer for every question'; end if;
    v_position := v_position + 1;
    insert into public.mock_test_questions(test_id, position, prompt, options)
      values (v_test_id, v_position, trim(v_item->>'prompt'), v_item->'options') returning id into v_question_id;
    insert into public.mock_test_answer_keys(question_id, correct_option) values (v_question_id, (v_item->>'correct')::integer);
  end loop;
  return v_test_id;
end;
$$;
revoke all on function public.create_classroom_mock_test(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.create_classroom_mock_test(uuid, text, text, integer, jsonb) to authenticated;

-- Private file bucket for teacher materials and assignment submissions.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('classroom-files', 'classroom-files', false, 104857600,
  array['video/mp4','video/webm','video/quicktime','application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "classroom file access" on storage.objects;
create policy "classroom file access" on storage.objects for select to authenticated using (
  bucket_id = 'classroom-files' and (
    exists (select 1 from public.learning_resources r where r.storage_path = name and (public.classroom_teaches(r.subject_id) or public.classroom_is_admin() or public.classroom_enrolled(r.subject_id)))
    or exists (select 1 from public.assignments a where a.attachment_path = name and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin() or public.classroom_enrolled(a.subject_id)))
    or exists (select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id where s.storage_path = name and (s.student_id = (select auth.uid()) or public.classroom_teaches(a.subject_id) or public.classroom_is_admin()))
  )
);
drop policy if exists "teachers upload classroom files" on storage.objects;
create policy "teachers upload classroom files" on storage.objects for insert to authenticated with check (
  bucket_id = 'classroom-files' and exists (select 1 from public.subjects s where s.id::text = split_part(name, '/', 1) and (s.teacher_id = (select auth.uid()) or public.classroom_is_admin()))
);
drop policy if exists "students upload assignment files" on storage.objects;
create policy "students upload assignment files" on storage.objects for insert to authenticated with check (
  bucket_id = 'classroom-files' and exists (
    select 1 from public.assignments a join public.subject_memberships m on m.subject_id = a.subject_id
    where a.id::text = split_part(name, '/', 1) and m.student_id = (select auth.uid())
  )
);
drop policy if exists "owners delete classroom files" on storage.objects;
create policy "owners delete classroom files" on storage.objects for delete to authenticated using (
  bucket_id = 'classroom-files' and (
    exists (select 1 from public.subjects s where s.id::text = split_part(name, '/', 1) and (s.teacher_id = (select auth.uid()) or public.classroom_is_admin()))
    or exists (select 1 from public.assignments a where a.attachment_path = name and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin()))
    or exists (select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id where s.storage_path = name and (public.classroom_teaches(a.subject_id) or public.classroom_is_admin()))
    or exists (select 1 from public.assignments a join public.subject_memberships m on m.subject_id = a.subject_id where a.id::text = split_part(name, '/', 1) and m.student_id = (select auth.uid()))
  )
);

-- Promote the initial admin after creating them in Supabase Auth:
-- insert into public.profiles (id, full_name, email, role)
-- select id, coalesce(raw_user_meta_data->>'full_name', 'Classroom Admin'), email, 'admin'
-- from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL')
-- on conflict (id) do update set
--   full_name = excluded.full_name,
--   email = excluded.email,
--   role = 'admin';
