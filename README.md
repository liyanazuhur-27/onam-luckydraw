# Onam Lucky Draw

Standalone React/Vite app for the Onam lucky draw.

## Run

```powershell
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Flow

1. Upload the final Excel from the `Coupon Master` sheet.
2. The app uses only Coupon Number, Name and Flat No.
3. Coupons 1–20 are currently treated as test coupons and excluded.
4. Duplicate coupon numbers are reassigned to the next unused number above the current maximum; the original number is preserved internally.
5. Enter stage mode.
6. Press Space to draw Winner 1, then Space/Next Winner for Winner 2 and 3.
7. When a person wins, all of that person's coupon entries are removed from the remaining pool.

## Controls

- Space: start/next winner
- R: reset
- F: fullscreen
- M: mute

This version intentionally avoids third-party animation libraries; the reel presentation is implemented with React state and CSS so the event build has fewer moving parts.
