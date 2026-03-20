"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  format?: (v: number) => string;
  className?: string;
  duration?: number;
}

export function AnimatedNumber({
  value,
  format,
  className,
  duration = 800,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    prevValue.current = value;

    if (start === end) return;

    const startTime = performance.now();

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [value, duration]);

  const formatted = format
    ? format(display)
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(display);

  return <span className={cn("font-mono tabular-nums", className)}>{formatted}</span>;
}
