/**
 * ID-CLOSE Vault (https://id-close.com)
 * Copyright (c) 2026 ID-CLOSE. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL.
 * Unauthorized copying, distribution, modification, or hosting of this software
 * via any medium is strictly prohibited without explicit written permission.
 * Licensed strictly for local security verification and code auditing.
 */

import {
  createVault,
  unlockVault,
  MIN_CONTAINER_SIZE,
  MAX_CONTAINER_SIZE
} from "./vault.js";

import {
  getProStatus,
  getProAlias,
  verifyLicense,
  activatePro,
  deactivatePro,
  restoreProFromStorage
} from "./license-verify.js";


const $ = (id) => document.getElementById(id);

function showInlineError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

function clearInlineError(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = "";
  el.style.display = "none";
}

function setStatus(id, msg, type = "info") {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + type;
}

function setProgress(barId, pctId, fraction) {
  const bar = $(barId);
  const pct = $(pctId);
  const clamped = Math.max(0, Math.min(1, fraction));
  const label = Math.round(clamped * 100) + "%";
  if (bar) bar.style.width = (clamped * 100).toFixed(1) + "%";
  if (pct) pct.textContent = label;
}

function showProgress(create) {
  const prefix = create ? "create" : "unlock";
  const row = $(`${prefix}-progress-row`);
  const track = $(`${prefix}-progress-track`);
  const status = $("progress-status");
  if (row) { row.classList.remove("hidden"); }
  if (track) { track.classList.remove("hidden"); }
  if (status) status.textContent = "";
  setProgress(`${prefix}-pct-bar`, `${prefix}-pct`, 0);
}

function hideProgress(create) {
  const prefix = create ? "create" : "unlock";
  const row = $(`${prefix}-progress-row`);
  const track = $(`${prefix}-progress-track`);
  const status = $("progress-status");
  if (row) { row.classList.add("hidden"); }
  if (track) { track.classList.add("hidden"); }
  if (status) status.textContent = "";
}

function setProgressStatus(msg) {
  const el = $("progress-status");
  if (el) el.textContent = msg || "";
}

function setBtnLoading(btnId, loading, text) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-anim"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg> ${text || "WORKING..."}`;
  } else {
    btn.innerHTML = text;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen Navigation
// ─────────────────────────────────────────────────────────────────────────────

function goTo(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = $(id);
  if (el) el.classList.add("active");
}

function initNavigation() {
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => goTo(btn.dataset.nav));
  });

  // CREATE NEW VAULT → Step 01
  $("btn-create-vault").addEventListener("click", () => goTo("scr-step-decoy"));

  // CONTINUE TO HIDDEN SECTOR → Step 02
  $("btn-to-step2").addEventListener("click", () => {
    const pass = $("decoy-password").value;
    if (!pass) {
      showInlineError("volume-a-error", "Primary passphrase is required.");
      $("decoy-password").focus();
      return;
    }
    goTo("scr-step-secret");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// File Drop Zone Handling
// ─────────────────────────────────────────────────────────────────────────────

const dropZones = [
  { zoneId: "decoy-drop-zone", inputId: "decoy-file-input", listId: "decoy-file-list", metaId: "decoy-file-meta", files: [] },
  { zoneId: "hidden-drop-zone", inputId: "hidden-file-input", listId: "hidden-file-list", metaId: "hidden-file-meta", files: [] },
  { zoneId: "vault-drop-zone", inputId: "vault-file-input", listId: null, metaId: "vault-file-meta", files: [] }
];

function initDropZones() {
  dropZones.forEach(({ zoneId, inputId, listId, metaId, files }) => {
    const zone = $(zoneId);
    const input = $(inputId);
    const meta = $(metaId);
    const list = listId ? $(listId) : null;

    if (!zone || !input) return;

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });

    ["dragenter", "dragover"].forEach(evt => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add("drag");
      });
    });
    ["dragleave", "drop"].forEach(evt => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove("drag");
      });
    });

    zone.addEventListener("drop", (e) => {
      const droppedFiles = e.dataTransfer && e.dataTransfer.files;
      if (droppedFiles && droppedFiles.length) {
        handleFiles(droppedFiles, files, list, meta, zoneId === "vault-drop-zone");
      }
    });

    input.addEventListener("change", () => {
      if (input.files && input.files.length) {
        handleFiles(input.files, files, list, meta, zoneId === "vault-drop-zone");
        input.value = "";
      }
    });
  });
}

