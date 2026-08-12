import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FormFieldProps extends ComponentProps<'input'> {
  label: string;
  error?: string;
}

export function FormField({ label, error, id, className, type, ...props }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} className="text-[13px] font-medium text-[rgba(219,234,250,0.88)]">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={fieldId}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          className={cn(
            'h-12 rounded-[11px] border-[rgba(120,178,235,0.20)] bg-[rgba(4,20,40,0.62)] px-4 text-[15px] focus-visible:border-[rgba(56,182,255,0.85)] focus-visible:bg-[rgba(6,26,50,0.78)] focus-visible:ring-[3px] focus-visible:ring-[rgba(56,182,255,0.14)]',
            isPassword && 'pr-11',
            className,
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-[rgba(178,205,235,0.6)] hover:text-[#8ad4ff]"
          >
            {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
