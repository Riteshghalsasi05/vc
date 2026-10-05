// Deploy with `supabase functions deploy invite-member`.
// Required function secrets: SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
  if (!url || !anonKey || !serviceKey || !adminEmail) return response({ error: "Invitation service is not configured." }, 500);

  const authHeader = request.headers.get("Authorization") || "";
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user || user.email?.trim().toLowerCase() !== adminEmail) return response({ error: "Administrator access required." }, 403);

  const { data: callerProfile, error: callerProfileError } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (callerProfileError || callerProfile?.role !== "admin") return response({ error: "Administrator access required." }, 403);

  const payload = await request.json().catch(() => ({}));
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = payload.role === "teacher" ? "teacher" : payload.role === "student" ? "student" : "";
  const className = typeof payload.class_name === "string" ? payload.class_name.trim().slice(0, 80) : null;
  if (!name || name.length > 120 || !role || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ error: "Enter a name, valid email address, and student or teacher role." }, 400);
  }

  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let existingUser = null;
  for (let page = 1; ; page += 1) {
    const { data: usersPage, error: listError } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (listError) return response({ error: "Could not check for an existing account." }, 500);
    existingUser = usersPage.users.find((item) => item.email?.trim().toLowerCase() === email) || null;
    if (existingUser || usersPage.users.length < 1000) break;
  }

  if (existingUser) {
    const { data: existingProfile, error: profileLookupError } = await service
      .from("profiles").select("role").eq("id", existingUser.id).maybeSingle();
    if (profileLookupError) return response({ error: "Could not check classroom access." }, 500);
    if (existingProfile) {
      return response({ error: `This account already has classroom access as ${existingProfile.role}.` }, 409);
    }
    const { error: provisionError } = await service.from("profiles").insert({
      id: existingUser.id,
      full_name: name,
      email,
      role,
      class_name: role === "student" ? className : null,
      account_status: existingUser.email_confirmed_at ? "active" : "pending",
    });
    if (provisionError) return response({ error: provisionError.message }, 400);
    return response({ ok: true, invited: false, message: `${name} already had a Supabase Auth account. Classroom access is now enabled as ${role}.` });
  }

  const { data: invitation, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name, role, class_name: role === "student" ? className : null },
  });
  if (inviteError || !invitation.user) return response({ error: inviteError?.message || "Could not send the invitation." }, 400);

  const { error: profileError } = await service.from("profiles").insert({
    id: invitation.user.id,
    full_name: name,
    email,
    role,
    class_name: role === "student" ? className : null,
    account_status: "pending",
  });
  if (profileError) {
    await service.auth.admin.deleteUser(invitation.user.id);
    return response({ error: profileError.message }, 400);
  }

  return response({ ok: true, invited: true, message: `Invitation sent to ${email}. They can set their password from the email.` });
});
