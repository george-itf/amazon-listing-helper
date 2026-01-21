import type { RiskLevel } from '../../types';

interface RiskBadgeProps {
  level: RiskLevel;
  label?: string;
}

export function RiskBadge({ level, label }: RiskBadgeProps) {
  const styles = {
    LOW: 'badge-success',
    MEDIUM: 'badge-warning',
    HIGH: 'badge-danger',
    UNKNOWN: 'badge-neutral',
  };

  return (
    <span className={`badge ${styles[level]}`}>
      {label || level}
    </span>
  );
}
