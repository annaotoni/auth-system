import { Link } from 'react-router-dom';

interface AuthFooterLinkProps {
  prompt: string;
  linkLabel: string;
  to: string;
}

export function AuthFooterLink({ prompt, linkLabel, to }: AuthFooterLinkProps) {
  return (
    <p className="mt-6 border-t border-[rgba(120,178,235,0.12)] pt-5 text-center text-sm text-[rgba(178,205,235,0.7)]">
      {prompt}{' '}
      <Link to={to} className="font-semibold text-[#7cc9ff] hover:text-[#a8ddff]">
        {linkLabel}
      </Link>
    </p>
  );
}
