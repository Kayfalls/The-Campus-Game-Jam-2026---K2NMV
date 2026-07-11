# Sounding: Depths — Local Multiplayer

## Solo
Just open `client.html` in a browser. No server needed.

## Multiplayer (up to 12 players, same Wi-Fi/hotspot)
1. One device (the **host**) needs [Node.js](https://nodejs.org) installed. No `npm install` — zero dependencies.
2. Put `server.js`, `sim.js`, and `client.html` in the same folder.
3. Host runs:
   ```
   node server.js
   ```
4. The terminal prints an address like `http://192.168.1.42:8080`. Share that with everyone on the same Wi-Fi/hotspot.
5. Everyone (including the host) opens that address in a browser → picks **Multiplayer** → sets name/skin.
6. The first person to join is the host and gets a **Start Match** button; everyone else waits in the lobby.

## Notes on scope
- True Bluetooth/Wi-Fi-Direct P2P (like Mini Militia) isn't possible from a browser — there's no web API for general peer-to-peer game data over Bluetooth. This uses a lightweight LAN server instead, which is the closest browser-based equivalent and needs no internet connection, just a shared local network.
- Current mode is **co-op PvE**: everyone fights waves of hunters together, with individual kill/death tracking. PvP (players fighting each other) reuses the same weapon/hit code and is the natural next layer whenever you want it added.
- Touch controls are included (left-side joystick to move, right-side drag to aim/fire, ECHO button) so it also works on phones/tablets.
