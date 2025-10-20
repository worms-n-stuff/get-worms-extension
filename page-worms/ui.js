/**
 * ui.js
 * -----------------------------------------------------------------------------
 * Encapsulates tooltip and modal interactions for worms.
 */

import {
  createTooltip,
  createBackdrop,
  createModalView,
  createModalForm,
} from "./templates.js";

const STATUS_LABELS = {
  private: "Private",
  friends: "Friends",
  public: "Public",
};

export class WormUI {
  constructor({ getWormById, onEdit, onDelete } = {}) {
    this._getWormById = getWormById;
    this._onEdit = onEdit;
    this._onDelete = onDelete;

    this._tooltipEl = null;
    this._tooltipContentEl = null;
    this._tooltipTagsEl = null;
    this._tooltipHideTimer = null;
    this._tooltipActiveId = null;

    this._backdropEl = null;
    this._windowEl = null;
    this._state = null;
    this._formResolver = null;

    this._handleEnter = this._handleEnter.bind(this);
    this._handleLeave = this._handleLeave.bind(this);
    this._handleClick = this._handleClick.bind(this);
    this._handleTooltipExpand = this._handleTooltipExpand.bind(this);
    this._handleBackdropClick = this._handleBackdropClick.bind(this);
    this._handleModalClick = this._handleModalClick.bind(this);
    this._handleModalSubmit = this._handleModalSubmit.bind(this);
    this._handleModalKeydown = this._handleModalKeydown.bind(this);
  }

  wireWormElement(el) {
    if (!el || el.dataset.pwWired === "1") return;
    el.dataset.pwOwned = "1";
    el.dataset.pwWired = "1";
    el.addEventListener("mouseenter", this._handleEnter);
    el.addEventListener("mouseleave", this._handleLeave);
    el.addEventListener("focus", this._handleEnter);
    el.addEventListener("blur", this._handleLeave);
    el.addEventListener("click", this._handleClick);
  }

  hideTooltip(immediate = false) {
    if (!this._tooltipEl) return;
    const hide = () => {
      this._tooltipEl.hidden = true;
      this._tooltipEl.style.display = "none";
      this._tooltipEl.dataset.wormId = "";
      this._tooltipActiveId = null;
    };
    if (immediate) {
      this._cancelTooltipHide();
      hide();
      return;
    }
    this._cancelTooltipHide();
    this._tooltipHideTimer = setTimeout(hide, 120);
  }

  closeModal() {
    if (!this._backdropEl) return;
    this._resolveForm(null);
    this._hideBackdrop();
    this._state = null;
    if (this._windowEl) {
      this._windowEl.innerHTML = "";
      this._windowEl.dataset.mode = "";
      this._windowEl.dataset.wormId = "";
    }
  }

  reset() {
    this.hideTooltip(true);
    this.closeModal();
  }

  destroy() {
    this.reset();
    if (this._tooltipEl) {
      this._tooltipEl.remove();
    }
    this._tooltipEl = null;
    this._tooltipContentEl = null;
    this._tooltipTagsEl = null;
    if (this._backdropEl) {
      this._backdropEl.removeEventListener("click", this._handleBackdropClick);
      this._windowEl?.removeEventListener("click", this._handleModalClick);
      this._windowEl?.removeEventListener("submit", this._handleModalSubmit);
      this._backdropEl.remove();
    }
    this._backdropEl = null;
    this._windowEl = null;
    document.removeEventListener("keydown", this._handleModalKeydown, true);
  }

  _returnToViewer(wormId) {
    if (wormId == null) return;
    const worm = this._getWormById?.(wormId);
    if (worm) void this.openViewer(wormId);
  }

  async promptCreate(initial = {}) {
    const result = await this._openForm({
      mode: "create",
      worm: {
        id: null,
        content: initial?.content || "",
        tags: Array.isArray(initial?.tags) ? initial.tags : [],
        status: initial?.status || "private",
      },
    });
    return result;
  }

