/**
 * templates.js
 * -----------------------------------------------------------------------------
 * Centralised HTML templates for tooltip and modal UI pieces.
 */

import { PW_OWNED_ATTR } from "../../constants.js";

const OWNED_ATTR_FRAGMENT = `${PW_OWNED_ATTR}=""`;

const tooltipMarkup = `
<div class="pw-tooltip" role="tooltip" hidden data-worm-id="" ${OWNED_ATTR_FRAGMENT}>
  <div class="pw-tooltip__content pw-tooltip__content--empty">No comment yet.</div>
  <div class="pw-tooltip__tags" hidden></div>
  <div class="pw-tooltip__actions">
    <button type="button" class="pw-btn pw-btn--link pw-tooltip__expand">Open</button>
  </div>
</div>
`;

const backdropMarkup = `
<div class="pw-modal-backdrop" aria-hidden="true" hidden ${OWNED_ATTR_FRAGMENT}>
  <div class="pw-modal-window" role="dialog" aria-modal="true" data-mode="" data-worm-id=""></div>
</div>
`;

const modalViewMarkup = `
<div class="pw-modal" ${OWNED_ATTR_FRAGMENT}>
  <header class="pw-modal__header">
    <h2 class="pw-modal__title">Worm Details</h2>
    <button type="button" class="pw-btn pw-btn--icon pw-modal__close" data-pw-action="close" aria-label="Close worm details">X</button>
  </header>
  <div class="pw-modal__body">
    <section class="pw-modal__section">
      <h3 class="pw-modal__section-title">Comment</h3>
      <p class="pw-modal__comment pw-modal__comment--empty">No comment yet.</p>
    </section>
    <section class="pw-modal__section">
      <h3 class="pw-modal__section-title">Tags</h3>
      <div class="pw-modal__tags"></div>
    </section>
    <section class="pw-modal__section pw-modal__section--inline">
      <h3 class="pw-modal__section-title">Status</h3>
      <span class="pw-status">Private</span>
    </section>
    <section class="pw-modal__meta"></section>
  </div>
  <footer class="pw-modal__footer">
    <button type="button" class="pw-btn" data-pw-action="edit">Edit</button>
    <button type="button" class="pw-btn" data-pw-action="delete">Delete</button>
    <button type="button" class="pw-btn" data-pw-action="close">Close</button>
  </footer>
</div>
`;

const modalFormMarkup = `
<form class="pw-modal pw-modal--form" ${OWNED_ATTR_FRAGMENT}>
  <header class="pw-modal__header">
    <h2 class="pw-modal__title">Edit Worm</h2>
    <button type="button" class="pw-btn pw-btn--icon pw-modal__close" data-pw-action="cancel" aria-label="Cancel worm edit">X</button>
  </header>
  <div class="pw-modal__body">
    <label class="pw-field">
      <span class="pw-field__label">Comment</span>
      <textarea name="content" class="pw-field__control pw-field__control--textarea" rows="6" placeholder="Add your comment..."></textarea>
    </label>
    <label class="pw-field">
      <span class="pw-field__label">Tags</span>
      <input type="text" name="tags" class="pw-field__control pw-field__control--input" placeholder="tag1, tag2" />
    </label>
    <label class="pw-field pw-field--inline">
      <span class="pw-field__label">Status</span>
      <select name="status" class="pw-field__control pw-field__control--dropdown">
        <option value="private">Private</option>
        <option value="friends">Friends</option>
        <option value="public">Public</option>
      </select>
    </label>
  </div>
  <footer class="pw-modal__footer">
    <button type="button" class="pw-btn" data-pw-action="cancel">Cancel</button>
    <button type="submit" class="pw-btn pw-btn--primary">Save Changes</button>
  </footer>
</form>
`;

type TemplateCache<T extends Element> = {
  node: T | null;
};

const caches = {
  tooltip: { node: null as HTMLDivElement | null },
  backdrop: { node: null as HTMLDivElement | null },
  modalView: { node: null as HTMLDivElement | null },
  modalForm: { node: null as HTMLFormElement | null },
} satisfies Record<string, TemplateCache<Element>>;

function getTemplate<T extends Element>(cache: TemplateCache<T>, markup: string): T {
  if (!cache.node) {
    if (typeof document === "undefined") {
      throw new Error("Templates require a DOM environment.");
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = markup.trim();
    cache.node = tpl.content.firstElementChild as T | null;
  }
  if (!cache.node) {
    throw new Error("Template markup did not yield an element.");
  }
  return cache.node;
}

export function createTooltip(): HTMLDivElement {
  return getTemplate(caches.tooltip, tooltipMarkup).cloneNode(true) as HTMLDivElement;
}

export function createBackdrop(): { backdrop: HTMLDivElement; windowEl: HTMLDivElement } {
  const backdrop = getTemplate(caches.backdrop, backdropMarkup).cloneNode(true) as HTMLDivElement;
  const windowEl = backdrop.querySelector<HTMLDivElement>(".pw-modal-window");
  if (!windowEl) {
    throw new Error("Backdrop template missing modal window element.");
  }
  return { backdrop, windowEl };
}

export function createModalView(): HTMLDivElement {
  return getTemplate(caches.modalView, modalViewMarkup).cloneNode(true) as HTMLDivElement;
}

export function createModalForm(): HTMLFormElement {
  return getTemplate(caches.modalForm, modalFormMarkup).cloneNode(true) as HTMLFormElement;
}
