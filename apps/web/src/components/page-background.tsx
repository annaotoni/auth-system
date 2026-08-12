import type { ReactNode } from 'react';
import { AnimatedGridBackground } from '@/components/animated-grid-background';

interface PageBackgroundProps {
  children: ReactNode;
}

// Fundo compartilhado de todas as telas de auth + dashboard: gradiente radial
// azul-marinho + grade 3D animada + vinhetas pra escurecer as bordas e dar
// contraste ao card central.
export function PageBackground({ children }: PageBackgroundProps) {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_50%_42%,#06294f_0%,#041c37_38%,#031b36_62%,#020e1c_100%)]">
      <AnimatedGridBackground />

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(46%_42%_at_50%_48%,rgba(2,10,22,0.92)_0%,rgba(2,12,26,0.72)_40%,rgba(3,27,54,0)_72%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 mix-blend-screen bg-[radial-gradient(70%_55%_at_50%_30%,rgba(56,182,255,0.10)_0%,rgba(56,182,255,0)_65%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,10,22,0.85)_0%,rgba(2,10,22,0)_22%,rgba(2,10,22,0)_70%,rgba(2,10,22,0.75)_100%)]"
        aria-hidden="true"
      />

      <div className="relative z-2 flex w-full max-w-[1440px] flex-col items-center px-6 py-8">
        {children}
      </div>
    </div>
  );
}
