import { useEffect, useRef } from "react";

export function useModalLifecycle(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const dialog = dialogs.item(dialogs.length - 1);
    const modalContainer = dialog?.parentElement ?? null;
    const backgroundElements = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalContainer)
      .map((element) => ({
        element,
        wasInert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    function focusableElements(): HTMLElement[] {
      return dialog === null ? [] : [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = focusableElements();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    for (const { element } of backgroundElements) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.addEventListener("keydown", handleKeyDown);
    const firstFocusable = focusableElements()[0];
    if (firstFocusable !== undefined) {
      firstFocusable.focus();
    } else if (dialog !== null) {
      dialog.tabIndex = -1;
      dialog.focus();
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      for (const { element, wasInert, ariaHidden } of backgroundElements) {
        element.inert = wasInert;
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }
      previouslyFocused?.focus();
    };
  }, [open]);
}
