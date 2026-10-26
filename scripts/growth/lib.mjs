// Pure helpers for the weekly growth report: ISO-week windows, arithmetic,
// the "one thing to fix" rule, and CSV/TSV parsing. No I/O here, so every
// number the report prints is computed (and tested) in this file or the
// per-source modules, never estimated.

const DAY = 86400000

/** ISO week label (e.g. "2026-W43") for a UTC date. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)) // Thursday of this week
  const year = d.getUTCFullYear()
  const week = 1 + Math.floor((d - Date.UTC(year, 0, 1)) / DAY / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Monday 00:00 UTC of an ISO week label. */
export function mondayOf(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(label)
  if (!m) throw new Error(`bad ISO week "${label}" (want e.g. 2026-W43)`)
  const jan4 = Date.UTC(+m[1], 0, 4)
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY
  return new Date(week1 + (+m[2] - 1) * 7 * DAY)
}

/**
 * The report window. Default: the last COMPLETE ISO week before `now`
 * (run on Monday 26 Oct 2026 -> 2026-W43, Mon 19 to Sun 25 Oct), plus the
 * week before it for week-over-week deltas. All boundaries are UTC.
 */
export function reportWindow(now = new Date(), label = null) {
  const start = label ? mondayOf(label) : new Date(mondayOf(isoWeek(now)) - 7 * DAY)
  const end = new Date(+start + 7 * DAY)
  const prevStart = new Date(+start - 7 * DAY)
  return { week: isoWeek(start), prevWeek: isoWeek(prevStart), prevStart, start, end }
}

/** YYYY-MM-DD for each day in [from, to). */
export function days(from, to) {
  const out = []
  for (let t = +from; t < +to; t += DAY) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Relative change, null when there is no base to compare against. */
export function change(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null
  return (cur - prev) / prev
}

export const pct = (x, digits = 0) => (x == null ? 'n/a' : `${(x * 100).toFixed(digits)}%`)

/** "12 (+3, +33% vs last week)" style delta text. */
export function delta(cur, prev) {
  if (cur == null) return 'n/a'
  if (prev == null) return String(cur)
  const diff = cur - prev
  const c = change(cur, prev)
  const sign = diff > 0 ? '+' : ''
  return `${cur} (${sign}${round(diff)}${c == null ? '' : `, ${sign}${pct(c)}`} vs last week)`
}

export const round = (x, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp

/**
 * One thing to fix: the biggest leak. Candidates are
 *   a) each funnel step vs the step before it (drop = 1 - next/prev), and
 *   b) each funnel step vs the same step last week (drop = 1 - cur/prev).
 * Only steps with a value this week, and a base of at least 1, count. The
 * largest drop wins; ties go to the earlier step (fix the top of the funnel
 * first). Returns null when nothing is comparable.
 */
export function pickLeak(steps) {
  const cands = []
  const have = steps.filter(s => s.value != null)
  for (let i = 1; i < have.length; i++) {
    const a = have[i - 1], b = have[i]
    if (a.value >= 1) cands.push({ kind: 'step', from: a.label, to: b.label, base: a.value, value: b.value, drop: 1 - b.value / a.value, order: i })
  }
  have.forEach((s, i) => {
    if (s.prev != null && s.prev >= 1 && s.value < s.prev) cands.push({ kind: 'wow', to: s.label, base: s.prev, value: s.value, drop: 1 - s.value / s.prev, order: i })
  })
  if (!cands.length) {
    // Nothing comparable. If the first connected step is empty, nothing enters the funnel: that is the leak.
    const first = have[0]
    return first && first.value === 0 ? { kind: 'empty', to: first.label, value: 0, base: first.prev ?? 0, prev: first.prev ?? null, drop: 1, order: 0 } : null
  }
  return cands.reduce((best, c) => (c.drop > best.drop + 1e-12 || (Math.abs(c.drop - best.drop) <= 1e-12 && c.order < best.order) ? c : best))
}

export function leakSentence(leak) {
  if (!leak) return 'Not enough connected funnel data to compare steps yet.'
  if (leak.kind === 'empty') {
    return `**${leak.to}: 0 this week${leak.prev != null ? ` (${leak.prev} last week)` : ''}.** Nothing enters the funnel at this step, so getting people in is the one thing to fix; no later step can improve until it does.`
  }
  const small = leak.base < 20 ? ` Small sample (base ${leak.base}), so treat it as a signal, not proof.` : ''
  if (leak.kind === 'step') {
    return `**${leak.from} -> ${leak.to}**: only ${leak.value} of ${leak.base} made it (${pct(1 - leak.drop, 1)} conversion, ${pct(leak.drop, 1)} lost). This is the biggest drop in the funnel this week.${small}`
  }
  return `**${leak.to}** fell from ${leak.base} last week to ${leak.value} this week (${pct(-leak.drop, 1)}). This is the biggest week-over-week fall in the funnel.${small}`
}

/** Parse a delimited text file (header row first) into objects. Handles quoted fields. */
export function parseDelimited(text, sep) {
  text = text.replace(/^﻿/, '')
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') q = false
      else field += ch
    } else if (ch === '"' && field === '') q = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  const [head = [], ...body] = rows
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/** Play bulk reports are UTF-16LE with a BOM; everything else is UTF-8. */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  return buf.toString('utf8')
}

export const num = v => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Sum `field` over rows whose date (YYYY-MM-DD) falls in [from, to). */
export function sumInWindow(rows, dateKey, field, from, to, keep = () => true) {
  const a = from.toISOString().slice(0, 10), b = to.toISOString().slice(0, 10)
  return rows.reduce((s, r) => (r[dateKey] >= a && r[dateKey] < b && keep(r) ? s + num(r[field]) : s), 0)
}

/**
 * Progress toward a count target by a deadline, from `asOf`. Required pace is
 * given both as a flat number per week and as compound weekly growth.
 */
export function goalProgress(current, target, asOf, deadline) {
  const daysLeft = Math.max(0, Math.ceil((+deadline - +asOf) / DAY))
  const weeksLeft = daysLeft / 7
  const gap = Math.max(0, target - current)
  return {
    current, target, progress: current / target, daysLeft, gap,
    perWeek: weeksLeft > 0 ? gap / weeksLeft : null,
    weeklyGrowth: weeksLeft > 0 && current > 0 ? (target / current) ** (1 / weeksLeft) - 1 : null,
  }
}
