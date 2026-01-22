# ROAM Events API Setup Guide

This guide walks you through setting up API keys for the Events feature in ROAM.

---

## Quick Start

Add your API keys to `.env.local` in the project root:

```bash
# Recommended - Ticketmaster has the best free tier
VITE_TICKETMASTER_KEY=your_key_here

# Optional - UK-focused events (clubs, festivals)
VITE_SKIDDLE_KEY=your_key_here
```

Then restart the dev server: `npm run dev`

---

## 1. Ticketmaster Discovery API (Recommended)

**Best for:** Concerts, sports, theatre, comedy, family events

**Free tier:** 5,000 requests/day, 5 requests/second

### Setup Steps

1. Go to [developer.ticketmaster.com](https://developer.ticketmaster.com/)

2. Click **"Get Started"** or **"Sign Up"**

3. Create an account (email verification required)

4. Once logged in, go to **"My Apps"** in the top navigation

5. Click **"Create New App"**
   - App Name: `ROAM Local Discovery`
   - App Description: `Personal local events discovery app`
   - App URL: `http://localhost:5173` (or your domain)

6. After creating, you'll see your **Consumer Key** - this is your API key

7. Add to `.env.local`:
   ```
   VITE_TICKETMASTER_KEY=your_consumer_key_here
   ```

### Verify It Works

Check the browser console - you should see events loading without 401 errors.

### Rate Limits

| Limit | Value |
|-------|-------|
| Daily requests | 5,000 |
| Requests per second | 5 |
| Deep paging limit | 1,000 items |

The app caches results for 30 minutes to stay well under limits.

---

## 2. Skiddle API (UK Events)

**Best for:** Clubbing, festivals, live music, nightlife (UK focused)

**Free tier:** Unspecified limits (contact for high volume)

### Setup Steps

1. Go to [skiddle.com/api/join.php](https://www.skiddle.com/api/join.php)

2. Fill in the registration form:
   - Name
   - Email
   - Company/Project: `ROAM - Personal Project`
   - Intended Use: `Local events discovery for personal use`

3. Check your email for the API key (usually arrives within minutes)

4. Add to `.env.local`:
   ```
   VITE_SKIDDLE_KEY=your_api_key_here
   ```

### Verify It Works

Look for Skiddle-sourced events (orange badge) in the Events tab.

### Rate Limits

Skiddle doesn't publish specific limits but monitors usage. The app's 30-minute cache keeps requests minimal.

---

## Troubleshooting

### No events showing

1. Check browser console for API errors
2. Verify your location is set (UK locations have best coverage)
3. Ensure at least one API key is configured
4. Try widening your search radius in the app

### 401 Unauthorized

Your API key is invalid or expired. Double-check the key in `.env.local`.

### 429 Too Many Requests

You've hit rate limits. The app should automatically use cached data. Wait a few minutes before retrying.

### Events not updating

The app caches events for 30 minutes. Click the refresh button to force a new fetch (respects rate limits).

---

## API Coverage by Region

| Region | Ticketmaster | Skiddle |
|--------|--------------|---------|
| UK | Excellent | Excellent |
| Europe | Good | Limited | Limited |
| North America | Excellent | None | Limited |
| Australia | Good | None | Limited |

---

## Security Notes

- Never commit `.env.local` to git (it's in `.gitignore`)
- API keys are exposed in browser network requests (this is normal for client-side apps)
- All APIs use HTTPS for secure transmission
- The app implements caching to minimize API calls

---

## Need Help?

- Ticketmaster: [developer.ticketmaster.com/support](https://developer.ticketmaster.com/support/)
- Skiddle: [skiddle.com/api](https://www.skiddle.com/api/)
