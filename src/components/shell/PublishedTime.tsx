// LobeHub PublishedTime equivalent (slim, no locale store)
import { memo } from 'react';

const formatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

interface PublishedTimeProps {
  className?: string;
  date?: number | string | Date;
}

const PublishedTime = memo<PublishedTimeProps>(({ className, date }) => {
  if (!date) return null;
  return <time className={className}>{formatter.format(new Date(date))}</time>;
});

PublishedTime.displayName = 'PublishedTime';

export default PublishedTime;
