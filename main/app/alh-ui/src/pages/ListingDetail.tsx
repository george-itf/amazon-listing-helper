import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { BuyBoxBadge, RiskBadge } from '../components/badges';
import { PriceEditModal } from '../components/modals/PriceEditModal';
import { StockEditModal } from '../components/modals/StockEditModal';
import { getListingWithFeatures, getListingEconomics } from '../api/listings';
import { getListingRecommendations } from '../api/recommendations';
import type { ListingWithFeatures, EconomicsResponse, Recommendation } from '../types';

export function ListingDetailPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const [listing, setListing] = useState<ListingWithFeatures | null>(null);
  const [economics, setEconomics] = useState<EconomicsResponse | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!listingId) return;

      setIsLoading(true);
      setError(null);

      try {
        const id = parseInt(listingId);
        const [listingData, economicsData, recsData] = await Promise.all([
          getListingWithFeatures(id),
          getListingEconomics(id).catch(() => null),
          getListingRecommendations(id).catch(() => []),
        ]);

        setListing(listingData);
        setEconomics(economicsData);
        setRecommendations(recsData);
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
    ]).then(([listingData, economicsData, recsData]) => {
      setListing(listingData);
      setEconomics(economicsData);
      setRecommendations(recsData);
    });
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
        title={listing.seller_sku}
        subtitle={listing.title}
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
                    <div>
                      <p className="font-medium">{rec.title}</p>
                      <p className="text-sm text-gray-600">{rec.description}</p>
                    </div>
                    <RiskBadge
                      level={rec.severity === 'CRITICAL' ? 'HIGH' : rec.severity}
                      label={rec.severity}
                    />
                  </div>
                  {rec.evidence_json?.computed_at && (
                    <p className="text-xs text-gray-400 mt-2">
                      Evidence computed at: {new Date(rec.evidence_json.computed_at).toLocaleString()}
                    </p>
                  )}
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
