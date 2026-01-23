/**
 * I.1 FIX: Extracted ComponentsTable component
 *
 * Displays a list of components with inline editing capability.
 */
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
  onDelete,
  onImport,
}: ComponentsTableProps) {
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
    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="table-header-sticky">
          <tr className="table-header">
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3 text-right">Unit Cost (ex VAT)</th>
            <th className="px-4 py-3 text-right">Stock</th>
            <th className="px-4 py-3">Lead Time</th>
            <th className="px-4 py-3 w-20">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {components.map((comp, index) => (
            <tr
              key={comp.id}
              className={`hover:bg-gray-100 ${
                editedComponentsCount > 0 &&
                isModified(comp.id, 'component_sku') ||
                isModified(comp.id, 'name') ||
                isModified(comp.id, 'description') ||
                isModified(comp.id, 'unit_cost_ex_vat')
                  ? 'bg-yellow-50'
                  : index % 2 === 1 ? 'bg-gray-50/50' : ''
              }`}
            >
              <td className="table-cell font-mono text-xs">
                {renderEditableCell(comp, 'component_sku')}
              </td>
              <td className="table-cell">{renderEditableCell(comp, 'name')}</td>
              <td className="table-cell text-gray-500">
                {renderEditableCell(comp, 'description')}
              </td>
              <td className="table-cell text-right">
                {renderEditableCell(comp, 'unit_cost_ex_vat', 'number')}
              </td>
              <td className="table-cell text-right">{comp.current_stock ?? '-'}</td>
              <td className="table-cell">
                {comp.lead_time_days ? `${comp.lead_time_days}d` : '-'}
              </td>
              <td className="table-cell">
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
        Tip: Click any cell to edit. Press Enter to confirm or Escape to cancel.
      </p>
    </div>
  );
}
