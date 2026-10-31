# Changelog

## 0.2.0

- New **Live** tab for the session you're playing, refreshed every 15 seconds: server health, server fps, players on the shard and on your game server, ping, packet loss, hitches and server restarts, read from the game's info overlay (`r_displayinfo 3`).
- Game servers on your shard with their health, and a shard health score derived from them.
- Which game server you were on, where and for how long, as server meshing moves you between them: at a station, in open space near a Lagrange point, or near a planet or moon.
- Reads the overlay even when your ship's name banner covers part of it, and drops numbers that contradict themselves rather than showing them.
- Place names for Pyro stations (Checkmate, Starlight Service Station), outposts, and the planets and moons of Stanton.
- New **Shards & servers** tab: every shard you've joined, every game server you've been on, server fps by time of day and health by region.
- Shard joins now record the full shard name; the app notes your last known location.
- Overlay reading can be switched off or set to 10, 15, 30 or 60 seconds.
- Fixed chart time labels overlapping when a chart has hundreds of points.

## 0.1.0

First release.

- Standalone Windows app (`StarCitizenInsights.exe`): no install, opens in its own window, quits after the window closes.
- Finds Star Citizen through the RSI Launcher's log or the usual folders on any drive; asks for the folder when it can't.
- Eight pages: Overview, Stability, Performance, Loading & servers, Combat, Ships, Missions & money, Sessions.
- Reads LIVE, PTU and TECH-PREVIEW logs, including `logbackups`, and counts copies of the same session once.
- Classifies crashes from the game's crash reports (GPU crash, access violation, deadlock, out of memory, …).
- Splits combat into ship combat and on foot, against NPCs and against players.
- Counts each logged event once, even when a corrupted log repeats it.
- Never stores other players' names.
