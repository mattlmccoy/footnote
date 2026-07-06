// js/modal.js
// Pure modal-stack state behind app.js's openModal() DOM helper. Modals stack (a dialog can open a
// child); ESC / overlay-click closes the topmost only. The DOM wiring lives in app.js; this keeps the
// ordering logic unit-testable.
export function modalReducer(stack, action) {
  switch (action && action.type) {
    case 'open':     return [...stack, action.id];
    case 'close':    return stack.slice(0, -1);
    case 'closeAll': return [];
    default:         return stack;
  }
}
export function topModal(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}
