import { Link } from 'wouter';
import { ArrowLeft, FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-[#f9faf5] px-5 py-12 text-[#1d3933]">
      <div className="mv-card max-w-md p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#edf3eb] text-primary">
          <FileQuestion className="h-7 w-7" />
        </span>
        <h1 className="mv-title mt-5 text-3xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="mv-button mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Return to home
        </Link>
      </div>
    </div>
  );
}
