# Star Citizen Insights

A Windows app that reads the `Game.log` files Star Citizen writes and turns them into stability, performance, loading, combat, ship and mission insights. Everything runs on your PC; nothing is uploaded, and the app only listens on `127.0.0.1`.

*Unofficial fan project, not affiliated with the Cloud Imperium group of companies. Star Citizen® is a registered trademark of Cloud Imperium Rights LLC.*

## For players

1. Download `StarCitizenInsights.exe`.
2. Double-click it. It opens in its own window.
3. The first start reads all your logs, which takes a minute or less. Later starts only read new sessions.

Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info**, then **Run anyway**. Some antivirus tools are wary of unsigned apps built this way; the source is in this repository if you want to check it or build it yourself.

The app finds Star Citizen through the RSI Launcher's log and the usual install folders on every drive. If it can't, it asks you to choose the `StarCitizen` folder (the one that holds `LIVE` and `PTU`). You can switch folders any time with **Change folder** at the bottom of the window.

It keeps its cache and settings in `%LOCALAPPDATA%\StarCitizenInsights`. To remove the app, delete the `.exe` and that folder. The app quits on its own about two minutes after you close its window. Press **Rescan logs** after a play session to add it.

Needs Windows 10 or 11 with Microsoft Edge (installed by default). Without Edge it opens in your default browser.

## Pages

- **Live**: the session you're playing, refreshed every 15 seconds: server health, server fps, players on the shard and on your game server, ping, packet loss, hitches, server restarts, the game servers on your shard with a shard health score, which server you were on where, and this session's contracts and events.
- **Journey**: where you were during a session, on a 3D map of the star system, with the stops you made and the trips between them (quantum travel, jumps, flights) in a timeline beside it. Planets and moons open as a globe with the named places on them. A time slider shows where you were at any moment. As on the game's star map: left-drag to turn and tilt, right-drag to move, the wheel to zoom.
- **Overview**: hours per month with hardware changes marked, a calendar of every day you played, when you play, which systems you load into, where you spend time.
- **Stability**: crash or freeze rate by patch, graphics driver, renderer, GPU and CPU; crash types from the game's crash reports; how far into a session crashes happen; a list of every crash.
- **Performance**: frame rate per month, by star system, hardware and patch; frame-time mix; memory use. From the frame-rate summary the game writes each time you leave a world. Video memory (VRAM) isn't in the logs; it comes from the info overlay (see below).
- **Loading & servers**: loading-screen times, server regions, relogs, disconnect reasons, server response times.
- **Shards & servers**: every shard you've joined with time on it and crash rate, every game server you've been on with its fps and health, server fps by hour of the day and health by region.
- **Combat**: ship combat vs on foot against NPCs vs players, PvP kills and deaths per month, top weapons for each, who you fight, where, how you died, ships you destroyed, anonymous rivals, your biggest combat sessions.
- **Ships**: flights per ship and manufacturer, timed hours, quantum jumps, ships lost, a ship log.
- **Missions & money**: contracts over time and by name, shop spending by month and category, biggest purchases and whether the shop confirmed them.
- **Sessions**: every session, searchable; click one for its timeline and frame-rate summaries.

The **LIVE / PTU / All builds** switch and the period picker filter every page.

## Live server status

Server fps, player counts, ping, packet loss and which game server you're on aren't in any log file; the game only shows them on its info overlay. To get them:

1. In the game console (`~`), type `r_displayinfo 3`. If your `USER.cfg` contains `r_displayinfo = 0`, the overlay starts hidden every time; change it to `3` or type the command each session. The Live tab tells you when this is the case.
2. Play in borderless or windowed mode.

While Star Citizen runs and is the window in front, the app copies the overlay's corner of the screen (about 720 × 320 pixels) and reads its text with Windows' built-in text recognition. It never reads the game's memory or files other than its logs; it reads screen pixels, like streaming software does. The images aren't kept, only the numbers.

