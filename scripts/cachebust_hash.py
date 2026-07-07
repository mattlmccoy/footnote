"""Per-file content-hash cache-busting.

Every asset is loaded as `<file>?v=<token>`. Instead of stamping every token with the global commit SHA
(which bumps EVERY asset on every push, so an open tab shows a false "newer version available" nag even when
its bundle is byte-identical), stamp each token with a hash of the referenced file's EFFECTIVE content:
its own bytes with its import `?v=` tokens rewritten to their dependencies' effective hashes. A file's token
then changes iff the file or something it (transitively) imports changed — no more false nags, and a changed
dependency still busts every dependent's cache.

Pure + deterministic + idempotent (stamping already-stamped files is a no-op). Cycles fall back to a raw
content hash to terminate.
"""
import re
import hashlib
import posixpath

# JS import specifier: quote, ./ or ../ relative path ending .js, optional ?v=, same quote.
_JS_IMPORT = re.compile(r"""(['"])(\.{1,2}/[A-Za-z0-9._/-]+\.js)(\?v=[A-Za-z0-9._-]+)?\1""")
# HTML/JS-string asset reference: a relative path ending .js/.css carrying a ?v= token.
_ASSET_REF = re.compile(r"""((?:\.{1,2}/)?[A-Za-z0-9._/-]+\.(?:js|css))\?v=[A-Za-z0-9._-]+""")


def _short(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:7]


def _resolve(base_dir, spec):
    """Resolve a relative import/ref against the importer's dir → repo-relative path."""
    return posixpath.normpath(posixpath.join(base_dir, spec)).lstrip("/")


def _rewrite_js(content, base_dir, files, memo, stack):
    """Return `content` with each import ?v= token set to that import's effective hash."""
    def repl(m):
        q, spec = m.group(1), m.group(2)
        dep = _resolve(base_dir, spec)
        h = effective_hash(dep, files, memo, stack)
        return f"{q}{spec}?v={h}{q}" if h else m.group(0)
    return _JS_IMPORT.sub(repl, content)


def effective_hash(path, files, memo=None, stack=None):
    """Hash of `path`'s content with its imports normalized to their effective hashes. None if unknown."""
    if memo is None:
        memo = {}
    if stack is None:
        stack = frozenset()
    if path in memo:
        return memo[path]
    content = files.get(path)
    if content is None:
        return None  # external / not in the tree — leave its token alone
    if path in stack:
        return _short(content)  # cycle: raw content hash breaks the recursion
    if path.endswith(".js"):
        rewritten = _rewrite_js(content, posixpath.dirname(path), files, memo, stack | {path})
        h = _short(rewritten)
    else:
        h = _short(content)  # css / other leaf assets: hash their own bytes
    memo[path] = h
    return h


def stamp(files):
    """Return a new {path: content} with every ?v= token set to its referenced file's effective hash.

    JS files: import tokens -> imported files' effective hashes.
    HTML files: asset refs (js/css) -> referenced files' effective hashes.
    Non-.js/.html files pass through unchanged.
    """
    memo = {}
    out = {}
    for path, content in files.items():
        if path.endswith(".js"):
            out[path] = _rewrite_js(content, posixpath.dirname(path), files, memo, frozenset())
        elif path.endswith(".html"):
            base = posixpath.dirname(path)

            def repl(m, base=base):
                ref = m.group(1)
                dep = _resolve(base, ref)
                h = effective_hash(dep, files, memo, frozenset())
                return f"{ref}?v={h}" if h else m.group(0)
            out[path] = _ASSET_REF.sub(repl, content)
        else:
            out[path] = content
    return out
