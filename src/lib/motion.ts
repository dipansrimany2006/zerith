import type { Transition } from 'framer-motion'

/** Spring presets shared by every animated component. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 400, damping: 30 },
  smooth: { type: 'spring', stiffness: 300, damping: 30 },
  stiff: { type: 'spring', stiffness: 350, damping: 28 },
  bouncy: { type: 'spring', stiffness: 280, damping: 22 },
  popup: { type: 'spring', stiffness: 380, damping: 32 },
  chevron: { type: 'spring', stiffness: 400, damping: 25 },
} satisfies Record<string, Transition>

export const EASE = {
  outExpo: [0.16, 1, 0.3, 1],
  outCubic: [0.33, 1, 0.68, 1],
} as const

/** Seconds between items in a staggered list. */
export const STAGGER = {
  tight: 0.04,
  normal: 0.06,
}

/** Seconds. */
export const DURATION = {
  crossFade: 0.14,
  backdrop: 0.25,
  digitMount: 0.6,
  digitUpdate: 0.3,
  checkDraw: 0.45,
}
