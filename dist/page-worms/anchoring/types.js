export function isAnchoringAdapter(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.buildTextCache === "function" &&
        typeof value.createPosition === "function" &&
        typeof value.resolvePosition === "function");
}
