'use client';
import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { durations, easings } from '../../theme/motion';

export interface CountUpProps {
  /** Target value to count up to. */
  to: number;
  /** Starting value (default 0). */
  from?: number;
  /** Fixed decimal places. Defaults to 1 for non-integer targets, 0 for integers. */
  decimals?: number;
  /** Rendered before the number, e.g. "~" or "$". */
  prefix?: string;
  /** Rendered after the number, e.g. "%", " h", " mi". */
  suffix?: string;
  /** Override duration (seconds). */
  duration?: number;
}

/**
 * Data-theater count-up (ADR-044) — animates a number 0→value with a spring-y ease the first time it
 * scrolls into view, so the condition StatCards (Bortle, SQM, dark-hours, drive miles, moon %) feel
 * alive. Client-only and reduced-motion-first: when the user prefers reduced motion we render the final
 * value immediately (no tween). Pure presentational; pass already-computed numbers from the server.
 */
export function CountUp({ to, from = 0, decimals, prefix = '', suffix = '', duration }: CountUpProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const [display, setDisplay] = useState(reduce ? to : from);
  const dp = decimals ?? (Number.isInteger(to) ? 0 : 1);

  useEffect(() => {
    if (reduce) {
      setDisplay(to);
      return;
    }
    if (!inView) return;
    const controls = animate(from, to, {
      duration: duration ?? durations.slow * 1.6,
      ease: easings.emphasized,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, to, from, reduce, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {display.toFixed(dp)}
      {suffix}
    </span>
  );
}
