/*
 * ChatLauncher — single-component entry point for the team chat experience.
 *
 * Renders a header button (white-on-translucent to match the existing
 * header treatment in ManagerDashboard and RepHome) with an unread badge,
 * and owns the open/close state for the <ChatPanel/> overlay.
 *
 * Unread count is maintained in two ways:
 *   • On mount / on panel close: one inbox read summed across conversations.
 *   • On realtime INSERT into any chat_messages row from a sender that
 *     isn't us: cheap optimistic bump (+1). We re-read the inbox after
 *     each panel close to settle any drift.
 *
 * The realtime subscription survives across panel open/close, so the badge
 * stays live even while the panel is shut. We tear it down on unmount.
 */
import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { listMyConversations, subscribeToChatInbox, supabase } from '../lib/supabase.js'
import ChatPanel from './ChatPanel.jsx'

export default function ChatLauncher({
  // Optional className override so callers can match the header's existing
  // button styling exactly (manager uses bg-white/20, rep uses
  // bg-white/20 active:bg-white/30, etc.). The default works in either.
  buttonClassName = 'relative p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0',
  // Some headers don't want a tooltip (mobile); pass `title={null}` to skip.
  title = 'Team chat',
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const channelRef = useRef(null)
  // Tracks which conversation ids include us — used by the realtime callback
  // to decide whether an inbound INSERT bumps our badge. Refreshed alongside
  // the unread count so a freshly-created DM lights up the badge.
  const myConvIdsRef = useRef(new Set())

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
    // Live badge updates — we receive every chat_messages INSERT in the
    // realtime stream (no participant-aware filter is possible server-side)
    // and decide locally whether the message belongs to one of our threads.
    channelRef.current = subscribeToChatInbox((row) => {
      if (!row) return
      if (row.sender_id === user.id) return
      // If we haven't loaded our conv set yet, just re-read; otherwise the
      // membership check below keeps us from bumping for other orgs'
      // messages (RLS will block the read anyway, but we don't want a
      // ghost badge during the brief window before refresh).
      if (myConvIdsRef.current.size === 0) {
        refreshUnread()
        return
      }
      if (myConvIdsRef.current.has(row.conversation_id) && !open) {
        setUnread((u) => u + 1)
      }
    })
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Re-read unread after the panel closes so the badge settles. (When the
  // panel is open it's continuously marking conversations as read; we just
  // need one authoritative re-read once the user dismisses it.)
  useEffect(() => {
    if (open) {
      // Optimistically clear the badge when opening so the user gets
      // immediate feedback; the next read settles the true count.
      setUnread(0)
      return
    }
    refreshUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName}
        aria-label={`Team chat${unread > 0 ? ` (${unread} unread)` : ''}`}
        title={title || undefined}
      >
        <MessageSquare className="w-5 h-5 text-white" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-red-500 text-white ring-2 ring-white/40"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <ChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
