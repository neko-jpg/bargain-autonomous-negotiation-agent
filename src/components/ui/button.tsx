import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-teal-600 text-white shadow-sm hover:bg-teal-700 active:bg-teal-800 shadow-teal-600/20',
        destructive: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800',
        outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900',
        secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200/80',
        ghost: 'hover:bg-slate-100 hover:text-slate-900 text-slate-600',
        link: 'text-teal-600 underline-offset-4 hover:underline',
        emerald: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 shadow-emerald-600/20',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-[11px]',
        lg: 'h-12 rounded-xl px-6 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
