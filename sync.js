(() => {
  let attachedConnection = null;
  let attachTimer = null;

  function attachGuestReceivePath() {
    if (typeof isHost === "undefined" || isHost) return;
    if (typeof roomReady === "undefined" || !roomReady) return;
    if (typeof hostConnection === "undefined" || !hostConnection) return;
    if (hostConnection === attachedConnection) return;

    attachedConnection = hostConnection;
    const conn = hostConnection;

    // network.js deliberately stops its join-attempt listener once the welcome
    // handshake succeeds. Keep a separate steady-state listener alive for all
    // packets sent by the host after that point.
    conn.on("data", (data) => {
      if (conn !== hostConnection || !roomReady) return;
      if (!data || typeof data !== "object") return;
      handleGuestData(data);
    });

    conn.on("close", () => {
      if (conn !== hostConnection) return;
      if (roomReady) returnToLobby("The host left the room.");
    });

    conn.on("error", () => {
      if (conn !== hostConnection || !roomReady) return;
      if (typeof connectionStatus !== "undefined") {
        connectionStatus.textContent = "Connection interrupted";
      }
    });
  }

  function startAttachLoop() {
    if (attachTimer !== null) return;

    attachTimer = setInterval(() => {
      if (attachedConnection && attachedConnection !== hostConnection) {
        attachedConnection = null;
      }
      attachGuestReceivePath();
    }, 100);
  }

  startAttachLoop();

  window.addEventListener("beforeunload", () => {
    if (attachTimer !== null) {
      clearInterval(attachTimer);
      attachTimer = null;
    }
  });
})();
