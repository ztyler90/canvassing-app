/*
 * InSessionChatBubble — floating chat affordance shown during an active
 * canvassing session. Behaves like Messenger's chat-head: a small circular
 * button anchored bottom-right that taps open a compact ChatPanel without
 * pausing the door-knock detector or GPS tracker (the session state lives
 * in SessionContext and is never touched here).
 *
 * Why this exists separate from ChatLauncher:
 *   - Different anchoring (floating, not header)
 *   - `compact` ChatPanel variant so it doesn't take over the whole screen
 *   - Has to coexist with the live-stats bar, map, and the bottom "End
 *     Session" controls — sits in the lower-right corner where the
 *     ActiveCanvassing layout has no controls
 *   - Unread bubble pulses on new traffic so the rep notices peripherally
 *     even while their attention is on the door
 *
 * Realtime + badge: same approach as ChatLauncher — subscribe to inbox
 * inserts, bump locally for messages in our conversations, settle on
 * panel close.
 */
import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { listMyConversations, subscribeToChatInbox, supabase } from '../lib/supabase.js'
import ChatPanel from './ChatPanel.jsx'

export default function InSessionChatBubble() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  // Brief pulse animation when a new message arrives while the bubble is
  // collapsed — gives the rep a peripheral cue without yanking focus.
  const [pulsing, setPulsing] = useState(false)
  const myConvIdsRef = useRef(new Set())
  const channelRef   = useRef(null)
  const pulseTimerRef = useRef(null)

  async function refreshUnread() {
    if (!user) return
    const rows = await listMyConversations()
    const total = rows.reduce((s, r) => s + (r.unread || 0), 0)
    setUnread(total)
    myConvIdsRef.current = new Set(rows.map((r) => r.id))
  }

  useEffect(() => {
    if (!user) return
    refreshUnread()
    channelRef.current = subscribeToChatInbox((row) => {
      if (!row || row.sender_id === user.id) return
      if (myConvIdsRef.current.size === 0) {
        refreshUnread()
        return
      }
      if (myConvIdsRef.current.has(row.conversation_id) && !open) {
        setUnread((u) => u + 1)
        setPulsing(true)
        clearTimeout(pulseTimerRef.current)
        pulseTimerRef.current = setTimeout(() => setPulsing(false), 2200)
      }
    })
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      clearTimeout(pulseTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (open) {
      setUnread(0)
      setPulsing(false)
      return
    }
    refreshUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      {/*
        Floating launcher — z-50 so it sits above the map and the live-stats
        bar. Bottom-right placement intentionally avoids the door-knock
        controls (which live bottom-center) and the End-Session button.
        On the smallest phones the bubble sits 80px from the bottom to
        clear the iOS home-indicator safe area + the End-Session row.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open chat${unread > 0 ? ` (${unread} unread)` : ''}`}
        className={
          'fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg ' +
          'flex items-center justify-center active:scale-95 transition-transform ' +
          (pulsing ? 'ring-4 ring-blue-300/70 animate-pulse' : '')
        }
        style={{
          // Respect iOS safe-area on phones with a home-indicator.
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)',
        }}
      >
        <MessageSquare className="w-5 h-5" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] font-extrabold flex items-center justify-center bg-red-500 text-white ring-2 ring-white"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Compact panel — capped height, anchored above the bubble. Does
         NOT render a click-outside scrim (would interrupt the rep's
         taps on the map/knock controls). The X button is the only
         dismissal path, mirroring how Messenger chat heads work. */}
      <ChatPanel open={open} onClose={() => setOpen(false)} compact />
    </>
  )
}
