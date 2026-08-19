// Ascending/descending toggle for the market list, shown next to the sort field.
import { ActionIcon } from '@lobehub/ui';
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import { memo } from 'react';

import { useI18n } from '@/i18n';

interface OrderButtonProps {
  onChange: (order: 'asc' | 'desc') => void;
  order: 'asc' | 'desc';
}

const OrderButton = memo<OrderButtonProps>(({ onChange, order }) => {
  const { t } = useI18n();
  const ascending = order === 'asc';
  return (
    <ActionIcon
      aria-label={ascending ? t('market.orderAsc') : t('market.orderDesc')}
      icon={ascending ? ArrowUpWideNarrow : ArrowDownWideNarrow}
      size="small"
      title={ascending ? t('market.orderAsc') : t('market.orderDesc')}
      onClick={() => onChange(ascending ? 'desc' : 'asc')}
    />
  );
});

OrderButton.displayName = 'OrderButton';

export default OrderButton;