  async openViewer(wormId) {
    const id = Number(wormId);
    if (!Number.isFinite(id)) return;
    const worm = this._getWormById?.(id);
    if (!worm) {
      this.closeModal();
      return;
    }
    this.hideTooltip(true);
    const viewEl = createModalView();
    this._populateView(viewEl, worm);
    this._state = { mode: "view", wormId: worm.id };
    this._setModalContent(viewEl, this._state);
    this._showBackdrop();
  }

  // ---------------------------------------------------------------------------
  // Tooltip helpers
  // ---------------------------------------------------------------------------
  _ensureTooltip() {
    if (this._tooltipEl) return;
    const tooltip = createTooltip();
    tooltip.dataset.pwOwned = "1";
    tooltip.addEventListener("mouseenter", () => this._cancelTooltipHide());
    tooltip.addEventListener("mouseleave", () => this.hideTooltip());
    const expandBtn = tooltip.querySelector(".pw-tooltip__expand");
    expandBtn?.addEventListener("click", this._handleTooltipExpand);

    document.body.appendChild(tooltip);
    this._tooltipEl = tooltip;
    this._tooltipContentEl = tooltip.querySelector(".pw-tooltip__content");
    this._tooltipTagsEl = tooltip.querySelector(".pw-tooltip__tags");
  }

  _handleEnter(e) {
    const target = e.currentTarget;
    if (!target) return;
    const id = Number(target.dataset.wormId || target.dataset.wormid || "");
    if (!Number.isFinite(id)) return;
    const worm = this._getWormById?.(id);
    if (!worm) return;
    this._showTooltip(worm, target);
  }

  _handleLeave() {
    this.hideTooltip();
  }

