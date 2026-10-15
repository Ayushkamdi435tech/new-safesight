

const API_BASE = "https://safesight-7lgj.onrender.com";
const KEY_STORAGE = "safesight_admin_key";

const SafeSightAPI = {
  base: API_BASE,

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

    const response = await fetch(
      path.startsWith("http") ? path : `${API_BASE}${path}`,
      {
        ...options,
        headers
      }
    );

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : {};

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
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function setMessage(message, isError = false) {
    const element = $("reports-message");

    if (!element) return;

    element.textContent = message;
    element.className = isError ? "error" : "";
  }

  function initializeMap() {
    const mapElement = $("incident-map");

    if (!mapElement || !window.L) return;

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
    $("logout-btn")?.addEventListener("click", () => {
      sessionStorage.removeItem(KEY_STORAGE);
      window.location.href = "login.html";
    });

    $("refresh-btn")?.addEventListener("click", load);

    $("priority-filter")?.addEventListener("change", render);
    $("status-filter")?.addEventListener("change", render);
    $("search-filter")?.addEventListener("input", render);
  }

  function updateCounters() {
    if ($("total-count")) {
      $("total-count").textContent = reports.length;
    }

    if ($("high-count")) {
      $("high-count").textContent = reports.filter(
        (report) => report.priority === "HIGH"
      ).length;
    }

    if ($("pending-count")) {
      $("pending-count").textContent = reports.filter(
        (report) => report.status === "PENDING_VERIFICATION"
      ).length;
    }

    if ($("active-count")) {
      $("active-count").textContent = reports.filter(
        (report) => report.status === "RESCUE_IN_PROGRESS"
      ).length;
    }
  }

  async function load() {
    if (loading) return;

    loading = true;
    setMessage("Loading reports…");

    if ($("refresh-btn")) {
      $("refresh-btn").disabled = true;
    }

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

      setMessage(
        "Updated " +
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      );
    } catch (error) {
      console.error("Could not load reports:", error);
      setMessage(error.message || "Could not load reports.", true);

      const box = $("reports-list");

      if (box) {
        box.innerHTML = `
          <div class="empty-state">
            <span>!</span>
            <b>Could not load reports</b>
            <p>${esc(error.message)}</p>
          </div>
        `;
      }
    } finally {
      loading = false;

      if ($("refresh-btn")) {
        $("refresh-btn").disabled = false;
      }
    }
  }

  function getFilteredReports() {
    const priority = $("priority-filter")?.value || "";
    const status = $("status-filter")?.value || "";
    const search = ($("search-filter")?.value || "")
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
    const box = $("reports-list");

    if (!box) return;

    const items = getFilteredReports();

    if ($("visible-count")) {
      $("visible-count").textContent =
        `${items.length} report${items.length === 1 ? "" : "s"}`;
    }

    box.innerHTML = "";

    if (!items.length) {
      box.innerHTML = `
        <div class="empty-state">
          <span>⌕</span>
          <b>No matching reports</b>
          <p>Try changing the filters or submit a test report in the Citizen Panel.</p>
        </div>
      `;
    }

    items.forEach((report) => {
      const card = document.createElement("article");

      card.className =
        "report-card" +
        (selectedId === report.public_id ? " selected" : "");

      const options = statuses.map(([value, label]) => `
        <option value="${value}"
          ${report.status === value ? "selected" : ""}>
          ${label}
        </option>
      `).join("");

      const latitude = safeCoordinate(report.latitude);
      const longitude = safeCoordinate(report.longitude);

      card.innerHTML = `
        <div class="report-top">
          <span class="report-id">${esc(report.public_id)}</span>
          <span class="badge ${esc(String(report.priority || "").toLowerCase())}">
            ${esc(report.priority || "UNRATED")} PRIORITY
          </span>
        </div>

        <h3>${esc(report.disaster_type || "Unknown disaster")}</h3>

        <p class="report-description">
          ${esc(report.description || "No description")}
        </p>

        <div class="report-meta">
          <span>⌖ ${
            latitude !== null && longitude !== null
              ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
              : "Location unavailable"
          }</span>

          <span>♙ ${esc(report.people_affected ?? "Unknown")} affected</span>
          <span>◷ ${esc(dateLabel(report.created_at))}</span>
        </div>

        <div class="report-controls">
          <select aria-label="Update report status">
            ${options}
          </select>

          <button type="button" class="button" data-update>
            Save status
          </button>

          <button type="button" class="button button-mini-secondary" data-view>
            Details
          </button>
        </div>
      `;

      const statusSelect = card.querySelector("select");
      const updateButton = card.querySelector("[data-update]");
      const viewButton = card.querySelector("[data-view]");

      updateButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await updateStatus(report.public_id, statusSelect.value);
      });

      viewButton.addEventListener("click", (event) => {
        event.stopPropagation();
        show(report);
      });

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
      L.marker([
        Number(report.latitude),
        Number(report.longitude)
      ])
        .addTo(layer)
        .bindPopup(`
          <b>${esc(report.public_id)}</b><br>
          ${esc(report.disaster_type)}<br>
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

    document.querySelectorAll(".report-card").forEach((card) => {
      card.classList.toggle(
        "selected",
        card.querySelector(".report-id")?.textContent === report.public_id
      );
    });

    const lat = safeCoordinate(report.latitude);
    const lng = safeCoordinate(report.longitude);

    if (map && layer && lat !== null && lng !== null) {
      map.setView([lat, lng], 14);

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

  function updateSelectedPanel(report) {
    const panel = $("selected-report");

    if (!panel) return;

    if (currentPhotoUrl) {
      URL.revokeObjectURL(currentPhotoUrl);
      currentPhotoUrl = null;
    }

    panel.className = "selected-report";

    const lat = safeCoordinate(report.latitude);
    const lng = safeCoordinate(report.longitude);

    panel.innerHTML = `
      <div class="report-top">
        <span class="report-id">${esc(report.public_id)}</span>

        <span class="badge ${esc(String(report.priority || "").toLowerCase())}">
          ${esc(report.priority || "UNRATED")} PRIORITY
        </span>
      </div>

      <h3 style="margin-top:12px">
        ${esc(report.disaster_type || "Unknown disaster")}
      </h3>

      <p>${esc(report.description || "No description")}</p>

      <div class="detail-grid">
        <div class="detail-cell">
          <small>CURRENT STATUS</small>
          <b>${esc(String(report.status || "Unknown").replaceAll("_", " "))}</b>
        </div>

        <div class="detail-cell">
          <small>PRIORITY SCORE</small>
          <b>${esc(report.priority_score ?? "Not available")}</b>
        </div>

        <div class="detail-cell">
          <small>PEOPLE TRAPPED</small>
          <b>${report.people_trapped ? "Reported yes" : "Not reported"}</b>
        </div>

        <div class="detail-cell">
          <small>PEOPLE AFFECTED</small>
          <b>${esc(report.people_affected ?? "Unknown")}</b>
        </div>
      </div>

      <p><b>Location:</b> ${
        lat !== null && lng !== null
          ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          : "Unavailable"
      }</p>

      <p><b>Submitted:</b> ${esc(dateLabel(report.created_at))}</p>

      <p><b>AI summary:</b> ${esc(report.ai_summary || "Not available")}</p>

      <div class="photo-evidence" style="margin:12px 0">
        <p><b>Photo evidence</b></p>

        ${
          report.image_path
            ? `
              <button
                type="button"
                class="button"
                id="loadPhotoBtn"
              >
                View incident photo
              </button>

              <div id="photoContainer" style="margin-top:12px"></div>
            `
            : "<p>No photo attached.</p>"
        }
      </div>

      <p class="field-hint">
        Verify incidents before taking operational action.
      </p>
    `;

    const loadPhotoBtn = $("loadPhotoBtn");

    if (loadPhotoBtn) {
      loadPhotoBtn.addEventListener("click", async () => {
        const container = $("photoContainer");

        loadPhotoBtn.disabled = true;
        loadPhotoBtn.textContent = "Loading photo...";

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
              // Keep the default error message.
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
          loadPhotoBtn.textContent = "Photo loaded";
        } catch (error) {
          console.error("Photo loading failed:", error);

          container.textContent =
            error.message || "Could not load the photo.";

          loadPhotoBtn.textContent = "Try again";
          loadPhotoBtn.disabled = false;
        }
      });
    }
  }

  async function updateStatus(id, status) {
    try {
      setMessage("Updating report status…");

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

      setMessage("Report status updated successfully.");
    } catch (error) {
      console.error("Status update failed:", error);
      alert("Status update failed: " + error.message);
    }
  }

  function start() {
    if (!SafeSightAPI.adminKey()) {
      window.location.href = "login.html";
      return;
    }

    initializeMap();
    bindEvents();
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
