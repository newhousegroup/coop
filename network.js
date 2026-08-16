(() => {
  const NativePeer = window.Peer;

  if (!NativePeer) return;

  function ResilientPeer(...args) {
    const instance = new NativePeer(...args);
    const nativeOn = instance.on.bind(instance);
    let reconnectTimer = null;
    let hasOpened = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (delay = 700) => {
      clearReconnectTimer();

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        if (instance.destroyed || !instance.disconnected) return;

        try {
          instance.reconnect();
        } catch (_) {
          scheduleReconnect(1200);
        }
      }, delay);
    };

    nativeOn("open", () => {
      hasOpened = true;
      clearReconnectTimer();
    });

    nativeOn("disconnected", () => {
      if (!instance.destroyed) scheduleReconnect();
    });

    // Wrap later error handlers registered by app.js. An unavailable-id before
    // the first successful open means a newly generated room code collided and
    // app.js should regenerate it. The same error after a successful open can
    // happen during re-registration; do not let app.js silently generate an
    // entirely different room while people are already inside.
    instance.on = (event, handler) => {
      if (event !== "error") return nativeOn(event, handler);

      return nativeOn(event, (error) => {
        if (hasOpened && error?.type === "unavailable-id") {
          if (typeof connectionStatus !== "undefined" && isHost && roomReady) {
            connectionStatus.textContent = "Reconnecting room";
          }
          scheduleReconnect(1200);
          return;
        }

        handler(error);
      });
    };

    return instance;
  }

  ResilientPeer.prototype = NativePeer.prototype;
  Object.setPrototypeOf(ResilientPeer, NativePeer);
  window.Peer = ResilientPeer;

  const originalJoinRoom = joinRoom;
  joinRoomBtn.removeEventListener("click", originalJoinRoom);
  joinRoomBtn.addEventListener("click", resilientJoinRoom);

  function resilientJoinRoom() {
    if (joinCode.length !== 4) return;

    localName = safeName();
    isHost = false;
    roomReady = false;
    connectionAttempt += 1;

    const attempt = connectionAttempt;
    const startedAt = Date.now();
    const targetCode = [...joinCode];
    const targetId = codeToPeerId(targetCode);
    const maxSearchMs = 12000;
    let retryTimer = null;
    let welcomeTimer = null;
    let finished = false;

    currentRoomCode = targetCode;
    setLobbyStatus("Finding room…");
    cleanupPeer();

    peer = new Peer();

    const clearTimers = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (welcomeTimer !== null) clearTimeout(welcomeTimer);
      retryTimer = null;
      welcomeTimer = null;
    };

    const fail = () => {
      if (finished || attempt !== connectionAttempt || roomReady) return;
      finished = true;
      clearTimers();
      cleanupPeer();
      setLobbyStatus("No room was found with that color code.", true);
    };

    const scheduleRetry = () => {
      if (finished || attempt !== connectionAttempt || roomReady) return;

      clearTimers();

      if (Date.now() - startedAt >= maxSearchMs) {
        fail();
        return;
      }

      setLobbyStatus("Still looking for room…");
      retryTimer = setTimeout(connectToHost, 1100);
    };

    const connectToHost = () => {
      if (finished || attempt !== connectionAttempt || roomReady || !peer || peer.destroyed) return;

      if (peer.disconnected) {
        try { peer.reconnect(); } catch (_) {}
        scheduleRetry();
        return;
      }

      if (hostConnection && !hostConnection.open) {
        try { hostConnection.close(); } catch (_) {}
      }

      const conn = peer.connect(targetId, {
        reliable: true,
        metadata: { app: "newhouse-coop", version: APP_VERSION }
      });

      hostConnection = conn;

      conn.on("open", () => {
        if (finished || conn !== hostConnection || attempt !== connectionAttempt) return;

        setLobbyStatus("Joining room…");
        conn.send({ type: "join", name: localName });

        welcomeTimer = setTimeout(() => {
          if (!roomReady && conn === hostConnection) scheduleRetry();
        }, 5000);
      });

      conn.on("data", (data) => {
        if (conn !== hostConnection || finished) return;

        handleGuestData(data);

        if (roomReady) {
          finished = true;
          clearTimers();
        }
      });

      conn.on("close", () => {
        if (conn !== hostConnection || finished) return;
        if (roomReady) {
          returnToLobby("The host left the room.");
          return;
        }
        scheduleRetry();
      });

      conn.on("error", () => {
        if (conn !== hostConnection || finished || roomReady) return;
        scheduleRetry();
      });
    };

    peer.on("open", (id) => {
      if (attempt !== connectionAttempt || finished) return;
      localId = id;
      connectToHost();
    });

    peer.on("disconnected", () => {
      if (finished || attempt !== connectionAttempt || roomReady) return;
      scheduleRetry();
    });

    peer.on("error", (error) => {
      if (finished || attempt !== connectionAttempt) return;

      if (error.type === "peer-unavailable") {
        scheduleRetry();
        return;
      }

      if (!roomReady) {
        finished = true;
        clearTimers();
        setLobbyStatus(`Could not join room: ${friendlyPeerError(error)}`, true);
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!peer || peer.destroyed || !peer.disconnected) return;

    try { peer.reconnect(); } catch (_) {}
  });
})();
