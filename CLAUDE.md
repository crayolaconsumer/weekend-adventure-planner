# ROAM — AI Agent Context

## STOP. READ THIS ENTIRE FILE BEFORE DOING ANYTHING.

This file exists because past sessions have caused problems by:
- Hallucinating database credentials
- Claiming features were complete when they weren't
- Creating components but not integrating them
- Wasting tokens and the user's time

**If you are resuming from compaction, you have lost context. DO NOT ASSUME ANYTHING.**

---

## MANDATORY PROCEDURES

### Before Claiming ANY Feature Is Complete

**RUN THE VERIFICATION SCRIPT:**
```bash
./scripts/verify-feature.sh FeatureName
```

This script checks:
1. Component file exists
2. Component is imported somewhere
3. Component is rendered (JSX tag found)
4. Related API files
5. Related hooks
6. Build succeeds

**If ANY check fails, the feature is NOT complete. Don't claim otherwise.**

For database tables, also run:
```
mcp__mysql-roam__mysql_list_tables
```

### Database Access

**Database:** `plesk_go-roam` on AWS RDS (MySQL)

**To find credentials:**
1. Check `.claude/settings.local.json` - credentials are in the allowed Bash commands
2. Or ask the user directly

**To connect:**
```
mcp__mysql-roam__mysql_connect with host, user, password, database, port parameters
```

**CRITICAL RULES:**
- DO NOT GUESS OR MAKE UP CREDENTIALS
- DO NOT USE "localhost", "root", "password", or any default values
- If you can't find credentials, ASK THE USER
- If connection fails, TELL THE USER - don't try random alternatives

### When You Don't Know Something

1. **Don't guess** - Ask the user
2. **Don't assume** - Check the code
3. **Don't hallucinate** - If you're unsure, say "I don't know"

---

## PROJECT STATE

### What Exists (Verified)
- MySQL database with 30 tables (verified via MCP)
- React 19 + Vite frontend
- Vercel serverless API routes
- Auth system (JWT + Google OAuth)
- NotificationBell in app header (App.jsx)
- Push notification infrastructure (api/lib/pushNotifications.js)
- Photo upload to Vercel Blob (api/contributions/upload.js)

### Environment Variables (in Vercel)
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (for web push)
- BLOB_READ_WRITE_TOKEN (for photo uploads)
- MySQL credentials (MYSQL_HOST, MYSQL_USER, etc.)
- JWT_SECRET, GOOGLE_CLIENT_ID, etc.

---

## TECH STACK

- React 19 + Vite
- Framer Motion (animations)
- Vercel (hosting + serverless API)
- MySQL (AWS RDS via Plesk)
- Web Push (VAPID)
- Vercel Blob (photos)

## FILE STRUCTURE

```
src/
├── components/    # UI components
├── pages/         # Route pages
├── hooks/         # Custom hooks
├── utils/         # Helpers
└── contexts/      # AuthContext

api/
├── auth/          # Login, register, OAuth
├── contributions/ # Tips, photos, votes
├── notifications/ # In-app notifications
├── places/        # Saved, ratings, swiped
├── social/        # Follows, requests, blocks
├── users/         # Profiles, preferences, stats
└── lib/           # Shared: auth.js, db.js, validation.js, rateLimit.js, pushNotifications.js

database/
└── schema.sql     # MySQL schema (source of truth for table structure)
```

---

## PAST MISTAKES (DO NOT REPEAT)

1. **NotificationBell orphaned** - Created component, put it only in Activity.jsx (a page users rarely visit), not in main nav. Users couldn't find notifications.

2. **PhotoUpload orphaned** - Created component and CSS, never imported it into VisitedPrompt where it was supposed to go.

3. **Push notifications not wired** - Created sendPushToUser(), notifyNewFollower(), etc. but never called them from any API endpoint. Functions existed but were dead code.

4. **Hallucinated DB credentials** - Made up credentials like "roam_user@localhost" that didn't exist, wasting time debugging fake connection errors.

5. **Premature "complete" claims** - Said "feature complete" multiple times when critical pieces were missing. User had to repeatedly push back.

---

## COMMUNICATION RULES

- Don't say "feature complete" unless you've run the verification checklist
- Don't say "everything works" without testing
- If unsure, say "I need to verify X before confirming"
- Be honest about what you don't know
- Admit mistakes immediately when caught

---

## DOCS

- Full roadmap: `/docs/ROADMAP.md`
- Audit findings: `/documents/VERIFIED_AUDIT_FINDINGS.md`
- Schema: `/database/schema.sql`
