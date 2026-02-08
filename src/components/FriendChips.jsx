/**
 * FriendChips Component
 *
 * Shows avatar chips for friends who have saved or visited a place.
 * Displays up to 3 avatars with a count if more friends engaged.
 */

import { memo } from 'react'
import './FriendChips.css'

function FriendChips({ placeId, friendActivity }) {
  // Don't render if no friend activity
  if (!friendActivity || friendActivity.friendCount === 0) {
    return null
  }

  // Combine saved and visited friends, dedupe by ID
  const friendMap = new Map()

  // Add saved friends
  if (friendActivity.friendsSaved) {
    friendActivity.friendsSaved.forEach(friend => {
      if (!friendMap.has(friend.id)) {
        friendMap.set(friend.id, { ...friend, action: 'saved' })
      }
    })
  }

  // Add visited friends (may overlap with saved)
  if (friendActivity.friendsVisited) {
    friendActivity.friendsVisited.forEach(friend => {
      const existing = friendMap.get(friend.id)
      if (existing) {
        // Friend both saved and visited - mark as visited (stronger signal)
        existing.action = 'visited'
        existing.recommended = friend.recommended
      } else {
        friendMap.set(friend.id, { ...friend, action: 'visited' })
      }
    })
  }

  const friends = Array.from(friendMap.values()).slice(0, 3)
  const extraCount = friendActivity.friendCount - friends.length

  // Determine the label
  let label = ''
  const hasVisited = friendActivity.friendsVisited?.length > 0
  const recommended = friendActivity.friendsVisited?.some(f => f.recommended)

  if (recommended) {
    label = friendActivity.friendCount === 1 ? 'friend recommends' : 'friends recommend'
  } else if (hasVisited) {
    label = friendActivity.friendCount === 1 ? 'friend visited' : 'friends visited'
  } else {
    label = friendActivity.friendCount === 1 ? 'friend saved' : 'friends saved'
  }

  return (
    <div className="friend-chips" role="group" aria-label={`${friendActivity.friendCount} ${label}`}>
      <div className="friend-chips-avatars">
        {friends.map((friend, index) => (
          <img
            key={friend.id}
            src={friend.avatarUrl || '/default-avatar.png'}
            alt={friend.username}
            className="friend-chips-avatar"
            style={{ zIndex: friends.length - index }}
            title={friend.username}
          />
        ))}
      </div>
      <span className="friend-chips-text">
        {extraCount > 0 && `+${extraCount} `}
        {label}
      </span>
    </div>
  )
}

// Memoize to prevent unnecessary re-renders
export default memo(FriendChips)
