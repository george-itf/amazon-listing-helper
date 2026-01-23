import { useState, useCallback, useMemo } from 'react';

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  /** Whether column is visible by default */
  defaultVisible?: boolean;
  /** Whether column can be hidden */
  canHide?: boolean;
  /** Column alignment */
  align?: 'left' | 'center' | 'right';
  /** Hide on mobile */
  hideOnMobile?: boolean;
  /** Custom cell renderer */
  cell?: (value: unknown, row: T) => React.ReactNode;
  /** Column width class */
  width?: string;
}

export interface UseColumnVisibilityOptions<T> {
  columns: ColumnDef<T>[];
  /** Storage key for persisting visibility state */
  storageKey?: string;
}

export interface UseColumnVisibilityResult<T> {
  /** All column definitions */
  columns: ColumnDef<T>[];
  /** Currently visible columns */
  visibleColumns: ColumnDef<T>[];
  /** Map of column id to visibility */
  columnVisibility: Record<string, boolean>;
  /** Toggle column visibility */
  toggleColumn: (columnId: string) => void;
  /** Show all columns */
  showAllColumns: () => void;
  /** Reset to default visibility */
  resetColumns: () => void;
  /** Check if a column is visible */
  isColumnVisible: (columnId: string) => boolean;
}

/**
 * Hook for managing table column visibility
 *
 * Features:
 * - Toggle individual column visibility
 * - Persist visibility state to localStorage
 * - Reset to default visibility
 * - Show all columns
 */
export function useColumnVisibility<T>(
  options: UseColumnVisibilityOptions<T>
): UseColumnVisibilityResult<T> {
  const { columns, storageKey } = options;

  // Build default visibility map
  const defaultVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columns.forEach((col) => {
      visibility[col.id] = col.defaultVisible !== false;
    });
    return visibility;
  }, [columns]);

  // Load initial visibility from storage or use defaults
  const loadInitialVisibility = useCallback((): Record<string, boolean> => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(`column-visibility-${storageKey}`);
        if (stored) {
          const parsed = JSON.parse(stored) as Record<string, boolean>;
          // Merge with defaults to handle new columns
          return { ...defaultVisibility, ...parsed };
        }
      } catch {
        // Ignore storage errors
      }
    }
    return defaultVisibility;
  }, [storageKey, defaultVisibility]);

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    loadInitialVisibility
  );

  // Persist to storage when visibility changes
  const persistVisibility = useCallback(
    (visibility: Record<string, boolean>) => {
      if (storageKey) {
        try {
          localStorage.setItem(`column-visibility-${storageKey}`, JSON.stringify(visibility));
        } catch {
          // Ignore storage errors
        }
      }
    },
    [storageKey]
  );

  const toggleColumn = useCallback(
    (columnId: string) => {
      const column = columns.find((c) => c.id === columnId);
      if (!column || column.canHide === false) return;

      setColumnVisibility((prev) => {
        const newVisibility = { ...prev, [columnId]: !prev[columnId] };
        persistVisibility(newVisibility);
        return newVisibility;
      });
    },
    [columns, persistVisibility]
  );

  const showAllColumns = useCallback(() => {
    const allVisible: Record<string, boolean> = {};
    columns.forEach((col) => {
      allVisible[col.id] = true;
    });
    setColumnVisibility(allVisible);
    persistVisibility(allVisible);
  }, [columns, persistVisibility]);

  const resetColumns = useCallback(() => {
    setColumnVisibility(defaultVisibility);
    persistVisibility(defaultVisibility);
  }, [defaultVisibility, persistVisibility]);

  const isColumnVisible = useCallback(
    (columnId: string) => columnVisibility[columnId] !== false,
    [columnVisibility]
  );

  const visibleColumns = useMemo(
    () => columns.filter((col) => columnVisibility[col.id] !== false),
    [columns, columnVisibility]
  );

  return {
    columns,
    visibleColumns,
    columnVisibility,
    toggleColumn,
    showAllColumns,
    resetColumns,
    isColumnVisible,
  };
}
