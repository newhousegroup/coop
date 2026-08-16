const MAX_USERS = 6;
const ROOM_PREFIX = "newhouse-coop-room-";
const APP_VERSION = "0.1.0";

const COLORS = [
  { name: "Coral", key: "0", hex: "#ef7468" },
  { name: "Peach", key: "1", hex: "#f1aa77" },
  { name: "Yellow", key: "2", hex: "#dfc451" },
  { name: "Turquoise", key: "3", hex: "#55b8b1" },
  { name: "Blue", key: "4", hex: "#6488cf" },
  { name: "Purple", key: "5", hex: "#8a6bc0" }
];

const lobby = document.querySelector("#lobby");
const room = document.querySelector("#room");
const displayName = document.querySelector("#displayName");
const createRoomBtn = document.querySelector("#createRoomBtn");
const showJoinBtn = document.querySelector("#showJoinBtn");
const lobbyHome = document.querySelector("#lobbyHome");
const joinPanel = document.querySelector("#joinPanel");
const backBtn = document.querySelector("#backBtn");
const colorPalette = document.querySelector("#colorPalette");
const joinRoomBtn = document.querySelector("#joinRoomBtn");
const joinSlots = [...document.querySelectorAll(".code-slot")];
const lobbyStatus = document.querySelector("#lobbyStatus");
const connectionStatus = document.querySelector("#connectionStatus");
const roomCode = document.querySelector("#roomCode");
const peopleCount = document.querySelector("#peopleCount");
const leaveBtn = document.querySelector("#leaveBtn");
const map = document.querySelector("#map");
const playersLayer = document.querySelector("#playersLayer");
const messages = document.querySelector("#messages");
const chatInput = document.querySelector("#chatInput");
const sendBtn = document.querySelector("#sendBtn");
const joystick = document.querySelector("#joystick");
const joystickKnob = document.querySelector("#joystickKnob");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

let peer = null;
let hostConnection = null;
let guestConnections = new Map();
let isHost = false;
let currentRoomCode = [];
let joinCode = [];
let localId = null;
let localName = "Guest";
let players = new Map();
let chatHistory = [];
let connectionAttempt = 0;
let roomReady = false;
let lastMoveSent = 0;

const joystickState = {
  pointerId: null,
  x: 0,
  y: 0,
  animationFrame: null,
  lastFrameTime: 0
};

function randomCode() {
  return Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * COLORS.length)].key);
}

function codeToPeerId(code) {
  return `${ROOM_PREFIX}${code.join("")}`;
}

function colorFromKey(key) {
  return COLORS.find((color) => color.key === String(key));
}

function setLobbyStatus(text = "", isError = false) {
  lobbyStatus.textContent = text;
  lobbyStatus.classList.toggle("error", isError);
}

function setThemeColor(color) {
  if (themeColorMeta) themeColorMeta.setAttribute("content", color);
}

function safeName() {
  const value = displayName.value.trim().replace(/\s+/g, " ").slice(0, 20);
  return value || `Guest ${Math.floor(Math.random() * 90 + 10)}`;
}

function renderPalette() {
  colorPalette.replaceChildren();

  COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-color";
    button.style.background = color.hex;
    button.dataset.key = color.key;
    button.setAttribute("aria-label", color.name);
    button.title = color.name;
    button.addEventListener("click", () => addJoinColor(color.key));
    colorPalette.appendChild(button);
  });
}

function addJoinColor(key) {
  if (joinCode.length >= 4) return;
  joinCode.push(key);
  renderJoinCode();
}

function renderJoinCode() {
  joinSlots.forEach((slot, index) => {
    const key = joinCode[index];
    const color = key !== undefined ? colorFromKey(key) : null;

    slot.classList.toggle("empty", !color);
    slot.style.background = color ? color.hex : "";
    slot.title = color ? `${color.name} — tap to remove` : "";
  });

  joinRoomBtn.disabled = joinCode.length !== 4;
}

function removeJoinSlot(index) {
  if (index < joinCode.length) {
    joinCode.splice(index, 1);
    renderJoinCode();
  }
}

function renderRoomCode() {
  roomCode.replaceChildren();

  currentRoomCode.forEach((key) => {
    const color = colorFromKey(key);
    if (!color) return;

    const chip = document.createElement("span");
    chip.className = "code-chip";
    chip.style.background = color.hex;
    chip.title = color.name;
    roomCode.appendChild(chip);
  });
}

