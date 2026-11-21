# Discord Bot — Religion (جلسات التلاوة)

Arabic Quran recitation sessions bot. Schedules voice-channel recitation sessions,
tracks reading progress toward a full 604-page khutma, and runs a points/shop/quiz economy.

**Reworked (v2):** single-file `bot.js` + fragile `storage.json` → multi-file structure + SQLite.

## Commands

- `/telawa` — schedule a recitation session (voice channel, start delay, duration, start/end/progress channels). The bot joins the voice channel (self-muted) at start time, reminds everyone 5 min before, and posts a summary at the end.
- `/join_session` / `/leave_session` — sign up for / drop out of the next session
- `/log_reading <pages>` — log pages read → +2 points/page, daily streak tracking
- `/progress` — khutma progress, streak, points, owned shop items
- `/points` — current points
- `/shop` + `/buy <item_id>` — buy rank titles with points
- `/quiz` + `/answer <text>` — religious quiz, +10 points for a correct answer
- `/owner` — owner-only panel (ban / unban modals, server list); owner ID in `.env` (`OWNER_ID`)

## Structure

```
src/
├── index.js           # entry: client, intents, command registration, error handling
├── config.js          # constants + env (owner ID, durations, colors)
├── db.js              # SQLite init + schema (WAL)
├── store.js           # data access: users / sessions / quizzes
├── util.js            # date + progress helpers
├── constants.js       # shop items, quiz question bank
├── sessionService.js  # telawa lifecycle: timers, reminder, begin/end, boot recovery
└── commands/          # one file per slash command + owner button/modal handlers
```

## Run

```bash
npm install
npm start            # or: npm run dev (nodemon)
```

## Data

SQLite database at `data/bot.db` (WAL mode, atomic writes — replaces the old `storage.json`).
Sessions are cleaned up on end and stale ones (bot offline during a session) are
auto-abandoned on boot. Old `storage.json` is kept as a legacy artifact and unused.
