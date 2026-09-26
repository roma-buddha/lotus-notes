import { useEffect, useRef, useState, type PointerEvent } from "react";

export function useOrganizerDrag(
  busy: boolean,
  move: (source: string, destination: string) => void,
  expand: (destination: string) => void,
) {
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{
    source: string;
    id: number;
    x: number;
    y: number;
    active: boolean;
    element: HTMLElement;
  } | null>(null);
  const hover = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const [source, setSource] = useState("");
  const [over, setOver] = useState("");
  const clearHover = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    hover.current = "";
    setOver("");
  };
  const finish = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.id))
      current.element.releasePointerCapture(current.id);
    clearHover();
    setSource("");
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      clearTimeout(timer.current);
    };
    // Cancellation only uses stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const destinationAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !root.current?.contains(hit)) return "";
    const destination =
      hit.closest<HTMLElement>("[data-organizer-destination]")?.dataset
        .organizerDestination ?? "";
    const parent = drag.current?.source.split("/").slice(0, -1).join("/");
    return destination === parent ? "" : destination;
  };
  const handlers = (path: string) => ({
    draggable: false,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (busy || event.button !== 0 || !event.isPrimary) return;
      suppressClick.current = false;
      drag.current = {
        source: path,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
        element: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (!current.active) {
        if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 7
        )
          return;
        current.active = true;
        suppressClick.current = true;
        setSource(current.source);
      }
      event.preventDefault();
      const destination = destinationAt(event.clientX, event.clientY);
      if (destination !== hover.current) {
        clearHover();
        hover.current = destination;
        setOver(destination);
        if (destination)
          timer.current = setTimeout(() => expand(destination), 600);
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const destination = current.active
        ? destinationAt(event.clientX, event.clientY)
        : "";
      finish();
      if (destination && !busy) move(current.source, destination);
    },
    onPointerCancel: finish,
    onLostPointerCapture: () => {
      if (drag.current) finish();
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    },
  });
  return { root, source, over, handlers };
}