function enterRoom() {
  lobby.classList.add("hidden");
  lobby.setAttribute("aria-hidden", "true");
  room.classList.remove("hidden");
  room.setAttribute("aria-hidden", "false");
  setThemeColor("#f4f1ea");
  renderRoomCode();
  renderPlayers();
  renderMessages();
  updatePeopleCount();
  map.focus();
}

function returnToLobby(message = "") {
  cleanupPeer();
  resetJoystick();

  roomReady = false;
  isHost = false;
  currentRoomCode = [];
  localId = null;
  players.clear();
  chatHistory = [];
  guestConnections.clear();
  hostConnection = null;

  room.classList.add("hidden");
  room.setAttribute("aria-hidden", "true");
  lobby.classList.remove("hidden");
  lobby.setAttribute("aria-hidden", "false");
  lobbyHome.classList.remove("hidden");
  joinPanel.classList.add("hidden");
  joinPanel.setAttribute("aria-hidden", "true");
  joinCode = [];
  renderJoinCode();
  setThemeColor("#0e0f11");
  setLobbyStatus(message);
}

function cleanupPeer() {
  for (const conn of guestConnections.values()) {
    try { conn.close(); } catch (_) {}
  }
  guestConnections.clear();

  if (hostConnection) {
    try { hostConnection.close(); } catch (_) {}
    hostConnection = null;
  }

  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
}

function createRoom() {
  localName = safeName();
  isHost = true;
  roomReady = false;
  connectionAttempt += 1;
  const attempt = connectionAttempt;
  setLobbyStatus("Creating room…");
  tryCreateRandomRoom(attempt, 0);
}

function tryCreateRandomRoom(attempt, retries) {
  if (attempt !== connectionAttempt) return;
  if (retries > 20) {
    setLobbyStatus("Could not find an available room code. Try again.", true);
    return;
  }

  cleanupPeer();
  currentRoomCode = randomCode();
  const requestedId = codeToPeerId(currentRoomCode);
  peer = new Peer(requestedId);

  peer.on("open", (id) => {
    if (attempt !== connectionAttempt) return;

    localId = id;
    players.clear();
    players.set(localId, makePlayer(localId, localName, 50, 72, 0));
    chatHistory = [];
    roomReady = true;
    connectionStatus.textContent = "Hosting room";
    enterRoom();
    addSystemMessage(`${localName} created the room.`);
  });

  peer.on("connection", handleIncomingGuest);

  peer.on("error", (error) => {
    if (attempt !== connectionAttempt) return;

    if (error.type === "unavailable-id") {
      tryCreateRandomRoom(attempt, retries + 1);
      return;
    }

    setLobbyStatus(`Could not create room: ${friendlyPeerError(error)}`, true);
  });
}

function joinRoom() {
  if (joinCode.length !== 4) return;

  localName = safeName();
  isHost = false;
  roomReady = false;
  connectionAttempt += 1;
  const attempt = connectionAttempt;
  currentRoomCode = [...joinCode];
  setLobbyStatus("Finding room…");
  cleanupPeer();

  peer = new Peer();

  peer.on("open", (id) => {
    if (attempt !== connectionAttempt) return;

    localId = id;
    const targetId = codeToPeerId(currentRoomCode);
    const conn = peer.connect(targetId, {
      reliable: true,
      metadata: { app: "newhouse-coop", version: APP_VERSION }
    });
    hostConnection = conn;

    let opened = false;
    const timeout = setTimeout(() => {
      if (!opened && attempt === connectionAttempt) {
        cleanupPeer();
        setLobbyStatus("No room was found with that color code.", true);
      }
    }, 9000);

    conn.on("open", () => {
      opened = true;
      clearTimeout(timeout);
      setLobbyStatus("Joining room…");
      conn.send({ type: "join", name: localName });
    });

    conn.on("data", handleGuestData);

    conn.on("close", () => {
      clearTimeout(timeout);
      if (roomReady) returnToLobby("The host left the room.");
    });

    conn.on("error", () => {
      clearTimeout(timeout);
      if (!roomReady) setLobbyStatus("Could not connect to that room.", true);
    });
  });

  peer.on("error", (error) => {
    if (attempt !== connectionAttempt) return;

    if (error.type === "peer-unavailable") {
      setLobbyStatus("No room was found with that color code.", true);
      cleanupPeer();
      return;
    }

    if (!roomReady) setLobbyStatus(`Could not join room: ${friendlyPeerError(error)}`, true);
  });
}

