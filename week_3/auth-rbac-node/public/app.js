"use strict";

const $ = (id) => document.getElementById(id);

// All text from the server is written with textContent (never innerHTML),
// so a username like <script> cannot run as code in the page.

function showResponse(method, path, status, data) {
  $("last-status").textContent = `${method} ${path} -> HTTP ${status}`;
  $("last-body").textContent = JSON.stringify(data, null, 2);
}

async function api(method, path, body) {
  const options = { method, headers: {}, credentials: "same-origin" };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body || {});
  }
  let status = 0;
  let data;
  try {
    const response = await fetch(path, options);
    status = response.status;
    data = await response.json();
  } catch (err) {
    data = { error: "Request failed or response was not JSON" };
  }
  showResponse(method, path, status, data);
  return { status, data };
}

async function refreshSession() {
  const { data } = await api("GET", "/api/session");
  $("session-status").textContent = data.authenticated
    ? `Signed in as ${data.username} (${data.role})`
    : "Not signed in";
}

function renderAdminTable(users) {
  const table = $("admin-table");
  const tbody = table.querySelector("tbody");
  tbody.replaceChildren();
  for (const user of users) {
    const row = document.createElement("tr");
    for (const value of [user.id, user.username, user.role, user.created_at]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.hidden = false;
}

function readForm(prefix) {
  const username = $(`${prefix}-username`).value.trim();
  const password = $(`${prefix}-password`).value;
  if (!username || !password) {
    showResponse("(client check)", prefix, 0, { error: "Username and password are required" });
    return null;
  }
  return { username, password };
}

$("btn-public").addEventListener("click", () => api("GET", "/api/public"));

$("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const creds = readForm("reg");
  if (!creds) return;
  const { status } = await api("POST", "/api/register", creds);
  if (status === 201) $("reg-password").value = "";
});

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const creds = readForm("login");
  if (!creds) return;
  const { status } = await api("POST", "/api/login", creds);
  $("login-password").value = "";
  if (status === 200) {
    const { data } = await api("GET", "/api/session");
    $("session-status").textContent = `Signed in as ${data.username} (${data.role})`;
  }
});

$("btn-logout").addEventListener("click", async () => {
  await api("POST", "/api/logout");
  $("admin-table").hidden = true;
  $("session-status").textContent = "Not signed in";
});

$("btn-profile").addEventListener("click", () => api("GET", "/api/profile"));

$("btn-admin").addEventListener("click", async () => {
  const { status, data } = await api("GET", "/api/admin/users");
  if (status === 200) {
    renderAdminTable(data.users);
  } else {
    $("admin-table").hidden = true;
  }
});

refreshSession();
