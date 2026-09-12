/**
 * ID-CLOSE VAULT — Standalone Round-Trip Cryptographic Test
 *
 * Validates create → decrypt cycle using Node.js crypto.webcrypto.
 * Run: node test-vault.js
 */

"use strict";

const { webcrypto } = require("crypto");
const crypto = webcrypto;

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const SECTOR_HEADER_SIZE = SALT_LENGTH + IV_LENGTH;
const MIN_CONTAINER_SIZE = 1024 * 1024;

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

async function importAesKey(keyBytes) {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptAesGcm(key, plaintext, iv) {
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return new Uint8Array(ct);
}

async function decryptAesGcm(key, ciphertextWithTag, iv) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextWithTag);
  return new Uint8Array(pt);
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

function buildPayload(text) {
  const parts = [];
  parts.push(packUint32BE(0)); // fileCount = 0
  const textBytes = new TextEncoder().encode(text || "");
  parts.push(packUint32BE(textBytes.length));
  parts.push(textBytes);
  return concatUint8Arrays(...parts);
}

function parsePayload(data) {
  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const fileCount = view.getUint32(offset, false);
  offset += 4;

  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const nameLen = view.getUint32(offset, false);
    offset += 4;
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
    offset += nameLen;
    const fileSize = view.getUint32(offset, false);
    offset += 4;
    const fileData = data.slice(offset, offset + fileSize);
    offset += fileSize;
    files.push({ name, data: fileData });
  }

  const textLen = view.getUint32(offset, false);
  offset += 4;
  const text = new TextDecoder().decode(data.slice(offset, offset + textLen));

  return { files, text };
}

function padPayload(payload, targetSize) {
  if (payload.length >= targetSize) return payload;
  const padded = new Uint8Array(targetSize);
  padded.set(payload);
  return padded;
}

// ─── Vault Creation ──────────────────────────────────────────────────────────

async function createVault({ decoyText, hiddenText, decoyPassword, masterPassword, containerSizeBytes }) {
  const decoyPayload = buildPayload(decoyText);
  const hiddenPayload = buildPayload(hiddenText);

  const salt = randomBytes(SALT_LENGTH);
  const decoyKey = await deriveKey(decoyPassword, salt);
  const masterKey = await deriveKey(masterPassword, salt);
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
  if (finalSize < requiredSize * 2) throw new Error("Container too small");

  const sectorSize = Math.floor(finalSize / 2);
  const maxPayloadSize = sectorSize - SECTOR_HEADER_SIZE - TAG_LENGTH;

  if (decoyPayload.length > maxPayloadSize) throw new Error("Decoy payload exceeds sector capacity");
  if (hiddenPayload.length > maxPayloadSize) throw new Error("Hidden payload exceeds sector capacity");

  const decoyPayloadPadded = padPayload(decoyPayload, maxPayloadSize);
  const hiddenPayloadPadded = padPayload(hiddenPayload, maxPayloadSize);

  const decoyCt = await encryptAesGcm(await importAesKey(decoyKey), decoyPayloadPadded, decoyIv);
  const hiddenCt = await encryptAesGcm(await importAesKey(masterKey), hiddenPayloadPadded, hiddenIv);

  const container = new Uint8Array(finalSize);
  getSafeRandomValues(container);

  container.set(salt, 0);
  container.set(decoyIv, SALT_LENGTH);
  container.set(decoyCt, SECTOR_HEADER_SIZE);

  container.set(salt, sectorSize);
  container.set(hiddenIv, sectorSize + SALT_LENGTH);
  container.set(hiddenCt, sectorSize + SECTOR_HEADER_SIZE);

  return container;
}

// ─── Vault Unlocking ─────────────────────────────────────────────────────────

async function unlockVault(containerBytes, password) {
  if (!containerBytes || containerBytes.length < MIN_CONTAINER_SIZE) {
    throw new Error("Decryption failed / Data corrupted");
  }

  const sectorSize = Math.floor(containerBytes.length / 2);

  // Try Decoy at offset 0
  try {
    const salt = containerBytes.slice(0, SALT_LENGTH);
    const iv = containerBytes.slice(SALT_LENGTH, SECTOR_HEADER_SIZE);
    const ciphertext = containerBytes.slice(SECTOR_HEADER_SIZE, sectorSize);
    const key = await deriveKey(password, salt);
    const aesKey = await importAesKey(key);
    const plaintext = await decryptAesGcm(aesKey, ciphertext, iv);
    return { type: "decoy", payload: parsePayload(plaintext) };
  } catch (_e) { /* fall through */ }

  // Try Hidden at offset sectorSize
  try {
    const salt = containerBytes.slice(sectorSize, sectorSize + SALT_LENGTH);
    const iv = containerBytes.slice(sectorSize + SALT_LENGTH, sectorSize + SECTOR_HEADER_SIZE);
    const ciphertext = containerBytes.slice(sectorSize + SECTOR_HEADER_SIZE, sectorSize + sectorSize);
    const key = await deriveKey(password, salt);
    const aesKey = await importAesKey(key);
    const plaintext = await decryptAesGcm(aesKey, ciphertext, iv);
    return { type: "hidden", payload: parsePayload(plaintext) };
  } catch (_e) {
    throw new Error("Decryption failed / Data corrupted");
  }
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${label}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${label}`);
    }
  }

  console.log("[TEST] Creating dual vault (10 MiB target)...");

  const decoyText = "Decoy payload content";
  const hiddenText = "Hidden secret payload";
  const decoyPass = "decoy123";
  const masterPass = "master999";
  const targetSize = 10 * 1024 * 1024;

  const vault = await createVault({
    decoyText,
    hiddenText,
    decoyPassword: decoyPass,
    masterPassword: masterPass,
    containerSizeBytes: targetSize
  });

  // Assertion 1: Buffer size is exactly 10 MiB
  console.log("\n[TEST] Verifying container size...");
  assert(vault.length === targetSize, `Buffer size is exactly ${targetSize} bytes (got ${vault.length})`);

  // Assertion 2: Decoy password decrypts decoy text
  console.log("\n[TEST] Decrypting with decoy password...");
  const decoyResult = await unlockVault(vault, decoyPass);
  assert(decoyResult.type === "decoy", `Sector type is "decoy" (got "${decoyResult.type}")`);
  assert(decoyResult.payload.text === decoyText, `Decoy text matches: "${decoyResult.payload.text}"`);

  // Assertion 3: Master password decrypts hidden text
  console.log("\n[TEST] Decrypting with master password...");
  const hiddenResult = await unlockVault(vault, masterPass);
  assert(hiddenResult.type === "hidden", `Sector type is "hidden" (got "${hiddenResult.type}")`);
  assert(hiddenResult.payload.text === hiddenText, `Hidden text matches: "${hiddenResult.payload.text}"`);

  // Assertion 4: Wrong password fails cleanly
  console.log("\n[TEST] Attempting decryption with wrong password...");
  let wrongPassFailed = false;
  try {
    await unlockVault(vault, "wrongpass");
  } catch (e) {
    wrongPassFailed = e.message.includes("Decryption failed");
  }
  assert(wrongPassFailed, "Wrong password throws 'Decryption failed / Data corrupted'");

  // Summary
  console.log("\n" + "=".repeat(60));
  if (failed === 0) {
    console.log("[SUCCESS] All cryptographic roundtrip assertions passed 100%.");
  } else {
    console.error(`[FAILURE] ${failed} of ${passed + failed} assertions failed.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
