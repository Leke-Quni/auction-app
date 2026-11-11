import { useEffect, useRef, type RefObject } from "react";

// While `open`, calls `onDismiss` when the pointer goes down outside `ref` or Escape is pressed. For menus and drop-down lists.
export function useDismiss(ref: RefObject<Element | null>, open: boolean, onDismiss: () => void) {
  // The latest callback, so a new function on each render does not take the listeners off and put them back.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open]);
}
