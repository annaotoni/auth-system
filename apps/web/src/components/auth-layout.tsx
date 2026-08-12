import type { ReactNode } from 'react';
import { GlowCard } from '@/components/glow-card';
import { PageBackground } from '@/components/page-background';

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <PageBackground>
      <GlowCard>
        <h1 className="m-0 text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-[#f2f8ff]">
          {title}
        </h1>
        {description && (
          <p className="mt-2.5 mb-8 text-[15px] text-[rgba(178,205,235,0.72)]">{description}</p>
        )}
        {!description && <div className="mb-8" />}
        {children}
      </GlowCard>
    </PageBackground>
  );
}
