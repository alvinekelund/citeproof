import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";

interface VerdictBadgeProps {
  color: 'green' | 'yellow' | 'red';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

const labels = {
  green: 'Supported',
  yellow: 'Partial',
  red: 'Unsupported',
};

const icons = {
  green: CheckCircle2,
  yellow: AlertCircle,
  red: XCircle,
};

export function VerdictBadge({ color, size = 'md', showIcon = true, className }: VerdictBadgeProps) {
  const Icon = icons[color];
  
  return (
    <span
      className={cn(
        "verdict-badge",
        `verdict-${color}`,
        size === 'sm' && "text-[10px] px-1.5 py-0.5",
        size === 'lg' && "text-sm px-3 py-1.5",
        className
      )}
    >
      {showIcon && <Icon className={cn("mr-1", size === 'sm' ? "h-3 w-3" : size === 'lg' ? "h-5 w-5" : "h-4 w-4")} />}
      {labels[color]}
    </span>
  );
}

interface VerdictDotProps {
  color: 'green' | 'yellow' | 'red';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function VerdictDot({ color, size = 'md', className }: VerdictDotProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        color === 'green' && "bg-verdict-green",
        color === 'yellow' && "bg-verdict-yellow",
        color === 'red' && "bg-verdict-red",
        size === 'sm' && "h-2 w-2",
        size === 'md' && "h-3 w-3",
        size === 'lg' && "h-4 w-4",
        className
      )}
    />
  );
}