function handleIncomingGuest(conn) {
  if (!isHost || !roomReady) {
    conn.on("open", () => {
      conn.send({ type: "reject", reason: "Room is not ready." });
      conn.close();
    });
    return;
  }

  conn.on("data", (data) => {
    if (!data || typeof data !== "object") return;

    if (data.type === "join") {
      acceptGuest(conn, data);
      return;
    }

    if (!guestConnections.has(conn.peer)) return;
    handleHostData(conn.peer, data);
  });

  conn.on("close", () => removeGuest(conn.peer));
  conn.on("error", () => removeGuest(conn.peer));
}

function acceptGuest(conn, data) {
  if (guestConnections.has(conn.peer)) return;

  if (players.size >= MAX_USERS) {
    conn.send({ type: "reject", reason: "This room is full (6 / 6)." });
    setTimeout(() => conn.close(), 250);
    return;
  }

  const name = cleanRemoteName(data.name);
  const colorIndex = firstAvailableColorIndex();
  const spawn = spawnPoint(players.size);
  const player = makePlayer(conn.peer, name, spawn.x, spawn.y, colorIndex);

  guestConnections.set(conn.peer, conn);
  players.set(conn.peer, player);

  conn.send({
    type: "welcome",
    selfId: conn.peer,
    players: [...players.values()],
    messages: chatHistory,
    roomCode: currentRoomCode
  });

  broadcast({ type: "player-joined", player }, conn.peer);
  addSystemMessage(`${name} joined the room.`);
  updatePeopleCount();
  renderPlayers();
}

function handleHostData(senderId, data) {
  if (!isHost || !players.has(senderId)) return;

  if (data.type === "move") {
    const player = players.get(senderId);
    player.x = clampNumber(data.x, 3, 97, player.x);
    player.y = clampNumber(data.y, 4, 94, player.y);
    renderPlayers();
    broadcast({ type: "move", id: senderId, x: player.x, y: player.y }, senderId);
    return;
  }

  if (data.type === "chat") {
    const text = cleanMessage(data.text);
    if (!text) return;
    createAndBroadcastMessage(senderId, text);
  }
}

function handleGuestData(data) {
  if (!data || typeof data !== "object") return;

  if (data.type === "reject") {
    const reason = typeof data.reason === "string" ? data.reason : "Could not join room.";
    returnToLobby(reason);
    return;
  }

  if (data.type === "welcome") {
    players.clear();

    for (const player of Array.isArray(data.players) ? data.players : []) {
      if (validPlayer(player)) players.set(player.id, player);
    }

    if (Array.isArray(data.roomCode) && data.roomCode.length === 4) {
      currentRoomCode = data.roomCode.map(String);
    }

    chatHistory = Array.isArray(data.messages) ? data.messages.filter(validMessage).slice(-100) : [];
    roomReady = true;
    connectionStatus.textContent = "Connected to host";
    enterRoom();
    return;
  }

  if (!roomReady) return;

  if (data.type === "player-joined" && validPlayer(data.player)) {
    players.set(data.player.id, data.player);
    renderPlayers();
    updatePeopleCount();
    return;
  }

  if (data.type === "player-left" && typeof data.id === "string") {
    players.delete(data.id);
    renderPlayers();
    updatePeopleCount();
    return;
  }

  if (data.type === "move" && typeof data.id === "string" && players.has(data.id)) {
    const player = players.get(data.id);
    player.x = clampNumber(data.x, 3, 97, player.x);
    player.y = clampNumber(data.y, 4, 94, player.y);
    renderPlayers();
    return;
  }

  if (data.type === "chat-message" && validMessage(data.message)) {
    chatHistory.push(data.message);
    chatHistory = chatHistory.slice(-100);
    renderMessages();
    return;
  }

  if (data.type === "system-message" && validMessage(data.message)) {
    chatHistory.push(data.message);
    chatHistory = chatHistory.slice(-100);
    renderMessages();
  }
}

function removeGuest(peerId) {
  if (!guestConnections.has(peerId) && !players.has(peerId)) return;

  const player = players.get(peerId);
  guestConnections.delete(peerId);
  players.delete(peerId);

  broadcast({ type: "player-left", id: peerId });
  if (player) addSystemMessage(`${player.name} left the room.`);
  renderPlayers();
  updatePeopleCount();
}

function makePlayer(id, name, x, y, colorIndex) {
  return {
    id,
    name: cleanRemoteName(name),
    x,
    y,
    colorIndex: Number.isInteger(colorIndex) ? colorIndex % COLORS.length : 0
  };
}

function validPlayer(player) {
  return player &&
    typeof player.id === "string" &&
    typeof player.name === "string" &&
    Number.isFinite(Number(player.x)) &&
    Number.isFinite(Number(player.y));
}

