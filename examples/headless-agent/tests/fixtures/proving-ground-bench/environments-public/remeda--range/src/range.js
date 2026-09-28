import { purry } from "./purry.js";
const DEFAULT_STEP = 1;
// Relative tolerance for snapping a near-integer division result to the nearest
// integer, preventing Math.ceil from inflating the length by one due to
// floating-point error in the numerator or denominator.
const SNAP_TOLERANCE = 1e-12;
export function range(...args) {
    throw new Error('not implemented');
}
function rangeImplementation(start, endOrOptions) {
    const step = typeof endOrOptions === "object" ? endOrOptions.step : DEFAULT_STEP;
    if (step === 0) {
        throw new RangeError("range: step cannot be zero (0)!");
    }
    const end = typeof endOrOptions === "object" ? endOrOptions.end : endOrOptions;
    const length = ceilingWithSnap((end - start) / step);
    if (length <= 0) {
        return [];
    }
    return Array.from({ length }, (_, i) => (i === 0 ? start : start + i * step));
}
// JS's floating-point math can create numbers that are slightly larger than
// the true mathematical result (e.g. `0.1 + 0.2 > 0.3`). This error would
// propagate into more complex calculations, and specifically can cause
// the built-in `Math.ceil` to round up a number that is effectively an
// integer (e.g. `Math.ceil(0.1 + 0.2 - 0.3) === 1`). To work around this we
// need an error margin where ceiling would ignore very small floating point
// artifacts so that it effectively "rounds" down instead of up.
function ceilingWithSnap(raw) {
    if (raw === 0) {
        return 0;
    }
    const rounded = Math.round(raw);
    return Math.abs(raw - rounded) / Math.abs(raw) < SNAP_TOLERANCE
        ? rounded
        : Math.ceil(raw);
}
