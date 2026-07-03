# Vendored crypto (do not edit)

Used only by `seal.js` to sealed-box encrypt GitHub Actions secret values in the browser
(GitHub's Secrets API requires libsodium `crypto_box_seal` ciphertext). No backend, no build step.

- `nacl.min.js` — tweetnacl 1.0.3 (MIT, https://github.com/dchest/tweetnacl-js).
  sha256 `973cc5733cc7432e30ee4682098f413094f494bccf76a567c23908c5035ddbbc`.
- `blake2b.js` — self-contained BLAKE2b composed from blakejs 1.2.1 (MIT,
  https://github.com/dcposch/blakejs): `util.js` inlined into `blake2b.js`, exposed as
  `globalThis.blake2bLib`. Verified against the RFC 7693 `blake2b("abc")` vector.
- `seal.js` — implements `crypto_box_seal` (`epk || crypto_box(m, BLAKE2b(epk||rpk,24), rpk, esk)`),
  byte-identical to libsodium so GitHub decrypts server-side. `sealWith(nacl, blake2b, pubB64, val)`
  is the pure/testable core; `sealToBase64(pubB64, val)` binds the browser globals.

Refresh: re-run `curl https://unpkg.com/tweetnacl@1.0.3/nacl.min.js` and rebuild `blake2b.js`
from blakejs (inline `util` require, expose `globalThis.blake2bLib`). Re-run `tests/seal.test.mjs`.
