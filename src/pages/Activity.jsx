/**
 * Activity Page
 *
 * Shows activity feed from followed users and user discovery
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useDiscoverUsers } from '../hooks/useSocial'
import ActivityFeed from '../components/ActivityFeed'
import UserCard, { UserCardSkeleton } from '../components/UserCard'
import './Activity.css'

export default function Activity() {
  const { isAuthenticated, user } = useAuth()
  const [activeTab, setActiveTab] = useState('feed')
  const { users: discoveredUsers, loading: discoverLoading, refresh: refreshDiscover } = useDiscoverUsers()

  return (
    <div className="page activity-page">
      <header className="page-header">
        <h1 className="page-title">Activity</h1>
      </header>

      {/* Tabs */}
      <div className="activity-tabs">
        <button
          className={`activity-tab ${activeTab === 'feed' ? 'active' : ''}`}
          onClick={() => setActiveTab('feed')}
        >
          Feed
        </button>
        <button
          className={`activity-tab ${activeTab === 'discover' ? 'active' : ''}`}
          onClick={() => setActiveTab('discover')}
        >
          Discover
        </button>
      </div>

      <div className="activity-content">
        {activeTab === 'feed' ? (
          isAuthenticated ? (
            <ActivityFeed />
          ) : (
            <div className="activity-login-prompt">
              <div className="activity-login-prompt-icon">🔐</div>
              <h2>Sign in to see your feed</h2>
              <p>Follow other explorers to see their tips and discoveries here.</p>
              <Link to="/profile" className="activity-login-prompt-btn">
                Sign In
              </Link>
            </div>
          )
        ) : (
          <DiscoverSection
            users={discoveredUsers}
            loading={discoverLoading}
            onRefresh={refreshDiscover}
            currentUserId={user?.id}
          />
        )}
      </div>
    </div>
  )
}

function DiscoverSection({ users, loading, onRefresh, currentUserId }) {
  if (loading && users.length === 0) {
    return (
      <div className="discover-section">
        <div className="discover-header">
          <h2>People to Follow</h2>
        </div>
        <div className="user-card-list">
          {[...Array(5)].map((_, i) => (
            <UserCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="discover-section">
        <div className="discover-empty">
          <span className="discover-empty-icon">👥</span>
          <h3>No recommendations yet</h3>
          <p>Start exploring and saving places to get personalized recommendations!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="discover-section">
      <div className="discover-header">
        <h2>People to Follow</h2>
        <button className="discover-refresh" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <p className="discover-subtitle">
        Based on your saved places and interests
      </p>

      <motion.div
        className="user-card-list"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {users.filter(u => u.id !== currentUserId).map((user, index) => (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <UserCard
              user={user}
              showStats
              showReason
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
