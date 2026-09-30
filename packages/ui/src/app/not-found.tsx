import { useT } from '@/i18n';
import { PageMessage } from '@/components/page-message';

export function NotFound() {
  const t = useT();
  return <PageMessage>{t('common.pageNotFound')}</PageMessage>;
}
