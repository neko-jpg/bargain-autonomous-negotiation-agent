import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-teal-600 text-white shadow',
        secondary: 'border-transparent bg-slate-100 text-slate-900 hover:bg-slate-200/80',
        destructive: 'border-transparent bg-rose-50 text-rose-700 border border-rose-200',
        outline: 'text-slate-950 border border-slate-200',
        teal: 'bg-teal-50 text-teal-800 border border-teal-200/80',
        emerald: 'bg-emerald-50 text-emerald-800 border border-emerald-200/80',
        amber: 'bg-amber-50 text-amber-800 border border-amber-200/80',
        purple: 'bg-purple-50 text-purple-800 border border-purple-200/80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
