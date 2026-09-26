import type * as Runtime from "./editorRuntime";
let runtime: typeof Runtime | undefined;
let pending: Promise<typeof Runtime> | undefined;
export function loadEditorRuntime() {
  return (pending ??= import("./editorRuntime")
    .then((value) => (runtime = value))
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}
export const externalEditorUpdate: typeof Runtime.externalEditorUpdate = (
  ...args
) => {
  if (args[0]) runtime?.externalEditorUpdate(...args);
};
export const undo: typeof Runtime.undo = (...args) =>
  runtime?.undo(...args) ?? false;
export const undoDepth: typeof Runtime.undoDepth = (...args) =>
  runtime?.undoDepth(...args) ?? 0;
export const editorItems: typeof Runtime.editorItems = (...args) =>
  runtime?.editorItems(...args) ?? [];
export const codeTarget: typeof Runtime.codeTarget = (...args) => {
  if (!runtime) throw new Error("Editor is still opening.");
  return runtime.codeTarget(...args);
};
export const readTarget: typeof Runtime.readTarget = (...args) => {
  if (!runtime) throw new Error("Editor is still opening.");
  return runtime.readTarget(...args);
};
