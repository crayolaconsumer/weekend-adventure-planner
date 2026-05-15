/**
 * Moderation AI Triage
 *
 * Classifies an incoming UGC report using the Vercel AI Gateway.
 * Runs in the background (fire-and-forget from the report endpoint)
 * so the user's "thanks!" toast isn't delayed.
 *
 * Model: google/gemini-2.5-flash-lite — cheapest credible classifier
 * on the gateway (~$0.025/1M input tokens). At a 400-token average
 * round-trip, that's ~$0.000015 per report. Even at 100k reports/month
 * the bill stays under $2. Switch the MODEL constant below if a better
 * option appears later — the rest of the flow is provider-agnostic.
 *
 * Cost guardrails (defence in depth):
 *   1. Cheap model by default
 *   2. Vercel AI Gateway dashboard has hard spend caps — set one
 *   3. Reports are already rate-limited (API_WRITE) at the endpoint
 *   4. We never retry: one failed AI call = report saves without AI fields
 *   5. Token budget is fixed (maxTokens) so a runaway prompt can't drain
 */

import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'google/gemini-2.5-flash-lite'

// Strict, narrow output shape — model returns these fields and nothing
// else. severity drives alerting, suggestedAction drives auto-hide.
const TriageSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  reason: z.string().max(280),
  suggestedAction: z.enum(['hide', 'review', 'dismiss']),
  confidence: z.number().min(0).max(1),
})

const SYSTEM_PROMPT = `You are a content-moderation triage assistant for ROAM, a place-discovery app where users share tips, photos, and reviews of locations.

Your job: classify a report and recommend an action. Be strict but fair — false positives waste operator time, false negatives leave abusive content live.

SEVERITY DEFINITIONS
- critical: Imminent or serious harm. Credible threats of violence, doxxing, child-safety concerns, content advocating illegal acts against people, explicit sexual content, identifiable hate speech with calls to action.
- high: Clear policy violation but not life-safety. Slurs, sustained harassment, scams with financial-loss potential, explicit non-sexual nudity.
- medium: Plausible violation needing human judgment. Borderline content, low-quality spam, misinformation that isn't clearly harmful, rude but not abusive language.
- low: Likely fine or trivial. Vague complaints, taste-only disputes, retaliatory reports, minor formatting/quality issues.

ACTION DEFINITIONS
- hide: Recommend taking the content down immediately. Only for clear-cut policy violations.
- review: Operator should look at this themselves. Default for ambiguous cases.
- dismiss: No action needed; the report itself looks unfounded or trivial.

CONFIDENCE
- 0.9-1.0: You are essentially certain.
- 0.7-0.9: Strong signal, slight ambiguity.
- 0.5-0.7: Uncertain — pick the safer interpretation.
- < 0.5: Mostly guessing — pick low severity and review, never auto-hide.

OUTPUT RULES
- "reason" is one sentence (≤280 chars) explaining your severity call in plain English.
- Never recommend hide + confidence < 0.85 simultaneously.
- The reporter's chosen category is informative but not authoritative — judge the content itself.`

/**
 * Triage a report. Returns null if the AI call fails for any reason
 * (no gateway key, rate limit, parsing error). Callers should treat
 * null as "not triaged" and proceed normally.
 *
 * @param {Object} input
 * @param {string} input.entityType - 'contribution' | 'user' | 'photo' | etc
 * @param {string} input.userReason - The radio-button category the reporter chose
 * @param {string|null} input.userDetails - Optional free-text detail
 * @param {string|null} input.content - The actual reported content (tip body, etc)
 * @param {string|null} input.authorUsername - Author of the reported content (for context)
 */
export async function triageReport({ entityType, userReason, userDetails, content, authorUsername }) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return null
  }

  const userPrompt = [
    `Entity type: ${entityType}`,
    authorUsername ? `Author: @${authorUsername}` : null,
    `Reporter chose category: ${userReason}`,
    userDetails ? `Reporter wrote: """${userDetails.slice(0, 600)}"""` : null,
    content ? `Reported content: """${content.slice(0, 2000)}"""` : '(No content available — judge based on the reporter\'s claim alone, lean toward "review" with medium severity)',
  ].filter(Boolean).join('\n\n')

  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: TriageSchema,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0,
      maxOutputTokens: 200,
    })

    // Enforce the "no hide without high confidence" rule defensively, in
    // case the model ignores the system prompt.
    if (object.suggestedAction === 'hide' && object.confidence < 0.85) {
      object.suggestedAction = 'review'
    }
    return object
  } catch (err) {
    console.error('Moderation triage failed:', err?.message || err)
    return null
  }
}
