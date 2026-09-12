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

// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR PUBLIC KEY (SPKI, base64url)
// Replace this value with your generated base64url-encoded SPKI public key
// from running: node license-generator.js <your-alias>
// ─────────────────────────────────────────────────────────────────────────────
const OPERATOR_PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAGIaxpK_eF4Ql0B5MBxTB8MbfnAOKF2VHvztSd3wI7lc";

const LICENSE_STORAGE_KEY = "idclose_pro_license";
const VAULT_PRO_TOKEN_KEY = "vault_pro_token";
let _isProLicensed = false;
let _proAlias = "";

function getProStatus() { return _isProLicensed; }
function getProAlias() { return _proAlias; }

// ─────────────────────────────────────────────────────────────────────────────
// Base64url helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Public Key Import
// ─────────────────────────────────────────────────────────────────────────────

async function importOperatorPublicKey() {
  const rawBytes = b64urlToBuffer(OPERATOR_PUBLIC_KEY_B64);
  return crypto.subtle.importKey(
    "spki",
    rawBytes.buffer,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// License Verification
// ─────────────────────────────────────────────────────────────────────────────

async function verifyLicense(tokenString) {
  if (!tokenString || typeof tokenString !== "string") {
    return { valid: false, error: "Empty token" };
  }

  if (OPERATOR_PUBLIC_KEY_B64 === "PASTE_YOUR_PUBLIC_KEY_HERE") {
    return { valid: false, error: "Operator public key not configured" };
  }

  try {
    const wrapperBytes = b64urlToBuffer(tokenString);
    const wrapperJson = new TextDecoder().decode(wrapperBytes);
    const wrapper = JSON.parse(wrapperJson);

    if (!wrapper.p || !wrapper.s) {
      return { valid: false, error: "Invalid token structure" };
    }

    const dataBuffer = b64urlToBuffer(wrapper.p);
    const signatureBuffer = b64urlToBuffer(wrapper.s);

    const payloadJson = new TextDecoder().decode(dataBuffer);
    const payload = JSON.parse(payloadJson);

    if (!payload.sub || !payload.tier || !payload.iat) {
      return { valid: false, error: "Malformed payload" };
    }

    const publicKey = await importOperatorPublicKey();

    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signatureBuffer,
      dataBuffer
    );

    if (!valid) {
      return { valid: false, error: "Invalid signature — license tampered or forged" };
    }

    return {
      valid: true,
      alias: payload.sub,
      tier: payload.tier,
      issuedAt: payload.iat,
      tokenData: payload
    };
  } catch (e) {
    return { valid: false, error: "Invalid or corrupted license key." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation / Deactivation
// ─────────────────────────────────────────────────────────────────────────────

function activatePro(tokenString, alias) {
  _isProLicensed = true;
  _proAlias = alias || "";
  try {
    localStorage.setItem(LICENSE_STORAGE_KEY, tokenString);
  } catch (_e) { /* localStorage unavailable — session only */ }
}

function deactivatePro() {
  _isProLicensed = false;
  _proAlias = "";
  try {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch (_e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-load on app init
// ─────────────────────────────────────────────────────────────────────────────

async function restoreProFromStorage() {
  try {
    // Check vault_pro_token (base64url wrapper format from license-generator.js)
    const vaultToken = localStorage.getItem(VAULT_PRO_TOKEN_KEY);
    if (vaultToken) {
      const result = await verifyLicense(vaultToken);
      if (result.valid) {
        _isProLicensed = true;
        _proAlias = result.alias || "";
        return true;
      }
      localStorage.removeItem(VAULT_PRO_TOKEN_KEY);
    }

    // Fall back to legacy format (idclose_pro_license)
    const stored = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (!stored) return false;
    const legacyResult = await verifyLicense(stored);
    if (legacyResult.valid) {
      _isProLicensed = true;
      _proAlias = legacyResult.alias || "";
      return true;
    }
    localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch (_e) { /* ignore */ }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  LICENSE_STORAGE_KEY,
  VAULT_PRO_TOKEN_KEY,
  getProStatus,
  getProAlias,
  verifyLicense,
  importOperatorPublicKey,
  activatePro,
  deactivatePro,
  restoreProFromStorage
};
