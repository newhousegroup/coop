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

  let activeIceServers = null;
  let iceExpiresAt = 0;
  let loadingIcePromise = null;

  function hasUsableTurn(iceServers) {
    return Array.isArray(iceServers) && iceServers.some((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.some((url) => typeof url === "string" && /^turns?:/i.test(url));
    });
  }

  async function loadTurnCredentials(force = false) {
    const stillFresh = activeIceServers && Date.now() < iceExpiresAt - 60_000;
    if (!force && stillFresh) return activeIceServers;
    if (loadingIcePromise) return loadingIcePromise;

    loadingIcePromise = (async () => {
      const response = await fetch("/api/turn-credentials", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" }
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || !hasUsableTurn(payload.iceServers)) {
        const missing = Array.isArray(payload?.missing) && payload.missing.length
          ? ` Missing Netlify variable${payload.missing.length > 1 ? "s" : ""}: ${payload.missing.join(", ")}.`
          : "";
        throw new Error(`TURN relay is unavailable.${missing}`);
      }

      activeIceServers = payload.iceServers;
      iceExpiresAt = Number(payload.expiresAt) || (Date.now() + 60 * 60 * 1000);
      return activeIceServers;
    })();

    try {
      return await loadingIcePromise;
    } finally {
      loadingIcePromise = null;
    }
  }

  function peerOptions(options = {}) {
    const existingConfig = options.config || {};

    return {
      ...CLOUD_OPTIONS,
      ...options,
      config: {
        ...existingConfig,
        iceServers: activeIceServers || existingConfig.iceServers || [],
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 4,
        sdpSemantics: "unified-plan"
      }
    };
  }

  function CloudPeer(idOrOptions, maybeOptions) {
    let instance;

    if (typeof idOrOptions === "string") {
      instance = new NativePeer(idOrOptions, peerOptions(maybeOptions || {}));
    } else {
      instance = new NativePeer(peerOptions(idOrOptions || {}));
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

      if (typeof isHost !== "undefined" && isHost) {
        setTimeout(() => {
          if (typeof connectionStatus !== "undefined" && roomReady) {
            connectionStatus.textContent = "Hosting · relay ready";
          }
        }, 0);
      }
    });

    nativeOn("disconnected", () => {
      if (!instance.destroyed) reconnect();
    });

    instance.on = (event, handler) => {
      if (event === "connection") {
        return nativeOn(event, (conn) => {
          watchConnection(conn, { hostSide: true });
          handler(conn);
        });
      }

      if (event !== "error") return nativeOn(event, handler);

      return nativeOn(event, (error) => {
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

  function setNetworkLabel(text) {
    if (typeof roomReady !== "undefined" && roomReady && typeof connectionStatus !== "undefined") {
      connectionStatus.textContent = text;
    } else if (typeof setLobbyStatus === "function") {
      setLobbyStatus(text);
    }
  }

  async function connectionRoute(conn) {
    const pc = conn?.peerConnection;
    if (!pc?.getStats) return null;

    try {
      const stats = await pc.getStats();
      let pair = null;

      stats.forEach((report) => {
        if (pair) return;
        if (report.type === "transport" && report.selectedCandidatePairId) {
          pair = stats.get(report.selectedCandidatePairId) || pair;
        }
      });

      if (!pair) {
        stats.forEach((report) => {
          if (pair) return;
          if (
            report.type === "candidate-pair" &&
            report.state === "succeeded" &&
            (report.nominated || report.selected)
          ) {
            pair = report;
          }
        });
      }

      if (!pair) return null;

      const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : null;
      const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : null;
      const relayed = local?.candidateType === "relay" || remote?.candidateType === "relay";

      return relayed ? "relay" : "direct";
    } catch (_) {
      return null;
    }
  }

  async function updateRouteLabel(conn) {
    const route = await connectionRoute(conn);
    if (route === "relay") {
      setNetworkLabel("Connected · TURN relay");
    } else if (route === "direct") {
      setNetworkLabel("Connected · direct");
    } else {
      setNetworkLabel("Connected");
    }
  }

  function watchConnection(conn, { onFailure = null, hostSide = false } = {}) {
    const pc = conn?.peerConnection;
    if (!pc) return;

    let failed = false;

    const handleIceState = () => {
      const state = pc.iceConnectionState;

      if (state === "checking") {
        setNetworkLabel(hostSide ? "Guest connecting…" : "Connecting…");
      }

      if (state === "connected" || state === "completed") {
        setTimeout(() => updateRouteLabel(conn), 250);
        setTimeout(() => updateRouteLabel(conn), 1200);
      }

      if (state === "failed" && !failed) {
        failed = true;
        setNetworkLabel("Connection failed · TURN retrying");
        if (typeof onFailure === "function") onFailure();
      }
    };

    pc.addEventListener?.("iceconnectionstatechange", handleIceState);
    pc.addEventListener?.("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        setTimeout(() => updateRouteLabel(conn), 350);
      }
    });

    handleIceState();
  }

  async function requireTurn(statusText) {
    setLobbyStatus(statusText);
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;

    try {
      await loadTurnCredentials();
      return true;
    } catch (error) {
      console.error(error);
      setLobbyStatus(error?.message || "TURN relay is unavailable.", true);
      return false;
    } finally {
      createRoomBtn.disabled = false;
      joinRoomBtn.disabled = joinCode.length !== 4;
    }
  }

  const originalCreateRoom = createRoom;
  const originalJoinRoom = joinRoom;

  createRoomBtn.removeEventListener("click", originalCreateRoom);
  joinRoomBtn.removeEventListener("click", originalJoinRoom);

  createRoomBtn.addEventListener("click", async () => {
    if (!(await requireTurn("Preparing meeting relay…"))) return;
    originalCreateRoom();
  });

  joinRoomBtn.addEventListener("click", async () => {
    if (joinCode.length !== 4) return;
    if (!(await requireTurn("Preparing meeting relay…"))) return;
    joinRoomFreshPeer();
  });

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
    const maxSearchMs = 18_000;
    let retryTimer = null;
    let generation = 0;
    let finished = false;
    let sawWebrtcPath = false;
    let sawWebrtcFailure = false;

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

      if (sawWebrtcPath || sawWebrtcFailure) {
        setLobbyStatus("Room found, but WebRTC could not connect even through TURN.", true);
      } else {
        setLobbyStatus("No room was found with that color code.", true);
      }
    };

    const scheduleFreshAttempt = (delay = 900) => {
      if (finished || attemptToken !== connectionAttempt || roomReady) return;
      clearRetryTimer();
      destroyCurrentGuestPeer();

      if (Date.now() - startedAt >= maxSearchMs) {
        fail();
        return;
      }

      setLobbyStatus(sawWebrtcFailure ? "TURN connection retrying…" : "Still looking for room…");
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
      let welcomed = false;

      const isCurrent = () => (
        !finished &&
        attemptToken === connectionAttempt &&
        thisGeneration === generation &&
        peer === guestPeer
      );

      const attemptTimeout = setTimeout(() => {
        if (isCurrent() && !welcomed) scheduleFreshAttempt();
      }, 6000);

      const stopAttemptTimeout = () => clearTimeout(attemptTimeout);

      guestPeer.on("open", (id) => {
        if (!isCurrent()) return;
        localId = id;

        const conn = guestPeer.connect(targetId, {
          reliable: true,
          serialization: "json",
          metadata: {
            app: "newhouse-coop",
            version: window.COOP_VERSION || "0.1.3"
          }
        });

        hostConnection = conn;

        watchConnection(conn, {
          onFailure: () => {
            if (!isCurrent() || welcomed || roomReady) return;
            sawWebrtcPath = true;
            sawWebrtcFailure = true;
            stopAttemptTimeout();
            scheduleFreshAttempt(500);
          }
        });

        const pc = conn.peerConnection;
        pc?.addEventListener?.("iceconnectionstatechange", () => {
          if (pc.iceConnectionState === "checking" || pc.iceConnectionState === "connected") {
            sawWebrtcPath = true;
          }
        });

        conn.on("open", () => {
          if (!isCurrent() || conn !== hostConnection) return;
          sawWebrtcPath = true;
          setLobbyStatus("Joining room…");
          conn.send({ type: "join", name: localName });
          setTimeout(() => updateRouteLabel(conn), 500);
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
            setTimeout(() => updateRouteLabel(conn), 450);
            setTimeout(() => updateRouteLabel(conn), 1500);
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
          sawWebrtcPath = true;
          sawWebrtcFailure = true;
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

        if (error?.type === "peer-unavailable") {
          stopAttemptTimeout();
          scheduleFreshAttempt();
          return;
        }

        if (error?.type === "webrtc") {
          sawWebrtcPath = true;
          sawWebrtcFailure = true;
          stopAttemptTimeout();
          scheduleFreshAttempt();
          return;
        }

        if (
          error?.type === "network" ||
          error?.type === "socket-error" ||
          error?.type === "socket-closed"
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
