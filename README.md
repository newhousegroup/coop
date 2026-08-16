# Newhouse CoOp

**Version 0.1.4**

A small browser-based multiplayer meeting-room experiment by Newhouse.

## What it does

- Create or join a room using a four-block color code.
- Six possible colors: Coral, Peach, Yellow, Turquoise, Blue, and Purple.
- Up to 6 people in a room.
- Move around a shared 2D map with WASD / arrow keys on desktop or a joystick on touch devices.
- Send room-wide text chat messages.
- Uses WebRTC DataChannels for room traffic.

## Networking

CoOp uses PeerJS Cloud for WebRTC signaling. Actual room traffic uses WebRTC DataChannels.

Version 0.1.3 added Cloudflare TURN as a required fallback for restrictive NATs and firewalls. CoOp requests short-lived TURN credentials from a Netlify Function before creating or joining a room. Direct peer-to-peer connectivity is still preferred; TURN is used automatically when a direct route is unavailable.

Version 0.1.4 fixes host-to-guest synchronization. The 0.1.3 guest join handler stopped processing inbound packets after receiving the initial welcome packet, which meant guest interactions reached the host but later host movement and messages did not reach the guest UI. `sync.js` installs a steady-state receive listener after the room is established and also restores guest-side host-close detection.

The room UI reports the selected route as `Connected · direct` or `Connected · TURN relay` when the browser exposes enough ICE statistics to identify it.

CoOp intentionally fails closed if TURN credentials cannot be obtained. A meeting room will not be created while relay capability is unavailable.

## Netlify configuration

Create a Cloudflare TURN key, then add these environment variables to the Netlify site with Functions scope:

- `TURNTOKEN` — the secret token belonging to the Cloudflare TURN key.
- `TURNKEYID` — the Cloudflare TURN key ID / UID.

Do not put either value in browser JavaScript or commit the token to this repository.

After changing environment variables, trigger a new Netlify deploy so the Function receives the new values.

The server-side credential broker is `netlify/functions/turn-credentials.mjs` and is exposed at `/api/turn-credentials`. It requests 24-hour short-lived ICE credentials from Cloudflare and removes the browser-unfriendly alternate port 53 entries while retaining TURN over UDP, TCP, and TLS/443.

## Room model

The first user is the room host. Up to five guests connect to the host. The host relays player position and chat packets between connected guests. Because the host coordinates the room, the room ends if the host leaves.

The four-color room code maps deterministically to the host's PeerJS brokering ID. If that ID is already occupied, CoOp generates another code.

## Run

Deploy the repository on Netlify so the TURN credential Function is available. Plain static hosting without the Netlify Function deliberately prevents rooms from starting.
