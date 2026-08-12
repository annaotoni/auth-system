import { cn } from '@/lib/utils';

interface PasswordStrengthMeterProps {
  password: string;
}

interface StrengthLevel {
  label: string;
  barClassName: string;
}

const LEVELS: StrengthLevel[] = [
  { label: 'Muito fraca', barClassName: 'bg-destructive' },
  { label: 'Fraca', barClassName: 'bg-destructive' },
  { label: 'Razoável', barClassName: 'bg-amber-500' },
  { label: 'Boa', barClassName: 'bg-amber-500' },
  { label: 'Forte', barClassName: 'bg-emerald-600' },
];

// Heurística simples (comprimento + variedade de caracteres) — só pra dar
// feedback visual imediato, não substitui a checagem real do HIBP no back-end.
function scorePassword(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, LEVELS.length - 1);
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) {
    return null;
  }

  const score = scorePassword(password);
  const level = LEVELS[score];

  return (
    <div className="mt-1.5 flex flex-col gap-1" aria-live="polite">
      <div className="flex gap-1">
        {LEVELS.map((_, index) => (
          <span
            key={index}
            className={cn('h-1 flex-1 rounded-full bg-muted', index <= score && level.barClassName)}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{level.label}</span>
    </div>
  );
}