function renderVaultCard(file) {
  const zone = $("vault-drop-zone");
  let card = $("vault-file-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "vault-file-card";
    zone.appendChild(card);
  }
  const sizeStr = formatBytes(file.size);
  card.className = "vault-file-card";
  card.innerHTML =
    `<span class="vault-file-card-name">${file.name} (${sizeStr})</span>` +
    `<button id="vault-file-remove" class="vault-file-remove-btn">REMOVE</button>`;
  card.querySelector("button").addEventListener("click", function (e) {
    e.stopPropagation();
    dropZones[2].files.length = 0;
    const vaultInput = $("vault-file-input");
    if (vaultInput) vaultInput.value = "";
    const meta = $("vault-file-meta");
    if (meta) meta.textContent = "";
    card.remove();
    const dropText = zone.querySelector("p");
    if (dropText) {
      dropText.innerHTML = "<strong>DRAG &amp; DROP VAULT FILE</strong><br><span style=\"font-size:0.65rem;\">or click to browse</span>";
    }
    checkUnlockReady();
  });
}

function handleFiles(fileList, filesArray, listEl, metaEl, singleOnly) {
  const newFiles = Array.from(fileList);
  if (singleOnly && newFiles.length > 1) {
    showInlineError("vault-error", "Select only one vault file");
    return;
  }
  if (singleOnly) {
    filesArray.length = 0;
    filesArray.push(newFiles[0]);
    clearInlineError("vault-error");
  } else {
    filesArray.push(...newFiles);
  }
  if (singleOnly && filesArray.length > 0) {
    renderVaultCard(filesArray[0]);
  }
  updateFileList(filesArray, listEl, metaEl);
}

function updateFileList(files, listEl, metaEl) {
  if (metaEl) {
    metaEl.textContent = files.length === 0
      ? ""
      : `${files.length} file(s) — ${files.map(f => f.name).join(", ")}`;
  }
  if (listEl) {
    listEl.innerHTML = "";
    files.forEach((file, idx) => {
      const item = document.createElement("div");
      item.className = "file-item";
      const sizeStr = formatBytes(file.size);
      item.innerHTML = `<span>${file.name} (${sizeStr})</span><button class="file-remove-btn" data-idx="${idx}">REMOVE</button>`;
      item.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        files.splice(idx, 1);
        updateFileList(files, listEl, metaEl);
      });
      listEl.appendChild(item);
    });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault Creation (reads from Step 01 + Step 02 inputs)
// ─────────────────────────────────────────────────────────────────────────────

async function readFilesForWorker(fileList) {
  const results = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const buffer = await file.arrayBuffer();
    results.push({ name: file.name, data: buffer });
  }
  return results;
}

let _pendingVaultBytes = null;

