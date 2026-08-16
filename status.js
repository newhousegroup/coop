(() => {
  const indicator = document.querySelector("#connectionStatus");
  if (!indicator) return;

  const labels = {
    direct: "Direct connection",
    turn: "TURN relay",
    ready: "Ready",
    failure: "Connection failure"
  };

  function inferState(text) {
    const value = String(text || "").trim().toLowerCase();

    if (/fail|error|interrupt|unavailable|could not/.test(value)) return "failure";
    if (value.includes("turn relay")) return "turn";
    if (value.includes("direct")) return "direct";
    return "ready";
  }

  function refreshIndicator() {
    const state = inferState(indicator.textContent);
    const label = labels[state];

    indicator.dataset.state = state;
    indicator.setAttribute("aria-label", label);
    indicator.setAttribute("title", label);
  }

  const observer = new MutationObserver(refreshIndicator);
  observer.observe(indicator, {
    childList: true,
    characterData: true,
    subtree: true
  });

  refreshIndicator();
})();
