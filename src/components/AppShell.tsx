'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SelectedProjectProvider } from '../context/SelectedProjectContext';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SelectedProjectProvider>
      <div className="flex min-h-screen bg-surface">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {children}
        </div>
      </div>
    </SelectedProjectProvider>
  );
}
