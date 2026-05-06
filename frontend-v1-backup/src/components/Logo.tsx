import { cn } from "@/lib/cn"

interface LogoProps {
  size?: number
  className?: string
  animated?: boolean
}

export function Logo({ size = 32, className, animated = true }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", animated && "logo-pulse", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="logo-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="45%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="logo-grad-2" x1="6" y1="26" x2="26" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <radialGradient id="logo-core" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer ring */}
      <circle
        cx="16"
        cy="16"
        r="13"
        stroke="url(#logo-grad)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="56 30"
        className={animated ? "logo-orbit" : undefined}
        style={{ transformOrigin: "16px 16px" }}
      />

      {/* Inner monogram: stylized "C" swept into an arc */}
      <path
        d="M22.5 10.5a7.5 7.5 0 1 0 0 11"
        stroke="url(#logo-grad-2)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Accent core dot */}
      <circle cx="22.5" cy="10.5" r="1.8" fill="url(#logo-grad-2)" />
      <circle cx="22.5" cy="10.5" r="3.2" fill="url(#logo-core)" />
    </svg>
  )
}