- Every 15 seconds by default; you can pick 10, 15, 30 or 60 seconds, or switch it off, on the Live tab.
- Each read takes about 100–250 ms of CPU on one core while the game runs. The reader uses about 150 MB of memory, and only while the game runs. In testing, the game's own frame-time statistics showed no added stutter.
- In a ship, its name banner covers part of the overlay. When a read misses something, the app looks at the same capture once or twice more: once keeping only the colored text (the server fps line turns yellow or orange when the server struggles), then with everything behind the overlay's text painted out (the overlay's text has a black shadow, the banner doesn't). Such a read costs about 350–500 ms of CPU, so at the 10-second setting reading uses up to about 5% of one core while you sit in a ship.
- Numbers that don't add up are dropped rather than shown: a server fps whose frame times disagree with it, a player count that jumps several-fold within minutes. A player count the app couldn't read is taken from the last reading that had it: within 2 minutes for your game server, 5 for the shard.
- Where you were comes from the overlay's location line (a station, or open space near a Lagrange point) when it's readable, otherwise from the last place the game logged you opening an inventory, as long as you haven't changed game server since.
- Reading pauses while the game is minimized or behind another window.
- The app keeps running in the background while the game is open, so a session is recorded even if you close the app window.
- Each reading also keeps the game's memory use from the overlay: in RAM, reserved, and video memory (VRAM) in use out of what your graphics card has. Game.log only has RAM peaks, so VRAM figures start with version 0.3.0 and cover sessions with the overlay on. A memory figure that changes several-fold within 2 minutes is a misread and is dropped; a session's VRAM peak only counts a value another reading within 2 minutes backs up.
- Readings are stored in `%LOCALAPPDATA%\StarCitizenInsights\overlay\` (one file per month).

## Journey

The top of the overlay is a stack of "Zone … Pos" lines: your position inside your ship, relative to the planet, moon, Lagrange point or jump point you're near, and in the star system. The app keeps the last two with each reading (in km), so it needs no extra screen reading for this.

- OCR garbles a digit now and then. The system position is printed twice and a reading counts when both copies agree, or when another reading within 3 minutes agrees with it, or when it lies on the straight line between two good readings (quantum travel goes in a straight line). The rest are left out.
- A **stop** is 2 minutes or more within 5 km. Near a planet or moon this is measured in the body's own turning frame, so sitting at Grim HEX for an hour is one spot, not an arc around Yela. Stops are named from the overlay's location line, from Game.log seeing you open your inventory there, or from the nearest named place on the planet or moon (within 10 km).
- **Trips** between stops are split into quantum travel (faster than 50 km/s), jumps between systems and flights. A loading screen in between marks a relog or respawn.
- The map is drawn by the app from coordinates; there are no map images. Positions of planets, moons, Lagrange points and named places come from the [starnav](https://crates.io/crates/starnav) community data (MIT, see `THIRD-PARTY-NOTICES.md`), converted with `scripts/make-starmap.js`. In Stanton they match the overlay to the metre. Pyro's Lagrange points there are placed by rule and some are off (Pyro III L1 by about 280,000 km): where your readings show a position to be wrong, the app works out the right one from them, or leaves the marker off. Pyro's jump points are placed where you jumped. The data's Nyx predates the system's current layout, so Nyx shows its star and your track only.
- Positions are stored from version 0.3.0 on, so earlier sessions have no journey.

**Health** of a reading is 60% the server's fps and 40% the lowest fps in the overlay's measuring window, both out of 30 (what game servers run at), minus 2 points per hitch. 80+ is good, 60+ fair, 40+ poor, lower is bad. A **game server's** health is the median of its readings; the **shard's** health is the health of the game servers you've been on in the last two hours, weighted by how many players each one has. Servers you haven't visited can't be seen from your PC.

## What the logs can and can't tell

- Kill, death and ship-destruction lines stop after 12 November 2025; newer game versions don't write them. Deaths after that come from corpse records.
- Flight time is only known from May to November 2025. Later builds log leaving the pilot seat but not taking it, so they count flights but not hours.
- Contract notifications appear from December 2025 on, and are read from English text: players with another game language won't get mission stats.
- The game's GPU-only frame timer sometimes reports impossible values; readings above 1,000 fps are ignored. Memory peaks larger than your PC could hold are ignored too.
- Corrupted logs sometimes repeat an old line hundreds of times; each distinct kill or ship destruction is counted once, and lines dated before their session started are ignored.
- "Unclean" endings are a crash report, or a log that just stops (a freeze, a forced close, or a power loss).

## Privacy

Other players' names are never stored or shown. Players are counted through a short one-way hash so the app can tell them apart ("Player A", "Player B"). Your parsed logs stay in the cache on your PC.

## For developers

Needs [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm start          # run from source and open the window (data in ./data)
npm run scan       # parse all logs from the command line and print totals
npm run build      # build dist/StarCitizenInsights.exe
```

`npm run build` bundles the app with esbuild and packs it into a copy of the Node.js you build with (Node's single executable application feature). It sets the icon and version info with rcedit, removes Node's original signature (changing the file would break it anyway) and switches the .exe to the Windows GUI subsystem so it opens no console.

Options for the server: `--port 4317`, `--root "D:\...\StarCitizen"`, `--no-open` (exe), `--open` and `--exit-when-idle` (source). `SCI_DATA_DIR` sets the data folder; `SCI_NO_DETECT=1` skips auto-detection to try the first-run folder picker.

On your own PC you can also start from source with `Star Citizen Insights.vbs` (no console) or `start.cmd` (with console).

### Layout

- `src/parse-log.js`: turns one `Game.log` into a session record.
- `src/scan.js`: finds logs, parses new or changed ones in parallel, caches results.
- `src/locate.js`: finds the install folder (launcher log, common folders on every drive).
- `src/server.js`: local web server, folder picker and the app window launcher.
- `public/`: the app UI (vanilla JS modules plus d3).
- `src/live.js`: follows the Game.log of the session being played.
- `src/overlay/`: `reader.ps1` captures the overlay corner and runs Windows OCR, `parse.js` turns its text into numbers, `monitor.js` reads on a schedule and stores readings.
- `public/js/journey-model.js` turns positions into a cleaned track, stops and trips; `public/js/pages/journey.js` draws the map. `public/data/starmap.json` is the map's data, built by `scripts/make-starmap.js` from starnav's `objContainers.json` and `pois.json`.
- `scripts/build-exe.js`: builds the .exe. `scripts/make-icon.js` regenerates `public/app.ico`.
- `scripts/ocr-file.js`: runs the overlay reader and parser on screenshots (`node scripts/ocr-file.js 720 320 3 0 shot.jpg`). `scripts/bench-overlay.js` times the reader.
- `prototype/` (local only, not published): the first Python analysis scripts and an earlier one-page dashboard.
