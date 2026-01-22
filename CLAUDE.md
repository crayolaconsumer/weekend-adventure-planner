# ROAM — AI Agent Context

> **Read `/docs/ROADMAP.md` for the full project plan and detailed instructions.**

## Quick Context

ROAM is a local discovery app ("Tinder for places") being developed into a community-driven platform.

**Current Phase**: Phase 1 complete (PWA), starting Phase 2 (Supabase backend)

**Vision**: Users tell each other why places matter through contributions and votes

## Before You Start

1. Read [docs/ROADMAP.md](docs/ROADMAP.md) — contains full plan, change log, and detailed instructions
2. Check git history: `git log --oneline -10`
3. Understand where we are in the phased rollout

## Key Decisions (Already Made)

- **Community curation** — Not editorial (we don't have expertise)
- **Supabase backend** — Postgres, auth, realtime
- **UK-wide scope** — No geographic limits initially
- **Pseudonymous accounts** — @username style

## Tech Stack

- React 19 + Vite
- Framer Motion (animations)
- Vercel (hosting + serverless)
- Supabase (coming: database + auth)

## File Structure

```
src/
├── components/    # UI components (SwipeCard, PlaceDetail, etc.)
├── pages/         # Route pages (Home, Events, Saved)
├── hooks/         # Custom hooks
├── utils/         # API client, filters, helpers
└── contexts/      # React contexts (future: AuthContext)
```

## When Done Working

1. Update the change log in `/docs/ROADMAP.md`
2. Commit with clear messages
3. Note any blockers or decisions for next session
