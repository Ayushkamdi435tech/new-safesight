
const API_BASE = "https://safesight-7lgj.onrender.com/api";
document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const msg = document.getElementById("login-message");
  const button = e.target.querySelector('button[type="submit"]');

  msg.className = "form-message";
  msg.textContent = "Checking credentials…";

  if (button) {
    button.disabled = true;
    button.textContent = "Verifying...";
  }

  try {
    const response = await fetch(`${API_BASE}/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Login failed.");
    }

    if (!data.admin_key) {
      throw new Error(
        "Login succeeded, but the backend did not return an admin key. Check the admin_login endpoint."
      );
    }

    sessionStorage.setItem("safesight_admin_key", data.admin_key);
    window.location.href = "dashboard.html";
  } catch (error) {
    msg.className = "form-message error";
    msg.textContent =
      error.message || "Cannot connect to the SafeSight backend.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Access dashboard →";
    }
  }
};

const toggleButton = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

if (toggleButton && passwordInput) {
  toggleButton.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    toggleButton.textContent = show ? "HIDE" : "SHOW";
  });
}
