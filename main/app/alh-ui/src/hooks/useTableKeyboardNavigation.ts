import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';

interface UseTableKeyboardNavigationOptions<T> {
  items: T[];
  onSelect?: (item: T, index: number) => void;
  onActivate?: (item: T, index: number) => void;
  initialIndex?: number;
}

interface UseTableKeyboardNavigationResult {
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  tableProps: {
    role: 'grid';
    tabIndex: number;
    onKeyDown: (e: KeyboardEvent<HTMLTableElement | HTMLDivElement>) => void;
    'aria-activedescendant': string | undefined;
  };
  getRowProps: (index: number) => {
    id: string;
    role: 'row';
    tabIndex: number;
    'aria-selected': boolean;
    onClick: () => void;
    onDoubleClick: () => void;
    className: string;
  };
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Hook for adding keyboard navigation to tables
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate between rows
 * - Home: Jump to first row
 * - End: Jump to last row
 * - Enter/Space: Activate current row (double-click action)
 * - PageUp/PageDown: Navigate 10 rows at a time
 */
export function useTableKeyboardNavigation<T>(
  options: UseTableKeyboardNavigationOptions<T>
): UseTableKeyboardNavigationResult {
  const { items, onSelect, onActivate, initialIndex = -1 } = options;
  const [focusedIndex, setFocusedIndex] = useState(initialIndex);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset focused index when items change significantly
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(items.length > 0 ? items.length - 1 : -1);
    }
  }, [items.length, focusedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableElement | HTMLDivElement>) => {
      if (items.length === 0) return;

      let newIndex = focusedIndex;
      let handled = false;

      switch (e.key) {
        case 'ArrowDown':
          newIndex = Math.min(focusedIndex + 1, items.length - 1);
          if (focusedIndex === -1) newIndex = 0;
          handled = true;
          break;

        case 'ArrowUp':
          newIndex = Math.max(focusedIndex - 1, 0);
          handled = true;
          break;

        case 'Home':
          newIndex = 0;
          handled = true;
          break;

        case 'End':
          newIndex = items.length - 1;
          handled = true;
          break;

        case 'PageDown':
          newIndex = Math.min(focusedIndex + 10, items.length - 1);
          handled = true;
          break;

        case 'PageUp':
          newIndex = Math.max(focusedIndex - 10, 0);
          handled = true;
          break;

        case 'Enter':
        case ' ':
          if (focusedIndex >= 0 && focusedIndex < items.length) {
            e.preventDefault();
            onActivate?.(items[focusedIndex], focusedIndex);
            handled = true;
          }
          break;

        case 'Escape':
          setFocusedIndex(-1);
          handled = true;
          break;
      }

      if (handled && newIndex !== focusedIndex) {
        e.preventDefault();
        setFocusedIndex(newIndex);
        onSelect?.(items[newIndex], newIndex);

        // Scroll the row into view
        const rowElement = containerRef.current?.querySelector(
          `[data-row-index="${newIndex}"]`
        );
        if (rowElement) {
          rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    },
    [focusedIndex, items, onSelect, onActivate]
  );

  const getRowProps = useCallback(
    (index: number) => ({
      id: `table-row-${index}`,
      role: 'row' as const,
      tabIndex: -1,
      'aria-selected': focusedIndex === index,
      'data-row-index': index,
      onClick: () => {
        setFocusedIndex(index);
        onSelect?.(items[index], index);
      },
      onDoubleClick: () => {
        onActivate?.(items[index], index);
      },
      className: focusedIndex === index ? 'ring-2 ring-inset ring-blue-500 bg-blue-50' : '',
    }),
    [focusedIndex, items, onSelect, onActivate]
  );

  const tableProps = {
    role: 'grid' as const,
    tabIndex: 0,
    onKeyDown: handleKeyDown,
    'aria-activedescendant': focusedIndex >= 0 ? `table-row-${focusedIndex}` : undefined,
  };

  return {
    focusedIndex,
    setFocusedIndex,
    tableProps,
    getRowProps,
    containerRef,
  };
}
