import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Link estilizado como o CTA principal (variant "glow") — usado nas telas de
// confirmação, onde a única ação é seguir para outra rota.
export function LinkButton({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link className={cn(buttonVariants({ variant: 'glow' }), 'w-full', className)} {...props} />
  );
}
