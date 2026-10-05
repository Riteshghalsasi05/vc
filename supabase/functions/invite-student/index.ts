// Deploy with Supabase CLI. Configure ADMIN_EMAIL and SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY as function secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") || "").toLowerCase();
  const authHeader = request.headers.get("Authorization") || "";
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user || user.email?.toLowerCase() !== adminEmail) {
    return Response.json({ error: "Admin access required." }, { status: 403, headers: cors });
  }
  const { data: profile } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403, headers: cors });
  const payload = await request.json().catch(() => ({}));
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a student name and valid email address." }, { status: 400, headers: cors });
  }
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name, role: "student" }
  });
  if (inviteError || !invited.user) {
    return Response.json({ error: inviteError?.message || "Could not send invitation." }, { status: 400, headers: cors });
  }
  const { error: profileError } = await service.from("profiles").insert({
    id: invited.user.id, full_name: name, email, role: "student"
  });
  if (profileError) return Response.json({ error: profileError.message }, { status: 400, headers: cors });
  return Response.json({ ok: true }, { headers: cors });
});
