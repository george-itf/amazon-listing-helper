import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { BuyBoxBadge, RiskBadge } from '../components/badges';
import { PriceEditModal } from '../components/modals/PriceEditModal';
import { StockEditModal } from '../components/modals/StockEditModal';
import { getListingWithFeatures, getListingEconomics } from '../api/listings';
import { getListingRecommendations } from '../api/recommendations';
import {
  getActiveBomForListing,
  getComponents,
  createBom,
  updateBomLines,
} from '../api/boms';
import type { ListingWithFeatures, EconomicsResponse, Recommendation } from '../types';
import type { Bom, Component } from '../api/boms';
import {
  getRecommendationTitle,
  getRecommendationDescription,
  getRecommendationActionText,
} from '../types/recommendations';

export function ListingDetailPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const [listing, setListing] = useState<ListingWithFeatures | null>(null);
  const [economics, setEconomics] = useState<EconomicsResponse | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

  // BOM state
  const [bom, setBom] = useState<Bom | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [isBomEditing, setIsBomEditing] = useState(false);
  const [bomLines, setBomLines] = useState<Array<{ component_id: number; quantity: number; wastage_rate: number }>>([]);
  const [isBomSaving, setIsBomSaving] = useState(false);
  const [bomError, setBomError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!listingId) return;

      setIsLoading(true);
      setError(null);

      try {
        const id = parseInt(listingId);
        const [listingData, economicsData, recsData, bomData, componentsData] = await Promise.all([
          getListingWithFeatures(id),
          getListingEconomics(id).catch(() => null),
          getListingRecommendations(id).catch(() => []),
          getActiveBomForListing(id).catch(() => null),
          getComponents().catch(() => []),
        ]);

        setListing(listingData);
        setEconomics(economicsData);
        setRecommendations(recsData);
        setBom(bomData);
        setComponents(componentsData);

        // Initialize BOM lines from existing BOM
        if (bomData?.lines) {
          setBomLines(bomData.lines.map(line => ({
            component_id: line.component_id,
            quantity: line.quantity,
            wastage_rate: line.wastage_rate,
          })));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load listing');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [listingId]);

  const reloadData = () => {
    if (!listingId) return;
    const id = parseInt(listingId);
    Promise.all([
      getListingWithFeatures(id),
      getListingEconomics(id).catch(() => null),
      getListingRecommendations(id).catch(() => []),
      getActiveBomForListing(id).catch(() => null),
    ]).then(([listingData, economicsData, recsData, bomData]) => {
      setListing(listingData);
      setEconomics(economicsData);
      setRecommendations(recsData);
      setBom(bomData);
      if (bomData?.lines) {
        setBomLines(bomData.lines.map(line => ({
          component_id: line.component_id,
          quantity: line.quantity,
          wastage_rate: line.wastage_rate,
        })));
      }
    });
  };

  // BOM handlers
  const handleAddBomLine = () => {
    setBomLines([...bomLines, { component_id: 0, quantity: 1, wastage_rate: 0 }]);
  };

  const handleRemoveBomLine = (index: number) => {
    setBomLines(bomLines.filter((_, i) => i !== index));
  };

  const handleBomLineChange = (index: number, field: 'component_id' | 'quantity' | 'wastage_rate', value: number) => {
    const newLines = [...bomLines];
    newLines[index] = { ...newLines[index], [field]: value };
    setBomLines(newLines);
  };

  const handleSaveBom = async () => {
    if (!listingId) return;

    // Filter out lines without a component selected
    const validLines = bomLines.filter(line => line.component_id > 0);
    if (validLines.length === 0) {
      setBomError('Please add at least one component to the BOM');
      return;
    }

    setIsBomSaving(true);
    setBomError(null);

    try {
      const id = parseInt(listingId);

      if (bom) {
        // Update existing BOM lines (creates new version, auto-activated)
        await updateBomLines(bom.id, { lines: validLines });
      } else {
        // Create new BOM (createVersion already sets is_active=true)
        await createBom({
          listing_id: id,
          scope_type: 'LISTING',
          lines: validLines,
        });
      }

      setIsBomEditing(false);
      reloadData();
    } catch (err) {
      setBomError(err instanceof Error ? err.message : 'Failed to save BOM');
    } finally {
      setIsBomSaving(false);
    }
  };

  const handleCancelBomEdit = () => {
    setIsBomEditing(false);
    setBomError(null);
    // Reset lines to original BOM
    if (bom?.lines) {
      setBomLines(bom.lines.map(line => ({
        component_id: line.component_id,
        quantity: line.quantity,
        wastage_rate: line.wastage_rate,
      })));
    } else {
      setBomLines([]);
    }
  };

  const calculateBomTotal = () => {
    return bomLines.reduce((total, line) => {
      const component = components.find(c => c.id === line.component_id);
      if (!component) return total;
      const lineCost = line.quantity * (1 + line.wastage_rate) * (Number(component.unit_cost_ex_vat) || 0);
      return total + lineCost;
    }, 0);
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>Loading listing...</p>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error || 'Listing not found'}</p>
        <Link to="/listings" className="btn btn-primary btn-sm">
          Back to Listings
        </Link>
      </div>
    );
  }

  const f = listing.features;

  return (
    <div>
      <PageHeader
        title={listing.title || 'Untitled Listing'}
        subtitle={listing.seller_sku}
        actions={
          <Link to="/listings" className="btn btn-secondary btn-sm">
            Back to Listings
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Price & Buy Box */}
        <div className="card">
          <h3 className="font-semibold mb-4">Price & Buy Box</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Current Price (inc VAT)</span>
              <span className="font-semibold">£{f?.price_inc_vat?.toFixed(2) ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Buy Box Status</span>
              {f ? <BuyBoxBadge status={f.buy_box_status} /> : '-'}
            </div>
            {f?.buy_box_percentage_30d != null && (
              <div className="flex justify-between">
                <span className="text-gray-600">Buy Box % (30d)</span>
                <span>{f.buy_box_percentage_30d.toFixed(1)}%</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">Buy Box Risk</span>
              {f?.buy_box_risk ? <RiskBadge level={f.buy_box_risk} /> : '-'}
            </div>
          </div>
          <button
            onClick={() => setIsPriceModalOpen(true)}
            className="btn btn-primary btn-sm mt-4 w-full"
          >
            Edit Price
          </button>
        </div>

        {/* Stock */}
        <div className="card">
          <h3 className="font-semibold mb-4">Stock</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Available Quantity</span>
              <span className="font-semibold">{f?.available_quantity ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Sales Velocity (per day)</span>
              <span>{f?.sales_velocity_units_per_day_30d?.toFixed(1) ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Days of Cover</span>
              <span>{f?.days_of_cover != null ? `${f.days_of_cover} days` : '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Stock Risk</span>
              {f?.stockout_risk ? <RiskBadge level={f.stockout_risk} /> : '-'}
            </div>
          </div>
          <button
            onClick={() => setIsStockModalOpen(true)}
            className="btn btn-primary btn-sm mt-4 w-full"
          >
            Edit Stock
          </button>
        </div>

        {/* Economics */}
        <div className="card">
          <h3 className="font-semibold mb-4">Economics</h3>
          {economics ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">BOM Cost (ex VAT)</span>
                <span>£{economics.bom_cost_ex_vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Amazon Fees (ex VAT)</span>
                <span>£{economics.amazon_fees_ex_vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Cost (ex VAT)</span>
                <span>£{economics.total_cost_ex_vat.toFixed(2)}</span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Profit (ex VAT)</span>
                  <span className={economics.profit_ex_vat < 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                    £{economics.profit_ex_vat.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margin</span>
                  <span className="font-semibold">{(economics.margin * 100).toFixed(1)}%</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Computed at: {new Date(economics.computed_at).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-gray-500">Economics data not available</p>
          )}
        </div>

        {/* Bill of Materials */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Bill of Materials (BOM)</h3>
            {!isBomEditing && (
              <button
                onClick={() => setIsBomEditing(true)}
                className="btn btn-primary btn-sm"
              >
                {bom ? 'Edit BOM' : 'Create BOM'}
              </button>
            )}
          </div>

          {bomError && (
            <div className="mb-4 p-2 bg-red-50 text-red-600 rounded text-sm">
              {bomError}
            </div>
          )}

          {isBomEditing ? (
            <div className="space-y-4">
              {bomLines.length === 0 ? (
                <p className="text-gray-500 text-sm">No components added yet. Click "Add Component" to start.</p>
              ) : (
                <div className="space-y-2">
                  {bomLines.map((line, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        className="input flex-1"
                        value={line.component_id}
                        onChange={(e) => handleBomLineChange(index, 'component_id', parseInt(e.target.value))}
                      >
                        <option value={0}>Select component...</option>
                        {components.map(comp => (
                          <option key={comp.id} value={comp.id}>
                            {comp.component_sku} - {comp.name} (£{(Number(comp.unit_cost_ex_vat) || 0).toFixed(2)})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="input w-20"
                        placeholder="Qty"
                        min="0.01"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => handleBomLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        type="number"
                        className="input w-20"
                        placeholder="Wastage %"
                        min="0"
                        max="0.99"
                        step="0.01"
                        value={line.wastage_rate}
                        onChange={(e) => handleBomLineChange(index, 'wastage_rate', parseFloat(e.target.value) || 0)}
                        title="Wastage rate (e.g., 0.05 = 5%)"
                      />
                      <button
                        onClick={() => handleRemoveBomLine(index)}
                        className="text-red-600 hover:text-red-800 px-2"
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t">
                <button
                  onClick={handleAddBomLine}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  + Add Component
                </button>
                <span className="font-medium">
                  Total: £{calculateBomTotal().toFixed(2)}
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveBom}
                  disabled={isBomSaving}
                  className="btn btn-primary btn-sm"
                >
                  {isBomSaving ? 'Saving...' : 'Save BOM'}
                </button>
                <button
                  onClick={handleCancelBomEdit}
                  disabled={isBomSaving}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
              </div>

              {components.length === 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  No components found. <Link to="/bom-library" className="text-blue-600 hover:underline">Add components</Link> first.
                </p>
              )}
            </div>
          ) : bom ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-500 mb-2">
                Version {bom.version} • {bom.is_active ? 'Active' : 'Inactive'}
              </div>
              {bom.lines.length === 0 ? (
                <p className="text-gray-500">No components in this BOM</p>
              ) : (
                <div className="divide-y">
                  {bom.lines.map((line) => (
                    <div key={line.id} className="py-2 flex justify-between">
                      <span>
                        {line.component_name || line.component?.name || `Component #${line.component_id}`}
                        <span className="text-gray-500 text-sm ml-2">
                          × {line.quantity}{line.wastage_rate > 0 ? ` (+${(line.wastage_rate * 100).toFixed(0)}% wastage)` : ''}
                        </span>
                      </span>
                      <span className="font-medium">
                        £{(Number(line.line_cost_ex_vat) || (line.quantity * (1 + line.wastage_rate) * (Number(line.unit_cost_ex_vat) || Number(line.component?.unit_cost_ex_vat) || 0))).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-2 border-t flex justify-between font-medium">
                <span>Total BOM Cost</span>
                <span>£{(Number(bom.total_cost_ex_vat) || 0).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-500 mb-2">No BOM configured for this listing</p>
              <p className="text-sm text-gray-400">
                Create a BOM to track component costs and calculate accurate profit margins.
              </p>
            </div>
          )}
        </div>

        {/* Keepa & Competition */}
        <div className="card">
          <h3 className="font-semibold mb-4">Keepa & Competition</h3>
          {f?.keepa_price_median_90d != null ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Price Median (90d)</span>
                <span>£{f.keepa_price_median_90d?.toFixed(2) ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Price Range (P25-P75)</span>
                <span>
                  £{f.keepa_price_p25_90d?.toFixed(2) ?? '-'} - £{f.keepa_price_p75_90d?.toFixed(2) ?? '-'}
                </span>
              </div>
              {f.keepa_volatility_90d != null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Volatility (90d)</span>
                  <span>{(f.keepa_volatility_90d * 100).toFixed(1)}%</span>
                </div>
              )}
              {f.keepa_offers_count_current != null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Current Offers</span>
                  <span>{f.keepa_offers_count_current}</span>
                </div>
              )}
              {f.competitor_price_position && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Price Position</span>
                  <span className={
                    f.competitor_price_position === 'ABOVE_BAND' ? 'text-red-600' :
                    f.competitor_price_position === 'BELOW_BAND' ? 'text-green-600' :
                    'text-gray-900'
                  }>
                    {f.competitor_price_position.replace('_', ' ')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Keepa data not available</p>
          )}
        </div>

        {/* Recommendations */}
        <div className="card lg:col-span-2">
          <h3 className="font-semibold mb-4">Recommendations</h3>
          {recommendations.length > 0 ? (
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <div key={rec.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 mr-3">
                      <p className="font-medium">{getRecommendationTitle(rec)}</p>
                      <p className="text-sm text-gray-600">{getRecommendationDescription(rec)}</p>
                      <p className="text-sm text-blue-600 mt-1">{getRecommendationActionText(rec)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <RiskBadge
                        level={rec.confidence as 'LOW' | 'MEDIUM' | 'HIGH'}
                        label={rec.confidence}
                      />
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        rec.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        rec.status === 'ACCEPTED' ? 'bg-green-100 text-green-700' :
                        rec.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {rec.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-2 flex justify-between">
                    <span>Confidence: {(rec.confidence_score * 100).toFixed(0)}%</span>
                    <span>Generated: {new Date(rec.generated_at || rec.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No recommendations for this listing</p>
          )}
        </div>
      </div>

      {/* Modals */}
      {listing && (
        <>
          <PriceEditModal
            listing={listing}
            isOpen={isPriceModalOpen}
            onClose={() => setIsPriceModalOpen(false)}
            onSuccess={reloadData}
          />
          <StockEditModal
            listing={listing}
            isOpen={isStockModalOpen}
            onClose={() => setIsStockModalOpen(false)}
            onSuccess={reloadData}
          />
        </>
      )}
    </div>
  );
}
