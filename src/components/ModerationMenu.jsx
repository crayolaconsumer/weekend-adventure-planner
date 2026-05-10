/**
 * ModerationMenu
 *
 * 3-dot overflow button that surfaces Report + Block actions on any
 * piece of user-generated content. Required by App Store Review
 * Guideline 1.2 — apps with UGC must allow users to report and block
 * abusive content/users from the same context the content appears in.
 *
 * Use case (typical):
 *   <ModerationMenu
 *     entityType="contribution"
 *     entityId={contribution.id}
 *     entityLabel="this tip"
 *     authorId={contribution.user_id}
 *     authorUsername={contribution.username}
 *   />
 *
 * Block is hidden when authorId is the current user, or unknown.
 * Whole component renders null for non-authenticated viewers (they
 * have no actionable target yet — direct them to sign in via a
 * separate path if needed).
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useBlockedUsers } from '../hooks/useBlockedUsers'
import { useToast } from '../hooks/useToast'
import ReportModal from './ReportModal'
import './ModerationMenu.css'

const DotsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="1.4" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
    <circle cx="12" cy="19" r="1.4" fill="currentColor"/>
  </svg>
)

export default function ModerationMenu({
  entityType,
  entityId,
  entityLabel,         // 'this tip', 'this photo', 'this review'
  authorId,            // user id of the content's author
  authorUsername,      // for the toast / block confirm copy
}) {
  const { user } = useAuth()
  const { blockUser } = useBlockedUsers()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const menuRef = useRef(null)

  // Don't render if no current viewer (they can't act). Apple still
  // expects the affordance to be REACHABLE — sign-in for that surface
  // is handled by the parent component's "sign in to interact" prompt.
  // Also hide when the viewer is the content's author (self-action).
  const viewerIsAuthor = user?.id && authorId && user.id === authorId

  // Close on outside click + escape
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  if (viewerIsAuthor) return null

  const handleReport = (e) => {
    e.stopPropagation()
    setOpen(false)
    setShowReport(true)
  }

  const handleBlock = async (e) => {
    e.stopPropagation()
    setOpen(false)
    if (!authorId) return
    const result = await blockUser(authorId)
    if (result?.success) {
      toast.success(`Blocked @${authorUsername || 'user'}. You won't see their content again.`)
    } else if (result?.error?.toLowerCase().includes('already')) {
      toast.info(`You've already blocked @${authorUsername || 'this user'}`)
    } else {
      toast.error(result?.error || 'Failed to block user')
    }
  }

  return (
    <>
      <div ref={menuRef} className="moderation-menu-wrapper">
        <button
          type="button"
          className="moderation-menu-trigger"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        >
          <DotsIcon />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              className="moderation-menu-popover"
              role="menu"
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              <button
                type="button"
                role="menuitem"
                className="moderation-menu-item"
                onClick={handleReport}
              >
                Report {entityLabel || entityType}
              </button>
              {authorId && (
                <button
                  type="button"
                  role="menuitem"
                  className="moderation-menu-item"
                  onClick={handleBlock}
                >
                  Block {authorUsername ? `@${authorUsername}` : 'user'}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ReportModal
        isOpen={showReport}
        entityType={entityType}
        entityId={entityId}
        reportedUserId={authorId}
        entityLabel={entityLabel}
        onClose={() => setShowReport(false)}
      />
    </>
  )
}
