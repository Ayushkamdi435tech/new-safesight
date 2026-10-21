const API_BASE = (
  localStorage.getItem("safesight_api_base") ||
  "https://safesight-7lgj.onrender.com"
).replace(/\/$/, "");
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

  if (
    value === "rescue_in_progress" ||
    value === "in_progress" ||
    value === "in progress"
  ) {
    return "in-progress";
  }

  if (value === "verified") {
    return "verified";
  }

  if (value === "rejected") {
    return "rejected";
  }

  return "pending";
}

// Supports the public_id returned by the SafeSight API.
function getReportId(report) {
  return (
    report.public_id ??
    report.id ??
    report.report_id ??
    report.uuid
  );
}

function getReportLocation(report) {
  if (report.location || report.address || report.place) {
    return report.location || report.address || report.place;
  }
  const lat = getLatitude(report);
  const lng = getLongitude(report);
  if (lat !== null && lng !== null) {
    return `Coordinates: ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  }
  return "Location not available";
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
  // Use the .show CSS class (defined in dashboard.html <style>)
  element.className = `message show ${type}`;
}

function clearMessage(elementId) {
  const element = $(elementId);

  if (!element) return;

  element.textContent = "";
  element.className = "message";
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

    state.map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 13,
    });
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
          role="article"
          aria-label="Incident ${esc(id)}: ${esc(getReportTitle(report))}"
        >
          <div class="report-top">
            <div class="report-top-left">
              <span class="report-id">#${esc(id)}</span>
              <h3>${esc(getReportTitle(report))}</h3>
            </div>
            <div class="report-top-badges">
              <span class="badge ${getPriorityClass(priority)}">
                ${esc(formatPriority(priority))}
              </span>
              <span class="badge status ${getStatusClass(status)}">
                ${esc(formatStatus(status))}
              </span>
            </div>
          </div>

          <div class="report-footer">
            <div class="report-footer-right">
              <button
                type="button"
                class="btn-view-details"
                data-report-id="${esc(id)}"
                aria-label="View full details for report ${esc(id)}"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                View Details
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  // Attach event listeners to each View Details button
  container.querySelectorAll(".btn-view-details").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const reportId = button.dataset.reportId;
      openReportModal(reportId);
    });
  });

  // Clicking anywhere on a card selects that report
  container.querySelectorAll(".report-card").forEach((card) => {
    const handleSelect = (event) => {
      if (event.target.closest(".btn-view-details")) return;
      selectReport(card.dataset.reportId);
    };

    card.addEventListener("click", handleSelect);

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        if (event.target.closest(".btn-view-details")) return;
        event.preventDefault();
        handleSelect(event);
      }
    });
  });

  const selectedStillVisible = reports.some(
    (report) =>
      String(getReportId(report)) === String(state.selectedReportId)
  );

  if (!selectedStillVisible && reports.length > 0) {
    state.selectedReportId = getReportId(reports[0]);
  }

  const selectedReport = reports.find(
    (report) =>
      String(getReportId(report)) === String(state.selectedReportId)
  );

  updateSelectedPanel(selectedReport || reports[0]);
  renderMapMarkers(reports);
}

function openReportModal(reportId) {
  // Use existing report object from state.reports without redundant API request
  const report = state.reports.find(
    (item) => String(getReportId(item)) === String(reportId)
  );

  if (!report) return;

  // Sync active report in dashboard state & side panel
  selectReport(reportId);

  const modal = $("reportDetailsModal");
  const modalReportBody = $("modalReportBody");
  if (!modal || !modalReportBody) return;

  const id = getReportId(report);
  const priority = getReportPriority(report);
  const status = getReportStatus(report);
  const lat = getLatitude(report);
  const lng = getLongitude(report);
  const hasCoords = lat !== null && lng !== null;

  // Update modal header badges
  const modalReportId = $("modalReportId");
  const modalPriorityBadge = $("modalPriorityBadge");
  const modalStatusBadge = $("modalStatusBadge");
  const modalReportTitle = $("modalReportTitle");
  if (modalReportId) modalReportId.textContent = `#${id}`;
  if (modalPriorityBadge) {
    modalPriorityBadge.className = `badge ${getPriorityClass(priority)}`;
    modalPriorityBadge.textContent = `${formatPriority(priority)} Priority`;
  }
  if (modalStatusBadge) {
    modalStatusBadge.className = `badge status ${getStatusClass(status)}`;
    modalStatusBadge.textContent = formatStatus(status);
  }
  if (modalReportTitle) {
    modalReportTitle.textContent = getReportTitle(report);
  }

  // Google Maps external link
  const modalGmapsLink = $("modalGmapsLink");
  if (modalGmapsLink) {
    if (hasCoords) {
      modalGmapsLink.href = `https://www.google.com/maps?q=${lat},${lng}`;
      modalGmapsLink.classList.remove("hidden");
    } else {
      modalGmapsLink.classList.add("hidden");
    }
  }

  // Focus Map Button
  const modalFocusMapBtn = $("modalFocusMapBtn");
  if (modalFocusMapBtn) {
    if (hasCoords) {
      modalFocusMapBtn.classList.remove("hidden");
      modalFocusMapBtn.onclick = () => {
        closeReportModal();
        focusReportOnMap(report);
      };
    } else {
      modalFocusMapBtn.classList.add("hidden");
    }
  }

  const isTrapped = Boolean(
    report.people_trapped === true ||
    report.people_trapped === "true" ||
    report.trapped_people === true
  );

  const peopleAffected =
    report.people_affected ?? report.affected_people ?? null;

  const aiSummary =
    report.ai_summary ||
    report.ai_analysis ||
    report.analysis ||
    null;

  const photoApiUrl = report.image_path
    ? `${API_BASE}/api/reports/${encodeURIComponent(id)}/photo`
    : null;

  const photoUrl =
    report.image_url ||
    report.photo_url ||
    report.image ||
    report.photo ||
    report.evidence_url ||
    photoApiUrl;

  modalReportBody.innerHTML = `
    <!-- Critical Trapped Alert Banner -->
    <div class="detail-banner ${isTrapped ? "urgent" : "safe"}">
      <span style="font-size:20px">${isTrapped ? "🚨" : "🛡️"}</span>
      <div>
        <strong style="display:block;font-size:14px;margin-bottom:2px">
          ${isTrapped ? "CRITICAL: Trapped Individuals Reported!" : "No Trapped Individuals Reported"}
        </strong>
        <span style="font-size:12px;font-weight:400;opacity:0.95">
          ${isTrapped ? "Eyewitness reported individuals trapped at the disaster scene. High priority extraction recommended." : "The citizen report indicated that no individuals are currently trapped."}
        </span>
      </div>
    </div>

    <!-- Incident Overview Metrics -->
    <div class="modal-stats-grid">
      <div class="modal-stat-tile">
        <small>Disaster / Incident Type</small>
        <strong>${esc(getReportTitle(report))}</strong>
      </div>
      <div class="modal-stat-tile">
        <small>Priority &amp; Score</small>
        <strong>${esc(formatPriority(priority))}${report.priority_score !== undefined && report.priority_score !== null ? ` (${esc(report.priority_score)}/100)` : ""}</strong>
      </div>
      <div class="modal-stat-tile">
        <small>Current Status</small>
        <span class="badge status ${getStatusClass(status)}" style="font-size:11px">
          ${esc(formatStatus(status))}
        </span>
      </div>
      <div class="modal-stat-tile">
        <small>Reported Date &amp; Time</small>
        <strong>${esc(formatDate(report.created_at || report.timestamp || report.submitted_at))}</strong>
      </div>
      <div class="modal-stat-tile">
        <small>People Affected</small>
        <strong>${peopleAffected !== null && peopleAffected !== undefined ? esc(peopleAffected) + " people" : "Not available"}</strong>
      </div>
      <div class="modal-stat-tile">
        <small>People Trapped</small>
        <strong>${isTrapped ? "Yes (Urgent)" : "No"}</strong>
      </div>
    </div>

    <!-- Reporter Contact Information -->
    <div class="modal-section">
      <h4>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        Reporter Contact Information
      </h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:8px">
        <div>
          <span style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:3px">Reporter Name</span>
          <strong style="font-size:14px;color:var(--navy)">${esc(report.reporter_name || "Not provided / Anonymous")}</strong>
        </div>
        <div>
          <span style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:3px">Contact Number</span>
          ${
            report.contact_number
              ? `<a href="tel:${esc(report.contact_number)}" style="font-size:14px;color:#2563eb;font-weight:700;display:inline-flex;align-items:center;gap:6px">📞 ${esc(report.contact_number)}</a>`
              : `<span style="font-size:13px;color:var(--muted)">Not provided</span>`
          }
        </div>
      </div>
    </div>

    <!-- Incident Location & Coordinates -->
    <div class="modal-section">
      <h4>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        Location &amp; Coordinates
      </h4>
      <p style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:6px">
        📍 ${esc(getReportLocation(report))}
      </p>
      ${
        hasCoords
          ? `
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px">
              <span><strong>Latitude:</strong> ${lat.toFixed(5)}°</span>
              <span><strong>Longitude:</strong> ${lng.toFixed(5)}°</span>
              <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                Open in Google Maps ↗
              </a>
            </div>
          `
          : `<span style="font-size:12px;color:var(--muted)">Exact GPS coordinates not available for this report.</span>`
      }
    </div>

    <!-- Complete Incident Description -->
    <div class="modal-section">
      <h4>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        Citizen Incident Description
      </h4>
      <p style="white-space:pre-line">${esc(getReportDescription(report))}</p>
    </div>

    <!-- AI Analysis & Urgency Assessment (if available) -->
    ${
      aiSummary
        ? `
          <div class="modal-section" style="background:#faf5ff;border-color:#e9d5ff">
            <h4 style="color:#7e22ce">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
              SafeSight AI Incident Analysis
            </h4>
            <p style="color:#581c87">${esc(aiSummary)}</p>
          </div>
        `
        : ""
    }

    <!-- Submitted Photo Evidence -->
    <div class="modal-section">
      <h4>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        Submitted Photographic Evidence
      </h4>
      ${
        photoUrl
          ? `
            <div class="photo-preview-wrap" id="modalPhotoWrap">
              <div style="padding:30px;color:#94a3b8;font-size:13px;text-align:center" id="modalPhotoPlaceholder">
                ⏳ Loading photo…
              </div>
            </div>
            <p style="font-size:11px;color:var(--muted);margin-top:6px;text-align:right">
              Tip: Click image to open high-resolution photo in new tab
            </p>
          `
          : `
            <p style="color:var(--muted);font-style:italic">No photographic evidence was submitted with this report.</p>
          `
      }
    </div>

    <!-- Quick Status Update inside Modal -->
    <div class="modal-status-card">
      <h4>Update Incident Status</h4>
      <p style="font-size:12px;color:#1e40af;margin-bottom:12px">
        Update this incident's status to coordinate rescue teams in real time:
      </p>
      <div class="modal-status-actions">
        <select id="modalStatusSelect" aria-label="Select incident status">
          <option value="PENDING_VERIFICATION" ${normalize(status) === "pending_verification" || normalize(status) === "pending" ? "selected" : ""}>Pending Verification</option>
          <option value="VERIFIED" ${normalize(status) === "verified" ? "selected" : ""}>Verified</option>
          <option value="RESCUE_IN_PROGRESS" ${normalize(status) === "rescue_in_progress" || normalize(status) === "in_progress" || normalize(status) === "in progress" ? "selected" : ""}>Rescue in Progress</option>
          <option value="RESOLVED" ${normalize(status) === "resolved" || normalize(status) === "completed" ? "selected" : ""}>Resolved</option>
          <option value="REJECTED" ${normalize(status) === "rejected" ? "selected" : ""}>Rejected</option>
        </select>
        <button type="button" class="btn btn-blue" id="modalUpdateStatusBtn" data-report-id="${esc(id)}">
          Update Status
        </button>
      </div>
      <div id="modalStatusFeedback" class="message" style="margin-top:10px"></div>
    </div>
  `;

  // Attach status update handler inside modal
  const modalUpdateBtn = $("modalUpdateStatusBtn");
  if (modalUpdateBtn) {
    modalUpdateBtn.addEventListener("click", async () => {
      const select = $("modalStatusSelect");
      const feedback = $("modalStatusFeedback");
      if (!select) return;

      modalUpdateBtn.disabled = true;
      modalUpdateBtn.textContent = "Updating...";

      try {
        await updateReportStatus(id, select.value);
        if (feedback) {
          feedback.className = "message show success";
          feedback.textContent = `Status successfully updated to ${formatStatus(select.value)}.`;
        }
        await loadReports();

        // Refresh modal status badge with updated state
        const updated = state.reports.find((r) => String(getReportId(r)) === String(id));
        if (updated) {
          const newStatus = getReportStatus(updated);
          if (modalStatusBadge) {
            modalStatusBadge.className = `badge status ${getStatusClass(newStatus)}`;
            modalStatusBadge.textContent = formatStatus(newStatus);
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.className = "message show error";
          feedback.textContent = `Update failed: ${err.message}`;
        }
      } finally {
        modalUpdateBtn.disabled = false;
        modalUpdateBtn.textContent = "Update Status";
      }
    });
  }

  // Open modal and lock background scroll
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Load photo via authenticated fetch if image_path exists
  if (photoApiUrl) {
    loadAuthenticatedPhoto(photoApiUrl, "modalPhotoWrap", "modalPhotoPlaceholder");
  } else if (photoUrl && !photoApiUrl) {
    const wrap = $("modalPhotoWrap");
    if (wrap) {
      wrap.innerHTML = `
        <a href="${esc(photoUrl)}" target="_blank" rel="noopener noreferrer"
           title="Click to view full image in new tab"
           style="display:flex;justify-content:center;align-items:center;width:100%">
          <img
            src="${esc(photoUrl)}"
            alt="Incident Photo Evidence"
            style="max-width:100%;max-height:360px;object-fit:contain;cursor:zoom-in"
          />
        </a>
      `;
    }
  }
}

/**
 * Fetch a protected photo endpoint with the admin X-Admin-Key header,
 * convert to a Blob URL and inject an <img> into the placeholder element.
 * This is required because <img src="…"> cannot send custom HTTP headers.
 */
async function loadAuthenticatedPhoto(url, wrapId, placeholderId) {
  const wrap = $(wrapId);
  const placeholder = $(placeholderId);
  if (!wrap) return;

  try {
    const response = await fetch(url, {
      headers: { "X-Admin-Key": SafeSightAPI.adminKey() },
    });

    if (!response.ok) {
      if (placeholder) {
        placeholder.textContent = "Photo not available (server returned an error).";
      }
      return;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Replace placeholder with the actual image
    wrap.innerHTML = `
      <a href="${objectUrl}" target="_blank" rel="noopener noreferrer"
         title="Click to view full image in new tab"
         style="display:flex;justify-content:center;align-items:center;width:100%">
        <img
          src="${objectUrl}"
          alt="Incident Photo Evidence"
          style="max-width:100%;max-height:360px;object-fit:contain;cursor:zoom-in"
        />
      </a>
    `;
    // Note: objectUrl (blob:) lives until page unload — no early revoke needed.
  } catch (err) {
    if (placeholder) {
      placeholder.textContent = "Photo could not be loaded. Check your connection.";
    }
    console.warn("Photo load error:", err);
  }
}

function closeReportModal() {
  const modal = $("reportDetailsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

function focusReportOnMap(report) {
  const lat = getLatitude(report);
  const lng = getLongitude(report);
  if (lat === null || lng === null || !state.map) return;

  const mapPanel = $("mapPanel");
  if (mapPanel) {
    mapPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  state.map.setView([lat, lng], 14, { animate: true });

  // Open corresponding marker popup
  state.markers.forEach((marker) => {
    const pos = marker.getLatLng();
    if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
      marker.openPopup();
    }
  });
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

  const id = getReportId(report);
  const priority = getReportPriority(report);
  const status = getReportStatus(report);

  const isTrapped = Boolean(
    report.people_trapped === true ||
    report.people_trapped === "true" ||
    report.trapped_people === true
  );

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
    (report.image_path ? `${API_BASE}/api/reports/${encodeURIComponent(id)}/photo` : "");

  panel.innerHTML = `
    <div class="details-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px">
      <div>
        <h2 style="margin:0 0 5px;font-size:18px">${esc(getReportTitle(report))}</h2>
        <p style="margin:0;font-size:12px;color:var(--muted)">${esc(getReportLocation(report))}</p>
      </div>

      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span class="badge ${getPriorityClass(priority)}">
          ${esc(formatPriority(priority))}
        </span>
        <button
          type="button"
          class="btn btn-blue"
          id="panelOpenModalBtn"
          style="padding:6px 11px;font-size:11px"
        >
          👁 Full View Modal
        </button>
      </div>
    </div>

    <div class="detail-box">
      <h4 style="margin:0 0 12px">Reporter Contact Details</h4>

      <div class="detail-row">
        <strong>Reporter name</strong>
        ${esc(report.reporter_name || "Not provided / Anonymous")}
      </div>

      <div class="detail-row">
        <strong>Contact number</strong>
        ${
          report.contact_number
            ? `<a href="tel:${esc(report.contact_number)}" style="color:#2563eb;font-weight:700">📞 ${esc(report.contact_number)}</a>`
            : "Not provided"
        }
      </div>
    </div>

    <div class="detail-box">
      <div class="detail-row">
        <strong>Status</strong>
        <span class="badge status ${getStatusClass(status)}">
          ${esc(formatStatus(status))}
        </span>
      </div>

      <div class="detail-row">
        <strong>Priority score</strong>
        ${esc(report.priority_score ?? "Not available")}
      </div>

      <div class="detail-row">
        <strong>People trapped</strong>
        ${
          isTrapped
            ? `<span class="badge urgent">⚠ YES - Immediate Rescue Required</span>`
            : "No"
        }
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
      <p style="white-space:pre-line;line-height:1.6">${esc(getReportDescription(report))}</p>
    </div>

    <div class="detail-box">
      <h4>AI Analysis</h4>
      <p style="line-height:1.6">${esc(aiSummary)}</p>
    </div>

    ${
      report.image_path
        ? `
          <div class="detail-box">
            <h4>Photo Evidence</h4>
            <div id="panelPhotoWrap" style="border-radius:10px;overflow:hidden;background:#0b172a;display:flex;justify-content:center;align-items:center;min-height:100px">
              <div id="panelPhotoPlaceholder" style="padding:20px;color:#94a3b8;font-size:13px;text-align:center">⏳ Loading photo…</div>
            </div>
          </div>
        `
        : `
          <div class="detail-box">
            <h4>Photo Evidence</h4>
            <p style="color:var(--muted)">No photo evidence attached.</p>
          </div>
        `
    }

    <div class="detail-box">
      <h4>Update Report Status</h4>

      <label for="statusUpdateSelect" style="display:block;font-size:12px;font-weight:700;margin-bottom:6px">New status</label>

      <select id="statusUpdateSelect" class="field" style="margin-bottom:10px">
        <option value="PENDING_VERIFICATION" ${normalize(status) === "pending_verification" || normalize(status) === "pending" ? "selected" : ""}>
          Pending verification
        </option>
        <option value="VERIFIED" ${normalize(status) === "verified" ? "selected" : ""}>
          Verified
        </option>
        <option value="RESCUE_IN_PROGRESS" ${normalize(status) === "rescue_in_progress" || normalize(status) === "in_progress" || normalize(status) === "in progress" ? "selected" : ""}>
          Rescue in progress
        </option>
        <option value="RESOLVED" ${normalize(status) === "resolved" || normalize(status) === "completed" ? "selected" : ""}>
          Resolved
        </option>
        <option value="REJECTED" ${normalize(status) === "rejected" ? "selected" : ""}>
          Rejected
        </option>
      </select>

      <button
        type="button"
        id="updateStatusBtn"
        class="btn btn-blue"
        data-report-id="${esc(id)}"
        style="width:100%"
      >
        Update Status
      </button>

      <p id="statusUpdateMessage" class="message" style="margin-top:10px"></p>
    </div>
  `;

  // Attach Full View Modal button in side panel
  $("panelOpenModalBtn")?.addEventListener("click", () => {
    openReportModal(id);
  });

  // Load side-panel photo via authenticated fetch (X-Admin-Key header required)
  if (report.image_path) {
    const panelPhotoUrl = `${API_BASE}/api/reports/${encodeURIComponent(id)}/photo`;
    loadAuthenticatedPhoto(panelPhotoUrl, "panelPhotoWrap", "panelPhotoPlaceholder");
  }

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
          message.className = "message show success";
          message.textContent = `Report status updated to ${formatStatus(select.value)} successfully.`;
        }

        await loadReports();
      } catch (error) {
        if (message) {
          message.className = "message show error";
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
      (statusValue === "completed" && status === "resolved") ||
      (statusValue === "resolved" && (status === "completed" || status === "resolved")) ||
      (statusValue === "rescue_in_progress" && (status === "rescue_in_progress" || status === "in_progress" || status === "in progress")) ||
      (statusValue === "pending_verification" && (status === "pending_verification" || status === "pending"));

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
      showMessage(
        "reportsMessage",
        "No reports have been submitted yet.",
        "info"
      );
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

  // Interactive Report Details Modal Close Listeners
  $("modalCloseBtn")?.addEventListener("click", closeReportModal);
  $("modalDoneBtn")?.addEventListener("click", closeReportModal);

  // Close modal when clicking on backdrop
  $("reportDetailsModal")?.addEventListener("click", (event) => {
    if (event.target && event.target.id === "reportDetailsModal") {
      closeReportModal();
    }
  });

  // Close modal with Escape key
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeReportModal();
    }
  });

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
