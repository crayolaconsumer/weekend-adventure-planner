import { isNative } from '../utils/nativeBridge'
import { isNativeAdAvailable } from '../utils/nativeAd'
import { isAdSenseConfigured, ADSENSE_SLOT_CARD } from '../utils/adSense'

// Interval for inserting sponsored cards (every N regular cards)
export const SPONSORED_INTERVAL = 8

/**
 * Whether ad cards may fill empty sponsored slots. Premium users, and
 * everyone while auth is still resolving (isPremium reads false then),
 * get none. Native needs the RoamNativeAd plugin; web needs the AdSense
 * client + card slot IDs.
 */
export function adCardsEnabled({ isPremium, authLoading }) {
  if (isPremium || authLoading) return false
  if (isNative()) return isNativeAdAvailable()
  return isAdSenseConfigured() && Boolean(ADSENSE_SLOT_CARD)
}

/**
 * Merge regular places with sponsored cards. After every
 * SPONSORED_INTERVAL regular cards: a promoter card if one is left, else
 * an ad slot { isAd, slot: 'ad-<k>' } when ads are enabled. Slot ids are
 * keyed by insertion point k (plus the deck number after the first deck),
 * so they stay stable within a deck.
 * Slots in removedSlots (no fill) are left out, and so are slots before
 * adsFromIndex (ads switched on mid-deck must not shift passed cards).
 * Slots in keptSlots stay even with ads off: ads switched off mid-deck
 * (auth check failed, upgrade) must not shift passed cards either.
 */
export function mergeCards({
  places,
  sponsoredPlaces = [],
  isPremium = false,
  adsEnabled = false,
  removedSlots = new Set(),
  adsFromIndex = 0,
  keptSlots = new Set(),
  deck = 0,
  mapPlace = (p) => p,
}) {
  // Premium subscribers see no ads (per the Pricing page's "no ads, ever"
  // promise). App Store rejection-risk if a paying user still sees
  // sponsored cards on review.
  const promoters = isPremium ? [] : (sponsoredPlaces || [])
  const withAds = adsEnabled && !isPremium
  if (promoters.length === 0 && !withAds && keptSlots.size === 0) {
    return places.map(p => ({ place: mapPlace(p), isSponsored: false }))
  }

  const result = []
  let sponsoredIndex = 0

  for (let i = 0; i < places.length; i++) {
    result.push({ place: mapPlace(places[i]), isSponsored: false })

    if ((i + 1) % SPONSORED_INTERVAL !== 0) continue

    if (sponsoredIndex < promoters.length) {
      const sponsored = promoters[sponsoredIndex]
      result.push({
        place: mapPlace(sponsored.place),
        isSponsored: true,
        sponsoredData: sponsored
      })
      sponsoredIndex++
    } else {
      // Unique per deck, so a native ad still loading for an old deck can
      // be released without touching the new deck's slot of the same k
      const k = (i + 1) / SPONSORED_INTERVAL
      const slot = deck ? `ad-${k}.${deck}` : `ad-${k}`
      const inWindow = keptSlots.has(slot) || (withAds && result.length >= adsFromIndex)
      if (inWindow && !removedSlots.has(slot)) result.push({ isAd: true, slot })
    }
  }

  return result
}

/**
 * Ad slots that must collapse now: any at or after currentIndex that came
 * back unfilled, any ahead of the top that expired, plus the top card if
 * it is an ad not yet filled. Slots
 * before currentIndex never change, so passed indices stay stable.
 * pendingTopOk (web): the ad is only requested once on top, so a top ad
 * may still be loading; AdCard reports 'unfilled' if it misses its window.
 */
export function slotsToRemove(cards, currentIndex, statuses, pendingTopOk = false) {
  const out = []
  for (let i = currentIndex; i < cards.length; i++) {
    const card = cards[i]
    if (!card.isAd) continue
    const status = statuses[card.slot]
    // 'expired' (native ad too old to show): drop it while still ahead; one
    // that expired while on top has already been seen, so it stays
    const ready = status === 'filled' || status === 'expired'
    const topNotReady = i === currentIndex && !ready && !pendingTopOk
    const stale = status === 'expired' && i > currentIndex
    if (status === 'unfilled' || stale || topNotReady) out.push(card.slot)
  }
  return out
}

/** next only adds places after prev's (load-more), same ids in the same order */
export function isAppend(prev, next) {
  return next.length >= prev.length && prev.every((p, i) => next[i]?.id === p.id)
}
