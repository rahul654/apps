/** Small inline icons (24×24, currentColor). Decorative: buttons carry their own aria-label. */
import type { ReactNode } from 'react';

type IconProps = { size?: number };

function Svg({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
);

export const PrevClipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6.5v11a1 1 0 0 1-1.55.83L8.5 13.2a1.4 1.4 0 0 1 0-2.4l7.95-5.13A1 1 0 0 1 18 6.5z" />
    <rect x="5" y="6" width="2.5" height="12" rx="1" />
  </Svg>
);

export const NextClipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6.5v11a1 1 0 0 0 1.55.83l7.95-5.13a1.4 1.4 0 0 0 0-2.4L7.55 5.67A1 1 0 0 0 6 6.5z" />
    <rect x="16.5" y="6" width="2.5" height="12" rx="1" />
  </Svg>
);

export const PrevSongIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 7v10l-7-5zM20 7v10l-7-5z" />
  </Svg>
);

export const NextSongIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7v10l7-5zM12 7v10l7-5z" />
  </Svg>
);

export const ShuffleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 4h4v4l-1.5-1.5-3.2 3.2-1.4-1.4 3.2-3.2zM4 6.6 5.4 5.2l13.1 13.1L20 16.8V20h-4l1.5-1.5L4.4 5.4zM10.3 13.3l1.4 1.4-6.3 6.3L4 19.6z" />
  </Svg>
);

export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2zM17 17H7v-3l-4 4 4 4v-3h12v-6h-2z" />
  </Svg>
);
