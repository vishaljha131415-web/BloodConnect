
/* =====================================
   BLOODCONNECT - FIREBASE JAVASCRIPT
   ===================================== */

const firebaseConfig = {
  apiKey: "AIzaSyCY9YvWTCuNwM7dj5cWp_cwNWfrF5qtr08",
  authDomain: "bloodconnect-413a1.firebaseapp.com",
  projectId: "bloodconnect-413a1",
  storageBucket: "bloodconnect-413a1.firebasestorage.app",
  messagingSenderId: "641853540623",
  appId: "1:641853540623:web:6a7501367d1c85fa66567a",
  measurementId: "G-GH2G0C757L"
};

let auth, db, currentUser = null;
let donorCache = [], requestCache = [];
let statusTimer;
let reqFilter = "all";
let donationCache = [], donationCounts = {};
const BADGES = [[25, "Legend"], [10, "Guardian"], [5, "Hero"], [3, "Life Saver"], [1, "First Drop"]];
const RESTING_DAYS = 90;

const $ = id => document.getElementById(id);
const val = id => ($ (id)?.value ?? "").trim();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function showStatus(message, type = "info") {
  const box = $("bcStatus");
  if (!box) return;
  clearTimeout(statusTimer);
  box.textContent = message;
  box.dataset.type = type;
  box.hidden = false;
  statusTimer = setTimeout(() => box.hidden = true, 6000);
}

function getError(error) {
  const messages = {
    "auth/email-already-in-use": "Email already registered. Please log in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Password must have at least 6 characters.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "Account not found. Please register.",
    "auth/unauthorized-domain": "Add your domain in Firebase Authentication settings.",
    "permission-denied": "Firestore rules denied this action. Check your database rules.",
    "unavailable": "Firebase unavailable. Check your internet connection."
  };
  return messages[error?.code] || error?.message || "Something went wrong.";
}

function setBusy(form, busy, text) {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.original = button.textContent;
    button.textContent = text || "Please wait...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
    button.disabled = false;
  }
}

/* INITIALIZE FIREBASE */
function initFirebase() {
  if (typeof firebase === "undefined") {
    showStatus("Firebase SDK failed to load. Check internet connection.", "error");
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore(); // Default Firestore database

    $("registerForm").addEventListener("submit", registerAccount);
    $("loginForm").addEventListener("submit", loginAccount);
    $("requestForm").addEventListener("submit", publishRequest);
    $("offerForm").addEventListener("submit", sendOffer);

    if (localStorage.getItem("bloodconnect-theme") === "light") {
      document.body.classList.add("light-mode");
    }
    updateThemeButton();

    auth.onAuthStateChanged(async user => {
      currentUser = user || null;
      updateAuthButtons();
      startOfferListeners();
      await Promise.all([loadDonors(), loadRequests()]);
      await showProfile();
    });
  } catch (error) {
    console.error(error);
    showStatus("Firebase setup error: " + getError(error), "error");
  }
}

/* NAVIGATION */
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });
  document.querySelectorAll(".nav-link[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (pageId === "donors") loadDonors();
  if (pageId === "requests") loadRequests();
  if (pageId === "profile") showProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeModal(id) {
  if ($(id)) $(id).hidden = true;
}

function closeAllModals() {
  document.querySelectorAll(".modal").forEach(modal => modal.hidden = true);
}

function openLogin() {
  closeAllModals();
  $("loginModal").hidden = false;
}

function openRegister() {
  closeAllModals();
  $("registerModal").hidden = false;
}

function switchModal(from, to) {
  closeModal(from);
  $(to).hidden = false;
}

function openRequest() {
  if (!currentUser) {
    showStatus("Please log in before posting a blood request.", "error");
    openLogin();
    return;
  }
  closeAllModals();
  $("requestModal").hidden = false;
}

/* AUTH BUTTONS */
function updateAuthButtons() {
  $("authButton").textContent = currentUser ? "Logout" : "Login";
  $("authButton").onclick = currentUser ? logout : openLogin;
  $("registerButton").hidden = !!currentUser;
}

/* REGISTER */
async function registerAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true, "Creating account...");

  try {
    const name = val("registerName");
    const phone = val("registerPhone");
    const email = val("registerEmail");
    const blood = val("registerBlood");
    const city = val("registerCity");
    const password = val("registerPassword");
    const publicContact = $("donorConsent").checked;

    if (!name || !phone || !email || !blood || !city || !password) {
      throw new Error("Please complete all required fields.");
    }

    const result = await auth.createUserWithEmailAndPassword(email, password);
    const user = result.user;
    await user.updateProfile({ displayName: name });

    await db.collection("donors").doc(user.uid).set({
      ownerUid: user.uid,
      name, phone, email, blood, city,
      publicContact,
      available: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    form.reset();
    closeAllModals();
    showPage("profile");
    await loadDonors();
    await showProfile();
    showStatus("Registration successful. Your profile is ready.", "success");
  } catch (error) {
    console.error(error);
    showStatus(getError(error), "error");
  } finally {
    setBusy(form, false);
  }
}

/* LOGIN */
async function loginAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true, "Signing in...");

  try {
    await auth.signInWithEmailAndPassword(val("loginEmail"), val("loginPassword"));
    form.reset();
    closeAllModals();
    showPage("profile");
    showStatus("Login successful. Welcome to BloodConnect.", "success");
  } catch (error) {
    console.error(error);
    showStatus(getError(error), "error");
  } finally {
    setBusy(form, false);
  }
}

