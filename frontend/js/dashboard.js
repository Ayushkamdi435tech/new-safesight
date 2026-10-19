
const API_BASE = "https://safesight-7lgj.onrender.com";
const KEY_STORAGE = "safesight_admin_key";

const SafeSightAPI = {
  adminKey() {
    return sessionStorage.getItem(KEY_STORAGE) || "";
  },

  async request(path, options = {}, requireAdmin = false) {
    const headers = new Headers(options.headers || {});

    if (requireAdmin) {
      const key = this.adminKey();

      if (!key) {
        window.location.href = "login.html";
        throw new Error("Admin session expired. Please log in again.");
      }

      headers.set("X-Admin-Key", key);
    }

    let response;

    try {
      response = await fetch(
        path.startsWith("http") ? path : `${API_BASE}${path}`,
        { ...options, headers }
      );
    } catch (error) {
      throw new Error(
        "Cannot connect to the backend. Check the Render service and CORS settings."
      );
    }

    const contentType = response.headers.get("content-type") || "";
    let data = {};

    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch {
        data = {};
      }
    }

    if (response.status === 401 && requireAdmin) {
      sessionStorage.removeItem(KEY_STORAGE);
      window.location.href = "login.html";
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      throw new Error(
        data.detail || `Request failed (${response.status})`
      );
    }

    return data;
  }
};

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const statuses = [
    ["PENDING_VERIFICATION", "Pending verification"],
    ["VERIFIED", "Verified"],
    ["RESCUE_IN_PROGRESS", "Rescue in progress"],
    ["RESOLVED", "Resolved"],
    ["REJECTED", "Rejected"]
  ];

  let reports = [];
  let map = null;
  let layer = null;
  let selectedId = null;
  let loading = false;
  let currentPhotoUrl = null;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function dateLabel(value) {
    if (!value) return "Unknown date";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Unknown date";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function safeCoordinate(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function setMessage(id, message, type = "info") {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.className = `message show ${type}`;
  }

  function clearMessage(id) {
    const element = $(id);
    if (!element) return;

    element.textContent = "";
    element.className = "message";
  }

  function setApiStatus(message, isError = false) {
    const element = $("apiStatus");
    if (!element) return;

    element.textContent = message;

    const dot = element.previousElementSibling;
    if (dot) {
      dot.style.background = isError ? "#f87171" : "#34d399";
    }
  }

  function initializeMap() {
    const mapElement = $("incidentMap");

    if (!mapElement || !window.L) {
      console.warn("Map container or Leaflet library is unavailable.");
      return;
    }

    try {
      map = L.map(mapElement).setView([19.2, 75.7], 6);

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19
        }
      ).addTo(map);

      layer = L.layerGroup().addTo(map);
    } catch (error) {
      console.error("Map initialization failed:", error);
    }
  }

  function bindEvents() {
    $("logoutBtn")?.addEventListener("click", () => {
      sessionStorage.removeItem(KEY_STORAGE);

      if (currentPhotoUrl) {
        URL.revokeObjectURL(currentPhotoUrl);
      }

      window.location.href = "login.html";
    });

    $("refreshBtn")?.addEventListener("click", load);

    $("priorityFilter")?.addEventListener("change", render);
    $("statusFilter")?.addEventListener("change", render);
    $("searchInput")?.addEventListener("input", render);

    $("clearFiltersBtn")?.addEventListener("click", () => {
      $("priorityFilter").value = "";
      $("statusFilter").value = "";
      $("searchInput").value = "";
      render();
    });

    if ($("currentDate")) {
      $("currentDate").textContent = new Date().toLocaleDateString(
        [],
        {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric"
        }
      );
    }
  }

  function updateCounters() {
    $("totalCount").textContent = reports.length;

    $("highCount").textContent = reports.filter(
      (report) => report.priority === "HIGH"
    ).length;

    $("pendingCount").textContent = reports.filter(
      (report) => report.status === "PENDING_VERIFICATION"
    ).length;

    $("resolvedCount").textContent = reports.filter(
      (report) => report.status === "RESOLVED"
    ).length;
  }

  async function load() {
    if (loading) return;

    loading = true;

    const refreshButton = $("refreshBtn");
    if (refreshButton) refreshButton.disabled = true;

    setApiStatus("Connecting to API…");
    setMessage("reportsMessage", "Loading incident reports…", "info");
    clearMessage("globalMessage");

    try {
      const result = await SafeSightAPI.request(
        "/api/reports",
        {},
        true
      );

      reports = Array.isArray(result)
        ? result
        : Array.isArray(result.reports)
          ? result.reports
          : [];

      updateCounters();
      render();

      setApiStatus("API connected");
      setMessage(
        "reportsMessage",
        `Successfully loaded ${reports.length} report${reports.length === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (error) {
      console.error("Could not load reports:", error);

      setApiStatus("API connection failed", true);
      setMessage(
        "reportsMessage",
        error.message || "Could not load reports.",
        "error"
      );

      $("reportList").innerHTML = `
        <div class="empty">
          <div class="emoji">!</div>
          <b>Could not load incident reports</b>
          <p>${esc(error.message)}</p>
          <p>Check the Render backend, authentication and CORS settings.</p>
        </div>
      `;

      if ($("totalCount")) $("totalCount").textContent = "—";
      if ($("highCount")) $("highCount").textContent = "—";
      if ($("pendingCount")) $("pendingCount").textContent = "—";
      if ($("resolvedCount")) $("resolvedCount").textContent = "—";
    } finally {
      loading = false;
      if (refreshButton) refreshButton.disabled = false;

      if (map) {
        setTimeout(() => map.invalidateSize(), 100);
      }
    }
  }

  function getFilteredReports() {
    const priority = $("priorityFilter")?.value || "";
    const status = $("statusFilter")?.value || "";
    const search = ($("searchInput")?.value || "")
      .trim()
      .toLowerCase();

    return reports.filter((report) => {
      const matchesPriority =
        !priority || report.priority === priority;

      const matchesStatus =
        !status || report.status === status;

      const searchableText = [
        report.public_id,
        report.disaster_type,
        report.description,
        report.status,
        report.priority
      ].join(" ").toLowerCase();

      return (
        matchesPriority &&
        matchesStatus &&
        (!search || searchableText.includes(search))
      );
    });
  }

  function render() {
    const box = $("reportList");
    if (!box) return;

    const items = getFilteredReports();

    if ($("reportCountLabel")) {
      $("reportCountLabel").textContent =
        `${items.length} report${items.length === 1 ? "" : "s"}`;
    }

    box.innerHTML = "";

    if (!items.length) {
      box.innerHTML = `
        <div class="empty">
          <div class="emoji">⌕</div>
          <b>No matching reports</b>
          <p>Try changing the filters or submit a report through the Citizen Portal.</p>
        </div>
      `;
    }

    items.forEach((report) => {
      const card = document.createElement("article");
      card.className = "report-item";

      if (selectedId === report.public_id) {
        card.style.borderColor = "#60a5fa";
        card.style.background = "#fbfdff";
      }

      const priority = String(report.priority || "UNRATED");
      const options = statuses.map(([value, label]) => `
        <option value="${value}"
          ${report.status === value ? "selected" : ""}>
          ${label}
        </option>
      `).join("");

      const lat = safeCoordinate(report.latitude);
      const lng = safeCoordinate(report.longitude);

      card.innerHTML = `
        <div class="report-top">
          <span class="report-id">${esc(report.public_id || "No ID")}</span>
          <span class="badge ${esc(priority.toLowerCase())}">
            ${esc(priority)} PRIORITY
          </span>
        </div>

        <h4>${esc(report.disaster_type || "Unknown disaster")}</h4>

        <p class="report-description">
          ${esc(report.description || "No description provided.")}
        </p>

        <div class="report-meta">
          <span>⌖ ${
            lat !== null && lng !== null
              ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
              : "Location unavailable"
          }</span>
          <span>♙ ${esc(report.people_affected ?? "Unknown")} affected</span>
          <span>◷ ${esc(dateLabel(report.created_at))}</span>
          <span class="badge status">
            ${esc(String(report.status || "Unknown").replaceAll("_", " "))}
          </span>
        </div>

        <div class="report-actions">
          <select class="field" aria-label="Update report status">
            ${options}
          </select>

          <button type="button" class="btn btn-blue" data-update>
            Save status
          </button>

          <button type="button" class="btn btn-light" data-view>
            Details
          </button>
        </div>
      `;

      const statusSelect = card.querySelector("select");

      card.querySelector("[data-update]").addEventListener(
        "click",
        async (event) => {
          event.stopPropagation();
          await updateStatus(report.public_id, statusSelect.value);
        }
      );

      card.querySelector("[data-view]").addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          show(report);
        }
      );

      card.addEventListener("click", () => show(report));
      box.appendChild(card);
    });

    renderMarkers(items);

    if (selectedId) {
      const selected = reports.find(
        (report) => report.public_id === selectedId
      );

      if (selected) {
        updateSelectedPanel(selected);
      }
    }
  }

  function renderMarkers(items) {
    if (!map || !layer) return;

    layer.clearLayers();

    const locatedReports = items.filter((report) => {
      const lat = safeCoordinate(report.latitude);
      const lng = safeCoordinate(report.longitude);

      return (
        lat !== null &&
        lng !== null &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      );
    });

    locatedReports.forEach((report) => {
      const lat = Number(report.latitude);
      const lng = Number(report.longitude);

      L.marker([lat, lng])
        .addTo(layer)
        .bindPopup(`
          <b>${esc(report.public_id || "Report")}</b><br>
          ${esc(report.disaster_type || "Unknown disaster")}<br>
          ${esc(report.priority || "UNRATED")} priority
        `)
        .on("click", () => show(report));
    });

    if (locatedReports.length && !selectedId) {
      const first = locatedReports[0];

      map.setView(
        [Number(first.latitude), Number(first.longitude)],
        locatedReports.length === 1 ? 13 : 7
      );
    }
  }

  function show(report) {
    selectedId = report.public_id;
    updateSelectedPanel(report);

    document.querySelectorAll(".report-item").forEach((card) => {
      const id = card.querySelector(".report-id")?.textContent;
      const selected = id === String(report.public_id || "No ID");

      card.style.borderColor = selected ? "#60a5fa" : "";
      card.style.background = selected ? "#fbfdff" : "";
    });

    const lat = safeCoordinate(report.latitude);
    const lng = safeCoordinate(report.longitude);

    if (map && lat !== null && lng !== null) {
      map.setView([lat, lng], 14);

      if (layer) {
        layer.eachLayer((marker) => {
          const position = marker.getLatLng();

          if (
            Math.abs(position.lat - lat) < 0.000001 &&
            Math.abs(position.lng - lng) < 0.000001
          ) {
            marker.openPopup();
          }
        });
      }
    }
  }

  function updateSelectedPanel(report) {
    const panel = $("reportDetails");
    if (!panel) return;

    if (currentPhotoUrl) {
      URL.revokeObjectURL(currentPhotoUrl);
      currentPhotoUrl = null;
    }

    const lat = safeCoordinate(report.latitude);
    const lng = safeCoordinate(report.longitude);

    panel.className = "";
    panel.innerHTML = `
      <div class="report-top">
        <span class="report-id">${esc(report.public_id || "No ID")}</span>
        <span class="badge ${esc(String(report.priority || "").toLowerCase())}">
          ${esc(report.priority || "UNRATED")} PRIORITY
        </span>
      </div>

      <h3 style="margin-top:12px">
        ${esc(report.disaster_type || "Unknown disaster")}
      </h3>

      <p class="report-description">
        ${esc(report.description || "No description provided.")}
      </p>

      <div class="detail-box">
        <div class="detail-row">
          <strong>Current status</strong>
          ${esc(String(report.status || "Unknown").replaceAll("_", " "))}
        </div>
        <div class="detail-row">
          <strong>Priority score</strong>
          ${esc(report.priority_score ?? "Not available")}
        </div>
        <div class="detail-row">
          <strong>People trapped</strong>
          ${report.people_trapped ? "Yes" : "Not reported"}
        </div>
        <div class="detail-row">
          <strong>People affected</strong>
          ${esc(report.people_affected ?? "Unknown")}
        </div>
        <div class="detail-row">
          <strong>Location</strong>
          ${
            lat !== null && lng !== null
              ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
              : "Unavailable"
          }
        </div>
        <div class="detail-row">
          <strong>Submitted</strong>
          ${esc(dateLabel(report.created_at))}
        </div>
        <div class="detail-row">
          <strong>AI summary</strong>
          ${esc(report.ai_summary || "Not available")}
        </div>
      </div>

      <div class="detail-box">
        <strong>Photo evidence</strong>
        <div id="photoContainer" style="margin-top:12px">
          ${
            report.image_path
              ? `<button type="button" class="btn btn-blue" id="loadPhotoBtn">View incident photo</button>`
              : `<p class="report-description">No photo attached.</p>`
          }
        </div>
      </div>

      <p class="report-description">
        Verify incidents before taking operational action.
      </p>
    `;

    const loadPhotoBtn = $("loadPhotoBtn");

    if (loadPhotoBtn) {
      loadPhotoBtn.addEventListener("click", async () => {
        const container = $("photoContainer");

        loadPhotoBtn.disabled = true;
        loadPhotoBtn.textContent = "Loading photo…";

        try {
          const response = await fetch(
            `${API_BASE}/api/reports/${encodeURIComponent(report.public_id)}/photo`,
            {
              headers: {
                "X-Admin-Key": SafeSightAPI.adminKey()
              }
            }
          );

          if (response.status === 401) {
            sessionStorage.removeItem(KEY_STORAGE);
            window.location.href = "login.html";
            return;
          }

          if (!response.ok) {
            let message = "Unable to load photo.";

            try {
              const error = await response.json();
              message = error.detail || message;
            } catch {
              // Keep the default message.
            }

            throw new Error(message);
          }

          const imageBlob = await response.blob();

          if (!imageBlob.type.startsWith("image/")) {
            throw new Error("The server did not return an image.");
          }

          if (currentPhotoUrl) {
            URL.revokeObjectURL(currentPhotoUrl);
          }

          currentPhotoUrl = URL.createObjectURL(imageBlob);

          const image = document.createElement("img");
          image.src = currentPhotoUrl;
          image.alt = `Incident photo for ${report.public_id}`;
          image.style.width = "100%";
          image.style.maxWidth = "500px";
          image.style.maxHeight = "420px";
          image.style.objectFit = "contain";
          image.style.borderRadius = "8px";
          image.style.display = "block";

          container.replaceChildren(image);
        } catch (error) {
          console.error("Photo loading failed:", error);

          container.textContent =
            error.message || "Could not load the photo.";
        } finally {
          if (loadPhotoBtn.isConnected) {
            loadPhotoBtn.disabled = false;
            loadPhotoBtn.textContent = "View incident photo";
          }
        }
      });
    }
  }

  async function updateStatus(id, status) {
    try {
      setMessage("globalMessage", "Updating report status…", "info");

      await SafeSightAPI.request(
        `/api/reports/${encodeURIComponent(id)}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status })
        },
        true
      );

      selectedId = id;
      await load();

      const updatedReport = reports.find(
        (report) => report.public_id === id
      );

      if (updatedReport) {
        show(updatedReport);
      }

      setMessage(
        "globalMessage",
        "Report status updated successfully.",
        "success"
      );
    } catch (error) {
      console.error("Status update failed:", error);

      setMessage(
        "globalMessage",
        `Status update failed: ${error.message}`,
        "error"
      );
    }
  }

  async function start() {
    if (!SafeSightAPI.adminKey()) {
      window.location.replace("login.html");
      return;
    }

    bindEvents();
    initializeMap();
    await load();

    if (map) {
      setTimeout(() => map.invalidateSize(), 200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
