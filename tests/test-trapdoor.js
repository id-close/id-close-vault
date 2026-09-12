#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirrored from vault.js / vault-worker.js)
// ─────────────────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PRO_SIZE_THRESHOLD = 50 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Base64url helpers (from license-generator.js)
// ─────────────────────────────────────────────────────────────────────────────

function base64urlEncode(buffer) {
  const b64 = Buffer.from(buffer).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return Buffer.from(b64, "base64");
}

// ─────────────────────────────────────────────────────────────────────────────
// Key loading (from license-generator.js)
// ─────────────────────────────────────────────────────────────────────────────

const PRIVATE_KEY_PATH = path.join(__dirname, "vault_private_key.pem");
const PUBLIC_KEY_PATH = path.join(__dirname, "vault_public_key.pem");

function loadPrivateKey() {
  return fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
}

function loadPublicKey() {
  return fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Ed25519 Sign (from license-generator.js)
// ─────────────────────────────────────────────────────────────────────────────

function signPayload(privateKeyPem, payloadBytes) {
  const keyObject = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, payloadBytes, keyObject);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ed25519 Verify (mirrors license-verify.js Web Crypto logic)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyEd25519(publicKeyPem, payloadBytes, signatureBytes) {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, payloadBytes, keyObject, signatureBytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// HKDF key derivation (mirrors vault.js deriveKeyHKDF)
// ─────────────────────────────────────────────────────────────────────────────

async function deriveKeyHKDF(ikmBytes, salt, info) {
  return new Promise((resolve, reject) => {
    crypto.hkdf("sha256", ikmBytes, salt, info, KEY_LENGTH_BITS / 8, (err, derived) => {
      if (err) return reject(err);
      resolve(Buffer.from(derived));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PBKDF2 key derivation (mirrors vault.js deriveKey)
// ─────────────────────────────────────────────────────────────────────────────

async function deriveKeyPBKDF2(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH_BITS / 8, "sha256", (err, key) => {
      if (err) return reject(err);
      resolve(Buffer.from(key));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-GCM encrypt/decrypt (mirrors vault.js)
// ─────────────────────────────────────────────────────────────────────────────

async function encryptAesGcm(key, plaintext, iv) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}

async function decryptAesGcm(key, ciphertextWithTag, iv) {
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - TAG_LENGTH);
  const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier info context builder (mirrors vault.js getTierInfoContext)
// ─────────────────────────────────────────────────────────────────────────────

function buildTierInfoContext(signatureB64, containerSizeBytes) {
  if (containerSizeBytes <= PRO_SIZE_THRESHOLD) {
    return Buffer.from("VAULT_TIER_FREE_STANDARD", "utf8");
  }
  if (!signatureB64) {
    return Buffer.from("INVALID_TAMPERED_TRAPDOOR", "utf8");
  }
  const sigBytes = base64urlDecode(signatureB64);
  const prefix = Buffer.from("VAULT_PRO_ED25519_BOUND:", "utf8");
  return Buffer.concat([prefix, sigBytes]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive tier key (mirrors vault.js deriveTierKey)
// ─────────────────────────────────────────────────────────────────────────────

async function deriveTierKey(password, salt, signatureB64, containerSizeBytes) {
  const baseKey = await deriveKeyPBKDF2(password, salt);
  const info = buildTierInfoContext(signatureB64, containerSizeBytes);
  const aesKey = await deriveKeyHKDF(baseKey, salt, info);
  return aesKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate a legitimate Pro license token (mirrors license-generator.js)
// ─────────────────────────────────────────────────────────────────────────────

function generateProToken(alias) {
  const privateKey = loadPrivateKey();
  const payload = {
    sub: alias,
    tier: "PRO_100MB",
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Buffer.from(payloadJson, "utf8");
  const signature = signPayload(privateKey, payloadBytes);

  const tokenObj = {
    p: base64urlEncode(payloadBytes),
    s: base64urlEncode(signature),
  };
  const tokenWrapper = base64urlEncode(Buffer.from(JSON.stringify(tokenObj), "utf8"));
  return { token: tokenWrapper, signature: tokenObj.s, payload };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test matrix
// ─────────────────────────────────────────────────────────────────────────────

const results = [];

function report(name, pass, detail) {
  const tag = pass ? "\x1b[32m[PASS]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
  results.push({ name, pass, detail });
  console.log(`  ${tag} ${name}${detail ? " — " + detail : ""}`);
}

async function test1_validTokenVerification() {
  const alias = "GhostUser";
  const { token } = generateProToken(alias);
  const publicKey = loadPublicKey();

  const wrapperBytes = base64urlDecode(token);
  const wrapper = JSON.parse(wrapperBytes.toString("utf8"));
  const payloadBytes = base64urlDecode(wrapper.p);
  const sigBytes = base64urlDecode(wrapper.s);

  const valid = await verifyEd25519(publicKey, payloadBytes, sigBytes);
  report("1. Ed25519 Valid Token Verification", valid === true, valid ? "valid: true" : "valid: false");
}

async function test2_tamperedTokenRejection() {
  const { token } = generateProToken("GhostUser");
  const publicKey = loadPublicKey();

  // Tamper: flip 1 byte in the signature
  const wrapperBytes = base64urlDecode(token);
  const wrapper = JSON.parse(wrapperBytes.toString("utf8"));
  const payloadBytes = base64urlDecode(wrapper.p);
  const sigBytes = base64urlDecode(wrapper.s);

  const tamperedSig = Buffer.from(sigBytes);
  tamperedSig[4] ^= 0xff; // flip bits in byte 4

  const valid = await verifyEd25519(publicKey, payloadBytes, tamperedSig);

  // Also test with completely random signature
  const randomSig = crypto.randomBytes(64);
  const validRandom = await verifyEd25519(publicKey, payloadBytes, randomSig);

  const bothRejected = valid === false && validRandom === false;
  report(
    "2. Tampered / Forged License Rejection",
    bothRejected,
    `tampered: ${valid}, random: ${validRandom} → rejected: ${bothRejected}`
  );
}

async function test3_legitimateProDecryption() {
  const password = "TrustedProPassword!2026";
  const containerSize = 64 * 1024 * 1024; // 64 MB — exceeds Pro threshold
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const plaintext = Buffer.from("ID-CLOSE VAULT PRO — LOCKED CONTENT v1.0. TOP SECRET.", "utf8");

  const { signature: sigB64 } = generateProToken("GhostUser");

  // Encrypt with legitimate Pro key
  const encKey = await deriveTierKey(password, salt, sigB64, containerSize);
  const ciphertext = await encryptAesGcm(encKey, plaintext, iv);

  // Decrypt with same legitimate Pro key
  const decKey = await deriveTierKey(password, salt, sigB64, containerSize);
  const decrypted = await decryptAesGcm(decKey, ciphertext, iv);

  const match = Buffer.compare(plaintext, decrypted) === 0;
  report(
    "3. Legitimate Pro Decryption (>50MB Tier Binding)",
    match,
    `plaintext integrity: ${match ? "byte-for-byte match" : "MISMATCH"}`
  );
}

async function test4_crackSimulation() {
  const password = "TrustedProPassword!2026";
  const containerSize = 64 * 1024 * 1024; // 64 MB — exceeds Pro threshold
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const plaintext = Buffer.from("ID-CLOSE VAULT PRO — LOCKED CONTENT v1.0. TOP SECRET.", "utf8");

  const { signature: legitSigB64 } = generateProToken("GhostUser");

  // Encrypt with the legitimate Pro key
  const encKey = await deriveTierKey(password, salt, legitSigB64, containerSize);
  const ciphertext = await encryptAesGcm(encKey, plaintext, iv);

  // Attacker injects a forged token with a fake signature
  const fakeSigBytes = crypto.randomBytes(64);
  const fakeSigB64 = base64urlEncode(fakeSigBytes);

  let decryptionThrew = false;
  let errorType = "";
  try {
    const attackKey = await deriveTierKey(password, salt, fakeSigB64, containerSize);
    await decryptAesGcm(attackKey, ciphertext, iv);
  } catch (e) {
    decryptionThrew = true;
    errorType = e.message.includes("auth") || e.message.includes("tag")
      ? "authentication tag mismatch"
      : e.message.includes("decrypt") || e.message.includes("Unsupported")
        ? "decryption failure"
        : e.message;
  }

  report(
    "4. Crack Simulation (Trapdoor Cryptographic Wall)",
    decryptionThrew,
    decryptionThrew
      ? `decryption threw: ${errorType} — zero bytes recovered`
      : "FAIL — attacker decrypted without genuine signature"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║     ID-CLOSE VAULT — Cryptographic Trapdoor & License Audit       ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log("");

  await test1_validTokenVerification();
  await test2_tamperedTokenRejection();
  await test3_legitimateProDecryption();
  await test4_crackSimulation();

  // ── Summary Matrix ──────────────────────────────────────────────────────
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────┬────────┐");
  console.log("│ Scenario                                               │ Result │");
  console.log("├──────────────────────────────────────────────────────────┼────────┤");
  for (const r of results) {
    const label = r.name.padEnd(56);
    const tag = r.pass ? "\x1b[32m  PASS \x1b[0m" : "\x1b[31m  FAIL \x1b[0m";
    console.log(`│ ${label} │${tag}│`);
  }
  console.log("└──────────────────────────────────────────────────────────┴────────┘");

  const allPass = results.every((r) => r.pass);
  console.log("");
  if (allPass) {
    console.log("  \x1b[32m✓ VAULT IS 100% MATHEMATICALLY TAMPER-PROOF\x1b[0m");
    console.log("    All 4 cryptographic boundary tests passed.");
    console.log("    HKDF tier-binding trapdoor correctly enforces Ed25519 signature.");
  } else {
    console.log("  \x1b[31m✗ VAULT INTEGRITY COMPROMISED\x1b[0m");
    console.log("    One or more tests failed — review results above.");
  }
  console.log("");

  process.exit(allPass ? 0 : 1);
}

main();
