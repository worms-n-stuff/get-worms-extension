/**
 * popup.js
 * - login status ui logic
 * - login button handler
 */
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");

function setStatus(text) {
  statusEl.textContent = text;
}

async function refreshStatus() {
  // Ask background if we currently have a valid session cached
  const resp = await chrome.runtime.sendMessage({
    type: "GW_GET_LOGIN_STATUS",
  });
  if (resp?.loggedIn) {
    setStatus("Logged in");
    loginBtn.style.display = "none";
  } else {
    setStatus("Logged out");
    loginBtn.style.display = "inline-block";
  }
}

loginBtn.addEventListener("click", async () => {
  // Initiate login handshake (background will create state + open tab)
  const resp = await chrome.runtime.sendMessage({ type: "GW_BEGIN_LOGIN" });
  if (resp?.ok) {
    setStatus("Opening login…");
  } else {
    setStatus("Could not start login");
    console.error(resp?.error || "unknown error");
  }
});

document.addEventListener("DOMContentLoaded", refreshStatus);

// on login, refresh UI
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "GW_LOGIN_SUCCESS") {
    document.getElementById("status").textContent = "Logged in";
    const btn = document.getElementById("loginBtn");
    if (btn) btn.style.display = "none";
  }
});
