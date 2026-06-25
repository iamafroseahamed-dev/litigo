// =============================================================================
// Supabase Edge Function: admin-users
// -----------------------------------------------------------------------------
// Secure server-side user provisioning for Adalat360.
//
// The ONLY place the Supabase Service Role Key is ever used. The frontend
// invokes this function with the caller's session JWT; the function:
//   1. Verifies the caller and loads their profile (role + organization).
//   2. Enforces role/organization permissions on the SERVER (never trusts the
//      client payload for authorization decisions).
//   3. Performs the privileged operation via the Admin API.
//   4. Writes an audit_logs entry.
//
// Actions (POST body { action: ... }):
//   - "create"         create auth user + profile (+ advocate) -> temp password
//   - "update"         edit profile fields (name/mobile/role/org/notifications)
//   - "reset_password" set a new temporary password -> temp password
//   - "set_status"     enable / disable (ban) a user
//
// Deploy:  supabase functions deploy admin-users
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY are
//          injected automatically by the Supabase platform.
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Role = 'platform_admin' | 'super_admin' | 'admin' | 'advocate' | 'viewer';

const CREATABLE: Record<string, Role[]> = {
  platform_admin: ['platform_admin', 'super_admin', 'admin', 'advocate', 'viewer'],
  super_admin: ['admin', 'advocate', 'viewer'],
};

const NOTIFICATION_KEYS = [
  'email_notifications',
  'notify_hearing_reminder',
  'notify_task_assignment',
  'notify_daily_cause_list',
  'notify_case_assignment',
] as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function generatePassword(length = 16): string {
  // Avoids ambiguous characters; includes symbols for complexity policies.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*?';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const n of bytes) out += alphabet[n % alphabet.length];
  return out;
}

