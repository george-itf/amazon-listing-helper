import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { getComponents, getBoms, createComponent } from '../api/boms';
import type { Component, Bom } from '../api/boms';

export function BomLibraryPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [activeTab, setActiveTab] = useState<'components' | 'boms'>('components');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New component form
  const [showNewComponent, setShowNewComponent] = useState(false);
  const [newComponent, setNewComponent] = useState({
    component_sku: '',
    name: '',
    description: '',
    unit_cost_ex_vat: '',
  });

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
        supplier_id: null,
        lead_time_days: null,
      });
      setShowNewComponent(false);
      setNewComponent({ component_sku: '', name: '', description: '', unit_cost_ex_vat: '' });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    }
  };

  return (
    <div>
      <PageHeader
        title="BOM Library"
        subtitle="Manage components and bills of materials"
        actions={
          <button
            onClick={() => setShowNewComponent(true)}
            className="btn btn-primary btn-sm"
          >
            New Component
          </button>
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

      {/* New Component Form */}
      {showNewComponent && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-4">New Component</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* Components Table */}
      {activeTab === 'components' && (
        <div className="card">
          {isLoading ? (
            <p className="text-center py-12 text-gray-500">Loading...</p>
          ) : components.length === 0 ? (
            <p className="text-center py-12 text-gray-500">No components found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Unit Cost (ex VAT)</th>
                    <th className="px-4 py-3">Lead Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {components.map((comp) => (
                    <tr key={comp.id} className="hover:bg-gray-50">
                      <td className="table-cell font-mono text-xs">{comp.component_sku}</td>
                      <td className="table-cell">{comp.name}</td>
                      <td className="table-cell text-gray-500">{comp.description || '-'}</td>
                      <td className="table-cell text-right">£{comp.unit_cost_ex_vat.toFixed(2)}</td>
                      <td className="table-cell">{comp.lead_time_days ? `${comp.lead_time_days}d` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      <td className="table-cell text-right">£{bom.total_cost_ex_vat.toFixed(2)}</td>
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
