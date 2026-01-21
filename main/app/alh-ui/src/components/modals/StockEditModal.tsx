import { useState, useEffect } from 'react';
import type { ListingWithFeatures } from '../../types';
import { previewStockChange, publishStockChange } from '../../api/listings';

interface StockPreviewResponse {
  listing_id: number;
  current_quantity: number;
  new_quantity: number;
  days_of_cover: number | null;
  stockout_risk: string;
  guardrails: {
    passed: boolean;
    violations: Array<{ rule: string; threshold: number; actual: number; message: string }>;
  };
}

interface StockEditModalProps {
  listing: ListingWithFeatures;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function StockEditModal({ listing, isOpen, onClose, onSuccess }: StockEditModalProps) {
  const currentQuantity = listing.features?.available_quantity ?? 0;
  const [newQuantity, setNewQuantity] = useState<string>(currentQuantity.toString());
  const [reason, setReason] = useState<string>('');
  const [preview, setPreview] = useState<StockPreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNewQuantity(currentQuantity.toString());
      setReason('');
      setPreview(null);
      setError(null);
    }
  }, [isOpen, currentQuantity]);

  const handlePreview = async () => {
    const quantityValue = parseInt(newQuantity, 10);
    if (isNaN(quantityValue) || quantityValue < 0) {
      setError('Please enter a valid quantity');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await previewStockChange(listing.id, quantityValue) as StockPreviewResponse;
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!preview || !reason.trim()) {
      setError('Please provide a reason for the stock change');
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      await publishStockChange(listing.id, {
        available_quantity: parseInt(newQuantity, 10),
        reason: reason.trim(),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  if (!isOpen) return null;

  const quantityChange = preview ? preview.new_quantity - preview.current_quantity : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/30"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-semibold mb-4">Edit Stock</h2>

          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{listing.seller_sku}</span> - {listing.title}
            </p>
            <p className="text-sm text-gray-500">
              Current quantity: {currentQuantity} units
            </p>
          </div>

          {/* Quantity input */}
          <div className="mb-4">
            <label className="label">New Quantity</label>
            <input
              type="number"
              step="1"
              min="0"
              className="input"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
            />
          </div>

          {/* Preview button */}
          {!preview && (
            <button
              onClick={handlePreview}
              disabled={isLoading}
              className="btn btn-secondary w-full mb-4"
            >
              {isLoading ? 'Loading...' : 'Preview Change'}
            </button>
          )}

          {/* Preview results */}
          {preview && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium mb-2">Preview Results</h3>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-600">Current Quantity:</span>
                <span>{preview.current_quantity} units</span>

                <span className="text-gray-600">New Quantity:</span>
                <span className="font-medium">{preview.new_quantity} units</span>

                <span className="text-gray-600">Change:</span>
                <span className={quantityChange > 0 ? 'text-green-600' : quantityChange < 0 ? 'text-red-600' : ''}>
                  {quantityChange > 0 ? '+' : ''}{quantityChange} units
                </span>

                {preview.days_of_cover !== null && (
                  <>
                    <span className="text-gray-600">Days of Cover:</span>
                    <span>{preview.days_of_cover} days</span>
                  </>
                )}

                <span className="text-gray-600">Stockout Risk:</span>
                <span className={
                  preview.stockout_risk === 'HIGH' ? 'text-red-600 font-medium' :
                  preview.stockout_risk === 'MEDIUM' ? 'text-amber-600' :
                  'text-green-600'
                }>{preview.stockout_risk}</span>
              </div>

              {/* Guardrails */}
              {!preview.guardrails.passed && (
                <div className="mt-3 p-3 bg-red-50 rounded border border-red-200">
                  <p className="text-sm font-medium text-red-800 mb-1">Guardrail Violations</p>
                  {preview.guardrails.violations.map((v, i) => (
                    <p key={i} className="text-xs text-red-700">{v.message}</p>
                  ))}
                </div>
              )}

              {preview.guardrails.passed && (
                <div className="mt-3 p-3 bg-green-50 rounded border border-green-200">
                  <p className="text-sm text-green-800">All guardrails passed</p>
                </div>
              )}
            </div>
          )}

          {/* Reason input (required for publish) */}
          {preview && (
            <div className="mb-4">
              <label className="label">Reason for change *</label>
              <textarea
                className="input"
                rows={2}
                placeholder="e.g., Stock replenishment; received 50 units"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            {preview && (
              <button
                onClick={handlePublish}
                disabled={isPublishing || !preview.guardrails.passed || !reason.trim()}
                className="btn btn-primary"
              >
                {isPublishing ? 'Publishing...' : 'Publish Change'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
