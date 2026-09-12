# ID-CLOSE VAULT (v1.0.0)

> Zero-Knowledge AES-256-GCM Air-Gapped Secure Container.

[![License: Proprietary](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-blue.svg)](SECURITY.md)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](package.json)
[![Air-Gapped](https://img.shields.io/badge/Air--Gap-Compliant-000000.svg)](#core-security-architecture)

---

## Overview

- 100% client-side, browser-native cryptographic vault. No server-side processing.
- Designed for zero-knowledge plausible deniability and maximum OPSEC.
- Built to run seamlessly in air-gapped amnesic environments (Tails OS, Qubes OS).
- Headerless container format. Single `.bin` file, no metadata leakage.
- One dependency: `express` for static serving. All cryptographic operations use the native Web Crypto API.

---

## Core Security Architecture

| Component | Implementation |
|---|---|
| **Encryption** | AES-256-GCM with authenticated tags |
| **Key Derivation** | PBKDF2 with high-iteration SHA-512 |
| **Plausible Deniability** | Dual-partition architecture (Decoy Volume A / Hidden Volume B) |
| **Anti-Forensics** | Strict memory zeroization & purge routines (DoD 5220.22-M principles) |
| **Air-Gap Integrity** | Zero network dependencies, zero CDNs, zero third-party telemetry |
| **Tier Binding** | HKDF-SHA256 binds license tokens to AES keys (Ed25519 verified) |
| **Integrity** | HMAC-based container integrity verification via Web Crypto |

---

## Usage

Open `public/index.html` directly in any modern browser, or serve statically via any offline HTTP server:

```bash
# Direct file access (no server required)
open public/index.html

# Or serve via Node.js
node server.js
```

No build step. No transpilation. No external dependencies at runtime.

---

## Security & Responsible Disclosure

Vulnerabilities are accepted under responsible disclosure. See [`SECURITY.md`](SECURITY.md) for full scope and timeline.

**Encrypted reports:** Encrypt all sensitive correspondence with the ID-CLOSE PGP key.

```
PGP Key Fingerprint : A019 5EA1 108D 251A A409  6A07 F9FB F2D9 4FE5 3E8B
```

- **Contact:** [id-close@proton.me](mailto:id-close@proton.me)
- **Warrant Canary:** [`public/canary.txt`](public/canary.txt)
- **Public Key:** [`public/pgp-key.txt`](public/pgp-key.txt)

---

## Legal & Licensing

ID-CLOSE Vault source code is provided under a **proprietary, all-rights-reserved license** for code review and verification only. No reproduction, hosting, or cloning is permitted.

| Document | Description |
|---|---|
| [`LICENSE`](LICENSE) | Proprietary license terms — inspection rights only |
| [`TERMS.md`](TERMS.md) | Terms of Service and prohibited conduct |
| [`WHITEPAPER.md`](WHITEPAPER.md) | Formal cryptographic specification and threat model |

---

<p align="center">
  <strong>ID-CLOSE</strong> — Zero trust. Zero knowledge. Zero compromise.<br>
  <a href="https://id-close.com">id-close.com</a>
</p>
