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
// Sector layout constants (deterministic offsets within each sector)
const SECTOR_HEADER_SIZE = SALT_LENGTH + IV_LENGTH; // 44 bytes
const SECTOR_SALT_OFFSET = 0;
const SECTOR_IV_OFFSET = SALT_LENGTH;
const SECTOR_DATA_OFFSET = SECTOR_HEADER_SIZE;

const MIN_CONTAINER_SIZE = 1024 * 1024; // 1 MiB minimum
const MAX_CONTAINER_SIZE = 1024 * 1024 * 1024; // 1 GiB maximum

function fromHex(hex) {
  const h = String(hex || "").toLowerCase();
  if (h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new Error("Invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    out[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  return out;
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

function getSafeRandomValues(targetUint8Array) {
  const CHUNK_SIZE = 65536;
  for (let offset = 0; offset < targetUint8Array.length; offset += CHUNK_SIZE) {
    const slice = targetUint8Array.subarray(offset, Math.min(offset + CHUNK_SIZE, targetUint8Array.length));
    crypto.getRandomValues(slice);
  }
  return targetUint8Array;
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

// ─────────────────────────────────────────────────────────────────────────────
// HKDF TIER-BINDING TRAPDOOR
// ─────────────────────────────────────────────────────────────────────────────

const PRO_SIZE_THRESHOLD = 50 * 1024 * 1024; // 50 MB

function getTierInfoContext(containerSizeBytes) {
  if (containerSizeBytes <= PRO_SIZE_THRESHOLD) {
    return new TextEncoder().encode("VAULT_TIER_FREE_STANDARD");
  }

  // Pro tier — require valid Ed25519 license token
  let signatureB64 = null;
  try {
    const stored = localStorage.getItem("vault_pro_token");
    if (stored) {
      // Parse base64url wrapper format: base64url(JSON({ p, s }))
      const wrapperBytes = b64urlToBuffer(stored);
      const wrapper = JSON.parse(new TextDecoder().decode(wrapperBytes));
      if (wrapper && wrapper.s) signatureB64 = wrapper.s;
    }
  } catch (_e) { /* ignore */ }

  if (!signatureB64) {
    return new TextEncoder().encode("INVALID_TAMPERED_TRAPDOOR");
  }

  const sigBytes = b64urlToBuffer(signatureB64);
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

async function deriveTierKey(password, salt, containerSizeBytes) {
  const baseKeyBytes = await deriveKey(password, salt);
  const infoContext = getTierInfoContext(containerSizeBytes);
  const aesKey = await deriveKeyHKDF(baseKeyBytes, salt, infoContext);
  baseKeyBytes.fill(0);
  return aesKey;
}

async function importAesKey(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptAesGcm(key, plaintext, iv) {
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return new Uint8Array(ct); // ciphertext || tag (16 bytes appended)
}

async function decryptAesGcm(key, ciphertextWithTag, iv) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextWithTag);
    return new Uint8Array(pt);
  } catch (_e) {
    throw new Error("Decryption failed / Data corrupted");
  }
}

function packUint32BE(n) {
  const arr = new Uint8Array(4);
  arr[0] = (n >>> 24) & 0xff;
  arr[1] = (n >>> 16) & 0xff;
  arr[2] = (n >>> 8) & 0xff;
  arr[3] = n & 0xff;
  return arr;
}

function unpackUint32BE(bytes, offset = 0) {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
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

function padPayload(payload, targetSize) {
  if (payload.length >= targetSize) return payload;
  const padded = new Uint8Array(targetSize);
  padded.set(payload);
  return padded;
}

async function readFileAsUint8Array(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function sanitizeFilename(name) {
  return String(name || "").replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 128) || "vault";
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT CREATION
// ─────────────────────────────────────────────────────────────────────────────

async function createVault(params) {
  const {
    decoyFiles,
    decoyText,
    decoyPassword,
    hiddenFiles,
    hiddenText,
    masterPassword,
    containerSizeBytes
  } = params;

  if (!decoyPassword || decoyPassword.length === 0) throw new Error("Decoy password required");
  if (!masterPassword || masterPassword.length === 0) throw new Error("Master password required");

  // Prepare decoy payload
  const decoyPayload = await buildPayload(decoyFiles, decoyText);
  // Prepare hidden payload
  const hiddenPayload = await buildPayload(hiddenFiles, hiddenText);

  // Generate shared salt
  const salt = randomBytes(SALT_LENGTH);

  // Derive tier-bound keys via HKDF trapdoor
  const decoyKey = await deriveTierKey(decoyPassword, salt, containerSizeBytes);
  const masterKey = await deriveTierKey(masterPassword, salt, containerSizeBytes);

  // Generate IVs
  const decoyIv = randomBytes(IV_LENGTH);
  const hiddenIv = randomBytes(IV_LENGTH);

  // Calculate required space based on unpadded payloads
  const unpaddedDecoySize = SECTOR_HEADER_SIZE + decoyPayload.length + TAG_LENGTH;
  const unpaddedHiddenSize = SECTOR_HEADER_SIZE + hiddenPayload.length + TAG_LENGTH;
  const requiredSize = Math.max(unpaddedDecoySize, unpaddedHiddenSize);

  // Determine final container size
  let finalSize = containerSizeBytes;
  if (!finalSize || finalSize < requiredSize) {
    finalSize = Math.max(requiredSize * 2, MIN_CONTAINER_SIZE);
    // Round up to nearest MiB boundary for cleaner entropy
    finalSize = Math.ceil(finalSize / (1024 * 1024)) * (1024 * 1024);
  }
  if (finalSize > MAX_CONTAINER_SIZE) throw new Error("Container size exceeds 1 GiB limit");
  if (finalSize < requiredSize * 2) throw new Error("Container too small for payloads");

  // Each sector gets half the container
  const sectorSize = Math.floor(finalSize / 2);
  const maxPayloadSize = sectorSize - SECTOR_HEADER_SIZE - TAG_LENGTH;

  if (decoyPayload.length > maxPayloadSize) throw new Error("Decoy payload exceeds sector capacity");
  if (hiddenPayload.length > maxPayloadSize) throw new Error("Hidden payload exceeds sector capacity");

  // Pad payloads to fill sectors (eliminates variable ciphertext lengths)
  const decoyPayloadPadded = padPayload(decoyPayload, maxPayloadSize);
  const hiddenPayloadPadded = padPayload(hiddenPayload, maxPayloadSize);

  // Re-encrypt with padded payloads so ciphertext fills the sector exactly
  const decoyCiphertextPadded = await encryptAesGcm(
    decoyKey,
    decoyPayloadPadded,
    decoyIv
  );
  const hiddenCiphertextPadded = await encryptAesGcm(
    masterKey,
    hiddenPayloadPadded,
    hiddenIv
  );

  // Build container
  const container = new Uint8Array(finalSize);

  // Fill entire container with cryptographic noise first
  getSafeRandomValues(container);

  // Write Decoy Sector at offset 0
  // Layout: [Salt(32)][IV(12)][Ciphertext+Tag — fills remaining sector half]
  container.set(salt, SECTOR_SALT_OFFSET);
  container.set(decoyIv, SECTOR_IV_OFFSET);
  container.set(decoyCiphertextPadded, SECTOR_DATA_OFFSET);

  // Write Hidden Sector at offset sectorSize
  // Same internal layout, completely independent sector
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
  if (decoyPayload !== decoyPayloadPadded) decoyPayload.fill(0);
  if (hiddenPayload !== hiddenPayloadPadded) hiddenPayload.fill(0);

  return container;
}

async function buildPayload(files, text) {
  const parts = [];

  // File entries: [count:u32][nameLen:u32][name][size:u32][data]...
  if (files && files.length > 0) {
    parts.push(packUint32BE(files.length));
    for (const file of files) {
      const data = await readFileAsUint8Array(file);
      const nameBytes = new TextEncoder().encode(sanitizeFilename(file.name));
      parts.push(packUint32BE(nameBytes.length));
      parts.push(nameBytes);
      parts.push(packUint32BE(data.length));
      parts.push(data);
    }
  } else {
    parts.push(packUint32BE(0));
  }

  // Text entry: [textLen:u32][text]
  const textBytes = new TextEncoder().encode(text || "");
  parts.push(packUint32BE(textBytes.length));
  parts.push(textBytes);

  return concatUint8Arrays(...parts);
}

function parsePayload(data) {
  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const files = [];

  const fileCount = view.getUint32(offset, false);
  offset += 4;

  for (let i = 0; i < fileCount; i++) {
    if (offset + 4 > data.length) throw new Error("Corrupt payload");
    const nameLen = view.getUint32(offset, false);
    offset += 4;
    if (offset + nameLen > data.length) throw new Error("Corrupt payload");
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
    offset += nameLen;
    if (offset + 4 > data.length) throw new Error("Corrupt payload");
    const fileSize = view.getUint32(offset, false);
    offset += 4;
    if (offset + fileSize > data.length) throw new Error("Corrupt payload");
    const fileData = data.slice(offset, offset + fileSize);
    offset += fileSize;
    files.push({ name, data: fileData });
  }

  if (offset + 4 > data.length) throw new Error("Corrupt payload");
  const textLen = view.getUint32(offset, false);
  offset += 4;
  if (offset + textLen > data.length) throw new Error("Corrupt payload");
  const text = new TextDecoder().decode(data.slice(offset, offset + textLen));

  return { files, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT UNLOCKING
// ─────────────────────────────────────────────────────────────────────────────

async function unlockVault(containerBytes, password) {
  if (!containerBytes || containerBytes.length < MIN_CONTAINER_SIZE) {
    throw new Error("Decryption failed / Data corrupted");
  }

  // Each sector occupies half the container
  const sectorSize = Math.floor(containerBytes.length / 2);

  // Try to decrypt as Decoy (Sector A at offset 0)
  try {
    const salt = containerBytes.slice(
      SECTOR_SALT_OFFSET,
      SECTOR_SALT_OFFSET + SALT_LENGTH
    );
    const iv = containerBytes.slice(
      SECTOR_IV_OFFSET,
      SECTOR_IV_OFFSET + IV_LENGTH
    );
    const ciphertext = containerBytes.slice(
      SECTOR_DATA_OFFSET,
      sectorSize
    );

    const aesKey = await deriveTierKey(password, salt, containerBytes.length);
    const plaintext = await decryptAesGcm(aesKey, ciphertext, iv);

    try {
      return { type: "decoy", payload: parsePayload(plaintext) };
    } finally {
      plaintext.fill(0);
    }
  } catch (_e) {
    // Fall through to try Hidden
  }

  // Try to decrypt as Hidden (Sector B at offset sectorSize)
  try {
    const salt = containerBytes.slice(
      sectorSize + SECTOR_SALT_OFFSET,
      sectorSize + SECTOR_SALT_OFFSET + SALT_LENGTH
    );
    const iv = containerBytes.slice(
      sectorSize + SECTOR_IV_OFFSET,
      sectorSize + SECTOR_IV_OFFSET + IV_LENGTH
    );
    const ciphertext = containerBytes.slice(
      sectorSize + SECTOR_DATA_OFFSET,
      sectorSize + sectorSize
    );

    const aesKey = await deriveTierKey(password, salt, containerBytes.length);
    const plaintext = await decryptAesGcm(aesKey, ciphertext, iv);

    try {
      return { type: "hidden", payload: parsePayload(plaintext) };
    } finally {
      plaintext.fill(0);
    }
  } catch (_e) {
    throw new Error("Decryption failed / Data corrupted");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  createVault,
  unlockVault,
  fromHex,
  PBKDF2_ITERATIONS,
  KEY_LENGTH_BITS,
  IV_LENGTH,
  TAG_LENGTH,
  SALT_LENGTH,
  MIN_CONTAINER_SIZE,
  MAX_CONTAINER_SIZE
};