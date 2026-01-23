import type { BuyBoxStatus } from '../../types';

interface BuyBoxBadgeProps {
  status: BuyBoxStatus;
}

export function BuyBoxBadge({ status }: BuyBoxBadgeProps) {
  // Show em-dash for Unknown status instead of a badge
  if (status === 'UNKNOWN') {
    return <span className="text-gray-400">—</span>;
  }

  const styles: Record<Exclude<BuyBoxStatus, 'UNKNOWN'>, string> = {
    WON: 'badge-success',
    PARTIAL: 'badge-warning',
    LOST: 'badge-danger',
  };

  const labels: Record<Exclude<BuyBoxStatus, 'UNKNOWN'>, string> = {
    WON: 'Won',
    PARTIAL: 'Partial',
    LOST: 'Lost',
  };

  return (
    <span className={`badge ${styles[status] || 'badge-neutral'}`}>
      {labels[status] || status}
    </span>
  );
}
