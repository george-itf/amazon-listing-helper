import type { BuyBoxStatus } from '../../types';

interface BuyBoxBadgeProps {
  status: BuyBoxStatus;
}

export function BuyBoxBadge({ status }: BuyBoxBadgeProps) {
  const styles = {
    WON: 'badge-success',
    LOST: 'badge-danger',
    UNKNOWN: 'badge-neutral',
  };

  const labels = {
    WON: 'Won',
    LOST: 'Lost',
    UNKNOWN: 'Unknown',
  };

  return (
    <span className={`badge ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
