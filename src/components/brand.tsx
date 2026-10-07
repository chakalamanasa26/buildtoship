import { Link } from 'wouter';
import { Heart } from 'lucide-react';

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2.5 ${light ? 'text-white' : 'text-foreground'}`}
      data-testid="link-brand"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${
          light ? 'bg-white/15' : 'bg-primary text-primary-foreground'
        }`}
      >
        <Heart className="h-[18px] w-[18px]" strokeWidth={2.4} />
      </span>
      <span className="font-bold tracking-tight text-lg">MediVault</span>
    </Link>
  );
}
