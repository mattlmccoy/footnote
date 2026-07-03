// Client-side libsodium crypto_box_seal, so the owner can encrypt GitHub Actions secret values
// in the browser (GitHub's Secrets API requires sealed-box ciphertext). Composed from vendored
// tweetnacl (crypto_box) + BLAKE2b (nonce derivation) — no backend, no build step.
//
// crypto_box_seal(m, rpk):
//   epk,esk = keypair();  nonce = BLAKE2b(epk || rpk, 24);
//   c = crypto_box(m, nonce, rpk, esk);  return epk || c
// This is byte-identical to libsodium's crypto_box_seal, so GitHub decrypts it server-side.
import './nacl.min.js';    // browser: sets globalThis.nacl (UMD global assignment)
import './blake2b.js';     // browser + node: sets globalThis.blake2bLib (IIFE)

// Pure core with injected libs so it's unit-testable under Node (where the UMD global isn't set).
export function sealWith(nacl, blake2b, pubKeyB64, value){
  const rpk = Uint8Array.from(atob(pubKeyB64), c => c.charCodeAt(0));   // recipient public key (32)
  const eph = nacl.box.keyPair();
  const input = new Uint8Array(eph.publicKey.length + rpk.length);
  input.set(eph.publicKey, 0); input.set(rpk, eph.publicKey.length);
  const nonce = blake2b(input, undefined, 24);                          // 24-byte crypto_box nonce
  const boxed = nacl.box(new TextEncoder().encode(value), nonce, rpk, eph.secretKey);
  const out = new Uint8Array(eph.publicKey.length + boxed.length);
  out.set(eph.publicKey, 0); out.set(boxed, eph.publicKey.length);
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Browser entry: binds the globals set by the side-effect imports above.
export function sealToBase64(pubKeyB64, value){
  return sealWith(globalThis.nacl, globalThis.blake2bLib.blake2b, pubKeyB64, value);
}
