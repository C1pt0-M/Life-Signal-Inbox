const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  return response.json();
}

export function getSamples() {
  return request("/api/samples");
}

export function getConfig() {
  return request("/api/config");
}

export function getHistory() {
  return request("/api/history");
}

export function extractNotice(payload) {
  return request("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function saveTodos(items) {
  return request("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

export function validateTodos(items) {
  return request("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, historical_items: [] }),
  });
}

export async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  return request("/api/ocr", {
    method: "POST",
    body: formData,
  });
}

export function exportIcs() {
  window.location.href = `${API_BASE}/api/export.ics`;
}
