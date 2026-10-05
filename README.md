# Virtual Classroom

A browser based student and teacher portal backed by Supabase Auth, Postgres, Row Level Security, and private Supabase Storage.

## Setup

1. Create a Supabase project. In **Project Settings → API**, copy the project URL and the anon/publishable browser key into `config.js`. Set `adminEmail` to the account that will be the classroom administrator. These browser values are public; never add a service role or secret key to `config.js`.
2. In **SQL Editor**, run `supabase/schema.sql`. It creates the profiles, subjects, enrollments, learning materials, assignments, submissions, tests, grades, and the private classroom file bucket with row level security policies. It can be re-run to add the app schema to an existing project.
3. Create the first admin user in **Authentication → Users**. Then run the one-time admin promotion SQL at the bottom of `supabase/schema.sql`, replacing `YOUR_ADMIN_EMAIL` with that exact account email. It must match `adminEmail` in `config.js`.
4. Install and sign in to the Supabase CLI, link this folder to the project, then set the invitation function secrets and deploy it:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ADMIN_EMAIL=admin@example.com SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_ANON_KEY=YOUR_ANON_KEY SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   supabase functions deploy invite-member
   ```

   The service role key stays in Edge Function secrets. The function checks both the signed-in user's profile role and the configured admin email before inviting a student or teacher.
5. In **Authentication → URL Configuration**, set the local or deployed website URL as the Site URL and add it to the Redirect URLs allowed by Auth, so invitation links return to the app.
6. Run `npm.cmd run dev` in PowerShell (or `npm run dev` in Command Prompt) from this folder, then open `http://localhost:5173`.

All sign-ins use Supabase Auth. If `123456` is the chosen password for the listed accounts, set it on those accounts in Supabase Auth; the app does not hard-code or bypass the password. Teachers upload materials to a selected subject, and enrolled students see the videos and notes grouped under that subject. A student's video is marked watched after 90% playback; the teacher can see completed video titles on the Students page. Re-run `supabase/schema.sql` after updating the app so the watch tracking table and teacher school profile field are created.

## Classroom workflows

- The administrator invites student and teacher accounts and sees the member list.
- Teachers create subjects and enroll existing student accounts by email, upload lesson videos and PDF/document notes, publish assignments, review submissions, and create multiple-choice mock tests.
- Students see only subjects they are enrolled in, access those subjects' files, submit assignment responses/files, and take tests. Test answers are scored by a database function; students cannot read the answer key or write their own score.
- Profiles and classroom data are restricted by role and enrollment through Postgres Row Level Security. Classroom files are private and opened through short-lived signed URLs.

New users can log in after they accept their email invitation and set a password. Their account changes from pending to active when Supabase confirms the invitation. Teacher and student profiles are provisioned by the admin invitation function; public sign-up is not used.

## Admin and member access

- Set `adminEmail` in `config.js` to the administrator's exact email. Create that email as a Supabase Auth user, then promote its profile with the one-time SQL statement in `schema.sql`. Set the Edge Function secret `ADMIN_EMAIL` to the same email. The Admin option checks both the profile role and that email.
- Sign in using **Admin Login**, then open **Students & Teachers** and add a full name, email, and role. A new Auth account receives an invitation link to set a password. If the Auth account already exists but does not have a classroom profile, the admin can enable it directly; that person signs in with their existing password. Accounts that already have a classroom role are reported instead of being duplicated.
- After a teacher signs in, they create a subject and add existing student accounts by email from the Subjects page. This enrolls those students so the subject materials, assignments, and tests appear in their portal.
