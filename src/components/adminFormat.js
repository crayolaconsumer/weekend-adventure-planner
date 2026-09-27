// Shared admin formatters: relative/absolute times and audit-log sentences.

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return 'never'
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return 'never'
  const s = Math.max(0, now - then) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`
  return `${Math.floor(s / (86400 * 365))}y ago`
}

export function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Turn an admin_actions row into a sentence. For report.* actions,
// target_id is the reported entity (contribution, review...), so a ban
// via a report names metadata.reportedUserId, never target_id.
export function describeAction(row) {
  const action = row.action || ''
  const targetType = row.target_type || ''
  const targetId = row.target_id || ''
  const username = row.metadata?.username
  const reportedUserId = row.metadata?.reportedUserId
  const who = username ? ` (@${username})` : ''

  if (action.startsWith('report.dismiss')) return `dismissed report on ${targetType} #${targetId}`
  if (action.startsWith('report.review')) return `marked report on ${targetType} #${targetId} as reviewed`
  if (action.startsWith('report.action.hide_content')) return `hid contribution #${targetId}`
  if (action.startsWith('report.action.hide_review')) return `hid review text on rating #${targetId}`
  if (action.startsWith('report.action.ban_user')) {
    return `banned user #${reportedUserId ?? targetId} (via report on ${targetType} #${targetId})`
  }
  if (action.startsWith('report.')) return `actioned report on ${targetType} #${targetId}`
  if (action.startsWith('campaign.create.active')) return `created and activated campaign #${targetId}`
  if (action.startsWith('campaign.create.draft')) return `created campaign #${targetId} (draft)`
  if (action.startsWith('campaign.create')) return `created campaign #${targetId}`
  if (action.startsWith('campaign.update')) return `updated campaign #${targetId}`
  if (action.startsWith('campaign.cancel')) return `cancelled campaign #${targetId}`
  if (action === 'moderate_promoted_event') {
    return row.metadata?.to === 'removed' ? `removed promoted event #${targetId}` : `set promoted event #${targetId} to ${row.metadata?.to || 'live'}`
  }
  if (action === 'user.delete') return `deleted account #${targetId}${who}`
  if (action.startsWith('user.ban')) return `banned user #${targetId}${who}`
  if (action.startsWith('user.unban')) return `unbanned user #${targetId}${who}`
  return `${action} on ${targetType || 'something'} #${targetId}`
}
