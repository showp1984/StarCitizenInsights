# Changelog

## 0.3.0

- New **Journey** tab: where you were during a session, on a 3D map of the star system drawn from your positions on the info overlay (left-drag to turn and tilt, right-drag to move, wheel to zoom, as on the game's star map), with your stops and trips (quantum travel, jumps, flights, relogs) in a timeline. Planets and moons open as a globe with outposts, stations and other named places; a time slider shows where you were at any moment. It follows the session you're playing.
- Overlay readings now keep your position in the star system and relative to the planet, moon, Lagrange or jump point you're near, and which system you're in.
- Stops are named from the overlay's location line, the places Game.log saw you open your inventory, or the nearest named place. Logs are read once more on the first start to note those places with their times.
- Map data for Stanton, Pyro and Nyx from the starnav community data (MIT).
- Video memory (VRAM): read from the info overlay with the game's RAM use. The Live tab charts RAM, reserved memory and VRAM over the session; the Performance tab adds VRAM to the memory chart and a typical VRAM peak.

## 0.2.1

- Live tab: reworded labels and the summary line, tiles regrouped (server, players, connection, your frame rate). Health scores are now labelled Good, Fair, Poor and Bad.

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
