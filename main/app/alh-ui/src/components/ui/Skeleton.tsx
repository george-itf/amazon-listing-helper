/**
 * Skeleton Loading Components
 *
 * Loading placeholder components that show during data fetching.
 */

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

/**
 * Base Skeleton component
 */
export function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton for text lines
 */
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton skeleton-text"
          style={{
            width: i === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for a table row
 */
export function SkeletonTableRow({
  columns = 5,
  className = '',
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <tr className={className} aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton
            height="1rem"
            width={i === 0 ? '80%' : i === columns - 1 ? '60px' : '70%'}
          />
        </td>
      ))}
    </tr>
  );
}

/**
 * Skeleton for multiple table rows
 */
export function SkeletonTable({
  rows = 5,
  columns = 5,
  className = '',
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <tbody className={className} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} columns={columns} />
      ))}
    </tbody>
  );
}

/**
 * Skeleton for a card
 */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card ${className}`} aria-hidden="true">
      <Skeleton height="0.875rem" width="40%" className="mb-2" />
      <Skeleton height="1.5rem" width="60%" />
    </div>
  );
}

/**
 * Skeleton for KPI cards grid
 */
export function SkeletonKpiCards({
  count = 4,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for a listing row (specific to Listings table)
 */
export function SkeletonListingRow() {
  return (
    <tr aria-hidden="true">
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="80px" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="80px" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="200px" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="40px" className="ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="60px" className="ml-auto" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1.25rem" width="50px" className="rounded-full" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="50px" className="ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="45px" className="ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="30px" className="ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="30px" className="ml-auto" />
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <Skeleton height="1.25rem" width="30px" className="rounded-full" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <Skeleton height="1rem" width="35px" />
          <Skeleton height="1rem" width="30px" />
        </div>
      </td>
    </tr>
  );
}

/**
 * Skeleton for multiple listing rows
 */
export function SkeletonListingsTable({
  rows = 10,
  className = '',
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <tbody className={className} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonListingRow key={i} />
      ))}
    </tbody>
  );
}

/**
 * Skeleton for a component row (BOM Library)
 */
export function SkeletonComponentRow() {
  return (
    <tr aria-hidden="true">
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="70px" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="150px" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="200px" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="50px" className="ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton height="1rem" width="40px" className="ml-auto" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="30px" />
      </td>
      <td className="px-4 py-3">
        <Skeleton height="1rem" width="45px" />
      </td>
    </tr>
  );
}

/**
 * Skeleton for components table
 */
export function SkeletonComponentsTable({
  rows = 10,
  className = '',
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <tbody className={className} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonComponentRow key={i} />
      ))}
    </tbody>
  );
}
