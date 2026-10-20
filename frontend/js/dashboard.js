
const API_BASE = "https://safesight-7lgj.onrender.com";
const KEY_STORAGE = "safesight_admin_key";

const SafeSightAPI = {
  adminKey() {
    return sessionStorage.getItem(KEY_STORAGE) || "";
  },

  async request(path, options = {}, requireAdmin = false) {
    const headers = new Headers(options.headers || {});

    if (requireAdmin) {
      headers.set("X-Admin-Key", this.adminKey());
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const contentType = response.headers.get("content-type") || "";
    let data = null;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null
          ? data.detail || data.message || "Request failed"
          : data || "Request failed";

      throw new Error(message);
    }

    return data;
  },
};

const $ = (id) => document.getElementById(id);

const state = {
  reports: [],
  filteredReports: [],
  selectedReportId: null,
  map: null,
  markers: [],
  markerLayer: null,
  loading: false,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStatus(status) {
  return String(status || "pending")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPriority(priority) {
  return String(priority || "medium")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPriorityClass(priority) {
  const value = normalize(priority);

  if (value === "critical" || value === "high") {
    return "high";
  }

  if (value === "low") {
    return "low";
  }

  return "medium";
}

function getStatusClass(status) {
  const value = normalize(status);

  if (value === "resolved" || value === "completed") {
    return "resolved";
  }

  if (value === "in_progress" || value === "in progress") {
    return "in-progress";
  }

  return "pending";
}

function getReportId(report) {
  return report.id ?? report.report_id ?? report.uuid;
}

function getReportLocation(report) {
  return (
    report.location ||
    report.address ||
    report.place ||
    "Location not provided"
  );
}

function getLatitude(report) {
  const value =
    report.latitude ??
    report.lat ??
    report.location_lat ??
    report.location?.latitude;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getLongitude(report) {
  const value =
    report.longitude ??
    report.lng ??
    report.lon ??
    report.location_lng ??
    report.location?.longitude;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getReportTitle(report) {
  return (
    report.title ||
    report.disaster_type ||
    report.incident_type ||
    report.type ||
    "Disaster Report"
  );
}

function getReportDescription(report) {
  return (
    report.description ||
    report.details ||
    report.message ||
    "No description provided."
  );
}

function getReportPriority(report) {
  return report.priority || report.severity || "medium";
}

function getReportStatus(report) {
  return report.status || "pending";
}

function showMessage(elementId, message, type = "info") {
  const element = $(elementId);

  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
  element.hidden = !message;
}

function clearMessage(elementId) {
  const element = $(elementId);

  if (!element) return;

  element.textContent = "";
  element.hidden = true;
}

function setApiStatus(message, healthy = false) {
  const element = $("apiStatus");

  if (!element) return;

  element.textContent = message;
  element.classList.toggle("online", healthy);
  element.classList.toggle("offline", !healthy);
}

function updateCurrentDate() {
  const element = $("currentDate");

  if (!element) return;

  element.textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function updateStats() {
  const reports = state.reports;

  const total = reports.length;

  const high = reports.filter((report) => {
    const priority = normalize(getReportPriority(report));
    return priority === "high" || priority === "critical";
  }).length;

  const pending = reports.filter((report) => {
    const status = normalize(getReportStatus(report));
    return status !== "resolved" && status !== "completed";
  }).length;

  const resolved = reports.filter((report) => {
    const status = normalize(getReportStatus(report));
    return status === "resolved" || status === "completed";
  }).length;

  if ($("totalCount")) $("totalCount").textContent = total;
  if ($("highCount")) $("highCount").textContent = high;
  if ($("pendingCount")) $("pendingCount").textContent = pending;
  if ($("resolvedCount")) $("resolvedCount").textContent = resolved;
}

function initMap() {
  const mapElement = $("incidentMap");

  if (!mapElement || typeof L === "undefined") {
    return;
  }

  if (state.map) {
    state.map.remove();
    state.map = null;
  }

  state.map = L.map(mapElement).setView([20.5937, 78.9629], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);

  state.markerLayer = L.layerGroup().addTo(state.map);
}

function renderMapMarkers(reports) {
  if (!state.map || !state.markerLayer) return;

  state.markerLayer.clearLayers();
  state.markers = [];

  const locatedReports = reports.filter((report) => {
    return (
      getLatitude(report) !== null &&
      getLongitude(report) !== null
    );
  });

  locatedReports.forEach((report) => {
    const latitude = getLatitude(report);
    const longitude = getLongitude(report);

    const marker = L.marker([latitude, longitude]);

    marker.bindPopup(`
      <div>
        <strong>${esc(getReportTitle(report))}</strong>
        <p>${esc(getReportLocation(report))}</p>
        <p>Priority: ${esc(formatPriority(getReportPriority(report)))}</p>
        <p>Status: ${esc(formatStatus(getReportStatus(report)))}</p>
      </div>
    `);

    marker.on("click", () => {
      selectReport(getReportId(report));
    });

    marker.addTo(state.markerLayer);
    state.markers.push(marker);
  });

  if (locatedReports.length > 0) {
    const bounds = L.latLngBounds(
      locatedReports.map((report) => [
        getLatitude(report),
        getLongitude(report),
      ])
    );

    state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }
}

function renderReports() {
  const container = $("reportList");

  if (!container) return;

  const reports = state.filteredReports;

  if ($("reportCountLabel")) {
    $("reportCountLabel").textContent =
      `${reports.length} report${reports.length === 1 ? "" : "s"}`;
  }

  if (reports.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No reports found</h3>
        <p>Try changing the filters or refresh the dashboard.</p>
      </div>
    `;

    updateSelectedPanel(null);
    renderMapMarkers([]);
    return;
  }

  container.innerHTML = reports
    .map((report) => {
      const id = getReportId(report);
      const selected =
        String(id) === String(state.selectedReportId);

      const priority = getReportPriority(report);
      const status = getReportStatus(report);

      return `
        <article
          class="report-card ${selected ? "selected" : ""}"
          data-report-id="${esc(id)}"
          tabindex="0"
          role="button"
          aria-label="View ${esc(getReportTitle(report))}"
        >
          <div class="report-card-header">
            <h3>${esc(getReportTitle(report))}</h3>
            <span class="priority-badge ${getPriorityClass(priority)}">
              ${esc(formatPriority(priority))}
            </span>
          </div>

          <p class="report-description">
            ${esc(getReportDescription(report))}
          </p>

          <div class="report-meta">
            <span>
              <strong>Location:</strong>
              ${esc(getReportLocation(report))}
            </span>

            <span class="status-badge ${getStatusClass(status)}">
              ${esc(formatStatus(status))}
            </span>
          </div>

          <div class="report-footer">
            <span>${esc(formatDate(report.created_at || report.timestamp || report.submitted_at))}</span>
            <span>View details →</span>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".report-card").forEach((card) => {
    const openCard = () => {
      selectReport(card.dataset.reportId);
    };

    card.addEventListener("click", openCard);

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCard();
      }
    });
  });

  const selectedStillVisible = reports.some(
    (report) =>
      String(getReportId(report)) === String(state.selectedReportId)
  );

  if (!selectedStillVisible) {
    state.selectedReportId = getReportId(reports[0]);
  }

  const selectedReport = reports.find(
    (report) =>
      String(getReportId(report)) === String(state.selectedReportId)
  );

  updateSelectedPanel(selectedReport || reports[0]);
  renderMapMarkers(reports);
}

function updateSelectedPanel(report) {
  const panel = $("reportDetails");

  if (!panel) return;

  if (!report) {
    panel.innerHTML = `
      <div class="empty-state">
        <h3>Select a report</h3>
        <p>Choose a report to see its full details.</p>
      </div>
    `;
    return;
  }

  const priority = getReportPriority(report);
  const status = getReportStatus(report);

  const peopleTrapped =
    report.people_trapped ?? report.trapped_people ?? "Not specified";

  const peopleAffected =
    report.people_affected ?? report.affected_people ?? "Not specified";

  const aiSummary =
    report.ai_summary ||
    report.ai_analysis ||
    report.analysis ||
    "No AI summary available.";

  const photoUrl =
    report.image_url ||
    report.photo_url ||
    report.image ||
    report.photo ||
    report.evidence_url ||
    "";

  panel.innerHTML = `
    <div class="details-header">
      <div>
        <h2>${esc(getReportTitle(report))}</h2>
        <p>${esc(getReportLocation(report))}</p>
      </div>

      <span class="priority-badge ${getPriorityClass(priority)}">
        ${esc(formatPriority(priority))}
      </span>
    </div>

    <div class="detail-box">
      <h4 style="margin:0 0 12px">Reporter Contact Details</h4>

      <div class="detail-row">
        <strong>Reporter name</strong>
        ${esc(report.reporter_name || "Not provided")}
      </div>

      <div class="detail-row">
        <strong>Contact number</strong>
        ${
          report.contact_number
            ? `<a href="tel:${esc(report.contact_number)}">${esc(report.contact_number)}</a>`
            : "Not provided"
        }
      </div>
    </div>

    <div class="detail-box">
      <div class="detail-row">
        <strong>Status</strong>
        <span class="status-badge ${getStatusClass(status)}">
          ${esc(formatStatus(status))}
        </span>
      </div>

      <div class="detail-row">
        <strong>Priority score</strong>
        ${esc(report.priority_score ?? "Not available")}
      </div>

      <div class="detail-row">
        <strong>People trapped</strong>
        ${esc(peopleTrapped)}
      </div>

      <div class="detail-row">
        <strong>People affected</strong>
        ${esc(peopleAffected)}
      </div>

      <div class="detail-row">
        <strong>Location</strong>
        ${esc(getReportLocation(report))}
      </div>

      <div class="detail-row">
        <strong>Submitted</strong>
        ${esc(formatDate(report.created_at || report.timestamp || report.submitted_at))}
      </div>
    </div>

    <div class="detail-box">
      <h4>Incident Description</h4>
      <p>${esc(getReportDescription(report))}</p>
    </div>

    <div class="detail-box">
      <h4>AI Analysis</h4>
      <p>${esc(aiSummary)}</p>
    </div>

    ${
      photoUrl
        ? `
          <div class="detail-box">
            <h4>Photo Evidence</h4>
            <a href="${esc(photoUrl)}" target="_blank" rel="noopener noreferrer">
              <img
                src="${esc(photoUrl)}"
                alt="Submitted disaster evidence"
                class="evidence-image"
                style="max-width:100%;height:auto;border-radius:10px"
                onerror="this.style.display='none'"
              />
            </a>
          </div>
        `
        : `
          <div class="detail-box">
            <h4>Photo Evidence</h4>
            <p>No photo evidence attached.</p>
          </div>
        `
    }

    <div class="detail-box">
      <h4>Update Report Status</h4>

      <label for="statusUpdateSelect">New status</label>

      <select id="statusUpdateSelect">
        <option value="pending" ${normalize(status) === "pending" ? "selected" : ""}>
          Pending
        </option>

        <option value="in_progress" ${normalize(status) === "in_progress" || normalize(status) === "in progress" ? "selected" : ""}>
          In Progress
        </option>

        <option value="resolved" ${normalize(status) === "resolved" || normalize(status) === "completed" ? "selected" : ""}>
          Resolved
        </option>
      </select>

      <button
        type="button"
        id="updateStatusBtn"
        class="primary-btn"
        data-report-id="${esc(getReportId(report))}"
      >
        Update Status
      </button>

      <p id="statusUpdateMessage" role="status"></p>
    </div>
  `;

  const updateButton = $("updateStatusBtn");

  if (updateButton) {
    updateButton.addEventListener("click", async () => {
      const reportId = updateButton.dataset.reportId;
      const select = $("statusUpdateSelect");
      const message = $("statusUpdateMessage");

      if (!select || !reportId) return;

      updateButton.disabled = true;
      updateButton.textContent = "Updating...";

      try {
        await updateReportStatus(reportId, select.value);

        if (message) {
          message.textContent = "Report status updated successfully.";
        }

        await loadReports();
      } catch (error) {
        if (message) {
          message.textContent = `Update failed: ${error.message}`;
        }
      } finally {
        updateButton.disabled = false;
        updateButton.textContent = "Update Status";
      }
    });
  }
}

function selectReport(reportId) {
  state.selectedReportId = reportId;

  const report = state.reports.find(
    (item) => String(getReportId(item)) === String(reportId)
  );

  if (!report) return;

  updateSelectedPanel(report);

  const cards = document.querySelectorAll(".report-card");

  cards.forEach((card) => {
    card.classList.toggle(
      "selected",
      String(card.dataset.reportId) === String(reportId)
    );
  });
}

function applyFilters() {
  const searchValue = normalize($("searchInput")?.value);
  const priorityValue = normalize($("priorityFilter")?.value);
  const statusValue = normalize($("statusFilter")?.value);

  state.filteredReports = state.reports.filter((report) => {
    const searchable = [
      getReportTitle(report),
      getReportDescription(report),
      getReportLocation(report),
      report.reporter_name,
      report.contact_number,
      getReportId(report),
    ]
      .map(normalize)
      .join(" ");

    const matchesSearch =
      !searchValue || searchable.includes(searchValue);

    const priority = normalize(getReportPriority(report));
    const matchesPriority =
      !priorityValue ||
      priority === priorityValue ||
      (priorityValue === "high" && priority === "critical");

    const status = normalize(getReportStatus(report));
    const matchesStatus =
      !statusValue ||
      status === statusValue ||
      (statusValue === "completed" && status === "resolved");

    return matchesSearch && matchesPriority && matchesStatus;
  });

  renderReports();
}

async function loadReports() {
  if (state.loading) return;

  state.loading = true;

  showMessage("reportsMessage", "Loading reports...", "info");

  try {
    const data = await SafeSightAPI.request("/api/reports", {}, true);

    const reports = Array.isArray(data)
      ? data
      : Array.isArray(data?.reports)
        ? data.reports
        : Array.isArray(data?.items)
          ? data.items
          : [];

    state.reports = reports;
    updateStats();
    applyFilters();

    clearMessage("reportsMessage");
    setApiStatus("API Connected", true);

    if (reports.length === 0) {
      showMessage("reportsMessage", "No reports have been submitted yet.", "info");
    }
  } catch (error) {
    console.error("Failed to load reports:", error);

    setApiStatus("API Disconnected", false);

    showMessage(
      "reportsMessage",
      `Unable to load reports: ${error.message}`,
      "error"
    );
  } finally {
    state.loading = false;
  }
}

async function updateReportStatus(reportId, status) {
  const payload = { status };

  await SafeSightAPI.request(
    `/api/reports/${encodeURIComponent(reportId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    true
  );
}

function clearFilters() {
  if ($("searchInput")) $("searchInput").value = "";
  if ($("priorityFilter")) $("priorityFilter").value = "";
  if ($("statusFilter")) $("statusFilter").value = "";

  applyFilters();
}

function bindEvents() {
  $("refreshBtn")?.addEventListener("click", loadReports);

  $("searchInput")?.addEventListener("input", applyFilters);

  $("priorityFilter")?.addEventListener("change", applyFilters);

  $("statusFilter")?.addEventListener("change", applyFilters);

  $("clearFiltersBtn")?.addEventListener("click", clearFilters);

  $("logoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem(KEY_STORAGE);
    window.location.href = "login.html";
  });
}

function checkAdminSession() {
  const key = SafeSightAPI.adminKey();

  if (!key) {
    window.location.href = "login.html";
    return false;
  }

  return true;
}

async function initDashboard() {
  updateCurrentDate();

  if (!checkAdminSession()) return;

  initMap();
  bindEvents();

  await loadReports();
}

document.addEventListener("DOMContentLoaded", initDashboard);
