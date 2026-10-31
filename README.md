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

- **Overview**: hours per month with hardware changes marked, a calendar of every day you played, when you play, which systems you load into, where you spend time.
- **Stability**: crash or freeze rate by patch, graphics driver, renderer, GPU and CPU; crash types from the game's crash reports; how far into a session crashes happen; a list of every crash.
- **Performance**: frame rate per month, by star system, hardware and patch; frame-time mix; memory use. From the frame-rate summary the game writes each time you leave a world.
- **Loading & servers**: loading-screen times, server regions, relogs, disconnect reasons, server response times.
- **Combat**: ship combat vs on foot against NPCs vs players, PvP kills and deaths per month, top weapons for each, who you fight, where, how you died, ships you destroyed, anonymous rivals, your biggest combat sessions.
- **Ships**: flights per ship and manufacturer, timed hours, quantum jumps, ships lost, a ship log.
- **Missions & money**: contracts over time and by name, shop spending by month and category, biggest purchases and whether the shop confirmed them.
- **Sessions**: every session, searchable; click one for its timeline and frame-rate summaries.

The **LIVE / PTU / All builds** switch and the period picker filter every page.

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
- `scripts/build-exe.js`: builds the .exe. `scripts/make-icon.js` regenerates `public/app.ico`.
- `prototype/` (local only, not published): the first Python analysis scripts and an earlier one-page dashboard.
