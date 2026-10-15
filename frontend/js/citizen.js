
(() => {
  "use strict";

  const API_BASE = "https://safesight-7lgj.onrender.com/api";
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
  const $ = id => document.getElementById(id);

  let map = null;
  let marker = null;
  let coordinates = null;
  let previewUrl = null;

  function message(id, text, type = "info") {
    const el = $(id);
    el.textContent = text;
    el.className = `message show ${type}`;
  }

  function clearMessage(id) {
    const el = $(id);
    el.textContent = "";
    el.className = "message";
  }

  function setLocation(lat, lng, zoom = 16) {
    lat = Number(lat);
    lng = Number(lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      message("locationMessage", "Invalid location coordinates.", "error");
      return;
    }

    coordinates = { latitude: lat, longitude: lng };

    $("latitude").value = lat;
    $("longitude").value = lng;
    $("latitudeDisplay").textContent = lat.toFixed(6);
    $("longitudeDisplay").textContent = lng.toFixed(6);

    if (map) {
      if (!marker) {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);

        marker.on("dragend", () => {
          const position = marker.getLatLng();
          setLocation(position.lat, position.lng, map.getZoom());
        });
      } else {
        marker.setLatLng([lat, lng]);
      }

      map.setView([lat, lng], zoom);
    }

    clearMessage("locationMessage");
  }

  function initializeMap() {
    if (typeof L === "undefined") {
      message(
        "locationMessage",
        "Map library did not load. Check your internet connection and refresh.",
        "error"
      );
      return;
    }

    map = L.map("locationMap").setView([20.5937, 78.9629], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    map.on("click", event => {
      setLocation(event.latlng.lat, event.latlng.lng, map.getZoom());

      message(
        "locationMessage",
        "Location selected. Drag the marker to adjust it.",
        "success"
      );
    });

    setTimeout(() => map.invalidateSize(), 300);
  }

  function useGPS() {
    if (!navigator.geolocation) {
      message(
        "locationMessage",
        "GPS is unavailable. Search an address or select the map.",
        "error"
      );
      return;
    }

    const button = $("currentLocationBtn");
    button.disabled = true;
    button.textContent = "Finding location...";

    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation(
          position.coords.latitude,
          position.coords.longitude,
          16
        );

        message(
          "locationMessage",
          "GPS location selected. Verify the marker before submitting.",
          "success"
        );

        button.disabled = false;
        button.textContent = "Use my current location";
      },
      error => {
        const text = error.code === 1
          ? "Location permission denied. Allow location access or select the map manually."
          : "Could not get GPS location. Try again or search for an address.";

        message("locationMessage", text, "error");

        button.disabled = false;
        button.textContent = "Use my current location";
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000
      }
    );
  }

  async function findAddress() {
    const address = $("manualAddress").value.trim();

    if (address.length < 3) {
      message(
        "locationMessage",
        "Enter an address, area or landmark first.",
        "error"
      );
      return;
    }

    const button = $("searchAddressBtn");
    button.disabled = true;
    button.textContent = "Searching...";

    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", address);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Address search is unavailable.");
      }

      const results = await response.json();

      if (!results.length) {
        message(
          "locationMessage",
          "Address not found. Include the city or a nearby landmark.",
          "error"
        );
        return;
      }

      const result = results[0];

      setLocation(Number(result.lat), Number(result.lon), 16);
      $("manualAddress").value = result.display_name || address;

      message(
        "locationMessage",
        "Address found. Check the marker's position.",
        "success"
      );
    } catch (error) {
      message(
        "locationMessage",
        `${error.message} You can still select a point directly on the map.`,
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Find address on map";
    }
  }

  function resetLocation() {
    coordinates = null;

    $("latitude").value = "";
    $("longitude").value = "";
    $("latitudeDisplay").textContent = "Not selected";
    $("longitudeDisplay").textContent = "Not selected";
    $("manualAddress").value = "";

    if (marker && map) {
      map.removeLayer(marker);
      marker = null;
    }

    if (map) {
      map.setView([20.5937, 78.9629], 5);
    }

    message(
      "locationMessage",
      "Choose GPS, search an address, or click the map.",
      "info"
    );
  }

  function checkPhoto(file) {
    if (!file) return true;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      message("formMessage", "Select a JPG, PNG or WEBP image.", "error");
      return false;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      message("formMessage", "Image must be 5 MB or smaller.", "error");
      return false;
    }

    return true;
  }

  $("currentLocationBtn").addEventListener("click", useGPS);
  $("searchAddressBtn").addEventListener("click", findAddress);
  $("resetLocationBtn").addEventListener("click", resetLocation);

  $("image").addEventListener("change", () => {
    clearMessage("formMessage");

    const file = $("image").files[0];
    const preview = $("photoPreview");

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    preview.removeAttribute("src");
    preview.style.display = "none";

    if (!file) return;

    if (!checkPhoto(file)) {
      $("image").value = "";
      return;
    }

    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.style.display = "block";
  });

  $("reportForm").addEventListener("submit", async event => {
    event.preventDefault();
    clearMessage("formMessage");

    if (!coordinates) {
      message(
        "formMessage",
        "Select the incident location first.",
        "error"
      );

      $("locationMap").scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      return;
    }

    const file = $("image").files[0];

    if (!checkPhoto(file)) return;

    const disasterType = $("disasterType").value;
    const description = $("description").value.trim();
    const affectedText = $("peopleAffected").value.trim();
    const affected = affectedText === "" ? null : Number(affectedText);

    if (!disasterType) {
      message("formMessage", "Select an incident type.", "error");
      return;
    }

    if (description.length < 10 || description.length > 3000) {
      message(
        "formMessage",
        "Description must contain 10 to 3000 characters.",
        "error"
      );
      return;
    }

    if (
      affected !== null &&
      (!Number.isInteger(affected) || affected < 0 || affected > 1000000)
    ) {
      message(
        "formMessage",
        "People affected must be a whole number between 0 and 1000000.",
        "error"
      );
      return;
    }

    const payload = {
      disaster_type: disasterType,
      description,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      people_trapped: $("peopleTrapped").value === "true",
      people_affected: affected
    };

    const button = $("submitBtn");
    button.disabled = true;
    button.textContent = "Submitting report...";

    try {
      const data = new FormData();

      for (const [key, value] of Object.entries(payload)) {
        if (value !== null) {
          data.append(key, String(value));
        }
      }

      if (file) {
        data.append("image", file);
      }

      const response = await fetch(`${API_BASE}/reports`, {
        method: "POST",
        body: data
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = Array.isArray(result.detail)
          ? result.detail.map(item => item.msg || "Invalid field").join("; ")
          : result.detail;

        throw new Error(detail || `Server returned ${response.status}`);
      }

      $("reportForm").reset();

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }

      $("photoPreview").removeAttribute("src");
      $("photoPreview").style.display = "none";

      resetLocation();

      message(
        "formMessage",
        `Report submitted successfully. Reference: ${result.public_id || "Created"}`,
        "success"
      );
    } catch (error) {
      message(
        "formMessage",
        `Submission failed: ${error.message}`,
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Submit incident report →";
    }
  });

  initializeMap();
})();
