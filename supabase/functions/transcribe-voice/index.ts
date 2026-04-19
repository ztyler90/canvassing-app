// transcribe-voice
// ----------------------------------------------------------------------------
// Accepts an authenticated rep's audio recording and returns the transcription
// produced by OpenAI's Whisper API. Body must be multipart/form-data with an
// "audio" field (Blob/File). Any authenticated user of the org can call it.
//
// Required secrets (set via `supabase secrets set`):
//   OPENAI_API_KEY  — key used for Whisper
//
// Response:
//   200 { text: "transcribed text" }
//   4xx { error: "..." }
// ----------------------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Whisper currently allows files up to 25 MB.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401)
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Invalid token' }, 401)
    }

    // ── Parse upload ──────────────────────────────────────────────────────
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Expected multipart/form-data upload' }, 400)
    }

    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File) && !(audio instanceof Blob)) {
      return json({ error: 'Missing "audio" field in form-data' }, 400)
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return json({ error: `Audio too large (max ${MAX_AUDIO_BYTES / 1024 / 1024} MB)` }, 413)
    }
    if (audio.size === 0) {
      return json({ error: 'Empty audio file' }, 400)
    }

    const language = (form.get('language') as string) || undefined
    const prompt   = (form.get('prompt') as string)   || undefined

    // ── Forward to Whisper ────────────────────────────────────────────────
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return json({ error: 'Server missing OPENAI_API_KEY secret' }, 500)
    }

    // Whisper requires a filename with a supported extension. Browser
    // MediaRecorder typically emits audio/webm or audio/mp4; preserve the
    // browser-supplied filename if the File API gave us one, otherwise fall
    // back to a best-guess extension so Whisper doesn't reject the upload.
    let filename = 'voice-note.webm'
    if (audio instanceof File && audio.name) {
      filename = audio.name
    } else if (audio.type) {
      const ext = audio.type.includes('mp4')
        ? 'mp4'
        : audio.type.includes('ogg')
          ? 'ogg'
          : audio.type.includes('wav')
            ? 'wav'
            : 'webm'
      filename = `voice-note.${ext}`
    }

    const whisperForm = new FormData()
    whisperForm.append('file',  audio, filename)
    whisperForm.append('model', 'whisper-1')
    // response_format=json keeps us to a predictable shape (text + no timings).
    whisperForm.append('response_format', 'json')
    // Small amount of context so the model doesn't mis-transcribe brand terms.
    whisperForm.append(
      'prompt',
      prompt || 'Door-to-door canvassing notes. Services may include window cleaning, gutter cleaning, house washing, roof cleaning, driveway washing, holiday lights.',
    )
    if (language) whisperForm.append('language', language)

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body:    whisperForm,
    })

    if (!whisperRes.ok) {
      let detail = ''
      try { detail = await whisperRes.text() } catch { /* ignore */ }
      console.error('[transcribe-voice] Whisper error', whisperRes.status, detail)
      return json({ error: 'Transcription failed', status: whisperRes.status }, 502)
    }

    const payload = await whisperRes.json() as { text?: string }
    const text    = (payload?.text || '').trim()
    return json({ text })
  } catch (err) {
    console.error('[transcribe-voice] fatal', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
