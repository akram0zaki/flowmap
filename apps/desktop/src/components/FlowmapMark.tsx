/**
 * The Flowmap mark.
 *
 * A current drawn as an F: one continuous stroke that rises like a stem,
 * turns across the top of the landscape, then runs out as a wave. The same
 * path is painted by `scripts/make-icon.py` for the desktop icon — edit both.
 */

export function FlowmapMark() {
  return (
    <svg className="fm-header__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M13.4 11.7
           H22.5
           A3.2 3.2 0 0 0 22.5 5.3
           H9.6
           A2.65 2.65 0 0 0 6.95 7.95
           V23.7
           A2.65 2.65 0 0 0 12.25 23.7
           V16
           C17.2 16.6 21.4 19.5 27 16.2"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