function normalizeRole(role: string | null | undefined): Role {
  const r = (role ?? '').toLowerCase();
  if (r === 'user') return 'viewer';
  if (
    r === 'platform_admin' ||
    r === 'super_admin' ||
    r === 'admin' ||
    r === 'advocate' ||
    r === 'viewer'
  ) {
    return r;
  }
  return 'viewer';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json(500, { error: 'Server is not configured (missing service role key).' });
  }

  const admin: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Identify the caller -------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Not authenticated.' });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: 'Not authenticated.' });
  const callerAuthId = userData.user.id;

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('id, role, organization_id, email')
    .eq('user_id', callerAuthId)
    .maybeSingle();

  if (!callerProfile) return json(403, { error: 'No profile is associated with your account.' });
  const callerRole = normalizeRole(callerProfile.role);

  // Only platform admins and super admins may manage users.
  if (callerRole !== 'platform_admin' && callerRole !== 'super_admin') {
    return json(403, { error: 'You do not have permission to manage users.' });
  }

  // --- Audit helper --------------------------------------------------------
  async function audit(
    action: string,
    target: { id?: string; email?: string | null; organization_id?: string | null } | null,
    metadata: Record<string, unknown> = {},
  ) {
    try {
      await admin.from('audit_logs').insert({
        organization_id: target?.organization_id ?? callerProfile!.organization_id ?? null,
        actor_user_id: callerAuthId,
        actor_email: callerProfile!.email,
        action,
        target_type: 'user',
        target_id: target?.id ?? null,
        target_email: target?.email ?? null,
        metadata,
      });
    } catch (_) {
      // Audit failures must never block the primary operation.
    }
  }

  // Loads a target profile and enforces that the caller may act on it.
  async function loadManageableTarget(profileId: string) {
    const { data: target } = await admin
      .from('profiles')
      .select('id, user_id, role, organization_id, email, full_name, active')
      .eq('id', profileId)
      .maybeSingle();
    if (!target) return { error: json(404, { error: 'User not found.' }) };

    if (callerRole !== 'platform_admin') {
      if (target.organization_id !== callerProfile!.organization_id) {
        return { error: json(403, { error: 'You cannot manage users outside your organization.' }) };
      }
      const targetRole = normalizeRole(target.role);
      if (targetRole === 'platform_admin' || targetRole === 'super_admin') {
        return { error: json(403, { error: 'You cannot manage this user.' }) };
      }
    }
    return { target };
  }

  // --- Parse body ----------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request body.' });
  }
  const action = String(body.action ?? '');

  try {
    // =====================================================================
    // CREATE
    // =====================================================================
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      const mobile = String(body.mobile ?? '').trim() || null;
      const targetRole = normalizeRole(body.role as string);
      const notifications = (body.notifications ?? {}) as Record<string, unknown>;

      if (!fullName) return json(400, { error: 'Full name is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(400, { error: 'A valid email address is required.' });
      }

      const allowed = CREATABLE[callerRole];
      if (!allowed || !allowed.includes(targetRole)) {
        return json(403, { error: `You are not allowed to create a ${targetRole.replace('_', ' ')}.` });
      }

      // Non-platform admins are pinned to their own organization.
      let organizationId =
        callerRole === 'platform_admin'
          ? (body.organization_id as string | null) ?? null
          : callerProfile.organization_id;
      if (!organizationId) return json(400, { error: 'An organization is required.' });

      const { data: org } = await admin
        .from('organizations')
        .select('id')
        .eq('id', organizationId)
        .maybeSingle();
      if (!org) return json(404, { error: 'Organization not found.' });
      organizationId = org.id;

      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .maybeSingle();
      if (existing) return json(409, { error: 'A user with this email already exists.' });

      // 1) Create the auth user.
      const temporaryPassword = generatePassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) {
        const msg = createErr?.message ?? 'unknown error';
        if (/registered|exists/i.test(msg)) {
          return json(409, { error: 'A user with this email already exists.' });
        }
        return json(400, { error: `Auth creation failed: ${msg}` });
      }
      const newUserId = created.user.id;

      // 2) Insert the profile.
      const profileRow: Record<string, unknown> = {
        user_id: newUserId,
        organization_id: organizationId,
        full_name: fullName,
        email,
        mobile,
        role: targetRole,
        active: true,
      };
      for (const key of NOTIFICATION_KEYS) {
        profileRow[key] = notifications[key] !== undefined ? Boolean(notifications[key]) : true;
      }

      const { error: profileErr } = await admin.from('profiles').insert(profileRow);
      if (profileErr) {
        // Roll back the orphaned auth user.
        await admin.auth.admin.deleteUser(newUserId).catch(() => {});
        return json(400, { error: `Profile creation failed: ${profileErr.message}` });
      }

      // 3) Mirror advocates into the directory (best-effort, dedup by email).
      if (targetRole === 'advocate') {
        try {
          const { data: dupe } = await admin
            .from('advocates')
            .select('id')
            .eq('organization_id', organizationId)
            .ilike('email', email)
            .maybeSingle();
          if (!dupe) {
            await admin.from('advocates').insert({
              organization_id: organizationId,
              advocate_name: fullName,
              email,
              mobile,
              active: true,
            });
          }
        } catch (_) {
          // Advocate mirroring is non-critical.
        }
      }

      await audit('user_created', { id: undefined, email, organization_id: organizationId }, {
        role: targetRole,
      });

      return json(200, { success: true, userId: newUserId, temporaryPassword });
    }

    // =====================================================================
    // UPDATE
    // =====================================================================
    if (action === 'update') {
      const profileId = String(body.profile_id ?? '');
      if (!profileId) return json(400, { error: 'Missing user reference.' });

      const result = await loadManageableTarget(profileId);
      if (result.error) return result.error;
      const target = result.target!;

      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = String(body.full_name).trim();
      if (body.mobile !== undefined) patch.mobile = String(body.mobile).trim() || null;

      let roleChanged = false;
      if (body.role !== undefined) {
        const nextRole = normalizeRole(body.role as string);
        if (callerRole !== 'platform_admin' && !['admin', 'advocate', 'viewer'].includes(nextRole)) {
          return json(403, { error: 'You cannot assign this role.' });
        }
        patch.role = nextRole;
        roleChanged = normalizeRole(target.role) !== nextRole;
      }

      if (callerRole === 'platform_admin' && body.organization_id !== undefined) {
        patch.organization_id = body.organization_id;
      }

      for (const key of NOTIFICATION_KEYS) {
        if (body[key] !== undefined) patch[key] = Boolean(body[key]);
      }
      if (body.active !== undefined) patch.active = Boolean(body.active);

      if (Object.keys(patch).length === 0) return json(200, { success: true });

      const { error } = await admin.from('profiles').update(patch).eq('id', profileId);
      if (error) return json(400, { error: `Update failed: ${error.message}` });

      await audit(roleChanged ? 'role_changed' : 'user_updated', target, {
        changes: Object.keys(patch),
        ...(roleChanged ? { from: target.role, to: patch.role } : {}),
      });

      return json(200, { success: true });
    }

    // =====================================================================
    // RESET PASSWORD
    // =====================================================================
    if (action === 'reset_password') {
      const profileId = String(body.profile_id ?? '');
      if (!profileId) return json(400, { error: 'Missing user reference.' });

      const result = await loadManageableTarget(profileId);
      if (result.error) return result.error;
      const target = result.target!;
      if (!target.user_id) return json(400, { error: 'This user has no authentication account.' });

      const temporaryPassword = generatePassword();
      const { error } = await admin.auth.admin.updateUserById(target.user_id, {
        password: temporaryPassword,
      });
      if (error) return json(400, { error: `Password reset failed: ${error.message}` });

      await audit('password_reset', target);
      return json(200, { success: true, temporaryPassword });
    }

    // =====================================================================
    // SET STATUS (enable / disable)
    // =====================================================================
    if (action === 'set_status') {
      const profileId = String(body.profile_id ?? '');
      if (!profileId) return json(400, { error: 'Missing user reference.' });
      const active = Boolean(body.active);

      const result = await loadManageableTarget(profileId);
      if (result.error) return result.error;
      const target = result.target!;

      const { error } = await admin.from('profiles').update({ active }).eq('id', profileId);
      if (error) return json(400, { error: `Update failed: ${error.message}` });

      if (target.user_id) {
        await admin.auth.admin
          .updateUserById(target.user_id, { ban_duration: active ? 'none' : '876000h' })
          .catch(() => {});
      }

      await audit(active ? 'user_activated' : 'user_disabled', target);
      return json(200, { success: true });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected server error.';
    return json(500, { error: message });
  }
});