async function handleCreateVault() {
  const decoyPassword = $("decoy-password").value;
  const masterPassword = $("master-password").value;
  const decoyFiles = dropZones[0].files;
  const hiddenFiles = dropZones[1].files;
  const decoyText = $("decoy-text").value;
  const hiddenText = $("hidden-text").value;
  const autoPad = $("auto-pad").value === "true";
  const containerSizeMiB = parseInt($("container-size").value, 10);

  if (!decoyPassword) { showInlineError("volume-a-error", "Primary passphrase is required."); return; }
  if (!masterPassword) { showInlineError("volume-b-error", "Secondary passphrase is required."); return; }
  if (decoyPassword === masterPassword) { showInlineError("volume-b-error", "Secondary passphrase must differ from Primary passphrase."); return; }

  let containerSizeBytes = null;
  if (containerSizeMiB && containerSizeMiB >= 1 && containerSizeMiB <= 100) {
    containerSizeBytes = containerSizeMiB * 1024 * 1024;
  } else if (!autoPad) {
    showInlineError("create-error", "Valid container size (1–100 MB) required");
    return;
  }

  if (containerSizeBytes) {
    const decoyPayloadSize = decoyFiles.reduce((sum, f) => sum + f.size, 0) + new TextEncoder().encode(decoyText).length;
    const hiddenPayloadSize = hiddenFiles.reduce((sum, f) => sum + f.size, 0) + new TextEncoder().encode(hiddenText).length;
    if (decoyPayloadSize + hiddenPayloadSize > containerSizeBytes) {
      showInlineError("volume-b-error", "Payload size exceeds container preset capacity.");
      return;
    }
  }

  setBtnLoading("generate-vault-btn", true);
  showProgress(true);
  setStatus("create-status", "Reading files...", "info");
  $("download-actions").classList.add("hidden");

  try {
    const workerDecoyFiles = await readFilesForWorker(decoyFiles);
    const workerHiddenFiles = await readFilesForWorker(hiddenFiles);

    let vaultBytes = null;
    let usedWorker = false;

    // Read pro token signature for HKDF tier binding (base64url wrapper format)
    let proTokenSig = null;
    try {
      const stored = localStorage.getItem("vault_pro_token");
      if (stored) {
        // Parse base64url wrapper: base64url(JSON({ p, s }))
        const bytes = Uint8Array.from(atob(stored.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(stored.length / 4) * 4, "=")), c => c.charCodeAt(0));
        const wrapper = JSON.parse(new TextDecoder().decode(bytes));
        if (wrapper && wrapper.s) proTokenSig = wrapper.s;
      }
    } catch (_e) { /* ignore */ }

    if (typeof Worker !== "undefined") {
      try {
        vaultBytes = await new Promise((resolve, reject) => {
          const worker = new Worker("/js/vault-worker.js");
          let resolved = false;

          worker.onmessage = function (e) {
            const msg = e.data;
            if (msg.type === "PROGRESS") {
              setProgress("create-pct-bar", "create-pct", msg.percent / 100);
              setProgressStatus(msg.percent + "% — " + msg.message);
              setStatus("create-status", msg.message, "info");
            } else if (msg.type === "SUCCESS") {
              resolved = true;
              worker.terminate();
              resolve(new Uint8Array(msg.result));
            } else if (msg.type === "ERROR") {
              resolved = true;
              worker.terminate();
              reject(new Error(msg.message));
            }
          };

          worker.onerror = function (err) {
            if (!resolved) {
              resolved = true;
              worker.terminate();
              reject(err);
            }
          };

          worker.postMessage({
            action: "CREATE_VAULT",
            payload: {
              decoyFiles: workerDecoyFiles,
              decoyText,
              decoyPassword,
              hiddenFiles: workerHiddenFiles,
              hiddenText,
              masterPassword,
              containerSizeBytes,
              proTokenSig
            }
          });
        });
        usedWorker = true;
      } catch (_workerErr) {
        vaultBytes = null;
      }
    }

    if (!usedWorker) {
      setStatus("create-status", "Deriving keys & encrypting...", "info");
      setProgress("create-pct-bar", "create-pct", 0.2);
      vaultBytes = await createVault({
        decoyFiles,
        decoyText,
        decoyPassword,
        hiddenFiles,
        hiddenText,
        masterPassword,
        containerSizeBytes
      });
      setProgress("create-pct-bar", "create-pct", 1);
    }

    if (_pendingVaultBytes) { _pendingVaultBytes.fill(0); }
    _pendingVaultBytes = vaultBytes;
    setProgress("create-pct-bar", "create-pct", 1);
    setProgressStatus("100% — Complete.");
    setStatus("create-status", "Vault generated. Choose download format below.", "ok");
    $("download-actions").classList.remove("hidden");
  } catch (e) {
    setStatus("create-status", "Error: " + e.message, "err");
    setProgressStatus("");
  } finally {
    setBtnLoading("generate-vault-btn", false, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg> GENERATE VAULT`);
    hideProgress(true);
  }
}

function triggerDownload(uint8Array, filename) {
  const blob = new Blob([uint8Array], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault Unlocking (from Welcome screen)
// ─────────────────────────────────────────────────────────────────────────────

async function handleUnlockVault() {
  const vaultFile = dropZones[2].files[0];
  const password = $("unlock-password").value;

  if (!vaultFile) { showInlineError("unlock-home-error", "Please select or drop a volume container file."); return; }
  if (!password) { showInlineError("unlock-home-error", "Enter passphrase to decrypt."); return; }

  // Show unlock overlay
  const overlay = $("unlock-overlay");
  overlay.classList.add("visible");
  document.body.classList.add("unlock-active");
  $("extracted-section").classList.add("extracted-hidden");
  $("unlock-close-btn").classList.add("btn-close-overlay");
  // Hide active screen to prevent bleed-through behind overlay
  document.querySelectorAll(".screen.active").forEach(s => s.dataset.wasActive = "1");
  document.querySelectorAll(".screen.active").forEach(s => s.classList.remove("active"));

  setBtnLoading("unlock-vault-btn", true);
  showProgress(false);
  setStatus("unlock-status", "Reading vault file...", "info");

  let vaultBytes = null;
  try {
    vaultBytes = new Uint8Array(await vaultFile.arrayBuffer());
    setProgress("unlock-pct-bar", "unlock-pct", 0.3);
    setStatus("unlock-status", "Attempting decryption...", "info");

    const result = await unlockVault(vaultBytes, password);

    setProgress("unlock-pct-bar", "unlock-pct", 0.8);
    setStatus("unlock-status", "Decrypting sector. Preparing files...", "ok");

    displayExtracted(result.payload);

    setProgress("unlock-pct-bar", "unlock-pct", 1);
    setStatus("unlock-status", "Success: Vault extracted.", "ok");

  } catch (e) {
    setStatus("unlock-status", "Decryption failed / Data corrupted", "err");
    $("extracted-section").classList.add("extracted-hidden");
  } finally {
    if (vaultBytes) { vaultBytes.fill(0); vaultBytes = null; }
    setBtnLoading("unlock-vault-btn", false, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> DECRYPT & OPEN VAULT`);
    hideProgress(false);
    $("unlock-close-btn").classList.remove("btn-close-overlay");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decrypted State Tracking & Memory Purge
// ─────────────────────────────────────────────────────────────────────────────

const _decryptedState = {
  objectURLs: [],
  typedArrays: []
};

function trackObjectURL(url) {
  _decryptedState.objectURLs.push(url);
}

function trackTypedArray(arr) {
  if (arr && typeof arr.fill === "function") {
    _decryptedState.typedArrays.push(arr);
  }
}

function purgeDecryptedState() {
  // 1. Revoke all tracked Object URLs
  for (const url of _decryptedState.objectURLs) {
    try { URL.revokeObjectURL(url); } catch (_e) { /* ignore */ }
  }
  _decryptedState.objectURLs.length = 0;

  // 2. Zeroize all tracked typed arrays
  for (const buf of _decryptedState.typedArrays) {
    try { buf.fill(0); } catch (_e) { /* ignore */ }
  }
  _decryptedState.typedArrays.length = 0;

  // 3. Clear DOM containers and text areas
  const extractedFiles = $("extracted-files");
  if (extractedFiles) extractedFiles.innerHTML = "";

  const extractedSection = $("extracted-section");
  if (extractedSection) extractedSection.classList.add("extracted-hidden");

  // 4. Reset unlock form fields
  const unlockPass = $("unlock-password");
  if (unlockPass) unlockPass.value = "";
  const vaultInput = $("vault-file-input");
  if (vaultInput) vaultInput.value = "";
  const vaultMeta = $("vault-file-meta");
  if (vaultMeta) vaultMeta.textContent = "";
  const vaultDropZone = $("vault-drop-zone");
  if (vaultDropZone) vaultDropZone.classList.remove("drag");

  // 5. Hide lock bar, close button, stop inactivity timer
  stopInactivityTimer();
  const lockBar = $("lock-bar");
  if (lockBar) lockBar.classList.remove("visible");
  const closeBtn = $("unlock-close-btn");
  if (closeBtn) closeBtn.classList.add("btn-close-overlay");

  // 6. Hide the unlock overlay entirely
  const overlay = $("unlock-overlay");
  if (overlay) overlay.classList.remove("visible");
  document.body.classList.remove("unlock-active");

  // 7. Restore any previously active screen
  document.querySelectorAll("[data-was-active]").forEach(s => {
    s.classList.add("active");
    delete s.dataset.wasActive;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inactivity Watchdog Timer
// ─────────────────────────────────────────────────────────────────────────────

const INACTIVITY_TIMEOUT_MS = 300000; // 5 minutes
let _inactivityTimer = null;
let _inactivityCountdown = null;
let _inactivityRemaining = INACTIVITY_TIMEOUT_MS;
let _inactivityHandler = null;

function startInactivityTimer() {
  stopInactivityTimer();
  _inactivityRemaining = INACTIVITY_TIMEOUT_MS;
  updateTimerBadge();

  _inactivityCountdown = setInterval(() => {
    _inactivityRemaining -= 1000;
    if (_inactivityRemaining <= 0) {
      _inactivityRemaining = 0;
      updateTimerBadge();
      purgeDecryptedState();
      return;
    }
    updateTimerBadge();
  }, 1000);

  // Debounced activity listener
  const resetTimer = () => {
    _inactivityRemaining = INACTIVITY_TIMEOUT_MS;
    updateTimerBadge();
  };

  const debounceReset = (() => {
    let pending = false;
    return () => {
      if (!pending) {
        pending = true;
        setTimeout(() => {
          resetTimer();
          pending = false;
        }, 200);
      }
    };
  })();

  _inactivityHandler = debounceReset;
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
    window.addEventListener(evt, _inactivityHandler, { passive: true });
  });
}

function stopInactivityTimer() {
  if (_inactivityCountdown) {
    clearInterval(_inactivityCountdown);
    _inactivityCountdown = null;
  }
  if (_inactivityHandler) {
    ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evt => {
      window.removeEventListener(evt, _inactivityHandler);
    });
    _inactivityHandler = null;
  }
}

function updateTimerBadge() {
  const badge = $("inactivity-counter");
  if (!badge) return;
  const secs = Math.max(0, Math.ceil(_inactivityRemaining / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  badge.textContent = `Auto-lock: ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function u16(v) {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v) {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}
function concat(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  const fileDataBlocks = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const dataBytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(dataBytes);
    const modDate = 0x5821;
    const modTime = 0x0000;

    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      0x14, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      modTime & 0xff, (modTime >> 8) & 0xff,
      modDate & 0xff, (modDate >> 8) & 0xff,
      ...u32(crc),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      0x00, 0x00
    ]);
    localHeaders.push(concat([localHeader, nameBytes]));
    fileDataBlocks.push(dataBytes);

    const centralHeader = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      0x14, 0x00,
      0x14, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      modTime & 0xff, (modTime >> 8) & 0xff,
      modDate & 0xff, (modDate >> 8) & 0xff,
      ...u32(crc),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00,
      ...u32(offset)
    ]);
    centralHeaders.push(concat([centralHeader, nameBytes]));
    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const ch of centralHeaders) cdSize += ch.length;

  const endRecord = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00,
    0x00, 0x00,
    ...u16(files.length),
    ...u16(files.length),
    ...u32(cdSize),
    ...u32(cdOffset),
    0x00, 0x00
  ]);

  return concat([...localHeaders, ...fileDataBlocks, ...centralHeaders, endRecord]);
}

function displayExtracted(payload) {
  const section = $("extracted-section");
  const container = $("extracted-files");
  container.innerHTML = "";

  const files = payload.files || [];
  const hasText = !!payload.text;
  const needsZip = files.length > 1 || (files.length > 0 && hasText) || (files.length === 0 && hasText);

  if (needsZip) {
    const zipEntries = [];
    for (const file of files) {
      trackTypedArray(file.data);
      zipEntries.push({ name: file.name, data: new Uint8Array(file.data) });
    }
    if (hasText) {
      const textBytes = new TextEncoder().encode(payload.text);
      trackTypedArray(textBytes);
      zipEntries.push({ name: "notes.txt", data: textBytes });
    }
    const zipBytes = makeZip(zipEntries);
    const zipBlob = new Blob([zipBytes], { type: "application/zip" });
    const zipUrl = URL.createObjectURL(zipBlob);
    trackObjectURL(zipUrl);

    const card = document.createElement("div");
    card.className = "vault-file-card";
    card.innerHTML =
      `<span class="vault-file-card-name">vault-extracted.zip (${formatBytes(zipBytes.length)})</span>` +
      `<button class="vault-file-remove-btn">SAVE</button>`;
    card.querySelector("button").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = zipUrl;
      a.download = "vault-extracted.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("unlock-status", "Saved vault-extracted.zip", "ok");
    });
    container.appendChild(card);
  } else if (files.length === 1 && !hasText) {
    const file = files[0];
    trackTypedArray(file.data);
    const blob = new Blob([file.data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    trackObjectURL(url);

    const card = document.createElement("div");
    card.className = "vault-file-card";
    card.innerHTML =
      `<span class="vault-file-card-name">${file.name} (${formatBytes(file.data.length)})</span>` +
      `<button class="vault-file-remove-btn">SAVE</button>`;
    card.querySelector("button").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("unlock-status", `Saved ${file.name}`, "ok");
    });
    container.appendChild(card);
  } else if (hasText && files.length === 0) {
    const textBytes = new TextEncoder().encode(payload.text);
    trackTypedArray(textBytes);
    const blob = new Blob([textBytes], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    trackObjectURL(url);

    const card = document.createElement("div");
    card.className = "vault-file-card";
    card.innerHTML =
      `<span class="vault-file-card-name">notes.txt (${formatBytes(textBytes.length)})</span>` +
      `<button class="vault-file-remove-btn">SAVE</button>`;
    card.querySelector("button").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "notes.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("unlock-status", "Saved notes.txt", "ok");
    });
    container.appendChild(card);
  } else {
    container.innerHTML = `<p class="t-body text-muted2">No files or text in vault.</p>`;
  }

  section.classList.remove("extracted-hidden");

  const lockBar = $("lock-bar");
  if (lockBar) lockBar.classList.add("visible");
  startInactivityTimer();
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy XMR
// ─────────────────────────────────────────────────────────────────────────────

function initCopyXMR() {
  const btn = $("copy-xmr-btn");
  const addr = $("xmr-addr");
  if (btn && addr) {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(addr.textContent).then(() => {
        btn.textContent = "ADDR COPIED!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "COPY ADDRESS";
          btn.classList.remove("copied");
        }, 2000);
      }).catch(() => {
        btn.textContent = "COPY FAILED";
        setTimeout(() => { btn.textContent = "COPY ADDRESS"; }, 2000);
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Particle Background (optimized)
// ─────────────────────────────────────────────────────────────────────────────

(function initParticles() {
  const cv = document.getElementById("particle-bg");
  if (!cv) return;
  const cx = cv.getContext("2d");
  let W, H, dpr;
  let mouseX = -1000, mouseY = -1000;
  const PARTICLE_COUNT = 40;
  const CONNECT_DIST_SQ = 150 * 150;
  const MOUSE_RADIUS_SQ = 180 * 180;
  const particles = [];
  let animId = null;
  let lastTime = 0;
  const FRAME_INTERVAL = 33;
  let running = false;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  let resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) return;
    resizeTimer = setTimeout(function () { resize(); resizeTimer = null; }, 150);
  });

  document.addEventListener("mousemove", function (e) { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 1.5
    });
  }

  function tick(now) {
    animId = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (now - lastTime < FRAME_INTERVAL) return;
    lastTime = now;
    cx.clearRect(0, 0, W, H);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      const dmx = p.x - mouseX, dmy = p.y - mouseY;
      const dmSq = dmx * dmx + dmy * dmy;
      const nearMouse = dmSq < MOUSE_RADIUS_SQ;
      cx.beginPath();
      cx.arc(p.x, p.y, nearMouse ? 1.8 : p.r, 0, Math.PI * 2);
      cx.fillStyle = nearMouse ? "rgba(255,59,48,0.8)" : "rgba(80,80,80,0.8)";
      cx.fill();
      for (let j = i + 1; j < PARTICLE_COUNT; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < CONNECT_DIST_SQ) {
          let alpha = (1 - Math.sqrt(distSq) / 150) * 0.3;
          if (nearMouse) {
            const qmx = q.x - mouseX, qmy = q.y - mouseY;
            if (qmx * qmx + qmy * qmy < MOUSE_RADIUS_SQ) {
              alpha = (1 - Math.sqrt(distSq) / 150) * 0.5;
              cx.strokeStyle = "rgba(255,59,48," + alpha + ")";
              cx.lineWidth = 0.6;
              cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(q.x, q.y); cx.stroke();
              continue;
            }
          }
          cx.strokeStyle = "rgba(70,70,70," + alpha * 2.5 + ")";
          cx.lineWidth = 0.6;
          cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(q.x, q.y); cx.stroke();
        }
      }
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
      running = false;
    } else if (!running) {
      running = true;
      lastTime = 0;
      animId = requestAnimationFrame(tick);
    }
  });

  running = true;
  animId = requestAnimationFrame(tick);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Container Size Preset Selector
// ─────────────────────────────────────────────────────────────────────────────

const PRESET_META = {
  10:  { hint: "Recommended for Seed Phrases, PGP Keys, Passwords.", a: "5 MB", b: "5 MB" },
  50:  { hint: "Recommended for IDs, Contracts, Critical PDFs.", a: "25 MB", b: "25 MB" },
  100: { hint: "Recommended for Archives, Codebases, Multi-Document ZIPs.", a: "50 MB", b: "50 MB" }
};

function updatePresetAllocation(sizeMB) {
  const hint = $("preset-hint");
  const alloc = $("preset-alloc");
  const meta = PRESET_META[sizeMB];
  if (meta) {
    if (hint) hint.textContent = meta.hint;
    if (alloc) alloc.textContent = `Allocation: ${meta.a} Volume A / ${meta.b} Volume B`;
  }
}

function initPresetSelector() {
  const selector = $("preset-selector");
  if (!selector) return;

  const buttons = selector.querySelectorAll(".preset-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const sizeMB = parseInt(btn.dataset.size, 10);

      // PRO enforcement: 100 MB requires active license
      if (sizeMB === 100 && !getProStatus()) {
        openProModal();
        return;
      }

      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $("container-size").value = sizeMB;
      $("auto-pad").value = "false";
      updatePresetAllocation(sizeMB);
    });
  });

  // Set default: 10 MB (Compact)
  $("container-size").value = 10;
  $("auto-pad").value = "false";
  updatePresetAllocation(10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unlock Readiness Check
// ─────────────────────────────────────────────────────────────────────────────

function checkUnlockReady() {
  const hasFile = dropZones[2].files.length > 0;
  const hasPass = $("unlock-password").value.length > 0;
  $("unlock-vault-btn").disabled = !(hasFile && hasPass);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRO Modal — Open / Close / Verification
// ─────────────────────────────────────────────────────────────────────────────

function wizardGoTo(step) {
  const modal = $("proModal");
  if (!modal) return;
  modal.querySelectorAll(".wizard-step").forEach(s => s.classList.remove("active"));
  const target = modal.querySelector(`.wizard-step[data-step="${step}"]`);
  if (target) target.classList.add("active");
}

function openProModal() {
  const modal = $("proModal");
  if (modal) modal.classList.add("open");
  document.body.setAttribute("data-pro-open", "");
  wizardGoTo("0");
}

function closeProModal() {
  const modal = $("proModal");
  if (modal) modal.classList.remove("open");
  document.body.removeAttribute("data-pro-open");
  wizardGoTo("0");

  const statusMsg = $("wiz-license-status");
  if (statusMsg) { statusMsg.textContent = ""; statusMsg.className = "wizard-activate-status"; }
  const input = $("wiz-license-input");
  if (input) input.value = "";
  const alias = $("wiz-alias");
  if (alias) alias.value = "";
  const txhash = $("wiz-txhash");
  if (txhash) txhash.value = "";
  const promo = $("wiz-promo");
  if (promo) promo.value = "";
  const dispatchStatus = $("wiz-dispatch-status");
  if (dispatchStatus) { dispatchStatus.textContent = ""; dispatchStatus.className = "wizard-activate-status"; }
}

function updateProBadge() {
  const badge = $("pro-status-badge");
  const text = $("pro-badge-text");
  if (!badge) return;
  if (getProStatus()) {
    badge.classList.add("visible");
    if (text) text.textContent = "PRO ACTIVE" + (getProAlias() ? " [" + getProAlias() + "]" : "");
  } else {
    badge.classList.remove("visible");
  }
}



async function handleLicenseActivation() {
  const statusMsg = $("wiz-license-status");
  const input = $("wiz-license-input");
  const btn = $("wiz-btn-activate");
  if (!input || !statusMsg) return;

  const rawInput = input.value.trim();
  if (!rawInput) {
    statusMsg.textContent = "Please enter your license token.";
    statusMsg.className = "wizard-activate-status err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "VERIFYING...";
  statusMsg.textContent = "Verifying cryptographic signature...";
  statusMsg.className = "wizard-activate-status";

  try {
    // Use verifyLicense which handles the base64url wrapper format from license-generator.js
    const result = await verifyLicense(rawInput);

    if (!result.valid) {
      statusMsg.textContent = result.error || "Invalid signature. Tampered or fake key.";
      statusMsg.className = "wizard-activate-status err";
      return;
    }

    // Save valid token to both storage keys
    localStorage.setItem("vault_pro_token", rawInput);
    activatePro(rawInput, result.alias);
    updateProBadge();

    statusMsg.textContent = "[+] Lifetime Pro Activated [" + result.alias + "]";
    statusMsg.className = "wizard-activate-status ok";
    input.value = "";

    setTimeout(() => closeProModal(), 1500);
  } catch (err) {
    statusMsg.textContent = "Malformed license token format.";
    statusMsg.className = "wizard-activate-status err";
  } finally {
    btn.disabled = false;
    btn.textContent = "VERIFY & ACTIVATE PRO";
  }
}

function initProModal() {
  const modal = $("proModal");
  if (!modal) return;

  // Close button
  const closeBtn = $("proModal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeProModal);

  // Click backdrop to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeProModal();
  });

  // ESC key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) {
      closeProModal();
    }
  });

  // Step 0 → Step 1A (Activate Existing License)
  $("wiz-step1a-trigger").addEventListener("click", () => wizardGoTo("1a"));

  // Step 0 → Step 1B (Acquire Genesis Pass)
  $("wiz-step1b-trigger").addEventListener("click", () => wizardGoTo("1b"));

  // Step 0 → close (Back)
  $("wiz-close").addEventListener("click", closeProModal);

  // Step 1A → Step 0 (Back)
  $("wiz-back-1a").addEventListener("click", () => wizardGoTo("0"));

  // Step 1B → Step 0 (Back)
  $("wiz-back-1b").addEventListener("click", () => wizardGoTo("0"));

  // Step 2B → Step 1B (Back to Payment)
  $("wiz-back-2b").addEventListener("click", () => wizardGoTo("1b"));

  // Step 1A → Verify & Activate
  $("wiz-btn-activate").addEventListener("click", handleLicenseActivation);

  // Enter key in license input
  $("wiz-license-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLicenseActivation();
  });

  // Step 1B → Step 2B (I Have Completed Payment)
  $("wiz-to-step2b").addEventListener("click", () => wizardGoTo("2b"));

  // Copy XMR address
  $("wiz-copy-xmr").addEventListener("click", function () {
    const addr = $("wiz-xmr-addr");
    if (!addr) return;
    navigator.clipboard.writeText(addr.textContent.trim()).then(() => {
      this.textContent = "COPIED!";
      this.classList.add("copied");
      setTimeout(() => { this.textContent = "COPY"; this.classList.remove("copied"); }, 2000);
    }).catch(() => {
      this.textContent = "FAILED";
      setTimeout(() => { this.textContent = "COPY"; }, 2000);
    });
  });

  // Copy Session ID
  $("wiz-copy-session").addEventListener("click", function () {
    const id = $("wiz-session-id");
    if (!id) return;
    navigator.clipboard.writeText(id.textContent.trim()).then(() => {
      this.textContent = "COPIED!";
      this.classList.add("copied");
      setTimeout(() => { this.textContent = "COPY ID"; this.classList.remove("copied"); }, 2000);
    }).catch(() => {
      this.textContent = "FAILED";
      setTimeout(() => { this.textContent = "COPY ID"; }, 2000);
    });
  });

  // Copy Dispatch to Clipboard
  $("wiz-copy-dispatch").addEventListener("click", function () {
    const alias = $("wiz-alias").value.trim();
    const txhash = $("wiz-txhash").value.trim();
    const promo = $("wiz-promo").value.trim() || "NONE";
    const status = $("wiz-dispatch-status");

    if (!alias || !txhash) {
      if (status) {
        status.textContent = "Alias and Transaction Hash are required.";
        status.className = "wizard-activate-status err";
      }
      return;
    }

    const lines = [
      "[ ID-CLOSE // GENESIS ORDER ]",
      "ALIAS: " + alias,
      "TX_PROOF: " + txhash,
      "PROMO_CODE: " + promo,
      "TIMESTAMP: " + new Date().toISOString()
    ];
    const dispatchMessage = lines.join("\n");

    navigator.clipboard.writeText(dispatchMessage).then(() => {
      this.textContent = "COPIED!";
      this.classList.add("copied");
      if (status) {
        status.textContent = "Dispatch copied to clipboard. Paste into Session.";
        status.className = "wizard-activate-status ok";
      }
      setTimeout(() => { this.textContent = "COPY DISPATCH TO CLIPBOARD"; this.classList.remove("copied"); }, 2000);
    }).catch(() => {
      this.textContent = "COPY FAILED";
      if (status) {
        status.textContent = "Clipboard access denied. Copy manually.";
        status.className = "wizard-activate-status err";
      }
      setTimeout(() => { this.textContent = "COPY DISPATCH TO CLIPBOARD"; }, 2000);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  initNavigation();
  initDropZones();
  initCopyXMR();
  initPresetSelector();
  initProModal();

  // Restore PRO license from localStorage (silent verification)
  restoreProFromStorage().then(restored => {
    updateProBadge();
  });

  $("generate-vault-btn").addEventListener("click", handleCreateVault);
  $("unlock-vault-btn").addEventListener("click", handleUnlockVault);

  $("btn-download-bin").addEventListener("click", () => {
    if (!_pendingVaultBytes) { showInlineError("create-error", "No vault generated yet"); return; }
    const filename = "volume.bin";
    triggerDownload(_pendingVaultBytes, filename);
    setStatus("create-status", "Container downloaded (.bin).", "ok");
    _pendingVaultBytes.fill(0);
    _pendingVaultBytes = null;
  });

  // Enable unlock button when both file and password present
  $("vault-file-input").addEventListener("change", checkUnlockReady);
  $("unlock-password").addEventListener("input", checkUnlockReady);

  // Clear inline errors on input
  $("decoy-password").addEventListener("input", () => clearInlineError("volume-a-error"));
  $("master-password").addEventListener("input", () => clearInlineError("volume-b-error"));
  $("unlock-password").addEventListener("input", () => clearInlineError("unlock-home-error"));
  $("vault-file-input").addEventListener("change", () => {
    clearInlineError("vault-error");
    clearInlineError("unlock-home-error");
  });
  $("generate-vault-btn").addEventListener("click", () => clearInlineError("create-error"));

  // Close unlock overlay
  $("unlock-close-btn").addEventListener("click", () => {
    purgeDecryptedState();
  });

  // Manual lock button
  $("btn-manual-lock").addEventListener("click", () => {
    purgeDecryptedState();
  });

  // Purge on navigation away
  window.addEventListener("beforeunload", () => {
    if (_decryptedState.objectURLs.length > 0 || _decryptedState.typedArrays.length > 0) {
      purgeDecryptedState();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
