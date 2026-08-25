import { useState, type PointerEvent } from "react";

export type Ripple = { id: number; x: number; y: number; size: number };

export function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const spawn = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    setRipples((current) => [
      ...current,
      {
        id: Date.now() + Math.random(),
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        size,
      },
    ]);
  };

  const done = (id: number) => {
    setRipples((current) => current.filter((ripple) => ripple.id !== id));
  };

  return { ripples, spawn, done };
}
