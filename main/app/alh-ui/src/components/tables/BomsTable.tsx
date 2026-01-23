/**
 * I.1 FIX: Extracted BomsTable component
 *
 * Displays a list of Bills of Materials with keyboard navigation.
 * Use arrow keys to navigate between rows.
 */
import { useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type { Bom } from '../../api/boms';

interface BomsTableProps {
  boms: Bom[];
  isLoading: boolean;
}

export function BomsTable({ boms, isLoading }: BomsTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number>(-1);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (boms.length === 0) return;

      let newIndex = focusedIndexRef.current;
      let handled = false;

      switch (e.key) {
        case 'ArrowDown':
          newIndex = Math.min(focusedIndexRef.current + 1, boms.length - 1);
          if (focusedIndexRef.current === -1) newIndex = 0;
          handled = true;
          break;

        case 'ArrowUp':
          newIndex = Math.max(focusedIndexRef.current - 1, 0);
          handled = true;
          break;

        case 'Home':
          newIndex = 0;
          handled = true;
          break;

        case 'End':
          newIndex = boms.length - 1;
          handled = true;
          break;

        case 'PageDown':
          newIndex = Math.min(focusedIndexRef.current + 10, boms.length - 1);
          handled = true;
          break;

        case 'PageUp':
          newIndex = Math.max(focusedIndexRef.current - 10, 0);
          handled = true;
          break;
      }

      if (handled) {
        e.preventDefault();
        focusedIndexRef.current = newIndex;

        // Update visual focus
        const rows = containerRef.current?.querySelectorAll('tbody tr');
        rows?.forEach((row, idx) => {
          if (idx === newIndex) {
            (row as HTMLElement).focus();
            row.classList.add('ring-2', 'ring-inset', 'ring-blue-500');
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            row.classList.remove('ring-2', 'ring-inset', 'ring-blue-500');
          }
        });
      }
    },
    [boms]
  );

  const handleRowFocus = useCallback((index: number) => {
    focusedIndexRef.current = index;
  }, []);

  if (isLoading) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (boms.length === 0) {
    return <p className="text-center py-12 text-gray-500">No BOMs found</p>;
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto max-h-[600px] overflow-y-auto"
      role="grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Bills of Materials table. Use arrow keys to navigate."
    >
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="table-header-sticky">
          <tr className="table-header">
            <th className="px-4 py-3" scope="col">ID</th>
            <th className="px-4 py-3" scope="col">Scope</th>
            <th className="px-4 py-3" scope="col">Version</th>
            <th className="px-4 py-3" scope="col">Active</th>
            <th className="px-4 py-3 text-right" scope="col">Lines</th>
            <th className="px-4 py-3 text-right" scope="col">Total Cost (ex VAT)</th>
            <th className="px-4 py-3" scope="col">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {boms.map((bom, index) => (
            <tr
              key={bom.id}
              tabIndex={-1}
              role="row"
              onFocus={() => handleRowFocus(index)}
              className={`hover:bg-gray-100 cursor-pointer focus:outline-none ${index % 2 === 1 ? 'bg-gray-50/50' : ''}`}
            >
              <td className="table-cell">{bom.id}</td>
              <td className="table-cell">
                <span className="badge badge-neutral">{bom.scope_type}</span>
              </td>
              <td className="table-cell">v{bom.version}</td>
              <td className="table-cell">
                {bom.is_active ? (
                  <span className="badge badge-success">Active</span>
                ) : (
                  <span className="badge badge-neutral">Inactive</span>
                )}
              </td>
              <td className="table-cell text-right">{bom.lines.length}</td>
              <td className="table-cell text-right">
                £{(Number(bom.total_cost_ex_vat) || 0).toFixed(2)}
              </td>
              <td className="table-cell text-gray-500">
                {new Date(bom.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sr-only" aria-live="polite">
        Use arrow keys to navigate rows.
      </div>
    </div>
  );
}
