# Tambola Demo

A Tambola (Housie) number caller for Android, built as a demo. It calls 1–90 aloud like any caller app, but it can be set so that the numbers on a chosen ticket are all called within the first N calls (55 by default) of selected games.

> Native Android app (Kotlin). Unlike the other apps in this repo it is **not** a web app: no `package.json`, not built by `scripts/build-site.mjs`, not published to GitHub Pages and not listed in the root `index.html`.

## Features

### Game screen (what everyone sees)
- Calls numbers 1–90, each once, and speaks only the number ("one", "forty-two"), with no rhyme or text before it.
- Big current number, call count (e.g. "Call 23 / 90"), the last 5 numbers and a 1–90 board with called numbers filled in.
- Voice loudness slider, 50–200% (saved). Above 100% boosts the voice past the phone's media volume; letting go of the slider while paused says a sample number. The phone's volume buttons change media volume while the app is open.
- Speed toggle: **Slow / Medium / Fast**. Fast calls the numbers very quickly, and the voice speeds up so numbers never overlap.
- Pause / Resume and New game. After call 90 it shows "Game over" and a button to start the next game.
- Nothing on the screen shows whether a game is a ticket game, so every game looks the same.

### Hidden admin panel
- Opened by tapping the **"Tambola"** title **4 times within 2 seconds**. Slower taps or fewer than 4 do nothing, and there is no ripple, sound or hint.
- Opening it pauses the game. Back returns to the game, still paused.
- Changes take effect from the **next** game, so the game in progress is not disturbed.
- Two tabs: **Tickets** and **Settings**.

### Tickets (hidden panel)
- Add ticket photos from the gallery, several at once. Each photo holds one ticket.
- Each ticket is scanned on the device as soon as it's added, with no internet. A ticket can have 14, 15 or 16 numbers, and small scan errors are acceptable.
- Shows each ticket's thumbnail, how many numbers were read and the numbers by row.
- Delete one ticket or all tickets.

### Settings (hidden panel)
- **Ticket games:** a start game and a gap (default: start at game 1, every 2nd game, which gives games 1, 3, 5, 7, 9…). Tickets are used one per game, in upload order. A live preview shows which games will use tickets.
- **Ticket finish:** a ticket game calls all the ticket's numbers within the first N calls (default 55, allowed 25–90).
- **Speeds:** seconds between calls for Slow, Medium and Fast (default 6 / 3 / 1, minimum about 0.8).
- **Game counter:** shows the next game number, with **Reset to 1**.

### How a ticket game calls numbers
- All of that ticket's numbers are called within the first N calls (Settings → Ticket finish, default 55, allowed 25–90), mixed in with other numbers.
- The ticket's numbers take turns between its rows (row 1, row 2, row 3, row 1, …).
- The ticket's last number comes at a random call from N−10 to N (45–55 by default), so it doesn't finish at the same call every game.
- Calls after that are the remaining numbers in random order.

### Random games
- Games not in the pattern are fully random.
- Once every uploaded ticket has been used, all later games are fully random.
- With no tickets uploaded, every game is fully random.

### Saved between sessions
- Tickets, game number, pattern and speeds are kept when the app is closed and reopened.
