import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlowCardProps {
  children: ReactNode;
  className?: string;
}

// Card "vidro" com halo ciano pulsante atrás — usado por AuthLayout e pelo
// dashboard, pra manter o mesmo tratamento visual em todas as telas.
export function GlowCard({ children, className }: GlowCardProps) {
  return (
    <div
      className={cn(
        'relative w-full max-w-[26rem] animate-[card-rise_700ms_cubic-bezier(0.2,0.8,0.25,1)_both]',
        className,
      )}
    >
      <div
        className="absolute -inset-[34px] animate-[halo-pulse_7s_ease-in-out_infinite] rounded-[40px] blur-md"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 45%, rgba(56,182,255,0.22) 0%, rgba(56,182,255,0) 70%)',
        }}
        aria-hidden="true"
      />
      <div
        className="relative rounded-[22px] border border-[rgba(120,190,255,0.18)] px-8 py-10 backdrop-blur-[22px] backdrop-saturate-150"
        style={{
          background:
            'linear-gradient(160deg, rgba(9,32,60,0.82) 0%, rgba(4,16,33,0.88) 60%, rgba(3,12,26,0.92) 100%)',
          boxShadow:
            '0 40px 90px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 60px -18px rgba(56,182,255,0.35)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
