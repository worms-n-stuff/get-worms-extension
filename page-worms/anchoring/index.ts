import { createDomAnchoringAdapter } from "./dom-anchors.js";
import {
  isAnchoringAdapter,
  type AnchorCache,
  type AnchoringAdapter,
  type AnchoringModuleOption,
  type CreateAnchorPositionOptions,
  type ResolvedAnchor,
} from "./types.js";

export type {
  AnchorCache,
  AnchoringAdapter,
  AnchoringModuleOption,
  CreateAnchorPositionOptions,
  ResolvedAnchor,
};
export { isAnchoringAdapter } from "./types.js";

export function createAnchoringAdapter(
  option?: AnchoringModuleOption
): AnchoringAdapter {
  if (!option || option === "dom") {
    return createDomAnchoringAdapter();
  }
  if (isAnchoringAdapter(option)) {
    return option;
  }
  return createDomAnchoringAdapter();
}
