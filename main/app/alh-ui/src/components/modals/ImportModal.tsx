/**
 * I.1 FIX: Extracted ImportModal component
 *
 * Modal for importing components from CSV or pasted spreadsheet data.
 */
import { useState, useRef } from 'react';
import type { ImportComponentRow } from '../../api/boms';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: ImportComponentRow[]) => Promise<void>;
  isImporting: boolean;
  error: string | null;
}

// Parse paste data (tab-separated values from spreadsheet)
function parsePasteData(text: string): ImportComponentRow[] {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return [];

  // First line might be headers
  const firstLine = lines[0].toLowerCase();
  const hasHeaders =
    firstLine.includes('sku') || firstLine.includes('name') || firstLine.includes('cost');
  const dataLines = hasHeaders ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const cols = line.split('\t');
      return {
        component_sku: cols[0]?.trim() || '',
        name: cols[1]?.trim() || '',
        description: cols[2]?.trim() || undefined,
        category: cols[3]?.trim() || undefined,
        unit_cost_ex_vat: cols[4] ? parseFloat(cols[4].replace(/[£$,]/g, '')) : undefined,
        supplier_sku: cols[5]?.trim() || undefined,
      };
    })
    .filter((row) => row.component_sku && row.name);
}

// Parse CSV file
function parseCSV(text: string): ImportComponentRow[] {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return [];

  // First line is headers
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const dataLines = lines.slice(1);

  return dataLines
    .map((line) => {
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
    })
    .filter((row) => row.component_sku && row.name);
}

export function ImportModal({
  isOpen,
  onClose,
  onImport,
  isImporting,
  error,
}: ImportModalProps) {
  const [importMode, setImportMode] = useState<'csv' | 'paste'>('paste');
  const [pasteData, setPasteData] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const rows = importMode === 'csv' ? parseCSV(pasteData) : parsePasteData(pasteData);

    if (rows.length === 0) {
      return;
    }

    await onImport(rows);
  };

  const handleClose = () => {
    setPasteData('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Import Components</h2>

          {/* Mode toggle */}
          <div className="flex gap-4 mb-4">
            <button
              onClick={() => setImportMode('paste')}
              className={`px-4 py-2 text-sm font-medium rounded-md ${
                importMode === 'paste'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Paste from Spreadsheet
            </button>
            <button
              onClick={() => setImportMode('csv')}
              className={`px-4 py-2 text-sm font-medium rounded-md ${
                importMode === 'csv'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
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

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>
          )}

          <div className="text-sm text-gray-600 mb-4">
            <p className="font-medium mb-1">Expected columns:</p>
            <ul className="list-disc list-inside">
              <li>
                <strong>component_sku</strong> (required) - Unique identifier
              </li>
              <li>
                <strong>name</strong> (required) - Component name
              </li>
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
            <button onClick={handleClose} className="btn btn-secondary">
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
  );
}
