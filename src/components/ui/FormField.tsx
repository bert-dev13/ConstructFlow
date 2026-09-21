'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const fieldClass =
  'mt-1.5 w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-text shadow-sm transition placeholder:text-text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70';

interface LabelProps {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, hint, children, className = '' }: LabelProps) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</label>
      {hint && <p className="mt-0.5 text-[11px] text-text-muted/80">{hint}</p>}
      {children}
    </div>
  );
}

export function TextInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...props} />;
}

export function TextArea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} resize-y ${className}`} {...props} />;
}

export function SelectInput({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={`${fieldClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function fieldInputClass() {
  return fieldClass;
}
