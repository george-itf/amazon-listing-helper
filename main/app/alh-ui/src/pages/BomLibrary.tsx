import { useState, useEffect, useRef } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import {
  getComponents,
  getBoms,
  createComponent,
  deleteComponent,
  importComponents,
  bulkUpdateComponents,
} from '../api/boms';
import type { Component, Bom, ImportComponentRow } from '../api/boms';

interface EditingCell {
  id: number;
  field: keyof Component;
}

export function BomLibraryPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [activeTab, setActiveTab] = useState<'components' | 'boms'>('components');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New component form
  const [showNewComponent, setShowNewComponent] = useState(false);
  const [newComponent, setNewComponent] = useState({
    component_sku: '',
    name: '',
    description: '',
    unit_cost_ex_vat: '',
    category: '',
  });

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'csv' | 'paste'>('paste');
  const [pasteData, setPasteData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline editing
  const [editedComponents, setEditedComponents] = useState<Map<number, Partial<Component>>>(new Map());
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Backup
  const [isBackingUp, setIsBackingUp] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [comps, allBoms] = await Promise.all([
        getComponents(),
        getBoms(),
      ]);
      setComponents(comps);
      setBoms(allBoms);
      setEditedComponents(new Map());
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleBackup = async (type: 'boms' | 'full') => {
    setIsBackingUp(true);
    try {
      const response = await fetch('/api/v2/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      if (!response.ok) {
        throw new Error('Backup failed');
      }

      // Download the backup file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${type}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showSuccess(`${type === 'full' ? 'Full' : 'BOM'} backup downloaded successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleCreateComponent = async () => {
    if (!newComponent.component_sku || !newComponent.name || !newComponent.unit_cost_ex_vat) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      await createComponent({
        component_sku: newComponent.component_sku,
        name: newComponent.name,
        description: newComponent.description || null,
        unit_cost_ex_vat: parseFloat(newComponent.unit_cost_ex_vat),
        current_stock: 0,
        supplier_id: null,
        lead_time_days: null,
      });
      setShowNewComponent(false);
      setNewComponent({ component_sku: '', name: '', description: '', unit_cost_ex_vat: '', category: '' });
      showSuccess('Component created successfully');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    }
  };

  // Parse paste data (tab-separated values from spreadsheet)
  const parsePasteData = (text: string): ImportComponentRow[] => {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];

    // First line might be headers
    const firstLine = lines[0].toLowerCase();
    const hasHeaders = firstLine.includes('sku') || firstLine.includes('name') || firstLine.includes('cost');
    const dataLines = hasHeaders ? lines.slice(1) : lines;

    return dataLines.map(line => {
      const cols = line.split('\t');
      return {
        component_sku: cols[0]?.trim() || '',
        name: cols[1]?.trim() || '',
        description: cols[2]?.trim() || undefined,
        category: cols[3]?.trim() || undefined,
        unit_cost_ex_vat: cols[4] ? parseFloat(cols[4].replace(/[£$,]/g, '')) : undefined,
        supplier_sku: cols[5]?.trim() || undefined,
      };
    }).filter(row => row.component_sku && row.name);
  };

  // Parse CSV file
  const parseCSV = (text: string): ImportComponentRow[] => {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];

    // First line is headers
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const dataLines = lines.slice(1);

    return dataLines.map(line => {
      // Handle quoted values
      const cols: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cols.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cols.push(current.trim());

      const row: ImportComponentRow = {
        component_sku: '',
        name: '',
      };

      headers.forEach((header, i) => {
        const value = cols[i]?.replace(/"/g, '').trim();
        if (header.includes('sku') && !header.includes('supplier')) {
          row.component_sku = value || '';
        } else if (header === 'name') {
          row.name = value || '';
        } else if (header.includes('description')) {
          row.description = value || undefined;
        } else if (header.includes('category')) {
          row.category = value || undefined;
        } else if (header.includes('cost') || header.includes('price')) {
          row.unit_cost_ex_vat = value ? parseFloat(value.replace(/[£$,]/g, '')) : undefined;
        } else if (header.includes('supplier') && header.includes('sku')) {
          row.supplier_sku = value || undefined;
        }
      });

      return row;
    }).filter(row => row.component_sku && row.name);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setPasteData(text);
      setImportMode('csv');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setError(null);
    setIsImporting(true);

    try {
      const rows = importMode === 'csv' ? parseCSV(pasteData) : parsePasteData(pasteData);

      if (rows.length === 0) {
        setError('No valid data found. Ensure your data has component_sku and name columns.');
        setIsImporting(false);
        return;
      }

      const result = await importComponents(rows);

      if (result.errors.length > 0) {
        setError(`Import completed with ${result.errors.length} errors: ${result.errors.map(e => `Row ${e.row}: ${e.error}`).join(', ')}`);
      }

      showSuccess(`Import complete: ${result.created} created, ${result.updated} updated`);
      setShowImportModal(false);
      setPasteData('');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import components');
    } finally {
      setIsImporting(false);
    }
  };

  // Inline editing handlers
  const getComponentValue = (comp: Component, field: keyof Component): string | number | null => {
    const edited = editedComponents.get(comp.id);
    if (edited && field in edited) {
      return edited[field] as string | number | null;
    }
    return comp[field] as string | number | null;
  };

  const handleCellEdit = (id: number, field: keyof Component, value: string | number | null) => {
    setEditedComponents(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(id) || {};
      newMap.set(id, { ...existing, [field]: value });
      return newMap;
    });
    setHasChanges(true);
  };

  const handleCellClick = (id: number, field: keyof Component) => {
    setEditingCell({ id, field });
  };

  const handleCellBlur = () => {
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: number, field: keyof Component) => {
    if (e.key === 'Enter') {
      setEditingCell(null);
    } else if (e.key === 'Escape') {
      // Revert this cell's changes
      setEditedComponents(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(id);
        if (existing) {
          const newExisting = { ...existing };
          delete newExisting[field];
          if (Object.keys(newExisting).length === 0) {
            newMap.delete(id);
          } else {
            newMap.set(id, newExisting);
          }
        }
        return newMap;
      });
      setEditingCell(null);
    }
  };

  const handleSaveChanges = async () => {
    if (editedComponents.size === 0) return;

    setIsSaving(true);
    setError(null);

    try {
      const updates = Array.from(editedComponents.entries()).map(([id, changes]) => ({
        id,
        ...changes,
      }));

      const result = await bulkUpdateComponents(updates);

      if (result.failed > 0) {
        setError(`${result.failed} updates failed: ${result.errors.map(e => e.error).join(', ')}`);
      }

      if (result.updated > 0) {
        showSuccess(`${result.updated} components updated successfully`);
      }

      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = () => {
    setEditedComponents(new Map());
    setHasChanges(false);
    setEditingCell(null);
  };

  const handleDeleteComponent = async (id: number) => {
    if (!confirm('Are you sure you want to delete this component?')) return;

    try {
      await deleteComponent(id);
      showSuccess('Component deleted');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete component');
    }
  };

  const renderEditableCell = (comp: Component, field: keyof Component, type: 'text' | 'number' = 'text') => {
    const isEditing = editingCell?.id === comp.id && editingCell?.field === field;
    const value = getComponentValue(comp, field);
    const isModified = editedComponents.get(comp.id)?.[field] !== undefined;

    if (isEditing) {
      return (
        <input
          type={type}
          step={type === 'number' ? '0.01' : undefined}
          className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={value ?? ''}
          onChange={(e) => handleCellEdit(comp.id, field, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
          onBlur={handleCellBlur}
          onKeyDown={(e) => handleKeyDown(e, comp.id, field)}
          autoFocus
        />
      );
    }

    return (
      <span
        onClick={() => handleCellClick(comp.id, field)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${isModified ? 'bg-yellow-100 font-medium' : ''}`}
        title="Click to edit"
      >
        {field === 'unit_cost_ex_vat' ? `£${(Number(value) || 0).toFixed(2)}` : value || '-'}
      </span>
    );
  };

  return (
    <div>
      <PageHeader
        title="BOM Library"
        subtitle="Manage components and bills of materials"
        actions={
          <div className="flex gap-2">
            <div className="relative group">
              <button
                disabled={isBackingUp}
                className="btn btn-secondary btn-sm"
              >
                {isBackingUp ? 'Backing up...' : 'Backup'}
              </button>
              <div className="absolute right-0 mt-1 w-40 bg-white border rounded shadow-lg hidden group-hover:block z-10">
                <button
                  onClick={() => handleBackup('boms')}
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                >
                  BOMs Only
                </button>
                <button
                  onClick={() => handleBackup('full')}
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                >
                  Full Backup
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowImportModal(true)}
              className="btn btn-secondary btn-sm"
            >
              Import Components
            </button>
            <button
              onClick={() => setShowNewComponent(true)}
              className="btn btn-primary btn-sm"
            >
              New Component
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab('components')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'components'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Components ({components.length})
        </button>
        <button
          onClick={() => setActiveTab('boms')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'boms'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          BOMs ({boms.length})
        </button>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Import Components</h2>

              {/* Mode toggle */}
              <div className="flex gap-4 mb-4">
                <button
                  onClick={() => setImportMode('paste')}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${
                    importMode === 'paste' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Paste from Spreadsheet
                </button>
                <button
                  onClick={() => setImportMode('csv')}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${
                    importMode === 'csv' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Upload CSV File
                </button>
              </div>

              {importMode === 'csv' && (
                <div className="mb-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {importMode === 'paste'
                    ? 'Paste your data here (tab-separated, from Excel/Google Sheets):'
                    : 'CSV content preview:'}
                </label>
                <textarea
                  className="w-full h-48 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={`component_sku\tname\tdescription\tcategory\tunit_cost_ex_vat\tsupplier_sku
SKU001\tWidget A\tA useful widget\tWidgets\t5.99\tSUP-001
SKU002\tGadget B\tA cool gadget\tGadgets\t12.50\tSUP-002`}
                  value={pasteData}
                  onChange={(e) => setPasteData(e.target.value)}
                />
              </div>

              <div className="text-sm text-gray-600 mb-4">
                <p className="font-medium mb-1">Expected columns:</p>
                <ul className="list-disc list-inside">
                  <li><strong>component_sku</strong> (required) - Unique identifier</li>
                  <li><strong>name</strong> (required) - Component name</li>
                  <li>description - Optional description</li>
                  <li>category - Optional category (default: General)</li>
                  <li>unit_cost_ex_vat - Cost excluding VAT</li>
                  <li>supplier_sku - Supplier's part number</li>
                </ul>
                <p className="mt-2 text-gray-500">
                  Existing components (by SKU) will be updated. New SKUs will be created.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setPasteData('');
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!pasteData.trim() || isImporting}
                  className="btn btn-primary"
                >
                  {isImporting ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Component Form */}
      {showNewComponent && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-4">New Component</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="label">Component SKU *</label>
              <input
                type="text"
                className="input"
                value={newComponent.component_sku}
                onChange={(e) => setNewComponent({ ...newComponent, component_sku: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Name *</label>
              <input
                type="text"
                className="input"
                value={newComponent.name}
                onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Unit Cost (ex VAT) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                <input
                  type="number"
                  step="0.01"
                  className="input pl-7"
                  value={newComponent.unit_cost_ex_vat}
                  onChange={(e) => setNewComponent({ ...newComponent, unit_cost_ex_vat: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Category</label>
              <input
                type="text"
                className="input"
                placeholder="General"
                value={newComponent.category}
                onChange={(e) => setNewComponent({ ...newComponent, category: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                type="text"
                className="input"
                value={newComponent.description}
                onChange={(e) => setNewComponent({ ...newComponent, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreateComponent} className="btn btn-primary btn-sm">
              Create
            </button>
            <button
              onClick={() => setShowNewComponent(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded text-sm">
          {successMessage}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* Unsaved Changes Bar */}
      {hasChanges && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded flex items-center justify-between">
          <span className="text-yellow-800">
            You have unsaved changes to {editedComponents.size} component(s)
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleDiscardChanges}
              className="btn btn-secondary btn-sm"
              disabled={isSaving}
            >
              Discard
            </button>
            <button
              onClick={handleSaveChanges}
              className="btn btn-primary btn-sm"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Components Table */}
      {activeTab === 'components' && (
        <div className="card">
          {isLoading ? (
            <p className="text-center py-12 text-gray-500">Loading...</p>
          ) : components.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No components found</p>
              <button
                onClick={() => setShowImportModal(true)}
                className="btn btn-primary"
              >
                Import Components
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
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
                  {components.map((comp) => (
                    <tr
                      key={comp.id}
                      className={`hover:bg-gray-50 ${editedComponents.has(comp.id) ? 'bg-yellow-50' : ''}`}
                    >
                      <td className="table-cell font-mono text-xs">
                        {renderEditableCell(comp, 'component_sku')}
                      </td>
                      <td className="table-cell">
                        {renderEditableCell(comp, 'name')}
                      </td>
                      <td className="table-cell text-gray-500">
                        {renderEditableCell(comp, 'description')}
                      </td>
                      <td className="table-cell text-right">
                        {renderEditableCell(comp, 'unit_cost_ex_vat', 'number')}
                      </td>
                      <td className="table-cell text-right">
                        {comp.current_stock ?? '-'}
                      </td>
                      <td className="table-cell">
                        {comp.lead_time_days ? `${comp.lead_time_days}d` : '-'}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => handleDeleteComponent(comp.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
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
          )}
        </div>
      )}

      {/* BOMs Table */}
      {activeTab === 'boms' && (
        <div className="card">
          {isLoading ? (
            <p className="text-center py-12 text-gray-500">Loading...</p>
          ) : boms.length === 0 ? (
            <p className="text-center py-12 text-gray-500">No BOMs found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Lines</th>
                    <th className="px-4 py-3 text-right">Total Cost (ex VAT)</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {boms.map((bom) => (
                    <tr key={bom.id} className="hover:bg-gray-50">
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
                      <td className="table-cell">{bom.lines.length}</td>
                      <td className="table-cell text-right">£{(Number(bom.total_cost_ex_vat) || 0).toFixed(2)}</td>
                      <td className="table-cell text-gray-500">
                        {new Date(bom.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
