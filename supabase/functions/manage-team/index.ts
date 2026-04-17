import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is an authenticated manager
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create a client with the service role key (has admin powers)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the JWT and check that the caller is a manager
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check role + org in public.users table
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('role, organization_id, is_super_admin')
      .eq('id', callerUser.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'manager') {
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!callerProfile.organization_id) {
      return new Response(JSON.stringify({ error: 'Owner is not attached to an organization' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { action } = body

    // ── CREATE REP ───────────────────────────────────────────────────────────
    if (action === 'create') {
      const { fullName, email, password } = body
      if (!fullName || !email || !password) {
        return new Response(JSON.stringify({ error: 'fullName, email, and password are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Create auth user
      const { data: newUserData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip email verification
        user_metadata: { full_name: fullName, role: 'rep' },
      })
      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const newUser = newUserData.user

      // Insert into public.users — stamp with the caller's organization so
      // tenant RLS + seat-count aggregation work immediately.
      const { error: insertError } = await adminClient.from('users').insert({
        id: newUser.id,
        email,
        full_name: fullName,
        role: 'rep',
        organization_id: callerProfile.organization_id,
        plan: 'standard',
      })
      if (insertError) {
        console.warn('[manage-team] Could not insert public.users row:', insertError.message)
        // Non-fatal: the auth user was created; they'll show up via auth metadata
      }

      return new Response(JSON.stringify({ user: { id: newUser.id, email, full_name: fullName } }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── DELETE REP ───────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { repId } = body
      if (!repId) {
        return new Response(JSON.stringify({ error: 'repId is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Make sure the rep actually belongs to this owner's organization.
      // Super-admins can delete across orgs.
      const { data: repProfile } = await adminClient
        .from('users')
        .select('organization_id, role')
        .eq('id', repId)
        .single()

      const sameOrg = repProfile?.organization_id === callerProfile.organization_id
      if (!repProfile || repProfile.role !== 'rep' || (!sameOrg && !callerProfile.is_super_admin)) {
        return new Response(JSON.stringify({ error: 'Rep not found or not under your organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Delete from public.users first (FK), then auth
      await adminClient.from('users').delete().eq('id', repId)
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(repId)
      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[manage-team] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
