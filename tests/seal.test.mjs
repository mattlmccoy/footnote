import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { sealWith } from '../js/vendor/seal.js';

const require = createRequire(import.meta.url);
const nacl = require('../js/vendor/nacl.min.js');   // UMD → module.exports = nacl
require('../js/vendor/blake2b.js');                 // IIFE → globalThis.blake2bLib
const blake2b = globalThis.blake2bLib.blake2b;

// Reverse of crypto_box_seal, to prove sealWith produces libsodium-compatible ciphertext.
function openSeal(sealedB64, recvPub, recvSec){
  const sealed = Uint8Array.from(atob(sealedB64), c => c.charCodeAt(0));
  const epk = sealed.slice(0, 32), c = sealed.slice(32);
  const input = new Uint8Array(64); input.set(epk, 0); input.set(recvPub, 32);
  const nonce = blake2b(input, undefined, 24);
  return nacl.box.open(c, nonce, epk, recvSec);
}

test('BLAKE2b matches the RFC 7693 "abc" vector', () => {
  assert.strictEqual(
    globalThis.blake2bLib.blake2bHex('abc'),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923');
});

test('sealWith → open round-trips (crypto_box_seal shape)', () => {
  const kp = nacl.box.keyPair();
  const pubB64 = Buffer.from(kp.publicKey).toString('base64');
  const sealedB64 = sealWith(nacl, blake2b, pubB64, 'smtp-secret-🔒');
  const sealed = Uint8Array.from(atob(sealedB64), c => c.charCodeAt(0));
  assert.strictEqual(sealed.length, 32 + 16 + new TextEncoder().encode('smtp-secret-🔒').length,
    'sealed = ephemeral_pk(32) + Poly1305 tag(16) + message');
  const opened = openSeal(sealedB64, kp.publicKey, kp.secretKey);
  assert.ok(opened, 'open returned null — ciphertext not decryptable');
  assert.strictEqual(new TextDecoder().decode(opened), 'smtp-secret-🔒');
});

test('a wrong recipient key cannot open the seal', () => {
  const kp = nacl.box.keyPair(), other = nacl.box.keyPair();
  const pubB64 = Buffer.from(kp.publicKey).toString('base64');
  const sealedB64 = sealWith(nacl, blake2b, pubB64, 'x');
  assert.strictEqual(openSeal(sealedB64, other.publicKey, other.secretKey), null);
});
