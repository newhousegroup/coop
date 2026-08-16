# Newhouse CoOp

A small browser-based multiplayer meeting-room experiment by Newhouse.

## What it does

- Create or join a room using a four-block color code.
- Six possible colors: Coral, Peach, Yellow, Turquoise, Blue, and Purple.
- Up to 6 people in a room.
- Move around a shared 2D map by clicking/tapping or using WASD / arrow keys.
- Send room-wide text chat messages.
- No Newhouse backend or database.

## Networking

CoOp uses [PeerJS](https://peerjs.com/) for WebRTC DataChannels and PeerJS Cloud for signaling.

The first user is the room host. Up to five guests connect to the host. The host relays player position updates and chat packets to the other guests. This keeps the prototype simple and avoids a full peer-to-peer mesh while still keeping actual room data on WebRTC connections.

The four-color code maps deterministically to the host's PeerJS ID. If that ID is already occupied, CoOp automatically generates another color code.

Because the host coordinates the room, the room ends if the host leaves.

## Run

This is a static site. Serve the repository through GitHub Pages, Netlify, or any ordinary HTTPS static host.

Opening `index.html` directly may work in some browsers, but HTTPS hosting is recommended for consistent WebRTC behavior.
