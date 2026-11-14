'use strict';

require('dotenv').config();

const crypto = require('node:crypto');

const [name, ...extraArguments] = process.argv.slice(2);
const secret = process.env.TURN_SECRET;
const configuredTtl = Number(process.env.TURN_TTL);
const ttl = Number.isInteger(configuredTtl) && configuredTtl > 0 ? configuredTtl : 3600;

if (
  !name ||
  !name.trim() ||
  name.includes(':') ||
  /[\r\n]/.test(name) ||
  extraArguments.length > 0
) {
  console.error('Usage: node scripts/make-turn-credential.js <name>');
  process.exit(1);
}
if (!secret) {
  console.error('TURN_SECRET is required. Set it in realtime/.env before generating a credential.');
  process.exit(1);
}

const expiry = Math.floor(Date.now() / 1000) + ttl;
const username = `${expiry}:${name.trim()}`;
const password = crypto.createHmac('sha1', secret).update(username).digest('base64');

console.log(JSON.stringify({
  username,
  password,
  expiresAt: new Date(expiry * 1000).toISOString(),
}, null, 2));
