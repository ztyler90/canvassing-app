/**
 * VoiceNoteButton — inline mic button that records a short audio clip,
 * uploads it to the transcribe-voice edge function, and passes the
 * transcribed text back to the parent.
 *
 * States:
 *   idle        – mic icon; tap to start recording
 *   recording   – red pulsing icon + elapsed timer; tap to stop
 *   transcribing – spinner; waiting on Whisper
 *
 * Props:
 *   onTranscribed(text)  — called with the transcription once Whisper returns.
 *                          The parent is responsible for appending to its
 *                          notes textarea (we don't mutate state directly).
 *   onError?(err)        — optional; otherwise we surface via console.warn.
 *   maxSeconds=90        — auto-stop the recording at this many seconds so
 *                          reps don't accidentally leave it running.
 *   disabled?            — disables the button (e.g. while saving).
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { transcribeVoiceNote } from '../lib/supabase.js'

// Pick the first MIME type the browser actually supports. Safari on iOS
// only speaks audio/mp4, Chrome/Firefox on desktop prefer audio/webm.
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const mt of candidates) {
    try { if (MediaRecorder.isTypeSupported(mt)) return mt } catch { /* ignore */ }
  }
  return ''
}

export default function VoiceNoteButton({
  onTranscribed,
  onError,
  maxSeconds = 90,
  disabled   = false,
}) {
  // 'idle' | 'recording' | 'transcribing'
  const [state, setState]       = useState('idle')
  const [elapsedS, setElapsedS] = useState(0)
  const [err, setErr]           = useState('')

  const recorderRef = useRef(null)
  const chunksRef   = useRef([])
  const streamRef   = useRef(null)
  const timerRef    = useRef(null)
  const autoStopRef = useRef(null)
  const mimeRef     = useRef('')

  // Tap-to-start
  async function start() {
    setErr('')
    if (state !== 'idle') return
    // Feature-detect — some desktop Safari versions still have no mediaDevices
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const msg = 'Voice notes aren’t supported on this device.'
      setErr(msg)
      onError?.(new Error(msg))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime   = pickMime()
      mimeRef.current = mime
      const rec    = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = handleStopped
      rec.onerror = (e) => {
        console.warn('[VoiceNote] MediaRecorder error', e)
        setErr('Recording failed')
        cleanupStream()
        setState('idle')
      }
      recorderRef.current = rec
      rec.start()
      setState('recording')
      setElapsedS(0)
      timerRef.current = setInterval(() => setElapsedS((s) => s + 1), 1000)
      // Safety valve — auto-stop so a forgotten recording doesn't drain
      // mic access indefinitely (and doesn't run past Whisper's size limit).
      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') stop()
      }, maxSeconds * 1000)
    } catch (e) {
      console.warn('[VoiceNote] getUserMedia failed', e)
      const msg = e?.name === 'NotAllowedError'
        ? 'Microphone access was denied'
        : 'Could not start recording'
      setErr(msg)
      onError?.(e instanceof Error ? e : new Error(msg))
      setState('idle')
    }
  }

  // Tap-to-stop — fires MediaRecorder.stop() which triggers handleStopped.
  function stop() {
    clearInterval(timerRef.current)
    clearTimeout(autoStopRef.current)
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop() } catch { /* ignore */ }
    }
  }

  function cleanupStream() {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    streamRef.current = null
  }

  async function handleStopped() {
    clearInterval(timerRef.current)
    clearTimeout(autoStopRef.current)
    cleanupStream()
    const type  = mimeRef.current || 'audio/webm'
    const blob  = new Blob(chunksRef.current, { type })
    chunksRef.current = []
    // A too-short recording is almost certainly an accidental tap. We skip
    // the network round-trip and return the user to idle silently.
    if (blob.size < 2000) {
      setState('idle')
      return
    }
    setState('transcribing')
    const { text, error } = await transcribeVoiceNote(blob)
    if (error) {
      console.warn('[VoiceNote] transcribe failed', error)
      setErr(error.message || 'Transcription failed')
      onError?.(error)
      setState('idle')
      return
    }
    if (text) onTranscribed?.(text)
    setState('idle')
  }

  // Ensure we release the mic if the modal unmounts mid-record
  useEffect(() => () => {
    clearInterval(timerRef.current)
    clearTimeout(autoStopRef.current)
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop() } catch { /* ignore */ }
    }
    cleanupStream()
  }, [])

  const isRec  = state === 'recording'
  const isTxr  = state === 'transcribing'
  const label  = isRec ? 'Stop' : isTxr ? 'Transcribing…' : 'Voice note'

  const btnBase = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border transition-colors'
  const btnCls = isRec
    ? 'bg-red-600 border-red-600 text-white animate-pulse'
    : isTxr
      ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-wait'
      : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={isRec ? stop : start}
        disabled={disabled || isTxr}
        className={`${btnBase} ${btnCls} disabled:opacity-60`}
        aria-pressed={isRec}
        title={isRec ? 'Stop recording' : isTxr ? 'Transcribing…' : 'Record a voice note'}
      >
        {isTxr
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : isRec
            ? <Square className="w-3.5 h-3.5" fill="currentColor" />
            : <Mic className="w-3.5 h-3.5" />
        }
        <span>{label}</span>
        {isRec && <span className="tabular-nums">{formatElapsed(elapsedS)}</span>}
      </button>
      {err && <span className="text-[11px] text-red-500">{err}</span>}
    </div>
  )
}

function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
