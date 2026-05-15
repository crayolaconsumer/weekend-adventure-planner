/**
 * Moderation Alerts
 *
 * Emails the operator when a UGC report comes in. We only fire on
 * critical/high severity (per the AI triage) so the operator's inbox
 * doesn't get spammed by low-stakes reports — those just sit in the
 * content_reports queue for occasional triage.
 *
 * Falls back to alerting on every report when AI triage didn't run
 * (no gateway key, or AI call failed), so we never silently miss a
 * report.
 */

import { sendEmail } from './email.js'

const ALERT_EMAIL = process.env.MODERATION_ALERT_EMAIL || 'fittonj@gmail.com'

/**
 * Decide whether this report deserves an immediate alert.
 *  - critical / high  → always
 *  - medium / low     → never (sits in queue)
 *  - no AI triage     → always (fail-safe: we'd rather over-notify than miss)
 */
export function shouldAlert(triage) {
  if (!triage) return true
  return triage.severity === 'critical' || triage.severity === 'high'
}

/**
 * Send an operator alert email for a report.
 *
 * Returns the result of sendEmail. Never throws — failures log and the
 * caller continues (the report is already persisted).
 */
export async function sendModerationAlert({ report, triage, reportedContent }) {
  try {
    const severity = triage?.severity || 'unknown'
    const sevTag = severity.toUpperCase()
    const subject = `[ROAM ${sevTag}] ${report.entity_type} report — ${report.reason}`

    const lines = [
      `A user-content report just came in.`,
      ``,
      `Report ID: ${report.id}`,
      `Entity:    ${report.entity_type} #${report.entity_id}`,
      `Reason:    ${report.reason}`,
      report.details ? `Detail:    ${report.details}` : null,
      ``,
      triage ? `--- AI triage ---` : `--- AI triage skipped (no gateway key or call failed) ---`,
      triage ? `Severity:   ${triage.severity} (confidence ${triage.confidence.toFixed(2)})` : null,
      triage ? `Reasoning:  ${triage.reason}` : null,
      triage ? `Suggested:  ${triage.suggestedAction}` : null,
      triage ? `Auto-action: ${report.ai_action_taken || 'none'}` : null,
      ``,
      reportedContent ? `--- Reported content ---` : null,
      reportedContent ? reportedContent : null,
      ``,
      `Review at: https://go-roam.uk/admin/reports`,
      ``,
      `(Reply to this email or open the admin link to action.)`,
    ].filter(line => line !== null)

    const text = lines.join('\n')

    // Tiny inline HTML — Resend renders text/* fine but a basic HTML view
    // reads better on phone email clients.
    const sevColour = severity === 'critical' ? '#b22d2d' : severity === 'high' ? '#c87a2f' : '#6b6b6b'
    const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; line-height: 1.5; color: #1a3a2f;">
  <p style="margin:0 0 12px"><span style="background:${sevColour};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.5px">${sevTag}</span></p>
  <p style="margin:0 0 6px"><strong>${report.entity_type} report</strong> — ${report.reason}</p>
  <p style="margin:0 0 6px;color:#6b6b6b;font-size:13px">Report #${report.id} · entity #${report.entity_id}</p>
  ${report.details ? `<p style="margin:12px 0;padding:10px 12px;background:#f6f3ec;border-radius:6px;font-size:14px"><em>"${escapeHtml(report.details)}"</em></p>` : ''}
  ${triage ? `<hr style="border:none;border-top:1px solid #e6e3d8;margin:18px 0"/>
  <p style="margin:0 0 4px;font-size:13px;color:#6b6b6b">AI triage (confidence ${triage.confidence.toFixed(2)})</p>
  <p style="margin:0 0 6px">${escapeHtml(triage.reason)}</p>
  <p style="margin:0;font-size:13px;color:#6b6b6b">Suggested: <strong>${triage.suggestedAction}</strong>${report.ai_action_taken && report.ai_action_taken !== 'none' ? ` · Auto-actioned: <strong>${report.ai_action_taken}</strong>` : ''}</p>` : `<p style="color:#6b6b6b;font-size:13px">AI triage skipped — review manually.</p>`}
  ${reportedContent ? `<hr style="border:none;border-top:1px solid #e6e3d8;margin:18px 0"/>
  <p style="margin:0 0 4px;font-size:13px;color:#6b6b6b">Reported content</p>
  <p style="margin:0;padding:10px 12px;background:#f6f3ec;border-radius:6px;font-size:14px">${escapeHtml(reportedContent)}</p>` : ''}
  <p style="margin-top:24px"><a href="https://go-roam.uk/admin/reports" style="display:inline-block;padding:10px 18px;background:#1a3a2f;color:#fff;text-decoration:none;border-radius:6px;font-weight:500">Review report</a></p>
</div>`

    return await sendEmail({ to: ALERT_EMAIL, subject, text, html })
  } catch (err) {
    console.error('Moderation alert send failed:', err?.message || err)
    return { sent: false, provider: 'error' }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
