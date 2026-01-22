/**
 * I.1 FIX: Extracted BomsTable component
 *
 * Displays a list of Bills of Materials.
 */
import type { Bom } from '../../api/boms';

interface BomsTableProps {
  boms: Bom[];
  isLoading: boolean;
}

export function BomsTable({ boms, isLoading }: BomsTableProps) {
  if (isLoading) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (boms.length === 0) {
    return <p className="text-center py-12 text-gray-500">No BOMs found</p>;
  }

  return (
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
    </div>
  );
}
