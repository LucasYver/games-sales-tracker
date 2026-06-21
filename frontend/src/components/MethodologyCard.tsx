import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

/**
 * Generic methodology callout. Intentionally does NOT name any of the upstream
 * data sources — only the principle (multi-method aggregation + confidence
 * scoring) is shared with end users.
 */
export function MethodologyCard() {
  const t = useTranslations('methodology');

  return (
    <Card className="border-primary/20 bg-accent/30 border-dashed">
      <CardHeader>
        <CardTitle className="text-primary flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
          <Info aria-hidden="true" className="size-4" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm leading-relaxed">
        <p>{t('paragraph1')}</p>
        <p>{t('paragraph2')}</p>
      </CardContent>
    </Card>
  );
}