function firstAvailableColorIndex() {
  const used = new Set([...players.values()].map((player) => player.colorIndex));

  for (let i = 0; i < COLORS.length; i += 1) {
    if (!used.has(i)) return i;
  }

  return players.size % COLORS.length;
}

function spawnPoint(index) {
  const points = [
    { x: 50, y: 72 },
    { x: 43, y: 72 },
    { x: 57, y: 72 },
    { x: 47, y: 81 },
    { x: 53, y: 81 },
    { x: 50, y: 63 }
  ];

  return points[index % points.length];
}

function renderPlayers() {
  playersLayer.replaceChildren();

  for (const player of players.values()) {
    const wrapper = document.createElement("div");
    wrapper.className = `player${player.id === localId ? " me" : ""}`;
    wrapper.style.left = `${player.x}%`;
    wrapper.style.top = `${player.y}%`;

    const dot = document.createElement("div");
    dot.className = "player-dot";
    dot.style.background = COLORS[player.colorIndex % COLORS.length].hex;
    dot.textContent = initials(player.name);

    const label = document.createElement("span");
    label.className = "player-name";
    label.textContent = player.id === localId ? `${player.name} (you)` : player.name;

    wrapper.append(dot, label);
    playersLayer.appendChild(wrapper);
  }
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function updatePeopleCount() {
  peopleCount.textContent = `${players.size} / ${MAX_USERS}`;
}

function moveLocalTo(x, y) {
  if (!roomReady || !localId || !players.has(localId)) return;

  const player = players.get(localId);
  player.x = clampNumber(x, 3, 97, player.x);
  player.y = clampNumber(y, 4, 94, player.y);
  renderPlayers();

  const now = performance.now();
  if (now - lastMoveSent < 28) return;
  lastMoveSent = now;

  const packet = { type: "move", id: localId, x: player.x, y: player.y };

  if (isHost) {
    broadcast(packet);
  } else if (hostConnection?.open) {
    hostConnection.send({ type: "move", x: player.x, y: player.y });
  }
}

function broadcast(packet, exceptPeerId = null) {
  for (const [peerId, conn] of guestConnections.entries()) {
    if (peerId === exceptPeerId || !conn.open) continue;
    try { conn.send(packet); } catch (_) {}
  }
}

function sendChat() {
  if (!roomReady) return;

  const text = cleanMessage(chatInput.value);
  if (!text) return;

  chatInput.value = "";
  resizeChatInput();

  if (isHost) {
    createAndBroadcastMessage(localId, text);
  } else if (hostConnection?.open) {
    hostConnection.send({ type: "chat", text });
  }
}

function createAndBroadcastMessage(senderId, text) {
  const player = players.get(senderId);
  if (!player) return;

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "chat",
    senderId,
    senderName: player.name,
    text,
    time: Date.now()
  };

  chatHistory.push(message);
  chatHistory = chatHistory.slice(-100);
  broadcast({ type: "chat-message", message });
  renderMessages();
}

function addSystemMessage(text) {
  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "system",
    text,
    time: Date.now()
  };

  chatHistory.push(message);
  chatHistory = chatHistory.slice(-100);

  if (isHost) broadcast({ type: "system-message", message });
  renderMessages();
}

function validMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.kind === "system") return typeof message.text === "string";
  return message.kind === "chat" && typeof message.senderName === "string" && typeof message.text === "string";
}

function renderMessages() {
  messages.replaceChildren();

  for (const message of chatHistory) {
    if (message.kind === "system") {
      const system = document.createElement("div");
      system.className = "system-message";
      system.textContent = message.text;
      messages.appendChild(system);
      continue;
    }

    const article = document.createElement("article");
    article.className = "message";

    const line = document.createElement("div");
    line.className = "message-line";

    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = message.senderId === localId ? `${message.senderName} · you` : message.senderName;

    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.time);

    const body = document.createElement("p");
    body.className = "message-body";
    body.textContent = message.text;

    line.append(name, time);
    article.append(line, body);
    messages.appendChild(article);
  }

  messages.scrollTop = messages.scrollHeight;
}

