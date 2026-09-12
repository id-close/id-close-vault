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

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;


// Security & Isolation Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none';"
  );
  next();
});


// Serve static assets from public/
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html', 'htm']
}));


// Fallback routing to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(PORT, '127.0.0.1', () => {
  console.log(`ID-CLOSE VAULT v1.0 Active on 127.0.0.1:${PORT}`);
});
