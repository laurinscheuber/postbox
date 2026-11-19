import { useId } from 'react';

interface PostboxLogoProps {
  className?: string;
}

export function PostboxLogo({ className = 'h-7 w-7' }: PostboxLogoProps) {
  const uid = useId().replace(/:/g, '');
  const bgId = `pb-bg-${uid}`;
  const ringId = `pb-ring-${uid}`;
  const cardId = `pb-card-${uid}`;
  const trayId = `pb-tray-${uid}`;
  const flapId = `pb-flap-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#131F38" />
          <stop offset="1" stopColor="#070B14" />
        </linearGradient>
        <linearGradient id={ringId} x1="12" y1="2" x2="52" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#94A3B8" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#38BDF8" stopOpacity="0.2" />
          <stop offset="1" stopColor="#0F172A" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={cardId} x1="18" y1="12" x2="46" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E0F2FE" stopOpacity="0.34" />
          <stop offset="1" stopColor="#38BDF8" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={trayId} x1="12" y1="20" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#BAE6FD" />
          <stop offset="0.45" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id={flapId} x1="16" y1="24" x2="48" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B1325" />
          <stop offset="1" stopColor="#0F1B33" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${bgId})`} />
      <rect
        x="2.625"
        y="2.625"
        width="58.75"
        height="58.75"
        rx="14.375"
        stroke={`url(#${ringId})`}
        strokeWidth="1.25"
      />

      <rect
        x="17"
        y="12.5"
        width="30"
        height="14"
        rx="4.5"
        fill={`url(#${cardId})`}
        stroke="#BAE6FD"
        strokeOpacity="0.32"
        strokeWidth="1"
      />

      <rect x="12" y="20" width="40" height="30.5" rx="8.5" fill={`url(#${trayId})`} />

      <path
        d="M17.5 25.5L30.2 34.4C31.28 35.15 32.72 35.15 33.8 34.4L46.5 25.5"
        stroke={`url(#${flapId})`}
        strokeWidth="3.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="24" y="41.5" width="16" height="3" rx="1.5" fill="#0B1325" fillOpacity="0.72" />
    </svg>
  );
}
