import { useState, useEffect, useRef } from 'react';
import type { ListingWithFeatures, PricePreviewResponse } from '../../types';
import { previewPriceChange, publishPriceChange } from '../../api/listings';

interface PriceEditModalProps {
  listing: ListingWithFeatures;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PriceEditModal({ listing, isOpen, onClose, onSuccess }: PriceEditModalProps) {
  const currentPrice = listing.features?.price_inc_vat ?? 0;
  const [newPrice, setNewPrice] = useState<string>(currentPrice.toFixed(2));
  const [reason, setReason] = useState<string>('');
  const [preview, setPreview] = useState<PricePreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // T.5 FIX: Ref for focus management
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNewPrice(currentPrice.toFixed(2));
      setReason('');
      setPreview(null);
      setError(null);
      // T.5 FIX: Focus price input when modal opens
      setTimeout(() => priceInputRef.current?.focus(), 0);
    }
  }, [isOpen, currentPrice]);

  // T.3 FIX: Clear preview when price changes
  const handlePriceChange = (value: string) => {
    setNewPrice(value);
    // If preview exists and price changed, clear it to force re-preview
    if (preview) {
      setPreview(null);
      setError(null);
    }
  };

  const handlePreview = async () => {
    const priceValue = parseFloat(newPrice);
    if (isNaN(priceValue) || priceValue <= 0) {
      setError('Please enter a valid price');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await previewPriceChange(listing.id, priceValue);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!preview || !reason.trim()) {
      setError('Please provide a reason for the price change');
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      await publishPriceChange(listing.id, {
        price_inc_vat: parseFloat(newPrice),
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
          <h2 className="text-lg font-semibold mb-4">Edit Price</h2>

          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{listing.seller_sku}</span> - {listing.title}
            </p>
            <p className="text-sm text-gray-500">
              Current price: £{currentPrice.toFixed(2)}
            </p>
          </div>

          {/* Price input */}
          <div className="mb-4">
            <label className="label">New Price (inc VAT)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
              <input
                ref={priceInputRef}
                type="number"
                step="0.01"
                min="0"
                className="input pl-7"
                value={newPrice}
                onChange={(e) => handlePriceChange(e.target.value)}
                onKeyDown={(e) => {
                  // T.4 FIX: Allow Enter key to trigger preview (if no preview) or submit
                  if (e.key === 'Enter' && !isLoading && !isPublishing) {
                    e.preventDefault();
                    if (!preview) {
                      handlePreview();
                    }
                  }
                }}
              />
            </div>
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
                <span className="text-gray-600">New Price:</span>
                <span className="font-medium">£{preview.economics.price_inc_vat.toFixed(2)}</span>

                <span className="text-gray-600">Price (ex VAT):</span>
                <span>£{preview.economics.price_ex_vat.toFixed(2)}</span>

                <span className="text-gray-600">Profit:</span>
                <span className={preview.economics.profit_ex_vat < 0 ? 'text-red-600' : 'text-green-600'}>
                  £{preview.economics.profit_ex_vat.toFixed(2)}
                </span>

                <span className="text-gray-600">Margin:</span>
                <span>{(preview.economics.margin * 100).toFixed(1)}%</span>
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
                placeholder="e.g., Regain Buy Box; competitor at £19.50"
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
