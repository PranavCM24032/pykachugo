import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const parent = dialog.parentElement;
    const inertSiblings = parent
      ? Array.from(parent.children)
          .filter((sibling): sibling is HTMLElement => sibling instanceof HTMLElement && sibling !== dialog)
          .map((sibling) => ({ element: sibling, wasInert: sibling.inert }))
      : [];
    inertSiblings.forEach(({ element }) => {
      element.inert = true;
    });

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getClientRects().length > 0
      );

    const firstFocus = initialFocusRef?.current || getFocusable()[0] || dialog;
    firstFocus.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      inertSiblings.forEach(({ element, wasInert }) => {
        element.inert = wasInert;
      });
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [open, dialogRef, initialFocusRef]);
}
