# Data Fetching Improvements

## Issues Fixed

### 1. **Increased JSONP Timeout from 15s to 30s**
- **File**: `index.html:346`
- **Change**: `const wd = setTimeout(fail, 30000);` (was 15000)
- **Why**: Corporate networks and slow connections often need more than 15 seconds. Users were seeing timeout errors unnecessarily.

### 2. **Added Explicit Error Messages & Error State UI**
- **File**: `index.html:49-55` (UI), `index.html:253-258` (state), `index.html:516-517` (renderVals)
- **Changes**:
  - New state fields: `error` and `cachedStats`
  - Error alert box shows users what went wrong with specific guidance
  - Different error messages for directory vs. stats fetch failures
- **Why**: Users previously saw only "Server warming up — tap ↻ Sync" which was confusing. Now they get actionable error messages.

### 3. **Local Caching of Team Stats**
- **File**: `index.html:380-409` (fetchStats), `index.html:280-307` (componentDidMount), `index.html:543-551` (onCoachChange)
- **Changes**:
  - Stats are now stored in `localStorage` under key `ayso154_stats_${teamCode}`
  - On page load, cached stats are restored immediately (users see old data vs. blank page)
  - When fetch fails, cached data is shown with error message "Using cached data — could not reach server"
- **Why**: If the Google Apps Script API is temporarily down or blocked, users see last-known data instead of a blank page.

### 4. **Improved Error Handling in JSONP Requests**
- **File**: `index.html:309-363` (jsonp method)
- **Changes**:
  - Console logging for each retry attempt with endpoint and call type
  - Different error handling for stats vs. directory calls
  - More specific error messages based on what failed
  - Script load errors now logged with context
- **Why**: Admins and support can now debug issues by checking browser console. Users get better error clarity.

### 5. **Graceful Fallback Strategy**
- **File**: `index.html:365-378` (fetchDirectory), `index.html:365-378` (fetchStats)
- **Changes**:
  - Directory fetch uses `STATIC_TEAMS` fallback (already existed)
  - Stats fetch now shows cached data or error message instead of blank
  - Error messages explain what users should do next
- **Why**: The dashboard is now functional even when the Google Apps Script endpoint is unavailable.

### 6. **Clear Error State When Switching Teams**
- **File**: `index.html:499`, `index.html:492`, `index.html:543-551`
- **Changes**:
  - Error is cleared when user changes division or coach selection
  - Cached stats are pre-loaded for the newly selected team
- **Why**: Users can retry with a fresh attempt by switching teams, reducing frustration.

## Console Logging Added

The dashboard now logs to the browser console for troubleshooting:

```javascript
console.warn(`[AYSO Dashboard] Fetch attempt ${retry + 1}/3 failed, retrying...`)
console.error(`[AYSO Dashboard] Fetch failed after 3 retries`)
console.warn('[AYSO Dashboard] Directory fetch returned empty, using cached data')
console.warn('[AYSO Dashboard] Stats fetch returned empty for', teamCode)
console.log('[AYSO Dashboard] Showing cached stats')
console.error('[AYSO Dashboard] Script load error')
```

Users or admins can press `F12` → Console tab to see these messages and understand why the dashboard isn't loading.

## Testing Recommendations

1. **Test offline**: Unplug internet or use Chrome DevTools network throttling to simulate a network failure. Stats should show "Using cached data" message.

2. **Test slow networks**: Use Chrome DevTools network throttling (slow 3G) to simulate a slow network. Verify the 30-second timeout doesn't trigger unnecessarily.

3. **Test API unavailability**: Go to DevTools → Network → add request blocker for the Google Apps Script domain to simulate a firewall/CORS block. Verify:
   - Directory picker loads with static team list
   - Stats show cached data with error message
   - Error message is actionable

4. **Test cache clearing**: Open DevTools → Application → Local Storage → Clear site data, then reload. Page should ask user to pick a team again.

5. **Check console logs**: Press F12 and verify console messages appear when fetching happens.

## Files Changed

- `index.html`: All changes are in the embedded `<script type="text/x-dc">` block (lines 202-563)
- `support.js`: No changes (this is a generated runtime file)

## Backward Compatibility

All changes are backward compatible. Existing users' localStorage caches will continue to work.