/* GOOGLE LOGIN */
async function googleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    const ref = db.collection("donors").doc(user.uid);
    const doc = await ref.get();

    if (!doc.exists) {
      await ref.set({
        ownerUid: user.uid,
        name: user.displayName || "BloodConnect User",
        email: user.email || "",
        phone: "", blood: "", city: "",
        publicContact: false, available: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    closeAllModals();
    showPage("profile");
    showStatus("Google login successful. Complete your donor details.", "success");
  } catch (error) {
    console.error(error);
    showStatus(getError(error), "error");
  }
}

/* LOGOUT */
async function logout() {
  try {
    await auth.signOut();
    closeAllModals();
    showPage("home");
    showStatus("You have been logged out.", "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
}

/* DONOR LIST */
async function loadDonors() {
  if (!db) return;
  try {
    const snapshot = await db.collection("donors").get();
    donorCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setStat("statDonors", donorCache.filter(d => d.name && d.blood && d.city && d.phone && d.publicContact !== false && d.available !== false).length);
    await loadDonations();
    renderDonors();
  } catch (error) {
    console.error(error);
    $("donorList").innerHTML =
      `<div class="empty-state">Unable to load donors: ${esc(getError(error))}</div>`;
  }
}

function searchByBlood() {
  renderDonors();
}

function clearSearch() {
  $("searchBlood").value = "";
  $("searchCity").value = "";
  syncChips();
  renderDonors();
}

function renderDonors() {
  const container = $("donorList");
  if (!container) return;

  const blood = val("searchBlood").toUpperCase();
  const city = val("searchCity").toLowerCase();

  const donors = donorCache.filter(d => d.name && d.blood && d.city && d.phone &&
    d.publicContact !== false && d.available !== false &&
    (!blood || String(d.blood).toUpperCase() === blood) &&
    (!city || String(d.city).toLowerCase().includes(city)));

  if ($("donorCount")) $("donorCount").textContent = donors.length + (donors.length === 1 ? " donor found" : " donors found");
  if (!donors.length) {
    container.innerHTML = `<div class="empty-state"><h3>No matching donors found</h3><p>Try a different blood group or city.</p></div>`;
    return;
  }

  container.innerHTML = donors.map(d => {
    const phone = String(d.phone).replace(/[^\d+]/g, "");
    const wa = String(d.phone).replace(/\D/g, "");
    const own = currentUser && currentUser.uid === d.ownerUid;
    const uid = d.ownerUid || d.id;
    const n = donationCount(uid), badge = badgeFor(n), rest = restingUntil(uid);

    return `<article class="data-card">
      <span class="blood-badge">${esc(d.blood)}</span>
      <div class="card-body">
        <h3>${esc(d.name)} ${own ? '<em class="pill">You</em>' : ""}</h3>
        <p class="meta"><span>⌖ ${esc(d.city)}</span>${rest ? `<span class="rest">Eligible again ${rest.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>` : '<span class="avail">Available</span>'}</p>
        <div class="pills">${n ? `${badge ? `<span class="pill badge">${badge}</span>` : ""}<span class="pill">${n} donation${n === 1 ? "" : "s"}</span>` : '<span class="pill">New donor</span>'}</div>
        ${rest ? "" : `<p>${esc(d.phone)}</p>`}
      </div>
      <div class="card-actions">
        ${rest ? "" : `<a class="btn btn-primary" href="tel:${esc(phone)}">Call</a>
        <a class="btn btn-outline" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent("Hello, I found your donor profile on BloodConnect. Are you available to help?")}" target="_blank" rel="noopener noreferrer">WhatsApp</a>${own ? "" : `<button class="btn btn-request" onclick="openOffer('${esc(uid)}')">Request</button>`}`}
        ${own ? '<button class="btn btn-outline" onclick="editMyDonorProfile()">Edit profile</button>' : ""}
      </div>
    </article>`;
  }).join("");
}

/* CREATE BLOOD REQUEST */
async function publishRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!currentUser) {
    showStatus("Please log in first.", "error");
    openLogin();
    return;
  }

  setBusy(form, true, "Publishing...");

  try {
    const request = {
      ownerUid: currentUser.uid,
      patientName: val("patientName"),
      blood: val("requestBlood"),
      units: Number(val("requestUnits")),
      hospital: val("requestHospital"),
      city: val("requestCity"),
      phone: val("requestPhone"),
      priority: val("requestPriority"),
      status: "Pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!request.patientName || !request.blood || !request.units ||
        !request.hospital || !request.city || !request.phone) {
      throw new Error("Please complete all required fields.");
    }

    await db.collection("requests").add(request);
    form.reset();
    closeAllModals();
    showPage("requests");
    await loadRequests();
    showStatus("Blood request published successfully.", "success");
  } catch (error) {
    console.error(error);
    showStatus(getError(error), "error");
  } finally {
    setBusy(form, false);
  }
}

/* LOAD REQUESTS */
async function loadRequests() {
  if (!db) return;
  try {
    const snapshot = await db.collection("requests").get();
    requestCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    requestCache.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
    setStat("statRequests", requestCache.filter(r => !["Donated", "Not Donated"].includes(r.status || "Pending")).length);
    renderRequests();
  } catch (error) {
    console.error(error);
    $("requestList").innerHTML =
      `<div class="empty-state">Unable to load requests: ${esc(getError(error))}</div>`;
  }
}

function getTime(date) {
  if (!date) return 0;
  if (typeof date.toMillis === "function") return date.toMillis();
  if (date.seconds) return date.seconds * 1000;
  return 0;
}

function renderRequests() {
  const container = $("requestList");
  if (!container) return;

  if (!requestCache.length) {
    container.innerHTML = `<div class="empty-state"><h3>No blood requests yet</h3><p>New requests will appear here.</p></div>`;
    return;
  }

  const list = sortedRequests();
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><h3>No requests in this filter</h3><p>Try another filter.</p></div>`;
    return;
  }

  container.innerHTML = list.map(r => {
    const own = currentUser && currentUser.uid === r.ownerUid;
    const phone = String(r.phone || "").replace(/[^\d+]/g, "");
    const wa = String(r.phone || "").replace(/\D/g, "");
    const pr = String(r.priority || "Normal").toLowerCase();
    const st = r.status || "Pending";
    const stc = st.toLowerCase().replace(/\s/g, "");

    return `<article class="data-card req ${esc(pr)} ${st === "Pending" ? "" : "done"}">
      <span class="blood-badge">${esc(r.blood)}<small>${esc(r.units)} unit${Number(r.units) === 1 ? "" : "s"}</small></span>
      <div class="card-body">
        <h3>${esc(r.patientName)}</h3>
        <p>${esc(r.hospital)}, ${esc(r.city)}</p>
        <div class="pills">
          <span class="pill ${esc(pr)}">${esc(r.priority || "Normal")}</span>
          <span class="pill st-${esc(stc)}">${esc(st)}</span>
          ${r.donorName && st !== "Pending" ? `<span class="pill">Donor: ${esc(r.donorName)}</span>` : ""}
          <span class="pill">${ago(r.createdAt)}</span>
        </div>
      </div>
      <div class="card-actions">
        <a class="btn btn-primary" href="tel:${esc(phone)}">Call</a>
        <a class="btn btn-outline" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent("Hello, I saw your blood request on BloodConnect. I may be able to help.")}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        ${requestControls(r, own)}
      </div>
    </article>`;
  }).join("");
}

/* UPDATE OWN REQUEST STATUS */
async function setRequestStatus(id, status) {
  if (!currentUser || !["Pending", "Donated", "Not Donated"].includes(status)) return;

  try {
    const ref = db.collection("requests").doc(id);
    const doc = await ref.get();

    if (!doc.exists || doc.data().ownerUid !== currentUser.uid) {
      throw new Error("You can only update your own request.");
    }

    await ref.update({ status });
    await loadRequests();
    showStatus("Request status updated.", "success");
  } catch (error) {
    showStatus(getError(error), "error");
    await loadRequests();
  }
}

/* DELETE OWN REQUEST ONLY */
async function deleteOwnRequest(id) {
  if (!currentUser) return;

  try {
    const ref = db.collection("requests").doc(id);
    const doc = await ref.get();

    if (!doc.exists || doc.data().ownerUid !== currentUser.uid) {
      throw new Error("You can only delete your own request.");
    }

    await ref.delete();
    await loadRequests();
    showStatus("Your request was deleted.", "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
}

/* PROFILE */
async function showProfile() {
  const container = $("profileContent");
  const editArea = $("profileEditArea");
  if (!container || !editArea) return;

  if (!currentUser) {
    container.innerHTML = `<div class="empty-state"><p>Please log in to view your profile.</p><button class="btn btn-primary" onclick="openLogin()">Login</button></div>`;
    editArea.innerHTML = "";
    return;
  }

  try {
    const doc = await db.collection("donors").doc(currentUser.uid).get();
    const d = doc.exists ? doc.data() : {};

    container.innerHTML = `
      <div class="profile-details">
        <div class="detail-item"><span>Name</span><strong>${esc(d.name || currentUser.displayName)}</strong></div>
        <div class="detail-item"><span>Email</span><strong>${esc(d.email || currentUser.email)}</strong></div>
        <div class="detail-item"><span>Phone</span><strong>${esc(d.phone || "Not set")}</strong></div>
        <div class="detail-item"><span>Blood group</span><strong>${esc(d.blood || "Not set")}</strong></div>
        <div class="detail-item"><span>City</span><strong>${esc(d.city || "Not set")}</strong></div>
        <div class="detail-item"><span>Donor listing</span><strong>${d.publicContact === false ? "Hidden" : "Public"}</strong></div>
      </div>
      ${achievementsHTML()}
      <button class="btn btn-primary" onclick="editMyDonorProfile()">Edit my profile</button>
      <button class="btn btn-outline" onclick="logout()">Logout</button>`;
  } catch (error) {
    container.innerHTML = `<p>${esc(getError(error))}</p>`;
  }
}

async function editMyDonorProfile() {
  if (!currentUser) {
    openLogin();
    return;
  }

  try {
    const doc = await db.collection("donors").doc(currentUser.uid).get();
    const d = doc.exists ? doc.data() : {};
    const groups = ["A+","A-","B+","B-","AB+","AB-","O+","O-"];

    $("profileEditArea").innerHTML = `
      <h3>Edit donor details</h3>
      <form id="profileEditForm">
        <div class="profile-edit-grid">
          <div class="field"><label for="editName">Full name</label><input id="editName" maxlength="80" value="${esc(d.name || currentUser.displayName || "")}" required></div>
          <div class="field"><label for="editPhone">Contact number</label><input id="editPhone" value="${esc(d.phone || "")}" required></div>
          <div class="field"><label for="editBlood">Blood group</label><select id="editBlood" required>
            <option value="">Select blood group</option>
            ${groups.map(g => `<option ${d.blood === g ? "selected" : ""}>${g}</option>`).join("")}
          </select></div>
          <div class="field"><label for="editCity">City</label><input id="editCity" maxlength="80" value="${esc(d.city || "")}" required></div>
        </div>
        <label class="consent-row"><input id="editConsent" type="checkbox" ${d.publicContact === false ? "" : "checked"}><span>Show my donor details and phone publicly.</span></label>
        <label class="consent-row"><input id="editAvailable" type="checkbox" ${d.available === false ? "" : "checked"}><span>I am available to be contacted.</span></label>
        <button class="btn btn-primary" type="submit">Save changes</button>
        <button class="btn btn-outline" type="button" onclick="cancelProfileEdit()">Cancel</button>
      </form>`;

    $("profileEditForm").addEventListener("submit", saveMyDonorProfile);
  } catch (error) {
    showStatus(getError(error), "error");
  }
}

function cancelProfileEdit() {
  $("profileEditArea").innerHTML = "";
}

async function saveMyDonorProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true, "Saving...");

  try {
    const name = val("editName");

    await db.collection("donors").doc(currentUser.uid).set({
      ownerUid: currentUser.uid,
      name,
      phone: val("editPhone"),
      email: currentUser.email || "",
      blood: val("editBlood"),
      city: val("editCity"),
      publicContact: $("editConsent").checked,
      available: $("editAvailable").checked,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await currentUser.updateProfile({ displayName: name });
    cancelProfileEdit();
    await showProfile();
    await loadDonors();
    showStatus("Profile updated successfully.", "success");
  } catch (error) {
    showStatus(getError(error), "error");
  } finally {
    setBusy(form, false);
  }
}

/* DARK / LIGHT MODE */
function toggleTheme() {
  document.body.classList.toggle("light-mode");
  localStorage.setItem(
    "bloodconnect-theme",
    document.body.classList.contains("light-mode") ? "light" : "dark"
  );
  updateThemeButton();
}

function updateThemeButton() {
  const button = $("themeButton");
  if (!button) return;
  const light = document.body.classList.contains("light-mode");
  button.textContent = light ? "☾" : "☼";
  button.title = light ? "Switch to dark mode" : "Switch to light mode";
}


/* DONATIONS, BADGES AND TWO-SIDE CONFIRMATION */
async function loadDonations() {
  try {
    const snap = await db.collection("donations").get();
    donationCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error(error);
    donationCache = [];
  }
  donationCounts = {};
  donationCache.forEach(x => {
    const c = donationCounts[x.donorUid] || (donationCounts[x.donorUid] = { n: 0, last: 0, name: x.donorName, blood: x.blood });
    c.n++;
    c.last = Math.max(c.last, getTime(x.createdAt));
  });
  setStat("statDonations", donationCache.length);
  const top = Object.values(donationCounts).sort((a, b) => b.n - a.n).slice(0, 3);
  if ($("heroesBlock")) $("heroesBlock").hidden = !top.length;
  if ($("topDonors")) $("topDonors").innerHTML = top.map(s => `<article class="feature-card"><div class="feature-icon">${esc(s.blood || "♥")}</div><h3>${esc(s.name || "Donor")}</h3><p>${s.n} donation${s.n === 1 ? "" : "s"} - ${badgeFor(s.n)}</p></article>`).join("");
}

function donationCount(uid) { return donationCounts[uid]?.n || 0; }
function badgeFor(n) { const b = BADGES.find(x => n >= x[0]); return b ? b[1] : ""; }
function restingUntil(uid) {
  const last = donationCounts[uid]?.last;
  if (!last) return null;
  const until = last + RESTING_DAYS * 864e5;
  return until > Date.now() ? new Date(until) : null;
}

function achievementsHTML() {
  const uid = currentUser.uid, n = donationCount(uid), b = badgeFor(n);
  const next = BADGES.slice().reverse().find(x => x[0] > n);
  const wait = requestCache.filter(r => r.donorUid === uid && r.status === "Donor Found" && !r.donorConfirmed).length;
  return `<div class="achievements">
    <div class="ach-count"><strong>${n}</strong><span>donation${n === 1 ? "" : "s"} confirmed</span></div>
    <div class="ach-info"><span class="pill badge">${b || "No badge yet"}</span>
      <p>${next ? `${next[0] - n} more to unlock ${next[1]}` : "Top badge unlocked. Thank you!"}</p>
      ${wait ? `<p class="need">${wait} request${wait > 1 ? "s are" : " is"} waiting for your confirmation. <button class="text-button" onclick="showPage('requests')">Open requests</button></p>` : ""}
    </div></div>`;
}

function requestControls(r, own) {
  const st = r.status || "Pending", id = esc(r.id);
  const stepper = n => `<ol class="steps">${["Donor chuna", "Donor ne confirm kiya", "Blood mila"].map((t, i) => `<li class="${i < n ? "done" : i === n ? "now" : ""}">${i + 1}. ${t}</li>`).join("")}</ol>`;
  if (own) {
    if (st === "Pending") {
      const opts = donorCache
        .filter(d => d.blood === r.blood && d.id !== currentUser.uid && d.name && d.phone && d.publicContact !== false && d.available !== false && !restingUntil(d.ownerUid || d.id))
        .map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${esc(d.city)})</option>`).join("");
      return `<div class="confirm-box">${stepper(0)}
        <label>Kisi donor ne haan bola? Naam chuno:</label>
        <select aria-label="Choose the donor who agreed" onchange="assignDonor('${id}',this.value)"><option value="">Select donor (${esc(r.blood)})</option>${opts}</select>
        <button class="btn btn-outline" onclick="deleteOwnRequest('${id}')">Delete request</button></div>`;
    }
    if (st === "Donor Found") {
      return `<div class="confirm-box">${stepper(r.donorConfirmed ? 2 : 1)}
        ${r.donorConfirmed
          ? `<p><b>${esc(r.donorName)}</b> ne bola ki unhone blood de diya. Mila ho to confirm karo.</p><button class="btn btn-primary" onclick="confirmReceived('${id}')">Confirm blood received</button>`
          : `<p>Waiting for <b>${esc(r.donorName)}</b> to confirm after donating.</p>`}
        <button class="btn btn-outline" onclick="resetDonor('${id}')">Change donor</button></div>`;
    }
    return `<button class="btn btn-outline" onclick="deleteOwnRequest('${id}')">Delete</button>`;
  }
  if (currentUser && r.donorUid === currentUser.uid && st === "Donor Found" && !r.donorConfirmed) {
    return `<div class="confirm-box you">${stepper(1)}
      <p><b>Aapko is request ka donor chuna gaya hai.</b> Blood de diya ho to confirm karo.</p>
      <button class="btn btn-primary" onclick="donorConfirm('${id}')">I donated</button>
      <button class="btn btn-outline" onclick="donorDecline('${id}')">Can't donate</button></div>`;
  }
  return "";
}

const NO_DONOR = { status: "Pending", donorUid: null, donorName: null, donorConfirmed: false };

async function patchRequest(id, patch, role, message) {
  if (!currentUser) return openLogin();
  try {
    const ref = db.collection("requests").doc(id);
    const doc = await ref.get();
    const r = doc.data();
    const allowed = doc.exists && (role === "owner" ? r.ownerUid === currentUser.uid : r.donorUid === currentUser.uid);
    if (!allowed) throw new Error("You cannot update this request.");
    await ref.update(patch);
    showStatus(message, "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
  await loadRequests();
}

function assignDonor(id, uid) {
  const d = donorCache.find(x => x.id === uid);
  if (!d) return;
  patchRequest(id, { status: "Donor Found", donorUid: uid, donorName: d.name, donorConfirmed: false }, "owner", "Donor selected. They will confirm after donating.");
}
function resetDonor(id) { patchRequest(id, NO_DONOR, "owner", "Donor removed. Request is open again."); }
function donorConfirm(id) { patchRequest(id, { donorConfirmed: true }, "donor", "Thanks! The patient's family will now confirm."); }
function donorDecline(id) { patchRequest(id, NO_DONOR, "donor", "Okay. The request is open for other donors."); }

async function confirmReceived(id) {
  try {
    const ref = db.collection("requests").doc(id);
    const doc = await ref.get();
    const r = doc.data();
    if (!doc.exists || r.ownerUid !== currentUser.uid || !r.donorUid || !r.donorConfirmed) {
      throw new Error("The donor has not confirmed yet.");
    }
    const batch = db.batch();
    batch.update(ref, { status: "Donated" });
    batch.set(db.collection("donations").doc(id), {
      donorUid: r.donorUid, donorName: r.donorName || "", requestId: id,
      requesterUid: currentUser.uid, blood: r.blood, city: r.city, hospital: r.hospital,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    await loadDonors();
    await loadRequests();
    showStatus("Donation confirmed. Thank you!", "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
}


/* DONOR REQUESTS + NOTIFICATIONS */
let incomingOffers = [], sentOffers = [], offerUnsubs = [];
const SEEN_KEY = "bc_seen_offers";
const findDonor = uid => donorCache.find(d => (d.ownerUid || d.id) === uid);
const offerTime = o => getTime(o.updatedAt || o.createdAt);
function getSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; } }

function startOfferListeners() {
  offerUnsubs.forEach(u => u());
  offerUnsubs = []; incomingOffers = []; sentOffers = [];
  if ($("notifWrap")) $("notifWrap").hidden = !currentUser;
  renderNotifs();
  if (!currentUser) return;
  const listen = (field, set, incoming) => {
    let first = true;
    return db.collection("helpRequests").where(field, "==", currentUser.uid).onSnapshot(snap => {
      if (incoming && !first) {
        snap.docChanges().forEach(ch => {
          if (ch.type === "added") showStatus("New blood request from " + ch.doc.data().fromName, "info");
        });
      }
      first = false;
      set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      renderNotifs();
    }, err => console.error(err));
  };
  offerUnsubs.push(listen("toUid", l => { incomingOffers = l; }, true), listen("fromUid", l => { sentOffers = l; }, false));
}

function notifItems() {
  const seen = getSeen();
  const flag = (o, side) => side === "in"
    ? ["Sent", "Accepted"].includes(o.status)
    : o.status === "Donated" || (["Accepted", "Declined"].includes(o.status) && seen[o.id] !== o.status);
  return [...incomingOffers.map(o => ({ o, side: "in" })), ...sentOffers.map(o => ({ o, side: "out" }))]
    .map(x => ({ ...x, isNew: flag(x.o, x.side) }))
    .sort((a, b) => offerTime(b.o) - offerTime(a.o));
}

function updateBadge() {
  const n = notifItems().filter(x => x.isNew).length;
  if (!$("bellBadge")) return;
  $("bellBadge").hidden = !n;
  $("bellBadge").textContent = n;
}

function renderNotifs() {
  if (!$("notifList")) return;
  const items = notifItems();
  $("notifList").innerHTML = items.length ? items.map(offerItemHTML).join("") : '<p class="notif-empty">No notifications yet.</p>';
  updateBadge();
}

function offerItemHTML({ o, side, isNew }) {
  const id = esc(o.id);
  const tel = p => `<a class="btn btn-outline" href="tel:${esc(String(p || "").replace(/[^\d+]/g, ""))}">Call</a>`;
  const wa = p => `<a class="btn btn-outline" href="https://wa.me/${esc(String(p || "").replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`;
  let text = "", acts = "";
  if (side === "in") {
    const who = `<b>${esc(o.fromName)}</b>`;
    if (o.status === "Sent") {
      text = `${who} needs <b>${esc(o.blood)}</b> blood for ${esc(o.patientName)} at ${esc(o.hospital)}, ${esc(o.city)}.${o.note ? " Note: " + esc(o.note) : ""}`;
      acts = `<button class="btn btn-primary" onclick="respondOffer('${id}','Accepted')">Accept</button><button class="btn btn-outline" onclick="respondOffer('${id}','Declined')">Decline</button>`;
    } else if (o.status === "Accepted") {
      text = `You accepted ${who}'s request (${esc(o.hospital)}, ${esc(o.city)}). After you donate, confirm it here.`;
      acts = `<button class="btn btn-primary" onclick="offerDonated('${id}')">I donated</button>${tel(o.fromPhone)}`;
    } else if (o.status === "Donated") text = `Waiting for ${who} to confirm your donation.`;
    else if (o.status === "Completed") text = "Donation confirmed. Thank you for saving a life!";
    else text = `You declined ${who}'s request.`;
  } else {
    const who = `<b>${esc(o.donorName)}</b>`;
    if (o.status === "Sent") text = `Request sent to ${who}. Waiting for a reply.`;
    else if (o.status === "Accepted") { text = `${who} accepted your request! Contact them now.`; acts = tel(o.donorPhone) + wa(o.donorPhone); }
    else if (o.status === "Declined") text = `${who} can't donate right now. Try another donor.`;
    else if (o.status === "Donated") { text = `${who} says they donated. Confirm if the blood was received.`; acts = `<button class="btn btn-primary" onclick="confirmOfferReceived('${id}')">Confirm blood received</button>`; }
    else text = `Donation from ${who} is complete.`;
  }
  return `<div class="notif-item${isNew ? " new" : ""}"><p>${text}</p>${acts ? `<div class="notif-actions">${acts}</div>` : ""}<time>${ago(o.updatedAt || o.createdAt)}</time></div>`;
}

function toggleNotif() {
  const p = $("notifPanel");
  p.hidden = !p.hidden;
  if (p.hidden) return;
  const seen = getSeen();
  sentOffers.forEach(o => { seen[o.id] = o.status; });
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
  updateBadge();
}

function openOffer(uid) {
  if (!currentUser) { showStatus("Please log in to send a request.", "error"); return openLogin(); }
  const donor = findDonor(uid);
  if (!donor) return;
  closeAllModals();
  $("offerDonorId").value = uid;
  $("offerTitle").textContent = `${donor.name} (${donor.blood})`;
  const mine = findDonor(currentUser.uid);
  if (mine) { if (!val("offerPhone")) $("offerPhone").value = mine.phone || ""; if (!val("offerCity")) $("offerCity").value = mine.city || ""; }
  $("offerModal").hidden = false;
}

async function sendOffer(e) {
  e.preventDefault();
  if (!currentUser) return openLogin();
  const donor = findDonor(val("offerDonorId"));
  if (!donor) return showStatus("Donor not found.", "error");
  const toUid = donor.ownerUid || donor.id;
  if (toUid === currentUser.uid) return showStatus("You cannot send a request to yourself.", "error");
  if (sentOffers.some(o => o.toUid === toUid && ["Sent", "Accepted", "Donated"].includes(o.status))) {
    return showStatus("You already have an active request with this donor.", "error");
  }
  const mine = findDonor(currentUser.uid);
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection("helpRequests").add({
      fromUid: currentUser.uid,
      fromName: mine?.name || currentUser.displayName || (currentUser.email || "Someone").split("@")[0],
      fromPhone: val("offerPhone"), toUid, donorName: donor.name, donorPhone: donor.phone, blood: donor.blood,
      patientName: val("offerPatient"), hospital: val("offerHospital"), city: val("offerCity"), note: val("offerNote"),
      status: "Sent", createdAt: ts, updatedAt: ts
    });
    $("offerForm").reset();
    closeModal("offerModal");
    showStatus(`Request sent to ${donor.name}. They will be notified.`, "success");
  } catch (error) {
    showStatus(getError(error), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateOffer(id, status, expect, message) {
  try {
    const ref = db.collection("helpRequests").doc(id);
    const doc = await ref.get();
    const o = doc.data();
    if (!doc.exists || o.toUid !== currentUser.uid || !expect.includes(o.status)) throw new Error("This request can no longer be changed.");
    await ref.update({ status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    showStatus(message, "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
}
const respondOffer = (id, s) => updateOffer(id, s, ["Sent"], s === "Accepted" ? "Accepted. They can now contact you." : "Request declined.");
const offerDonated = id => updateOffer(id, "Donated", ["Accepted"], "Thanks! Waiting for the other person to confirm.");

async function confirmOfferReceived(id) {
  try {
    const ref = db.collection("helpRequests").doc(id);
    const doc = await ref.get();
    const o = doc.data();
    if (!doc.exists || o.fromUid !== currentUser.uid || o.status !== "Donated") throw new Error("The donor has not confirmed yet.");
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.update(ref, { status: "Completed", updatedAt: ts });
    batch.set(db.collection("donations").doc(id), {
      donorUid: o.toUid, donorName: o.donorName || "", requestId: id, requesterUid: currentUser.uid,
      blood: o.blood, city: o.city, hospital: o.hospital, createdAt: ts
    });
    await batch.commit();
    await loadDonors();
    showStatus("Donation confirmed. Thank you!", "success");
  } catch (error) {
    showStatus(getError(error), "error");
  }
}

/* START */
/* UI HELPERS (chips, stats, time-ago) */
function setStat(id, n) { const e = $(id); if (e) e.textContent = n; }

function ago(t) {
  const ms = getTime(t);
  if (!ms) return "Just now";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  return h < 24 ? h + " hr ago" : Math.floor(h / 24) + " d ago";
}

function sortedRequests() {
  const rank = { critical: 0, urgent: 1, normal: 2 };
  const pr = r => rank[String(r.priority).toLowerCase()] ?? 2;
  const open = r => !["Donated", "Not Donated"].includes(r.status || "Pending");
  return requestCache
    .filter(r => reqFilter === "all" || (reqFilter === "open" ? open(r) : String(r.priority).toLowerCase() === reqFilter))
    .sort((a, b) => (open(b) - open(a)) || (pr(a) - pr(b)) || (getTime(b.createdAt) - getTime(a.createdAt)));
}

function syncChips() {
  const v = val("searchBlood") || "All";
  document.querySelectorAll("#bloodChips .chip").forEach(c => c.classList.toggle("on", c.dataset.g === v));
}

function initUI() {
  const groups = ["All", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  $("bloodChips").innerHTML = groups.map(g => `<button class="chip${g === "All" ? " on" : ""}" data-g="${g}">${g}</button>`).join("");
  $("bloodChips").onclick = e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    $("searchBlood").value = b.dataset.g === "All" ? "" : b.dataset.g;
    syncChips();
    renderDonors();
  };
  $("searchBlood").addEventListener("change", () => { syncChips(); renderDonors(); });
  $("searchCity").addEventListener("input", renderDonors);

  const filters = [["all", "All"], ["open", "Open"], ["critical", "Critical"], ["urgent", "Urgent"]];
  $("reqChips").innerHTML = filters.map(([k, l]) => `<button class="chip${k === "all" ? " on" : ""}" data-k="${k}">${l}</button>`).join("");
  $("reqChips").onclick = e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    reqFilter = b.dataset.k;
    document.querySelectorAll("#reqChips .chip").forEach(c => c.classList.toggle("on", c === b));
    renderRequests();
  };

  document.addEventListener("click", e => { if (!e.target.closest("#notifWrap")) $("notifPanel").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAllModals(); $("notifPanel").hidden = true; } });
}

window.addEventListener("DOMContentLoaded", () => { initUI(); initFirebase(); });
