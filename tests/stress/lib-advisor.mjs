// lib-advisor.mjs — extract the REAL pure sync helpers out of js/advisor.js and js/gh.js source
// (the same idiom tests/advisor-merge.test.mjs uses) so the stress harnesses exercise production
// merge/retry logic, not a re-implementation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const advSrc = readFileSync(join(here, '..', '..', 'js', 'advisor.js'), 'utf8');

// advisor.js is window-coupled; pull out the standalone function bodies by regex.
const mergeFn = advSrc.match(/function mergeReviews\(remote, local\)\{[\s\S]*?\n\}/)[0];
const delLine = advSrc.match(/const deleteComment = .*?;/s)[0];

const extracted = new Function(
  `${delLine}\n${mergeFn}\nreturn { deleteComment, mergeReviews };`
)();

export const advisorMergeReviews = extracted.mergeReviews;   // (remote, local) — reviewer portal fork
export const deleteComment = extracted.deleteComment;

// gh.js is a clean ES module — import its owner-side merge directly (from this worktree's own copy).
export { mergeReview as ownerMergeReview } from '../../js/gh.js';
