'use client';

import type { ReactNode } from 'react';

interface FormSectionProps {
  title: string;
  description?: string;
  step?: number;
  accent?: 'primary' | 'warning' | 'neutral';
  children: ReactNode;
  className?: string;
}

const accentBar = {
  primary: 'bg-primary',
  warning: 'bg-warning',
  neutral: 'bg-border',
};

export function FormSection({
  title,
  description,
  step,
  accent = 'primary',
  children,
  className = '',
}: FormSectionProps) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm ring-1 ring-black/[0.02] ${className}`}
    >
      <div className="flex">
        <div className={`w-1 shrink-0 ${accentBar[accent]}`} aria-hidden />
        <div className="min-w-0 flex-1 p-6 sm:p-7">
          <div className="mb-5 flex items-start gap-3">
            {step != null && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-xs font-bold text-primary">
                {step}
              </span>
            )}
            <div>
              <h2 className="font-semibold tracking-tight text-text">{title}</h2>
              {description && <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p>}
            </div>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
