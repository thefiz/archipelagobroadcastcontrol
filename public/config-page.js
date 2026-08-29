const login = document.querySelector("#configLogin");
const app = document.querySelector("#configApp");
const keyInput = document.querySelector("#configKey");
const loginButton = document.querySelector("#configLoginButton");
const loginNotice = document.querySelector("#configLoginNotice");
const rotationSeconds = document.querySelector("#rotationSeconds");
const asapOverrideSeconds = document.querySelector("#asapOverrideSeconds");
const fallbackRotationSeconds = document.querySelector("#fallbackRotationSeconds");
const fallbackTargets = document.querySelector("#fallbackTargets");
const addFallbackTarget = document.querySelector("#addFallbackTarget");
const rotationValidStatuses = document.querySelector("#rotationValidStatuses");
const statusSettings = document.querySelector("#statusSettings");
const saveButton = document.querySelector("#saveConfig");
const reloadButton = document.querySelector("#reloadConfig");
const notice = document.querySelector("#configNotice");

let adminKey = "";
let currentSettings = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
      ...(options.headers || {})
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({ ok:false, error:`HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function addFallbackRow(value = "") {
  const row = document.createElement("div");
  row.className = "fallback-target-row";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 64;
  input.value = value;
  input.placeholder = "fallback-1";
  input.dataset.fallbackTarget = "true";
  input.setAttribute("aria-label", "Fallback target ID");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "small-button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());

  row.append(input, remove);
  fallbackTargets.append(row);
}

function render(settings) {
  currentSettings = settings;
  rotationSeconds.value = settings.rotationSeconds;
  asapOverrideSeconds.value = settings.asapOverrideSeconds;
  fallbackRotationSeconds.value = settings.fallbackRotationSeconds;
  fallbackTargets.replaceChildren();
  for (const target of settings.fallbackTargets || []) addFallbackRow(target);
  rotationValidStatuses.replaceChildren();
  for (const [key, definition] of Object.entries(settings.statuses)) { const option=document.createElement("label"); option.className="rotation-status-option"; const checkbox=document.createElement("input"); checkbox.type="checkbox"; checkbox.checked=(settings.rotationValidStatuses||[]).includes(key); checkbox.dataset.rotationStatus=key; const text=document.createElement("span"); text.textContent=`${definition.label} (${key})`; option.append(checkbox,text); rotationValidStatuses.append(option); }
  statusSettings.replaceChildren();

  for (const [key, definition] of Object.entries(settings.statuses)) {
    const row = document.createElement("div");
    row.className = "config-status-row";

    const rawKey = document.createElement("div");
    rawKey.className = "config-key";
    rawKey.textContent = key;

    const label = document.createElement("input");
    label.type = "text";
    label.maxLength = 80;
    label.value = definition.label;
    label.dataset.statusLabel = key;
    label.setAttribute("aria-label", `${key} display label`);

    const timeout = document.createElement("input");
    timeout.type = "number";
    timeout.min = "0";
    timeout.max = "86400";
    timeout.step = "1";
    timeout.value = definition.expiresSeconds;
    timeout.dataset.statusTimeout = key;
    timeout.setAttribute("aria-label", `${key} timeout seconds`);

    row.append(rawKey, label, timeout);
    statusSettings.append(row);
  }
}

async function loadSettings() {
  notice.textContent = "Loading…";
  const result = await api("/api/admin/runtime-config");
  render(result.settings);
  notice.textContent = "";
}

async function authenticate() {
  adminKey = keyInput.value;
  loginNotice.textContent = "Checking key…";
  try {
    await loadSettings();
    login.classList.add("hidden");
    app.classList.remove("hidden");
    loginNotice.textContent = "";
  } catch (error) {
    adminKey = "";
    loginNotice.textContent = error.message;
  }
}

async function save() {
  const statuses = {};
  for (const key of Object.keys(currentSettings.statuses)) {
    statuses[key] = {
      label: document.querySelector(`[data-status-label="${key}"]`).value,
      expiresSeconds: Number(document.querySelector(`[data-status-timeout="${key}"]`).value)
    };
  }
  const payload = {
    rotationSeconds: Number(rotationSeconds.value),
    asapOverrideSeconds: Number(asapOverrideSeconds.value),
    fallbackRotationSeconds: Number(fallbackRotationSeconds.value),
    fallbackTargets: [...document.querySelectorAll("[data-fallback-target]")].map((input) => input.value.trim()),
    rotationValidStatuses: [...document.querySelectorAll("[data-rotation-status]:checked")].map((input)=>input.dataset.rotationStatus),
    statuses
  };

  notice.textContent = "Saving…";
  saveButton.disabled = true;
  try {
    const result = await api("/api/admin/runtime-config", { method:"POST", body:JSON.stringify(payload) });
    render(result.settings);
    notice.textContent = "Saved. Changes are active now.";
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

addFallbackTarget.addEventListener("click", () => addFallbackRow(`fallback-${document.querySelectorAll("[data-fallback-target]").length + 1}`));
loginButton.addEventListener("click", authenticate);
keyInput.addEventListener("keydown", (event) => { if (event.key === "Enter") authenticate(); });
saveButton.addEventListener("click", save);
reloadButton.addEventListener("click", () => loadSettings().catch((error) => { notice.textContent = error.message; }));
