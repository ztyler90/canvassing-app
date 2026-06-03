/*
 * ChatPanel — slide-out team chat surface, shared by the manager and rep
 * headers and the in-session bubble.
 *
 * Architecture (kept deliberately self-contained):
 *
 *   <ChatPanel open onClose>
 *     ├── Inbox view
 *     │     • Pinned "All Team" channel
 *     │     • DMs sorted by recency, unread badges
 *     │     • "New DM" → opens picker
 *     ├── Thread view
 *     │     • Message list (paginated back by load-older)
 *     │     • Composer (Enter sends, Shift+Enter newline)
 *     │     • Live updates via subscribeToChatMessages
 *     └── DM Picker view
 *           • Filter input + org roster
 *           • Tap → getOrCreateDM → swap to thread view
 *
 * The component owns its own data lifecycle: on open, it loads the inbox
 * and ensures the team conversation exists. Thread/inbox refreshes are
 * driven by realtime subscriptions plus a final markChatRead on close so
 * the badge clears immediately.
 *
 * `compact` mode trims paddings and caps height for the in-session bubble,
 * where horizontal real estate is precious and we want it to feel like a
 * notification surface rather than a full inbox.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { ArrowLeft, MessageSquare, Plus, Search, Send, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  ensureTeamConversation,
  getChatMessages,
  getOrCreateDM,
  listMyConversations,
  listOrgTeammates,
  markChatRead,
  sendChatMessage,
  subscribeToChatMessages,
} from '../lib/supabase.js'

// Tailwind-friendly short-form date for inbox previews.
function previewDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isToday(d))     return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

// Initials from a name string for the avatar bubble.
function initials(name) {
  if (!name) return '?'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// Conversation row title — "All Team" for the channel, or the other person's
// name for DMs (falls back to email when the row hasn't filled full_name).
function titleOf(conv) {
  if (conv.type === 'team') return conv.name || 'All Team'
  return conv.other_user?.full_name || conv.other_user?.email || 'Direct Message'
}

export default function ChatPanel({ open = false, onClose, compact = false }) {
  const { user } = useAuth()
  const [view, setView] = useState('inbox')        // 'inbox' | 'thread' | 'picker'
  const [conversations, setConversations] = useState([])
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [activeConvId, setActiveConvId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [teammates, setTeammates] = useState([])
  const [pickerFilter, setPickerFilter] = useState('')
  // Tracks which teammate row is mid-DM-creation so the picker shows a
  // spinner instead of silently doing nothing. Also surfaces any error
  // message inline rather than swallowing it.
  const [pickerBusyId, setPickerBusyId] = useState(null)
  const [pickerError, setPickerError]   = useState('')
  const threadEndRef = useRef(null)
  const channelRef   = useRef(null)

  // Find the active conversation row in the inbox so the thread header
  // can show the right title without re-reading.
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || null,
    [conversations, activeConvId]
  )

  // ── Inbox load + refresh ────────────────────────────────────────────────
  async function refreshInbox() {
    setLoadingInbox(true)
    // Make sure the team channel exists for this org before listing —
    // covers brand-new orgs where the trigger seeded it but the cache
    // hasn't yet seen the row, and any pre-trigger-era orgs.
    await ensureTeamConversation()
    const rows = await listMyConversations()
    setConversations(rows)
    setLoadingInbox(false)
  }

  // First-open inbox refresh. We don't load on mount — only when the panel
  // is actually open — to avoid a wasted query for users who never open it.
  useEffect(() => {
    if (!open) return
    refreshInbox()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Thread load + realtime subscription ────────────────────────────────
  useEffect(() => {
    if (!activeConvId) return
    let cancelled = false
    setLoadingMessages(true)
    getChatMessages(activeConvId, { limit: 50 }).then((rows) => {
      if (cancelled) return
      setMessages(rows)
      setLoadingMessages(false)
      // Mark read on open so the badge clears immediately.
      markChatRead(activeConvId).then(refreshInbox)
    })

    // Realtime: append new messages as they land. Filter is server-side,
    // so other conversations never wake this socket.
    channelRef.current = subscribeToChatMessages(activeConvId, async (row) => {
      // Sender profile isn't in the realtime payload — backfill from the
      // inbox roster (DM peer) or fetch lazily. For now, attach a stub so
      // the bubble renders without flicker; full name resolves on next
      // refresh.
      setMessages((prev) => {
        // Don't double-insert echoed-from-send messages.
        if (prev.some((m) => m.id === row.id)) return prev
        return [...prev, { ...row, users: row.users || null }]
      })
      // Auto-mark-read if the panel is open on this thread.
      markChatRead(activeConvId)
    })

    return () => {
      cancelled = true
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [activeConvId])

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages.length])

  // Final mark-read on panel close so the badge clears.
  useEffect(() => {
    if (open) return
    if (activeConvId) markChatRead(activeConvId)
  }, [open, activeConvId])

  // ── Actions ────────────────────────────────────────────────────────────
  async function openConversation(conv) {
    setActiveConvId(conv.id)
    setView('thread')
  }

  async function openPicker() {
    setView('picker')
    if (teammates.length === 0) {
      const rows = await listOrgTeammates()
      setTeammates(rows)
    }
  }

  async function startDM(teammate) {
    if (!teammate?.id || pickerBusyId) return
    setPickerError('')
    setPickerBusyId(teammate.id)
    const { id: convId, error } = await getOrCreateDM(teammate.id)
    setPickerBusyId(null)
    if (error || !convId) {
      // Show the failure inline so the user isn't left wondering why the
      // tap did nothing. The console.error in supabase.js carries the
      // full error for DevTools; the UI just needs a human-readable nudge.
      setPickerError(
        error?.message
          ? `Couldn't open conversation: ${error.message}`
          : "Couldn't open conversation. Try again in a moment."
      )
      return
    }
    await refreshInbox()
    setActiveConvId(convId)
    setView('thread')
  }

  async function handleSend() {
    if (!draft.trim() || !activeConvId || sending) return
    setSending(true)
    const body = draft
    setDraft('')
    const { data, error } = await sendChatMessage(activeConvId, body)
    if (error) {
      // Restore the draft so the user doesn't lose their message.
      setDraft(body)
    } else if (data) {
      // Echo locally so the message appears without waiting for realtime —
      // the dedupe-by-id in the subscription handler keeps us from
      // double-rendering when the broadcast arrives.
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    }
    setSending(false)
    refreshInbox()
  }

  function handleComposerKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Filtered teammate roster for the picker.
  const filteredTeammates = useMemo(() => {
    const f = pickerFilter.trim().toLowerCase()
    if (!f) return teammates
    return teammates.filter((t) =>
      (t.full_name || '').toLowerCase().includes(f) ||
      (t.email || '').toLowerCase().includes(f))
  }, [teammates, pickerFilter])

  // ── Render ─────────────────────────────────────────────────────────────
  if (!open) return null

  // Surface sizing. Default is a desktop side-panel (right-aligned); compact
  // is the in-session bubble's expanded state (anchored bottom-right of its
  // host, capped so it doesn't cover door-knock controls).
  const surfaceCls = compact
    ? 'fixed bottom-20 right-4 z-[60] w-[min(360px,calc(100vw-2rem))] max-h-[60vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden'
    : 'fixed top-0 right-0 bottom-0 z-[60] w-full sm:w-[400px] flex flex-col bg-white shadow-2xl border-l border-gray-200 overflow-hidden'

  return (
    <>
      {/* Click-outside scrim — only for the full-height variant so taps on
         the rest of the dashboard close the panel. Compact bubble does not
         get a scrim (would interrupt mid-session interactions). */}
      {!compact && (
        <div
          className="fixed inset-0 z-[55] bg-slate-900/20"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div className={surfaceCls} role="dialog" aria-label="Team chat">
        {/* Header — context-sensitive: inbox shows "Team Chat", thread shows
           the conversation title, picker shows "New message". The leading
           control is a back button when not on inbox, a chat icon otherwise. */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 bg-gradient-to-b from-slate-50 to-white">
          {view !== 'inbox' ? (
            <button
              type="button"
              onClick={() => setView('inbox')}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-600"
              aria-label="Back to inbox"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700">
              <MessageSquare className="w-4 h-4" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">
              {view === 'inbox'  && 'Team Chat'}
              {view === 'thread' && (activeConv ? titleOf(activeConv) : 'Conversation')}
              {view === 'picker' && 'New message'}
            </p>
            {view === 'inbox' && (
              <p className="text-[11px] text-gray-500">Messages your teammates can see</p>
            )}
            {view === 'thread' && activeConv && (
              <p className="text-[11px] text-gray-500">
                {activeConv.type === 'team' ? `${activeConv.participant_count} member${activeConv.participant_count === 1 ? '' : 's'}` : 'Direct message'}
              </p>
            )}
          </div>
          {view === 'inbox' && (
            <button
              type="button"
              onClick={openPicker}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-600"
              aria-label="New direct message"
              title="New direct message"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-600"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — three mutually-exclusive panes. */}
        {view === 'inbox' && (
          <InboxList
            conversations={conversations}
            loading={loadingInbox}
            onOpen={openConversation}
            onNewDM={openPicker}
          />
        )}
        {view === 'thread' && (
          <ThreadView
            conv={activeConv}
            messages={messages}
            loading={loadingMessages}
            currentUserId={user?.id}
            threadEndRef={threadEndRef}
            draft={draft}
            setDraft={setDraft}
            onSend={handleSend}
            onComposerKey={handleComposerKey}
            sending={sending}
            compact={compact}
          />
        )}
        {view === 'picker' && (
          <PickerView
            teammates={filteredTeammates}
            filter={pickerFilter}
            setFilter={setPickerFilter}
            onPick={startDM}
            busyId={pickerBusyId}
            errorMessage={pickerError}
          />
        )}
      </div>
    </>
  )
}

// ─── Inbox list ────────────────────────────────────────────────────────────
function InboxList({ conversations, loading, onOpen, onNewDM }) {
  if (loading) {
    return (
      <div className="flex-1 grid place-items-center p-8">
        <div className="animate-spin w-6 h-6 rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }
  // Pin team channel(s) on top, DMs below. Within each group we keep the
  // server's recency sort.
  //
  // DM filter — only render rows that actually have a message. Tapping a
  // teammate creates the conversation row eagerly (so the DM thread can
  // load), but a thread the user opened and abandoned without sending
  // shouldn't litter the inbox. The empty row stays in the DB (and gets
  // reused on next dm_key match — getOrCreateDM is idempotent), it just
  // doesn't render until either side actually says something.
  const teamRows = conversations.filter((c) => c.type === 'team')
  const dmRows   = conversations.filter((c) => c.type === 'dm' && c.last_message)

  return (
    <div className="flex-1 overflow-y-auto">
      {teamRows.length > 0 && (
        <SectionLabel>Team channel</SectionLabel>
      )}
      {teamRows.map((c) => <ConversationRow key={c.id} conv={c} onOpen={onOpen} />)}

      <SectionLabel>Direct messages</SectionLabel>
      {dmRows.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-gray-500">No direct messages yet.</p>
          <button
            type="button"
            onClick={onNewDM}
            className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            Start a conversation →
          </button>
        </div>
      ) : (
        dmRows.map((c) => <ConversationRow key={c.id} conv={c} onOpen={onOpen} />)
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide font-semibold text-gray-500">
      {children}
    </p>
  )
}

function ConversationRow({ conv, onOpen }) {
  const title    = titleOf(conv)
  const subtitle = conv.last_message?.body
    ? conv.last_message.body.slice(0, 80)
    : (conv.type === 'team' ? 'No messages yet · say hi 👋' : 'No messages yet')
  const hasUnread = conv.unread > 0
  // Avatar tint cycles for DMs so the inbox doesn't feel monotone; team
  // channel gets a fixed blue/Users-icon treatment.
  const avatarBg = conv.type === 'team' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'

  return (
    <button
      type="button"
      onClick={() => onOpen(conv)}
      className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors border-b border-gray-100"
    >
      <div className={`w-9 h-9 rounded-full grid place-items-center text-xs font-bold ${avatarBg}`}>
        {conv.type === 'team' ? <Users className="w-4 h-4" /> : initials(title)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`truncate text-sm ${hasUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
            {title}
          </p>
          <p className={`shrink-0 text-[10px] tabular-nums ${hasUnread ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
            {previewDate(conv.last_message?.created_at || conv.last_message_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className={`flex-1 truncate text-xs ${hasUnread ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
            {subtitle}
          </p>
          {hasUnread && (
            <span className="shrink-0 text-[10px] font-extrabold text-white bg-blue-600 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {conv.unread > 99 ? '99+' : conv.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Thread view ───────────────────────────────────────────────────────────
function ThreadView({
  conv, messages, loading, currentUserId, threadEndRef,
  draft, setDraft, onSend, onComposerKey, sending, compact,
}) {
  return (
    <>
      <div className={`flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50 ${compact ? 'min-h-[180px]' : ''}`}>
        {loading ? (
          <div className="grid place-items-center py-8">
            <div className="animate-spin w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="grid place-items-center py-8 text-center">
            <MessageSquare className="w-6 h-6 text-gray-300 mb-2" />
            <p className="text-xs text-gray-500">
              {conv?.type === 'team' ? 'No messages yet — kick things off.' : 'No messages yet.'}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine    = m.sender_id === currentUserId
            const prev    = messages[i - 1]
            const showAvatar = !mine && (!prev || prev.sender_id !== m.sender_id)
            const senderName = m.users?.full_name || m.users?.email || (mine ? 'You' : 'Teammate')
            return (
              <div key={m.id} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                {!mine && (
                  <div className={`w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold bg-slate-200 text-slate-700 ${showAvatar ? '' : 'invisible'}`}>
                    {initials(senderName)}
                  </div>
                )}
                <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md'
                }`}>
                  {!mine && showAvatar && (
                    <p className="text-[10px] font-semibold text-gray-500 mb-0.5">{senderName}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                  <p className={`text-[10px] mt-0.5 ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                    {format(new Date(m.created_at), 'h:mm a')}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Composer — Enter sends, Shift+Enter newline. Auto-grows up to a
         cap so the thread doesn't get pushed off-screen on long drafts. */}
      <div className="border-t border-gray-200 bg-white px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-h-32"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!draft.trim() || sending}
            className="p-2 rounded-xl bg-blue-600 text-white disabled:bg-slate-300 hover:bg-blue-700 transition-colors"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Picker view ───────────────────────────────────────────────────────────
// `busyId` is the teammate id currently mid-DM-creation. We swap that row's
// trailing affordance for a spinner so a slow round-trip looks like a slow
// round-trip — not a dead tap. `errorMessage` surfaces any RPC failure
// inline; the full error lives in DevTools (logged from supabase.js).
function PickerView({ teammates, filter, setFilter, onPick, busyId, errorMessage }) {
  return (
    <>
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search teammates"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        {errorMessage && (
          <p className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 leading-snug">
            {errorMessage}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {teammates.length === 0 ? (
          <div className="grid place-items-center py-8 text-center">
            <p className="text-xs text-gray-500">No teammates found.</p>
          </div>
        ) : (
          teammates.map((t) => {
            const isBusy = busyId === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t)}
                disabled={isBusy || (busyId && busyId !== t.id)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors border-b border-gray-100 disabled:opacity-60"
              >
                <div className="w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-slate-200 text-slate-700">
                  {initials(t.full_name || t.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{t.full_name || t.email}</p>
                  <p className="text-[11px] text-gray-500 capitalize">{t.role || 'member'}</p>
                </div>
                {isBusy && (
                  <span
                    aria-hidden="true"
                    className="shrink-0 w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
                  />
                )}
              </button>
            )
          })
        )}
      </div>
    </>
  )
}
