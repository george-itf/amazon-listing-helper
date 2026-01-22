import type { BuyBoxStatus } from '../../types';

interface BuyBoxBadgeProps {
  status: BuyBoxStatus;
}

export function BuyBoxBadge({ status }: BuyBoxBadgeProps) {
  const styles: Record<BuyBoxStatus, string> = {
    WON: 'badge-success',
    PARTIAL: 'badge-warning',
    LOST: 'badge-danger',
    UNKNOWN: 'badge-neutral',
  };

  const labels: Record<BuyBoxStatus, string> = {
    WON: 'Won',
    PARTIAL: 'Partial',
    LOST: 'Lost',
    UNKNOWN: 'Unknown',
  };

  return (
    <span className={`badge ${styles[status] || 'badge-neutral'}`}>
      {labels[status] || status}
    </span>
  );
}
