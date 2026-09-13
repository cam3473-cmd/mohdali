import { useEffect } from "react";

// يجعل كل النوافذ المنبثقة (.modal) قابلة للسحب من عنوانها (h3) لأي مكان على الشاشة.
// يعمل عبر تفويض الأحداث على مستوى المستند بدل تعديل كل نافذة على حدة، فيشمل كل
// نافذة حالية أو مستقبلية تتبع نفس البنية (.modal-backdrop > .modal > h3) تلقائياً.
export function useDraggableModals() {
  useEffect(() => {
    let dragging: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;

    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const handle = target.closest(".modal > h3") as HTMLElement | null;
      if (!handle) return;
      const modal = handle.closest(".modal") as HTMLElement | null;
      if (!modal) return;

      dragging = modal;
      startX = e.clientX;
      startY = e.clientY;
      const matrix = new DOMMatrixReadOnly(window.getComputedStyle(modal).transform);
      origX = matrix.m41;
      origY = matrix.m42;
      e.preventDefault();
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      dragging.style.transform = `translate(${origX + dx}px, ${origY + dy}px)`;
    }

    function onMouseUp() {
      dragging = null;
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}
