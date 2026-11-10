'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const username = process.argv[2];
const secret = process.env.JWT_SECRET;

if (!username || !username.trim()) {
  console.error('Usage: npm run make:test-token -- <username>');
  process.exit(1);
}
if (!secret) {
  console.error('JWT_SECRET is required. Set it in realtime/.env before generating a test token.');
  process.exit(1);
}

const token = jwt.sign({ userId: crypto.randomUUID(), username: username.trim() }, secret, {
  algorithm: 'HS256',
  expiresIn: '1h',
});

console.log(token);
