// Dragging cases and folders onto folders in the case library.
// The data travels in the drag itself, so the table and the folder tree stay separate.

export const CASES_MIME = "application/x-flaw-patrol-cases";
export const FOLDER_MIME = "application/x-flaw-patrol-folder";

/** The cases being dragged, with the folder each came from so the move can be undone. */
export type DraggedCases = { id: string; folderId: string | null }[];

/** A small "Move 3 cases" chip to show under the pointer instead of a picture of the row. */
export function dragChip(e: React.DragEvent, text: string) {
  const chip = document.createElement("div");
  chip.textContent = text;
  Object.assign(chip.style, {
    position: "fixed",
    top: "-100px",
    left: "0",
    padding: "4px 10px",
    borderRadius: "999px",
    background: "var(--color-accent-600, #6d28d9)",
    font: "600 12px system-ui, sans-serif",
    whiteSpace: "nowrap",
  });
  chip.style.setProperty("color", "#fff");
  document.body.appendChild(chip);
  e.dataTransfer.setDragImage(chip, 10, 10);
  setTimeout(() => chip.remove(), 0);
}
