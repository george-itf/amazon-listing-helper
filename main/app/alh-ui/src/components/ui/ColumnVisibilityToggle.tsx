import { useState, useRef, useEffect } from 'react';
import type { ColumnDef } from '../../hooks/useColumnVisibility';

interface ColumnVisibilityToggleProps<T> {
  columns: ColumnDef<T>[];
  columnVisibility: Record<string, boolean>;
  onToggleColumn: (columnId: string) => void;
  onShowAll: () => void;
  onReset: () => void;
}

function ColumnsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function ColumnVisibilityToggle<T>({
  columns,
  columnVisibility,
  onToggleColumn,
  onShowAll,
  onReset,
}: ColumnVisibilityToggleProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const hiddenCount = columns.filter(
    (col) => col.canHide !== false && !columnVisibility[col.id]
  ).length;

  const toggleableColumns = columns.filter((col) => col.canHide !== false);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-secondary btn-sm inline-flex items-center gap-2"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <ColumnsIcon />
        <span>Columns</span>
        {hiddenCount > 0 && (
          <span className="badge badge-primary text-xs">{hiddenCount} hidden</span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
          role="menu"
          aria-orientation="vertical"
        >
          <div className="p-2 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">
              Toggle Columns
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {toggleableColumns.map((column) => {
              const isVisible = columnVisibility[column.id] !== false;
              return (
                <button
                  key={column.id}
                  onClick={() => onToggleColumn(column.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                  role="menuitemcheckbox"
                  aria-checked={isVisible}
                >
                  <span
                    className={`flex-shrink-0 w-4 h-4 border rounded flex items-center justify-center ${
                      isVisible
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-300'
                    }`}
                  >
                    {isVisible && <CheckIcon />}
                  </span>
                  <span className={isVisible ? 'text-gray-900' : 'text-gray-500'}>
                    {column.header}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-2 border-t border-gray-100 flex gap-2">
            <button
              onClick={() => {
                onShowAll();
                setIsOpen(false);
              }}
              className="flex-1 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Show All
            </button>
            <button
              onClick={() => {
                onReset();
                setIsOpen(false);
              }}
              className="flex-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
