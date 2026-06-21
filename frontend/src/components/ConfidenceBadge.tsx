import { useTranslations } from 'next-intl';
import type { ConfidenceLevel } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

const VARIANT: Record<ConfidenceLevel, 'default' | 'secondary' | 'outline'> = {
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
};

const ICON: Record<ConfidenceLevel, typeof ShieldCheck> = {
  HIGH: ShieldCheck,
  MEDIUM: ShieldQuestion,
  LOW: ShieldAlert,
};

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const t = useTranslations('confidence');
  const Icon = ICON[level];
  return (
    <Badge variant={VARIANT[level]} className="gap-1.5">
      <Icon aria-hidden="true" className="size-3.5" />
      {t(level)}
    </Badge>
  );
}
