/**
 * Film grain overlay. Absolutely positioned — the parent must establish a
 * positioning context (relative/absolute/fixed) and clip overflow.
 * Honors reduced-motion via CSS (static frame).
 */
export default function GrainOverlay() {
  return <div className="grain-overlay" aria-hidden="true" />
}
