/**
 * ID-CLOSE Vault (https://id-close.com)
 * Copyright (c) 2026 ID-CLOSE. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL.
 * Unauthorized copying, distribution, modification, or hosting of this software
 * via any medium is strictly prohibited without explicit written permission.
 * Licensed strictly for local security verification and code auditing.
 */

"use strict";

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const SECTOR_HEADER_SIZE = SALT_LENGTH + IV_LENGTH;
const MIN_CONTAINER_SIZE = 1024 * 1024;
const MAX_CONTAINER_SIZE = 1024 * 1024 * 1024;
const SECTOR_SALT_OFFSET = 0;
const SECTOR_IV_OFFSET = SALT_LENGTH;
const SECTOR_DATA_OFFSET = SECTOR_HEADER_SIZE;

function getSafeRandomValues(target) {
  const CHUNK = 65536;
  for (let off = 0; off < target.length; off += CHUNK) {
    crypto.getRandomValues(target.subarray(off, Math.min(off + CHUNK, target.length)));
  }
  return target;
}

function randomBytes(n) {
  return getSafeRandomValues(new Uint8Array(n));
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

function b64urlToBuffer(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const PRO_SIZE_THRESHOLD = 50 * 1024 * 1024;

function getTierInfoContext(containerSizeBytes, proTokenSig) {
  if (containerSizeBytes <= PRO_SIZE_THRESHOLD) {
    return new TextEncoder().encode("VAULT_TIER_FREE_STANDARD");
  }
  if (!proTokenSig) {
    return new TextEncoder().encode("INVALID_TAMPERED_TRAPDOOR");
  }
  // proTokenSig is base64url-encoded signature from the wrapper's s field
  const sigBytes = b64urlToBuffer(proTokenSig);
  const prefix = new TextEncoder().encode("VAULT_PRO_ED25519_BOUND:");
  return concatUint8Arrays(prefix, sigBytes);
}

async function deriveKeyHKDF(ikmBytes, salt, info) {
  const ikmKey = await crypto.subtle.importKey(
    "raw",
    ikmBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info
    },
    ikmKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveTierKey(password, salt, containerSizeBytes, proTokenSig) {
  const baseKeyBytes = await deriveKey(password, salt);
  const infoContext = getTierInfoContext(containerSizeBytes, proTokenSig);
  const aesKey = await deriveKeyHKDF(baseKeyBytes, salt, infoContext);
  baseKeyBytes.fill(0);
  return aesKey;
}

async function importAesKey(keyBytes) {
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptAesGcm(key, plaintext, iv) {
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return new Uint8Array(ct);
}

function packUint32BE(n) {
  const arr = new Uint8Array(4);
  arr[0] = (n >>> 24) & 0xff;
  arr[1] = (n >>> 16) & 0xff;
  arr[2] = (n >>> 8) & 0xff;
  arr[3] = n & 0xff;
  return arr;
}

function concatUint8Arrays(...arrays) {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function sanitizeFilename(name) {
  return String(name || "").replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 128) || "vault";
}

function padPayload(payload, targetSize) {
  if (payload.length >= targetSize) return payload;
  const padded = new Uint8Array(targetSize);
  padded.set(payload);
  return padded;
}

function buildPayload(files, text) {
  const parts = [];
  if (files && files.length > 0) {
    parts.push(packUint32BE(files.length));
    for (const file of files) {
      const data = new Uint8Array(file.data);
      const nameBytes = new TextEncoder().encode(sanitizeFilename(file.name));
      parts.push(packUint32BE(nameBytes.length));
      parts.push(nameBytes);
      parts.push(packUint32BE(data.length));
      parts.push(data);
    }
  } else {
    parts.push(packUint32BE(0));
  }
  const textBytes = new TextEncoder().encode(text || "");
  parts.push(packUint32BE(textBytes.length));
  parts.push(textBytes);
  return concatUint8Arrays(...parts);
}

function postProgress(percent, message) {
  self.postMessage({ type: "PROGRESS", percent, message });
}

async function createVault(params) {
  const {
    decoyFiles,
    decoyText,
    decoyPassword,
    hiddenFiles,
    hiddenText,
    masterPassword,
    containerSizeBytes,
    proTokenSig
  } = params;

  if (!decoyPassword || decoyPassword.length === 0) throw new Error("Decoy password required");
  if (!masterPassword || masterPassword.length === 0) throw new Error("Master password required");

  // 10%: Initializing container structure
  postProgress(10, "Initializing container structure...");

  const decoyPayload = buildPayload(decoyFiles, decoyText);
  const hiddenPayload = buildPayload(hiddenFiles, hiddenText);

  const salt = randomBytes(SALT_LENGTH);

  // 35%: Generating cryptographically secure random padding
  postProgress(35, "Generating cryptographic noise...");

  const decoyKey = await deriveTierKey(decoyPassword, salt, containerSizeBytes, proTokenSig);
  const masterKey = await deriveTierKey(masterPassword, salt, containerSizeBytes, proTokenSig);

  const decoyIv = randomBytes(IV_LENGTH);
  const hiddenIv = randomBytes(IV_LENGTH);

  const unpaddedDecoySize = SECTOR_HEADER_SIZE + decoyPayload.length + TAG_LENGTH;
  const unpaddedHiddenSize = SECTOR_HEADER_SIZE + hiddenPayload.length + TAG_LENGTH;
  const requiredSize = Math.max(unpaddedDecoySize, unpaddedHiddenSize);

  let finalSize = containerSizeBytes;
  if (!finalSize || finalSize < requiredSize) {
    finalSize = Math.max(requiredSize * 2, MIN_CONTAINER_SIZE);
    finalSize = Math.ceil(finalSize / (1024 * 1024)) * (1024 * 1024);
  }
  if (finalSize > MAX_CONTAINER_SIZE) throw new Error("Container size exceeds 1 GiB limit");
  if (finalSize < requiredSize * 2) throw new Error("Container too small for payloads");

  const sectorSize = Math.floor(finalSize / 2);
  const maxPayloadSize = sectorSize - SECTOR_HEADER_SIZE - TAG_LENGTH;

  if (decoyPayload.length > maxPayloadSize) throw new Error("Decoy payload exceeds sector capacity");
  if (hiddenPayload.length > maxPayloadSize) throw new Error("Hidden payload exceeds sector capacity");

  const decoyPayloadPadded = padPayload(decoyPayload, maxPayloadSize);
  const hiddenPayloadPadded = padPayload(hiddenPayload, maxPayloadSize);

  // 70%: Encrypting Primary Partition (AES-256-GCM)
  postProgress(70, "Encrypting Primary Partition (AES-256-GCM)...");

  const decoyCiphertextPadded = await encryptAesGcm(
    decoyKey,
    decoyPayloadPadded,
    decoyIv
  );

  // 90%: Encrypting Secondary Partition (AES-256-GCM)
  postProgress(90, "Encrypting Secondary Partition (AES-256-GCM)...");

  const hiddenCiphertextPadded = await encryptAesGcm(
    masterKey,
    hiddenPayloadPadded,
    hiddenIv
  );

  // 100%: Packaging final binary container
  postProgress(95, "Packaging final binary container...");

  const container = new Uint8Array(finalSize);
  getSafeRandomValues(container);

  container.set(salt, SECTOR_SALT_OFFSET);
  container.set(decoyIv, SECTOR_IV_OFFSET);
  container.set(decoyCiphertextPadded, SECTOR_DATA_OFFSET);

  container.set(salt, sectorSize + SECTOR_SALT_OFFSET);
  container.set(hiddenIv, sectorSize + SECTOR_IV_OFFSET);
  container.set(hiddenCiphertextPadded, sectorSize + SECTOR_DATA_OFFSET);

  // Zero sensitive material
  salt.fill(0);
  decoyIv.fill(0);
  hiddenIv.fill(0);
  decoyCiphertextPadded.fill(0);
  hiddenCiphertextPadded.fill(0);
  decoyPayloadPadded.fill(0);
  hiddenPayloadPadded.fill(0);

  postProgress(100, "Complete.");

  return container.buffer;
}

self.onmessage = async function (e) {
  const { action, payload } = e.data;

  if (action === "CREATE_VAULT") {
    try {
      const containerBuffer = await createVault(payload);
      self.postMessage(
        { type: "SUCCESS", result: containerBuffer },
        [containerBuffer]
      );
    } catch (err) {
      self.postMessage({ type: "ERROR", message: err.message });
    }
  }
};
