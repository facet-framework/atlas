// The views of the ADR and BPMN plugins live in their plugins
// (plugins/<plugin>/src/views); the core keeps what it draws itself.
export * from "./shared";
export * from "./Chat";
export { pinnedTop, standsAtTheBottom, tailroom } from "./chatScroll";
export * from "./Palette";
export * from "./Motion";
