# Changelog

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
