'use client';

import { useState } from 'react';
import {
  AGENCY_NAME,
  OFFICE_NAME,
  SYSTEM_LOGO,
  SYSTEM_LOGO_FALLBACK,
  SYSTEM_NAME,
} from '../lib/branding';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show office / agency caption under the mark (wordmark is in the image). */
  showText?: boolean;
  className?: string;
}

const HEIGHT: Record<NonNullable<LogoProps['size']>, string> = {
  sm: 'h-11',
  md: 'h-16',
  lg: 'h-24',
  xl: 'h-28 md:h-36',
};

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const [src, setSrc] = useState(SYSTEM_LOGO);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <img
        src={src}
        alt={SYSTEM_NAME}
        title={`${SYSTEM_NAME} - ${OFFICE_NAME}`}
        className={`${HEIGHT[size]} w-auto max-w-full object-contain`}
        decoding="async"
        loading="eager"
        onError={() => {
          if (src !== SYSTEM_LOGO_FALLBACK) setSrc(SYSTEM_LOGO_FALLBACK);
        }}
      />
      {showText && (
        <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
          {OFFICE_NAME} · {AGENCY_NAME}
        </p>
      )}
    </div>
  );
}
