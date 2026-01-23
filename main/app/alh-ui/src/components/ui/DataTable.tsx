import { useRef, useCallback, useMemo } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ColumnDef } from '../../hooks/useColumnVisibility';
import { useColumnVisibility } from '../../hooks/useColumnVisibility';
import { ColumnVisibilityToggle } from './ColumnVisibilityToggle';

export interface DataTableProps<T> {
  /** Data rows */
  data: T[];
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Unique key for each row */
  getRowId: (row: T) => string | number;
  /** Loading state */
  isLoading?: boolean;
  /** Storage key for persisting column visibility */
  storageKey?: string;
  /** Custom empty state */
  emptyState?: ReactNode;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Row double-click handler */
  onRowDoubleClick?: (row: T) => void;
  /** Enable keyboard navigation */
  enableKeyboardNavigation?: boolean;
  /** Enable responsive card layout on mobile */
  enableResponsive?: boolean;
  /** Show column visibility toggle */
  showColumnToggle?: boolean;
  /** Additional toolbar content (rendered before column toggle) */
  toolbar?: ReactNode;
  /** Row selection state */
  selectedIds?: Set<string | number>;
  /** Selection change handler */
  onSelectionChange?: (selectedIds: Set<string | number>) => void;
  /** Custom row class name */
  getRowClassName?: (row: T, index: number) => string;
  /** Zebra striping */
  striped?: boolean;
}

/**
 * A reusable data table component with:
 * - Column visibility toggle with localStorage persistence
 * - Keyboard navigation (arrow keys, Home, End, PageUp, PageDown)
 * - Responsive card layout on mobile
 * - Row selection support
 * - Customizable cell rendering
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  isLoading = false,
  storageKey,
  emptyState,
  onRowClick,
  onRowDoubleClick,
  enableKeyboardNavigation = true,
  enableResponsive = true,
  showColumnToggle = true,
  toolbar,
  selectedIds,
  onSelectionChange,
  getRowClassName,
  striped = true,
}: DataTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number>(-1);

  // Column visibility
  const {
    visibleColumns,
    columnVisibility,
    toggleColumn,
    showAllColumns,
    resetColumns,
  } = useColumnVisibility({ columns, storageKey });

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    if (selectedIds?.size === data.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map((row) => getRowId(row))));
    }
  }, [data, selectedIds, onSelectionChange, getRowId]);

  const handleSelectRow = useCallback(
    (id: string | number) => {
      if (!onSelectionChange || !selectedIds) return;
      const newSelection = new Set(selectedIds);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      onSelectionChange(newSelection);
    },
    [selectedIds, onSelectionChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!enableKeyboardNavigation || data.length === 0) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      let newIndex = focusedIndexRef.current;
      let handled = false;

      switch (e.key) {
        case 'ArrowDown':
          newIndex = Math.min(focusedIndexRef.current + 1, data.length - 1);
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
          newIndex = data.length - 1;
          handled = true;
          break;
        case 'PageDown':
          newIndex = Math.min(focusedIndexRef.current + 10, data.length - 1);
          handled = true;
          break;
        case 'PageUp':
          newIndex = Math.max(focusedIndexRef.current - 10, 0);
          handled = true;
          break;
        case 'Enter':
        case ' ':
          if (focusedIndexRef.current >= 0 && onRowDoubleClick) {
            e.preventDefault();
            onRowDoubleClick(data[focusedIndexRef.current]);
            handled = true;
          }
          break;
      }

      if (handled && newIndex !== focusedIndexRef.current) {
        e.preventDefault();
        focusedIndexRef.current = newIndex;

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
    [data, enableKeyboardNavigation, onRowDoubleClick]
  );

  const handleRowFocus = useCallback((index: number) => {
    focusedIndexRef.current = index;
  }, []);

  // Get cell value
  const getCellValue = useCallback((row: T, column: ColumnDef<T>): ReactNode => {
    const accessor = column.accessor;
    let value: unknown;

    if (typeof accessor === 'function') {
      value = accessor(row);
    } else {
      value = row[accessor];
    }

    if (column.cell) {
      return column.cell(value, row);
    }

    if (value === null || value === undefined) {
      return '—';
    }

    return value as ReactNode;
  }, []);

  // Selection state
  const isAllSelected = selectedIds && data.length > 0 && selectedIds.size === data.length;
  const isSomeSelected = selectedIds && selectedIds.size > 0 && selectedIds.size < data.length;

  // Memoize toolbar
  const toolbarContent = useMemo(() => {
    if (!toolbar && !showColumnToggle) return null;

    return (
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">{toolbar}</div>
        {showColumnToggle && (
          <ColumnVisibilityToggle
            columns={columns}
            columnVisibility={columnVisibility}
            onToggleColumn={toggleColumn}
            onShowAll={showAllColumns}
            onReset={resetColumns}
          />
        )}
      </div>
    );
  }, [toolbar, showColumnToggle, columns, columnVisibility, toggleColumn, showAllColumns, resetColumns]);

  if (isLoading) {
    return (
      <div>
        {toolbarContent}
        <div className="text-center py-12 text-gray-500">
          <div className="inline-block animate-spin text-3xl mb-4">&#8635;</div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        {toolbarContent}
        {emptyState || (
          <div className="text-center py-12 text-gray-500">
            <p>No data found</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {toolbarContent}

      <div
        ref={containerRef}
        className="overflow-x-auto max-h-[600px] overflow-y-auto"
        role="grid"
        tabIndex={enableKeyboardNavigation ? 0 : undefined}
        onKeyDown={enableKeyboardNavigation ? handleKeyDown : undefined}
        aria-label="Data table. Use arrow keys to navigate."
      >
        <table
          className={`min-w-full divide-y divide-gray-200 ${enableResponsive ? 'table-responsive' : ''}`}
        >
          <thead className="table-header-sticky">
            <tr className="table-header">
              {onSelectionChange && (
                <th className="px-4 py-3 w-10" scope="col">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !!isSomeSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
                    aria-label={isAllSelected ? 'Deselect all' : 'Select all'}
                  />
                </th>
              )}
              {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  className={`px-4 py-3 ${column.hideOnMobile ? 'mobile-hidden' : ''} ${
                    column.align === 'right' ? 'text-right' : ''
                  } ${column.width || ''}`}
                  scope="col"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((row, index) => {
              const rowId = getRowId(row);
              const isSelected = selectedIds?.has(rowId);
              const customClassName = getRowClassName?.(row, index) || '';

              return (
                <tr
                  key={rowId}
                  tabIndex={enableKeyboardNavigation ? -1 : undefined}
                  role="row"
                  onFocus={() => handleRowFocus(index)}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  className={`
                    hover:bg-gray-100 cursor-pointer focus:outline-none
                    ${isSelected ? 'bg-blue-50' : striped && index % 2 === 1 ? 'bg-gray-50/50' : ''}
                    ${customClassName}
                  `}
                >
                  {onSelectionChange && (
                    <td className="table-cell td-checkbox">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(rowId)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
                        aria-label={`Select row ${index + 1}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={`table-cell ${column.hideOnMobile ? 'mobile-hidden' : ''} ${
                        column.align === 'right' ? 'text-right' : ''
                      }`}
                      data-label={column.header}
                      data-align={column.align}
                    >
                      {getCellValue(row, column)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {enableKeyboardNavigation && (
          <div className="sr-only" aria-live="polite">
            Use arrow keys to navigate rows. Press Enter to activate.
          </div>
        )}
      </div>
    </div>
  );
}
