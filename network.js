(() => {
  const NativePeer = window.Peer;
  if (!NativePeer) return;

  const CLOUD_OPTIONS = {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    secure: true,
    debug: 2
  };

  function CloudPeer(idOrOptions, maybeOptions) {
    let instance;

    if (typeof idOrOptions === "string") {
      instance = new NativePeer(idOrOptions, {
        ...CLOUD_OPTIONS,
        ...(maybeOptions || {})
      });
    } else {
      instance = new NativePeer({
        ...CLOUD_OPTIONS,
        ...(idOrOptions || {})
      });
    }

    const nativeOn = instance.on.bind(instance);
    let hasOpened = false;
    let reconnectTimer = null;

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const reconnect = (delay = 700) => {
      clearReconnect();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (instance.destroyed || !instance.disconnected) return;
        try {
          instance.reconnect();
        } catch (_) {
          reconnect(1200);
        }
      }, delay);
    };

    nativeOn("open", () => {
      hasOpened = true;
      clearReconnect();
    });

    nativeOn("disconnected", () => {
      if (!instance.destroyed) reconnect();
    });

    instance.on = (event, handler) => {
      if (event !== "error") return nativeOn(event, handler);

      return nativeOn(event, (error) => {
        // A host that has already opened should never silently change its room
        // code just because its signaling socket briefly lost registration.
        if (hasOpened && error?.type === "unavailable-id") {
          if (typeof connectionStatus !== "undefined" && isHost && roomReady) {
            connectionStatus.textContent = "Reconnecting room";
          }
          reconnect(1200);
          return;
        }

        handler(error);
      });
    };

    return instance;
  }

  CloudPeer.prototype = NativePeer.prototype;
  Object.setPrototypeOf(CloudPeer, NativePeer);
  window.Peer = CloudPeer;

  const originalJoinRoom = joinRoom;
  joinRoomBtn.removeEventListener("click", originalJoinRoom);
  joinRoomBtn.addEventListener("click", joinRoomFreshPeer);

  function joinRoomFreshPeer() {
    if (joinCode.length !== 4) return;

    localName = safeName();
    isHost = false;
    roomReady = false;
    connectionAttempt += 1;

    const attemptToken = connectionAttempt;
    const targetCode = [...joinCode];
    const targetId = codeToPeerId(targetCode);
    const startedAt = Date.now();
    const maxSearchMs = 15000;
    let retryTimer = null;
    let generation = 0;
    let finished = false;

    currentRoomCode = targetCode;
    setLobbyStatus("Finding room…");
    cleanupPeer();

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const destroyCurrentGuestPeer = () => {
      if (hostConnection) {
        try { hostConnection.close(); } catch (_) {}
        hostConnection = null;
      }

      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
    };

    const fail = () => {
      if (finished || attemptToken !== connectionAttempt || roomReady) return;
      finished = true;
      clearRetryTimer();
      destroyCurrentGuestPeer();
      setLobbyStatus("No room was found with that color code.", true);
    };

    const scheduleFreshAttempt = (delay = 850) => {
      if (finished || attemptToken !== connectionAttempt || roomReady) return;
      clearRetryTimer();
      destroyCurrentGuestPeer();

      if (Date.now() - startedAt >= maxSearchMs) {
        fail();
        return;
      }

      setLobbyStatus("Still looking for room…");
      retryTimer = setTimeout(startFreshAttempt, delay);
    };

    const startFreshAttempt = () => {
      if (finished || attemptToken !== connectionAttempt || roomReady) return;
      clearRetryTimer();
      destroyCurrentGuestPeer();

      generation += 1;
      const thisGeneration = generation;
      const guestPeer = new Peer();
      peer = guestPeer;
      let connectionOpened = false;
      let welcomed = false;

      const isCurrent = () => (
        !finished &&
        attemptToken === connectionAttempt &&
        thisGeneration === generation &&
        peer === guestPeer
      );

      const attemptTimeout = setTimeout(() => {
        if (isCurrent() && !welcomed) scheduleFreshAttempt();
      }, 5200);

      const stopAttemptTimeout = () => clearTimeout(attemptTimeout);

      guestPeer.on("open", (id) => {
        if (!isCurrent()) return;
        localId = id;

        const conn = guestPeer.connect(targetId, {
          reliable: true,
          serialization: "json",
          metadata: {
            app: "newhouse-coop",
            version: window.COOP_VERSION || "0.1.2"
          }
        });

        hostConnection = conn;

        conn.on("open", () => {
          if (!isCurrent() || conn !== hostConnection) return;
          connectionOpened = true;
          setLobbyStatus("Joining room…");
          conn.send({ type: "join", name: localName });
        });

        conn.on("data", (data) => {
          if (!isCurrent() || conn !== hostConnection) return;

          if (data?.type === "reject") {
            finished = true;
            stopAttemptTimeout();
            handleGuestData(data);
            return;
          }

          handleGuestData(data);

          if (roomReady) {
            welcomed = true;
            finished = true;
            stopAttemptTimeout();
          }
        });

        conn.on("close", () => {
          if (!isCurrent()) return;
          stopAttemptTimeout();
          if (roomReady || welcomed) {
            returnToLobby("The host left the room.");
            return;
          }
          scheduleFreshAttempt();
        });

        conn.on("error", () => {
          if (!isCurrent() || roomReady || welcomed) return;
          stopAttemptTimeout();
          scheduleFreshAttempt();
        });
      });

      guestPeer.on("disconnected", () => {
        if (!isCurrent() || roomReady || welcomed) return;
        stopAttemptTimeout();
        scheduleFreshAttempt();
      });

      guestPeer.on("error", (error) => {
        if (!isCurrent() || roomReady || welcomed) return;

        if (
          error?.type === "peer-unavailable" ||
          error?.type === "network" ||
          error?.type === "socket-error" ||
          error?.type === "socket-closed" ||
          (!connectionOpened && error?.type === "webrtc")
        ) {
          stopAttemptTimeout();
          scheduleFreshAttempt();
          return;
        }

        finished = true;
        stopAttemptTimeout();
        destroyCurrentGuestPeer();
        setLobbyStatus(`Could not join room: ${friendlyPeerError(error)}`, true);
      });
    };

    startFreshAttempt();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!peer || peer.destroyed || !peer.disconnected) return;
    try { peer.reconnect(); } catch (_) {}
  });
})();
