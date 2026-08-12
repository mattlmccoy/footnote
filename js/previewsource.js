// Pure decision logic for the owner reader's "Preview staged edits" control. Kept out of the DOM so the
// one rule that matters for safety, the default reading view NEVER changes, is unit-tested.
//
// The owner reader normally renders content/<id>.html (the MERGED reading view). When Claude stages a
// full-section rewrite it builds a branch render at preview/<id>.html (from review-edits/<id>), which the
// owner should be able to view before approving. Previewing is strictly opt-in: it shows the branch render
// only when there is a staged edit, that branch render was actually built, and the owner toggled it on.

// Which rendered HTML path the reader should fetch. Defaults to the merged content path in every case
// except the fully-armed one (staged + built + toggled on), so a missing preview or an accidental toggle
// can never swap the live merged view.
export function readingSource({ unitId, hasStaged = false, previewExists = false, previewOn = false } = {}) {
  if (hasStaged && previewExists && previewOn) return `preview/${unitId}.html`;
  return `content/${unitId}.html`;
}

// Whether to show the "Preview staged edits" control at all. Both a staged edit and a built branch preview
// are required; otherwise the control is hidden entirely so there is no dead click.
export function showPreviewToggle({ hasStaged = false, previewExists = false } = {}) {
  return !!(hasStaged && previewExists);
}
