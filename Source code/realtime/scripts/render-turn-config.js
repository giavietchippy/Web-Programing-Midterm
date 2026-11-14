'use strict';

const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PRODUCTION_DENIED_PEERS = [
  '# Block loopback, private, and link-local IPv4 destinations in production.',
  'denied-peer-ip=127.0.0.0-127.255.255.255',
  'denied-peer-ip=10.0.0.0-10.255.255.255',
  'denied-peer-ip=172.16.0.0-172.31.255.255',
  'denied-peer-ip=192.168.0.0-192.168.255.255',
  'denied-peer-ip=169.254.0.0-169.254.255.255',
].join('\n');

async function main() {
  const secret = process.env.TURN_SECRET;
  const realm = process.env.TURN_REALM;
  const externalIp = process.env.TURN_EXTERNAL_IP?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret || /[\r\n]/.test(secret)) {
    throw new Error('TURN_SECRET must be set to a single-line secret.');
  }
  if (!realm || /[\r\n]/.test(realm)) {
    throw new Error('TURN_REALM must be set to a single-line realm.');
  }
  if (externalIp && net.isIP(externalIp) === 0) {
    throw new Error('TURN_EXTERNAL_IP must be a valid IP address when set.');
  }
  if (isProduction && !externalIp) {
    throw new Error('TURN_EXTERNAL_IP must be set in production.');
  }

  const templatePath = path.join(__dirname, '..', 'coturn', 'turnserver.conf.template');
  const outputPath = path.join(__dirname, '..', 'coturn', 'turnserver.conf');
  const template = await fs.readFile(templatePath, 'utf8');
  const substitutions = {
    TURN_SECRET: secret,
    TURN_REALM: realm,
    TURN_EXTERNAL_IP_DIRECTIVE: externalIp
      ? `external-ip=${externalIp}`
      : '# external-ip omitted for local/private-network testing.',
    DENIED_PEER_IP_RULES: isProduction
      ? PRODUCTION_DENIED_PEERS
      : '# Production-only private-peer restrictions are disabled.',
  };
  const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => {
    if (!Object.hasOwn(substitutions, key)) {
      throw new Error(`Unknown coturn template placeholder: ${placeholder}`);
    }
    return substitutions[key];
  });

  if (/\{\{[^}]+\}\}/.test(rendered)) {
    throw new Error('The rendered coturn configuration contains an unresolved placeholder.');
  }

  await fs.writeFile(outputPath, rendered, { encoding: 'utf8', mode: 0o600 });
  console.log(`Rendered coturn configuration to ${path.relative(path.join(__dirname, '..'), outputPath)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
