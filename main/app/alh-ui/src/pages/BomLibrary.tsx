/**
 * BOM Library Page
 *
 * I.1-I.4 REFACTOR:
 * - I.1: Extracted ComponentsTable, BomsTable, ImportModal
 * - I.2: Replaced useState with useReducer via useComponentEditor hook
 * - I.3: Added loading state for bulk save with progress indicator
 * - I.4: Replaced confirm() with accessible ConfirmDialog
 */
import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import {
  getComponents,
  getBoms,
  createComponent,
  deleteComponent,
  importComponents,
} from '../api/boms';
import type { Component, Bom, ImportComponentRow } from '../api/boms';
import { ComponentsTable } from '../components/tables/ComponentsTable';
import { BomsTable } from '../components/tables/BomsTable';
import { ImportModal, ConfirmDialog } from '../components/modals';
import { useComponentEditor } from '../hooks/useComponentEditor';

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
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // I.4: Confirm dialog for delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; componentId: number | null }>({
    isOpen: false,
    componentId: null,
  });

  // I.2: Use custom hook with useReducer for component editing
  const editor = useComponentEditor();

  // Backup
  const [isBackingUp, setIsBackingUp] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [comps, allBoms] = await Promise.all([getComponents(), getBoms()]);
      setComponents(comps);
      setBoms(allBoms);
      editor.reset(); // I.2: Reset editor state on data reload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleBackup = async (type: 'boms' | 'full') => {
    setIsBackingUp(true);
    try {
      const apiKey = import.meta.env.VITE_API_KEY;
      const response = await fetch('/api/v2/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'X-API-Key': apiKey }),
        },
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
      setNewComponent({
        component_sku: '',
        name: '',
        description: '',
        unit_cost_ex_vat: '',
        category: '',
      });
      showSuccess('Component created successfully');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    }
  };

  const handleImport = async (rows: ImportComponentRow[]) => {
    setImportError(null);
    setIsImporting(true);

    try {
      if (rows.length === 0) {
        setImportError('No valid data found. Ensure your data has component_sku and name columns.');
        setIsImporting(false);
        return;
      }

      const result = await importComponents(rows);

      if (result.errors.length > 0) {
        setImportError(
          `Import completed with ${result.errors.length} errors: ${result.errors
            .map((e) => `Row ${e.row}: ${e.error}`)
            .join(', ')}`
        );
      }

      showSuccess(`Import complete: ${result.created} created, ${result.updated} updated`);
      setShowImportModal(false);
      loadData();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import components');
    } finally {
      setIsImporting(false);
    }
  };

  // I.3: Save changes with progress indicator
  const handleSaveChanges = async () => {
    setError(null);

    try {
      const result = await editor.saveChanges();

      if (result.failed > 0) {
        setError(`${result.failed} updates failed: ${result.errors.map((e) => e.error).join(', ')}`);
      }

      if (result.updated > 0) {
        showSuccess(`${result.updated} components updated successfully`);
      }

      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    }
  };

  // I.4: Delete with accessible confirm dialog
  const handleDeleteClick = (id: number) => {
    setDeleteConfirm({ isOpen: true, componentId: id });
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm.componentId === null) return;

    try {
      await deleteComponent(deleteConfirm.componentId);
      showSuccess('Component deleted');
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete component');
    } finally {
      setDeleteConfirm({ isOpen: false, componentId: null });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm({ isOpen: false, componentId: null });
  };

  return (
    <div>
      <PageHeader
        title="BOM Library"
        subtitle="Manage components and bills of materials"
        actions={
          <div className="flex gap-2">
            <div className="relative group">
              <button disabled={isBackingUp} className="btn btn-secondary btn-sm">
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
            <button onClick={() => setShowImportModal(true)} className="btn btn-secondary btn-sm">
              Import Components
            </button>
            <button onClick={() => setShowNewComponent(true)} className="btn btn-primary btn-sm">
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
            activeTab === 'boms' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          BOMs ({boms.length})
        </button>
      </div>

      {/* I.1: Import Modal Component */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => {
          setShowImportModal(false);
          setImportError(null);
        }}
        onImport={handleImport}
        isImporting={isImporting}
        error={importError}
      />

      {/* I.4: Confirm Dialog for Delete */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Component"
        message="Are you sure you want to delete this component? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

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
                  onChange={(e) =>
                    setNewComponent({ ...newComponent, unit_cost_ex_vat: e.target.value })
                  }
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
            <button onClick={() => setShowNewComponent(false)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded text-sm">{successMessage}</div>
      )}

      {/* Error Message */}
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}

      {/* I.3: Unsaved Changes Bar with Progress */}
      {editor.hasChanges && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <div className="flex items-center justify-between">
            <span className="text-yellow-800">
              You have unsaved changes to {editor.editedComponentsCount} component(s)
            </span>
            <div className="flex gap-2">
              <button
                onClick={editor.discardAll}
                className="btn btn-secondary btn-sm"
                disabled={editor.isSaving}
              >
                Discard
              </button>
              <button
                onClick={handleSaveChanges}
                className="btn btn-primary btn-sm"
                disabled={editor.isSaving}
              >
                {editor.isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
          {/* I.3: Progress indicator */}
          {editor.isSaving && (
            <div className="mt-2">
              <div className="w-full bg-yellow-200 rounded-full h-1.5">
                <div
                  className="bg-yellow-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${editor.saveProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* I.1: Components Table Component */}
      {activeTab === 'components' && (
        <div className="card">
          <ComponentsTable
            components={components}
            isLoading={isLoading}
            getValue={editor.getValue}
            isEditing={editor.isEditing}
            isModified={editor.isModified}
            startEdit={editor.startEdit}
            cancelEdit={editor.cancelEdit}
            editCell={editor.editCell}
            handleKeyDown={editor.handleKeyDown}
            editedComponentsCount={editor.editedComponentsCount}
            onDelete={handleDeleteClick}
            onImport={() => setShowImportModal(true)}
          />
        </div>
      )}

      {/* I.1: BOMs Table Component */}
      {activeTab === 'boms' && (
        <div className="card">
          <BomsTable boms={boms} isLoading={isLoading} />
        </div>
      )}
    </div>
  );
}
