// Adapted from: src/routes/(main)/community/(list)/features/Pagination (LobeHub canary)
import { Button, Flexbox, Text } from '@lobehub/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { useI18n } from '@/i18n';

interface PaginationProps {
  currentPage: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
  totalPages: number;
}

const Pagination = memo<PaginationProps>(({ currentPage, hasNextPage, onPageChange, totalPages }) => (
  <PaginationInner currentPage={currentPage} hasNextPage={hasNextPage} onPageChange={onPageChange} totalPages={totalPages} />
));

Pagination.displayName = 'Pagination';

const PaginationInner = memo<PaginationProps>(({ currentPage, hasNextPage, onPageChange, totalPages }) => {
  const { t } = useI18n();
  return (
    <Flexbox horizontal align="center" gap={12} justify="center" paddingBlock={16}>
      <Button disabled={currentPage <= 1} icon={ChevronLeft} onClick={() => onPageChange(currentPage - 1)}>
        {t('market.prev')}
      </Button>
      <Text type="secondary">{t('market.pageInfo', { page: currentPage, total: totalPages })}</Text>
      <Button disabled={!hasNextPage} icon={ChevronRight} onClick={() => onPageChange(currentPage + 1)}>
        {t('market.next')}
      </Button>
    </Flexbox>
  );
});

export default Pagination;
