# ID-CLOSE Vault — Security Policy

## Responsible Disclosure

ID-CLOSE is committed to the security and integrity of our zero-knowledge cryptographic vault system. We welcome responsible disclosure of vulnerabilities discovered by security researchers.

## Reporting Channel

All security findings, inquiries, and vulnerability reports must be submitted via:

- **Email:** [id-close@proton.me](mailto:id-close@proton.me)

Do **not** open public GitHub issues for security vulnerabilities. All reports are handled confidentially.

## Verification Standards

Before engaging with any claimed ID-CLOSE communication, verify authenticity using:

- **Warrant Canary:** Published at [https://id-close.com/canary.txt](https://id-close.com/canary.txt)
- **PGP Public Key:** Available at [https://id-close.com/pgp-key.txt](https://id-close.com/pgp-key.txt) and in the `PGP-keys-and-password/` directory of this repository.

Encrypt all sensitive correspondence with the ID-CLOSE PGP key.

## Scope

The following classes of vulnerabilities are in-scope for responsible disclosure:

| Category | Examples |
|----------|----------|
| **Zero-Knowledge Leaks** | Information disclosure that could allow a third party (including the server operator) to infer plaintext content, user identity, or vault structure |
| **Cryptographic Failures** | Weaknesses in PBKDF2 key derivation, AES-256-GCM encryption, IV generation, tag verification, or key scheduling |
| **Air-Gap Bypasses** | Any mechanism by which the Software transmits, exfiltrates, or leaks data to external networks, services, or third parties without explicit user action |
| **License Verification Bypass** | Circumvention or forgery of Ed25519 signature verification in `license-verify.js` |
| **Injection & XSS** | Cross-site scripting, DOM injection, or content-security-policy bypasses |
| **Server-Side Vulnerabilities** | Path traversal, header injection, or other flaws in `server.js` |

## Disclosure Timeline

1. **Report received** — Acknowledgment within 72 hours.
2. **Triage** — Initial assessment within 7 business days.
3. **Remediation** — Fix developed and tested before any public disclosure.
4. **Credit** — Researchers who follow this process may be credited (with consent) in release notes.

## Scope Limitations

This policy does not authorize destructive testing, denial-of-service attacks, or access to production infrastructure beyond what is necessary to demonstrate a vulnerability.

---

**ID-CLOSE** — https://id-close.com  
**Security Contact:** [id-close@proton.me](mailto:id-close@proton.me)
