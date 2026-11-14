'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const args = process.argv.slice(2);
const username = args.find((argument) => !argument.startsWith('--'));
const roleIndex = args.indexOf('--role');
const role = roleIndex === -1 ? 'user' : args[roleIndex + 1];
const secret = process.env.JWT_SECRET;

if (!username || !username.trim()) {
  console.error('Usage: npm run make:test-token -- <username> [--role user|admin]');
  process.exit(1);
}
if (role !== 'user' && role !== 'admin') {
  console.error('Role must be "user" or "admin".');
  process.exit(1);
}
if (!secret) {
  console.error('JWT_SECRET is required. Set it in realtime/.env before generating a test token.');
  process.exit(1);
}

const token = jwt.sign({ userId: crypto.randomUUID(), username: username.trim(), role, sessionVersion: 0 }, secret, {
  algorithm: 'HS256',
  expiresIn: '1h',
});

console.log(token);
