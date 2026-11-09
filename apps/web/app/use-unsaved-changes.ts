"use client";

import { useEffect, useRef, type RefObject } from "react";

// Sent when the visitor really leaves with unsaved edits; the photo uploader listens and deletes what it uploaded meanwhile.
export const DISCARD_EVENT = "unsaved-changes:discard";
export const UNSAVED_MESSAGE = "You have unsaved changes. If you leave this page they will not be saved.";

const snapshot = (form: HTMLFormElement) =>
  JSON.stringify(Array.from(new FormData(form).entries(), ([k, v]) => [k, v instanceof File ? `${v.name}:${v.size}` : v]));

// Warns before the visitor leaves a page with edits that were not saved (closing the tab, a link, the back button), and
// nothing is saved when they go. Dirty means the form differs from how it looked when `active` became true or when
// `savedSignal` last changed (pass the action's result so a successful save counts as the new starting point).
export function useUnsavedChanges(formRef: RefObject<HTMLFormElement | null>, active: boolean, savedSignal?: unknown, onDirtyChange?: (dirty: boolean) => void) {
  const notify = useRef(onDirtyChange);
  notify.current = onDirtyChange;
  useEffect(() => {
    const form = formRef.current;
    if (!active || !form) return;
    let start = snapshot(form);
    let dirty = false;
    let guarded = false;
    let leaving = false;

    const set = (value: boolean) => {
      if (value !== dirty) notify.current?.(value);
      dirty = value;
    };
    notify.current?.(false);
    const check = () => {
      set(snapshot(form) !== start);
      if (dirty && !guarded) {
        // One extra history entry, so the back button can be asked about before it leaves.
        window.history.pushState(null, "", window.location.href);
        guarded = true;
      }
    };
    const reset = () => {
      start = snapshot(form);
      set(false);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty || leaving) return;
      e.preventDefault();
      e.returnValue = UNSAVED_MESSAGE;
    };
    const discard = () => window.dispatchEvent(new Event(DISCARD_EVENT));
    const onPageHide = () => {
      if (dirty && !leaving) discard();
    };
    const onClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(UNSAVED_MESSAGE + " Leave anyway?")) {
        e.preventDefault();
        e.stopPropagation();
      } else discard();
    };
    const onPopState = () => {
      if (leaving || !dirty || !guarded) return;
      if (window.confirm(UNSAVED_MESSAGE + " Leave anyway?")) {
        leaving = true;
        discard();
        window.history.back();
      } else {
        window.history.pushState(null, "", window.location.href);
      }
    };

    // Hidden fields set by script (the photo list) fire no input event; a change to their value attribute does show up here.
    const observer = new MutationObserver(check);
    observer.observe(form, { attributes: true, attributeFilter: ["value"], subtree: true });
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    const onReset = () => void setTimeout(reset);
    form.addEventListener("reset", onReset);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      notify.current?.(false);
      observer.disconnect();
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
      form.removeEventListener("reset", onReset);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [formRef, active, savedSignal]);
}