function formatTime(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cleanRemoteName(value) {
  return String(value || "Guest").trim().replace(/\s+/g, " ").slice(0, 20) || "Guest";
}

function cleanMessage(value) {
  return String(value || "").trim().slice(0, 500);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function friendlyPeerError(error) {
  const type = error?.type || "unknown";
  const messagesByType = {
    "browser-incompatible": "this browser does not support WebRTC",
    "disconnected": "the PeerJS signaling service disconnected",
    "network": "a network error occurred",
    "server-error": "the PeerJS signaling service returned an error",
    "socket-error": "the signaling connection failed",
    "socket-closed": "the signaling connection closed"
  };

  return messagesByType[type] || "a WebRTC connection error occurred";
}

function resizeChatInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 110)}px`;
}

function updateJoystickFromPointer(event) {
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const rawX = event.clientX - centerX;
  const rawY = event.clientY - centerY;
  const distance = Math.hypot(rawX, rawY);
  const maxDistance = Math.max(1, rect.width / 2 - 27);
  const scale = distance > maxDistance ? maxDistance / distance : 1;
  const knobX = rawX * scale;
  const knobY = rawY * scale;

  joystickState.x = Math.max(-1, Math.min(1, rawX / maxDistance));
  joystickState.y = Math.max(-1, Math.min(1, rawY / maxDistance));

  if (distance > maxDistance) {
    joystickState.x = knobX / maxDistance;
    joystickState.y = knobY / maxDistance;
  }

  joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
}

function startJoystickLoop() {
  if (joystickState.animationFrame !== null) return;
  joystickState.lastFrameTime = performance.now();

  const tick = (time) => {
    const dt = Math.min(32, Math.max(0, time - joystickState.lastFrameTime));
    joystickState.lastFrameTime = time;

    if (joystickState.pointerId !== null && roomReady && players.has(localId)) {
      const player = players.get(localId);
      const speed = 0.032;
      moveLocalTo(
        player.x + joystickState.x * speed * dt,
        player.y + joystickState.y * speed * dt
      );
      joystickState.animationFrame = requestAnimationFrame(tick);
      return;
    }

    joystickState.animationFrame = null;
  };

  joystickState.animationFrame = requestAnimationFrame(tick);
}

function resetJoystick() {
  joystickState.pointerId = null;
  joystickState.x = 0;
  joystickState.y = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";

  if (joystickState.animationFrame !== null) {
    cancelAnimationFrame(joystickState.animationFrame);
    joystickState.animationFrame = null;
  }
}

renderPalette();
renderJoinCode();
setThemeColor("#0e0f11");

joinSlots.forEach((slot, index) => {
  slot.addEventListener("click", () => removeJoinSlot(index));
});

createRoomBtn.addEventListener("click", createRoom);

showJoinBtn.addEventListener("click", () => {
  lobbyHome.classList.add("hidden");
  joinPanel.classList.remove("hidden");
  joinPanel.setAttribute("aria-hidden", "false");
  setLobbyStatus("");
});

backBtn.addEventListener("click", () => {
  joinPanel.classList.add("hidden");
  joinPanel.setAttribute("aria-hidden", "true");
  lobbyHome.classList.remove("hidden");
  joinCode = [];
  renderJoinCode();
  setLobbyStatus("");
});

joinRoomBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", () => returnToLobby("You left the room."));
sendBtn.addEventListener("click", sendChat);

chatInput.addEventListener("input", resizeChatInput);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
  }
});

map.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch" || window.matchMedia("(pointer: coarse)").matches) return;
  if (event.target.closest(".player")) return;

  const rect = map.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  moveLocalTo(x, y);
});

joystick.addEventListener("pointerdown", (event) => {
  if (!roomReady || joystickState.pointerId !== null) return;

  event.preventDefault();
  joystickState.pointerId = event.pointerId;
  joystick.setPointerCapture?.(event.pointerId);
  updateJoystickFromPointer(event);
  startJoystickLoop();
});

joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== joystickState.pointerId) return;
  event.preventDefault();
  updateJoystickFromPointer(event);
});

function endJoystickPointer(event) {
  if (event.pointerId !== joystickState.pointerId) return;
  event.preventDefault();
  resetJoystick();
}

joystick.addEventListener("pointerup", endJoystickPointer);
joystick.addEventListener("pointercancel", endJoystickPointer);
joystick.addEventListener("lostpointercapture", () => resetJoystick());

window.addEventListener("keydown", (event) => {
  if (!roomReady || document.activeElement === chatInput || document.activeElement === displayName) return;
  if (!players.has(localId)) return;

  const key = event.key.toLowerCase();
  const movement = {
    arrowup: [0, -1.7],
    w: [0, -1.7],
    arrowdown: [0, 1.7],
    s: [0, 1.7],
    arrowleft: [-1.7, 0],
    a: [-1.7, 0],
    arrowright: [1.7, 0],
    d: [1.7, 0]
  }[key];

  if (!movement) return;
  event.preventDefault();
  const player = players.get(localId);
  moveLocalTo(player.x + movement[0], player.y + movement[1]);
});

window.addEventListener("beforeunload", () => {
  resetJoystick();
  cleanupPeer();
});