  _handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (!target) return;
    const id = Number(target.dataset.wormId || target.dataset.wormid || "");
    if (!Number.isFinite(id)) return;
    this.hideTooltip(true);
    void this.openViewer(id);
  }

  _handleTooltipExpand(e) {
    e.preventDefault();
    e.stopPropagation();
    const id = Number(this._tooltipEl?.dataset.wormId || "");
    if (!Number.isFinite(id)) return;
    this.hideTooltip(true);
    void this.openViewer(id);
  }

  _showTooltip(worm, wormEl) {
    this._ensureTooltip();
    if (!this._tooltipEl) return;
    this._cancelTooltipHide();
    this._tooltipEl.dataset.wormId = String(worm.id);
    this._tooltipActiveId = worm.id;

    const snippet = (worm.content || "").trim();
    if (snippet) {
      const text =
        snippet.length > 160 ? `${snippet.slice(0, 157).trimEnd()}...` : snippet;
      this._tooltipContentEl.textContent = text;
      this._tooltipContentEl.classList.remove("pw-tooltip__content--empty");
    } else if (this._tooltipContentEl) {
      this._tooltipContentEl.textContent = "No comment yet.";
      this._tooltipContentEl.classList.add("pw-tooltip__content--empty");
    }

    if (this._tooltipTagsEl) {
      this._tooltipTagsEl.innerHTML = "";
      if (Array.isArray(worm.tags) && worm.tags.length) {
        this._tooltipTagsEl.hidden = false;
        for (const tag of worm.tags) {
          const chip = document.createElement("span");
          chip.className = "pw-chip";
          chip.textContent = tag;
          this._tooltipTagsEl.appendChild(chip);
        }
      } else {
        this._tooltipTagsEl.hidden = true;
      }
    }

    this._tooltipEl.hidden = false;
    this._tooltipEl.style.display = "block";
    requestAnimationFrame(() => this._positionTooltip(wormEl));
  }

  _positionTooltip(wormEl) {
    if (!this._tooltipEl) return;
    const tooltip = this._tooltipEl;
    const rect = wormEl.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const scrollX =
      window.scrollX ||
      window.pageXOffset ||
      document.documentElement.scrollLeft ||
      0;
    const scrollY =
      window.scrollY ||
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      0;
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    let top = rect.top + scrollY + rect.height / 2 - tipRect.height / 2;
    let left = rect.right + scrollX + 12;

    const maxLeft = scrollX + viewportW - tipRect.width - 12;
    if (left > maxLeft) {
      left = rect.left + scrollX - tipRect.width - 12;
    }
    const minTop = scrollY + 12;
    const maxTop = scrollY + viewportH - tipRect.height - 12;
    if (top < minTop) top = minTop;
    if (top > maxTop) top = maxTop;

    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.left = `${Math.round(left)}px`;
  }

  _cancelTooltipHide() {
    if (this._tooltipHideTimer) {
      clearTimeout(this._tooltipHideTimer);
      this._tooltipHideTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------
  _ensureBackdrop() {
    if (this._backdropEl && this._windowEl) return;
    const { backdrop, windowEl } = createBackdrop();
    backdrop.dataset.pwOwned = "1";
    if (windowEl) windowEl.dataset.pwOwned = "1";
    backdrop.addEventListener("click", this._handleBackdropClick);
    windowEl.addEventListener("click", this._handleModalClick);
    windowEl.addEventListener("submit", this._handleModalSubmit);
    document.body.appendChild(backdrop);
    this._backdropEl = backdrop;
    this._windowEl = windowEl;
  }

  _setModalContent(contentEl, state) {
    this._ensureBackdrop();
    if (!this._windowEl) return;
    this._windowEl.innerHTML = "";
    this._windowEl.dataset.mode = state?.mode || "";
    this._windowEl.dataset.wormId =
      state?.wormId != null ? String(state.wormId) : "";
    this._windowEl.appendChild(contentEl);
  }

  _showBackdrop() {
    if (!this._backdropEl) return;
    this._backdropEl.hidden = false;
    this._backdropEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("pw-modal-open");
    document.addEventListener("keydown", this._handleModalKeydown, true);
  }

  _hideBackdrop() {
    if (!this._backdropEl) return;
    this._backdropEl.hidden = true;
    this._backdropEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("pw-modal-open");
    document.removeEventListener("keydown", this._handleModalKeydown, true);
  }

  _handleBackdropClick(e) {
    if (e.target !== this._backdropEl) return;
    const state = this._state;
    this._resolveForm(null);
    this.closeModal();
    if (state?.mode === "form") this._returnToViewer(state?.wormId ?? null);
  }

  _handleModalClick(e) {
    const control = e.target.closest?.("[data-pw-action]");
    if (!control) return;
    const action = control.dataset.pwAction;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();

    const state = this._state;
    const wormId = state?.wormId ?? null;

    switch (action) {
      case "close": {
        this._resolveForm(null);
        this.closeModal();
        if (state?.mode === "form") this._returnToViewer(wormId);
        break;
      }
      case "cancel": {
        this._resolveForm(null);
        this.closeModal();
        this._returnToViewer(wormId);
        break;
      }
      case "edit": {
        if (wormId != null) void this._beginEdit(wormId);
        break;
      }
      case "delete": {
        if (wormId != null) void this._confirmDelete(wormId);
        break;
      }
      default:
        break;
    }
  }

  _handleModalSubmit(e) {
    if (!(e.target instanceof HTMLFormElement)) return;
    if (this._state?.mode !== "form") return;
    e.preventDefault();
    const data = new FormData(e.target);
    const content = (data.get("content") || "").toString().trim();
    const tagsRaw = (data.get("tags") || "").toString();
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const statusValue = data.get("status")?.toString() || "private";
    const status =
      statusValue === "friends" || statusValue === "public"
        ? statusValue
        : "private";

    this._resolveForm({
      content,
      tags,
      status,
    });
    this.closeModal();
  }

  _handleModalKeydown(e) {
    if (e.key !== "Escape") return;
    if (!this._backdropEl || this._backdropEl.hidden) return;
    e.preventDefault();
    const state = this._state;
    this._resolveForm(null);
    this.closeModal();
    if (state?.mode === "form") this._returnToViewer(state?.wormId ?? null);
  }

  async _beginEdit(wormId) {
    const worm = this._getWormById?.(wormId);
    if (!worm) return;
    const result = await this._openForm({ mode: "edit", worm });
    if (!result) {
      this._returnToViewer(wormId);
      return;
    }
    try {
      await this._onEdit?.(wormId, result);
    } catch (err) {
      console.error("[WormUI] failed to update worm", err);
    }
    const updated = this._getWormById?.(wormId);
    if (updated) {
      void this.openViewer(wormId);
    } else {
      this.closeModal();
    }
  }

  async _confirmDelete(wormId) {
    const msg = "Delete this worm?";
    const ok =
      typeof confirm === "function"
        ? confirm(msg)
        : typeof window !== "undefined" &&
          typeof window.confirm === "function"
        ? window.confirm(msg)
        : true;
    if (ok === false) return;
    this.closeModal();
    try {
      await this._onDelete?.(wormId);
    } catch (err) {
      console.error("[WormUI] failed to delete worm", err);
    }
    this.hideTooltip(true);
  }

  _resolveForm(value) {
    if (!this._formResolver) return;
    const resolver = this._formResolver;
    this._formResolver = null;
    resolver(value);
  }

  async _openForm({ mode, worm }) {
    const formEl = createModalForm();

    const titleEl = formEl.querySelector(".pw-modal__title");
    const submitBtn = formEl.querySelector('button[type="submit"]');
    if (mode === "create") {
      titleEl.textContent = "Add Worm";
      submitBtn.textContent = "Add Worm";
    } else {
      titleEl.textContent = "Edit Worm";
      submitBtn.textContent = "Save Changes";
    }

    const textarea = formEl.querySelector("textarea[name='content']");
    const tagsInput = formEl.querySelector("input[name='tags']");
    const statusSelect = formEl.querySelector("select[name='status']");

    if (textarea) textarea.value = worm?.content || "";
    if (tagsInput)
      tagsInput.value = Array.isArray(worm?.tags) ? worm.tags.join(", ") : "";
    if (statusSelect) statusSelect.value = worm?.status || "private";

    this._state = { mode: "form", wormId: worm?.id ?? null };

    const promise = new Promise((resolve) => {
      this._formResolver = resolve;
    });

    this._setModalContent(formEl, this._state);
    this._showBackdrop();

    return promise;
  }

  _populateView(viewEl, worm) {
    const commentEl = viewEl.querySelector(".pw-modal__comment");
    if (commentEl) {
      const content = (worm.content || "").trim();
      if (content) {
        commentEl.textContent = worm.content;
        commentEl.classList.remove("pw-modal__comment--empty");
      } else {
        commentEl.textContent = "No comment yet.";
        commentEl.classList.add("pw-modal__comment--empty");
      }
    }

    const tagsWrap = viewEl.querySelector(".pw-modal__tags");
    if (tagsWrap) {
      tagsWrap.innerHTML = "";
      if (Array.isArray(worm.tags) && worm.tags.length) {
        for (const tag of worm.tags) {
          const chip = document.createElement("span");
          chip.className = "pw-chip";
          chip.textContent = tag;
          tagsWrap.appendChild(chip);
        }
      } else {
        const none = document.createElement("span");
        none.className = "pw-empty";
        none.textContent = "No tags";
        tagsWrap.appendChild(none);
      }
    }

    const statusEl = viewEl.querySelector(".pw-status");
    if (statusEl) {
      statusEl.className = `pw-status`;
      statusEl.textContent = STATUS_LABELS[worm.status] || "Private";
    }

    const metaSection = viewEl.querySelector(".pw-modal__meta");
    if (metaSection) {
      metaSection.innerHTML = "";
      const createdText = this._formatDate(worm.created_at);
      if (createdText) {
        const created = document.createElement("span");
        created.className = "pw-meta";
        created.textContent = `Created ${createdText}`;
        metaSection.appendChild(created);
      }
      const updatedText = this._formatDate(worm.updated_at);
      if (updatedText) {
        const updated = document.createElement("span");
        updated.className = "pw-meta";
        updated.textContent = `Updated ${updatedText}`;
        metaSection.appendChild(updated);
      }
    }
  }

  _formatDate(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }
}
