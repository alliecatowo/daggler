/* Shared SVG icons, ported from the design mock. */
import type { ReactNode } from "react";

export function LogoMark({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx={5} cy={6} r={2.4} stroke="currentColor" strokeWidth={1.6} />
      <circle cx={5} cy={18} r={2.4} stroke="currentColor" strokeWidth={1.6} />
      <circle cx={19} cy={12} r={2.4} fill="currentColor" />
      <path d="M7.2 7.1l9.4 4M7.2 16.9l9.4-4" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function Ic({ children, size = 17 }: { children: ReactNode; size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

export const FlowIcon = () => (
  <Ic>
    <rect x={3} y={4} width={7} height={5} rx={1.3} stroke="currentColor" strokeWidth={1.5} />
    <rect x={14} y={9} width={7} height={5} rx={1.3} stroke="currentColor" strokeWidth={1.5} />
    <rect x={3} y={15} width={7} height={5} rx={1.3} stroke="currentColor" strokeWidth={1.5} />
    <path d="M10 6.5h2.5M14 11.5h-2.5M10 17.5h2.5" stroke="currentColor" strokeWidth={1.5} />
  </Ic>
);

export const CubeIcon = () => (
  <Ic>
    <path
      d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke="currentColor" strokeWidth={1.5} />
  </Ic>
);

export const TplIcon = () => (
  <Ic>
    <rect x={4} y={4} width={16} height={16} rx={2} stroke="currentColor" strokeWidth={1.5} />
    <path d="M4 9h16M9 9v11" stroke="currentColor" strokeWidth={1.5} />
  </Ic>
);

export const BugIcon = () => (
  <Ic>
    <rect x={7} y={8} width={10} height={11} rx={5} stroke="currentColor" strokeWidth={1.5} />
    <path
      d="M12 8V5m-3 1L7 4m8 2l2-2M4 12h3m10 0h3M5 17l2-1m12 1l-2-1"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  </Ic>
);

export const ShieldIcon = () => (
  <Ic>
    <path
      d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
    <path
      d="M9 12l2 2 4-4"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Ic>
);

export const GearIcon = () => (
  <Ic>
    <circle cx={12} cy={12} r={3} stroke="currentColor" strokeWidth={1.5} />
    <path
      d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M5 19l2-2m10-10l2-2"
      stroke="currentColor"
      strokeWidth={1.3}
    />
  </Ic>
);

export const BranchIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M4 2v8m0 0a2 2 0 104 0M4 10a2 2 0 11-4 0m4 0V6a3 3 0 013-3h2"
      stroke="currentColor"
      strokeWidth={1.4}
    />
  </svg>
);

export const PrIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SearchIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth={1.5} />
    <path d="M11 11l3 3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
  </svg>
);
