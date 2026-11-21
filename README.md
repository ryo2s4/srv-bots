# srv-bots

Source of the Discord bots deployed on the home server. Runtime data, `.env`
files, `node_modules/` and audio are **not** stored here — the deploy tool syncs
only the tracked files into `~/bots/<name>/` and never touches those paths.

## Layout

- `luna/` — the main bot (code only).
- `religion/` — the Quran bot (code only).

## Deploy

The server clones this repo to `~/src/srv-bots`. Pressing **PULL** in the control
UI (`http://localhost:8787`) pulls this repo, syncs tracked files into each bot,
restarts the bots, and rolls back automatically on failure.

Manual equivalent on the server:

```sh
git -C ~/src/srv-bots pull --ff-only
systemctl --user restart discord-bot@luna discord-bot@religion
```
