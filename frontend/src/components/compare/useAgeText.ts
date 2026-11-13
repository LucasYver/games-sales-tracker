'use client';

import { useTranslations } from 'next-intl';

/** "4 ans et 8 mois" from a number of whole months. */
export function useAgeText(): (months: number) => string {
  const t = useTranslations('compare');
  return (months) => {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (years === 0 && rest === 0) return t('ageUnderMonth');
    const y = years > 0 ? t('ageYears', { n: years }) : '';
    const m = rest > 0 ? t('ageMonths', { n: rest }) : '';
    return y && m ? t('ageJoin', { years: y, months: m }) : y || m;
  };
}
