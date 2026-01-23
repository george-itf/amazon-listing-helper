/**
 * I.1 FIX: Extracted ComponentsTable component
 *
 * Displays a list of components with inline editing capability.
 * Supports keyboard navigation: Arrow keys to move between rows,
 * Enter to start editing the name field.
 */
import { useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type { Component } from '../../api/boms';

interface ComponentsTableProps {
  components: Component[];
  isLoading: boolean;
  // Editor state and actions from useComponentEditor
  getValue: (component: Component, field: keyof Component) => string | number | null;
  isEditing: (id: number, field: keyof Component) => boolean;
  isModified: (id: number, field: keyof Component) => boolean;
  startEdit: (id: number, field: keyof Component) => void;
  cancelEdit: () => void;
  editCell: (id: number, field: keyof Component, value: string | number | null) => void;
  handleKeyDown: (e: React.KeyboardEvent, id: number, field: keyof Component) => void;
  editedComponentsCount: number;
  // Selection
  selectedIds?: Set<number>;
  onSelectionChange?: (selectedIds: Set<number>) => void;
  // Actions
  onDelete: (id: number) => void;
  onImport: () => void;
}

export function ComponentsTable({
  components,
  isLoading,
  getValue,
  isEditing,
  isModified,
  startEdit,
  cancelEdit,
  editCell,
  handleKeyDown,
  editedComponentsCount,
  selectedIds = new Set(),
  onSelectionChange,
  onDelete,
  onImport,
}: ComponentsTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number>(-1);

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    if (selectedIds.size === components.length) {
      // Deselect all
      onSelectionChange(new Set());
    } else {
      // Select all
      onSelectionChange(new Set(components.map((c) => c.id)));
    }
  }, [components, selectedIds, onSelectionChange]);

  const handleSelectRow = useCallback(
    (id: number) => {
      if (!onSelectionChange) return;
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

  const isAllSelected = components.length > 0 && selectedIds.size === components.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < components.length;

  // Handle keyboard navigation at table level
  const handleTableKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (components.length === 0) return;

      // Don't interfere with input editing
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      let newIndex = focusedIndexRef.current;
      let handled = false;

      switch (e.key) {
        case 'ArrowDown':
          newIndex = Math.min(focusedIndexRef.current + 1, components.length - 1);
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
          newIndex = components.length - 1;
          handled = true;
          break;

        case 'Enter':
          if (focusedIndexRef.current >= 0) {
            // Start editing the name field of the focused row
            startEdit(components[focusedIndexRef.current].id, 'name');
            handled = true;
          }
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
    [components, startEdit]
  );

  const handleRowFocus = useCallback((index: number) => {
    focusedIndexRef.current = index;
  }, []);

  const renderEditableCell = (
    comp: Component,
    field: keyof Component,
    type: 'text' | 'number' = 'text'
  ) => {
    const editing = isEditing(comp.id, field);
    const value = getValue(comp, field);
    const modified = isModified(comp.id, field);

    if (editing) {
      return (
        <input
          type={type}
          step={type === 'number' ? '0.01' : undefined}
          className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={value ?? ''}
          onChange={(e) =>
            editCell(
              comp.id,
              field,
              type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
            )
          }
          onBlur={cancelEdit}
          onKeyDown={(e) => handleKeyDown(e, comp.id, field)}
          autoFocus
        />
      );
    }

    return (
      <span
        onClick={() => startEdit(comp.id, field)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${
          modified ? 'bg-yellow-100 font-medium' : ''
        }`}
        title="Click to edit"
      >
        {field === 'unit_cost_ex_vat'
          ? `£${(Number(value) || 0).toFixed(2)}`
          : value || '-'}
      </span>
    );
  };

  if (isLoading) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (components.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">No components found</p>
        <button onClick={onImport} className="btn btn-primary">
          Import Components
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto max-h-[600px] overflow-y-auto"
      role="grid"
      tabIndex={0}
      onKeyDown={handleTableKeyDown}
      aria-label="Components table. Use arrow keys to navigate, Enter to edit."
    >
      <table className="min-w-full divide-y divide-gray-200 table-responsive">
        <thead className="table-header-sticky">
          <tr className="table-header">
            {onSelectionChange && (
              <th className="px-4 py-3 w-10" scope="col">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isSomeSelected;
                  }}
                  onChange={handleSelectAll}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
                  aria-label={isAllSelected ? 'Deselect all' : 'Select all'}
                />
              </th>
            )}
            <th className="px-4 py-3" scope="col">SKU</th>
            <th className="px-4 py-3" scope="col">Name</th>
            <th className="px-4 py-3 mobile-hidden" scope="col">Description</th>
            <th className="px-4 py-3 text-right" scope="col">Unit Cost (ex VAT)</th>
            <th className="px-4 py-3 text-right mobile-hidden" scope="col">Stock</th>
            <th className="px-4 py-3 mobile-hidden" scope="col">Lead Time</th>
            <th className="px-4 py-3 w-20" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {components.map((comp, index) => (
            <tr
              key={comp.id}
              tabIndex={-1}
              role="row"
              onFocus={() => handleRowFocus(index)}
              className={`hover:bg-gray-100 cursor-pointer focus:outline-none ${
                selectedIds.has(comp.id) ? 'bg-blue-50' :
                editedComponentsCount > 0 &&
                isModified(comp.id, 'component_sku') ||
                isModified(comp.id, 'name') ||
                isModified(comp.id, 'description') ||
                isModified(comp.id, 'unit_cost_ex_vat')
                  ? 'bg-yellow-50'
                  : index % 2 === 1 ? 'bg-gray-50/50' : ''
              }`}
            >
              {onSelectionChange && (
                <td className="table-cell td-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(comp.id)}
                    onChange={() => handleSelectRow(comp.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
                    aria-label={`Select ${comp.name || comp.component_sku}`}
                  />
                </td>
              )}
              <td className="table-cell font-mono text-xs" data-label="SKU">
                {renderEditableCell(comp, 'component_sku')}
              </td>
              <td className="table-cell" data-label="Name">{renderEditableCell(comp, 'name')}</td>
              <td className="table-cell text-gray-500 mobile-hidden" data-label="Description">
                {renderEditableCell(comp, 'description')}
              </td>
              <td className="table-cell text-right" data-label="Cost" data-align="right">
                {renderEditableCell(comp, 'unit_cost_ex_vat', 'number')}
              </td>
              <td className="table-cell text-right mobile-hidden" data-label="Stock" data-align="right">
                {comp.current_stock ?? '-'}
              </td>
              <td className="table-cell mobile-hidden" data-label="Lead Time">
                {comp.lead_time_days ? `${comp.lead_time_days}d` : '-'}
              </td>
              <td className="table-cell td-actions">
                <button
                  onClick={() => onDelete(comp.id)}
                  className="text-red-600 hover:text-red-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 rounded px-1"
                  title="Delete component"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-500 mt-3 px-4">
        Tip: Use arrow keys to navigate rows. Click any cell or press Enter to edit. Press Escape to cancel.
      </p>
      <div className="sr-only" aria-live="polite">
        Use arrow keys to navigate rows. Press Enter to start editing.
      </div>
    </div>
  );
}
