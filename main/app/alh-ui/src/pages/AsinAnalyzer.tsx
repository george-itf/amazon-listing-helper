import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { analyzeAsin, trackAsin, getTrackedAsins, convertAsinToListing } from '../api/asins';
import type { AsinAnalysis, AsinEntity } from '../api/asins';

export function AsinAnalyzerPage() {
  const navigate = useNavigate();
  const [asinInput, setAsinInput] = useState('');
  const [analysis, setAnalysis] = useState<AsinAnalysis | null>(null);
  const [trackedAsins, setTrackedAsins] = useState<AsinEntity[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isLoadingTracked, setIsLoadingTracked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Convert form state
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertSku, setConvertSku] = useState('');
  const [convertPrice, setConvertPrice] = useState('');
  const [convertQuantity, setConvertQuantity] = useState('100');

  // Load tracked ASINs on mount
  useEffect(() => {
    loadTrackedAsins();
  }, []);

  const loadTrackedAsins = async () => {
    setIsLoadingTracked(true);
    try {
      const tracked = await getTrackedAsins();
      setTrackedAsins(tracked);
    } catch (err) {
      console.error('Failed to load tracked ASINs:', err);
    } finally {
      setIsLoadingTracked(false);
    }
  };

  const handleAnalyze = async () => {
    const asin = asinInput.trim().toUpperCase();
    if (!asin || asin.length !== 10) {
      setError('Please enter a valid 10-character ASIN');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const result = await analyzeAsin(asin);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTrack = async () => {
    if (!analysis) return;

    try {
      await trackAsin(analysis.asin);
      await loadTrackedAsins();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to track ASIN');
    }
  };

  const handleConvert = async () => {
    if (!analysis || !convertSku.trim() || !convertPrice) {
      setError('Please fill in all required fields');
      return;
    }

    setIsConverting(true);
    setError(null);

    try {
      const result = await convertAsinToListing(analysis.asin_entity_id, {
        seller_sku: convertSku.trim(),
        initial_price_inc_vat: parseFloat(convertPrice),
        initial_quantity: parseInt(convertQuantity) || 100,
      });
      navigate(`/listings/${result.listing_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setIsConverting(false);
    }
  };

  const handleAnalyzeTracked = (asin: string) => {
    setAsinInput(asin);
    setAnalysis(null);
    // Auto-analyze
    setTimeout(() => {
      const btn = document.querySelector('[data-analyze-btn]') as HTMLButtonElement;
      btn?.click();
    }, 100);
  };

  return (
    <div>
      <PageHeader
        title="ASIN Analyzer"
        subtitle="Research new products and convert to listings"
        actions={
          <button onClick={loadTrackedAsins} className="btn btn-secondary btn-sm">
            Refresh
          </button>
        }
      />

      {/* Search */}
      <div className="card mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Enter ASIN (e.g., B08N5WRWNW)"
            className="input flex-1"
            value={asinInput}
            onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            maxLength={10}
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="btn btn-primary"
            data-analyze-btn
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {error && (
          <p className="text-red-600 text-sm mt-2">{error}</p>
        )}
      </div>

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-6 mb-6">
          {/* Product Info Header */}
          {analysis.market_data && (
            <div className="card">
              <div className="flex gap-4">
                {analysis.market_data.main_image_url && (
                  <img
                    src={analysis.market_data.main_image_url}
                    alt={analysis.market_data.title || analysis.asin}
                    className="w-24 h-24 object-contain rounded border"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">
                    {analysis.market_data.title || analysis.asin}
                  </h3>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600 mt-1">
                    {analysis.market_data.brand && (
                      <span>Brand: <strong>{analysis.market_data.brand}</strong></span>
                    )}
                    {analysis.market_data.category && (
                      <span>Category: <strong>{analysis.market_data.category}</strong></span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm mt-2">
                    <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{analysis.asin}</span>
                    {analysis.market_data.rating != null && (
                      <span className="flex items-center gap-1">
                        <span className="text-yellow-500">★</span>
                        {analysis.market_data.rating.toFixed(1)}
                        {analysis.market_data.rating_count != null && (
                          <span className="text-gray-500">({analysis.market_data.rating_count.toLocaleString()} reviews)</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Current Prices */}
            <div className="card">
              <h3 className="font-semibold mb-4">Current Prices</h3>
              <div className="space-y-3">
                {analysis.market_data?.buy_box_price != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Buy Box Price</span>
                    <span className="font-semibold text-lg">£{analysis.market_data.buy_box_price.toFixed(2)}</span>
                  </div>
                )}
                {analysis.market_data?.price_current != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">New Price</span>
                    <span>£{analysis.market_data.price_current.toFixed(2)}</span>
                  </div>
                )}
                {analysis.market_data?.price_amazon != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amazon Price</span>
                    <span>£{analysis.market_data.price_amazon.toFixed(2)}</span>
                  </div>
                )}
                {analysis.market_data?.buy_box_is_amazon != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Buy Box Owner</span>
                    <span className={analysis.market_data.buy_box_is_amazon ? 'text-orange-600' : 'text-blue-600'}>
                      {analysis.market_data.buy_box_is_amazon ? 'Amazon' : '3rd Party'}
                    </span>
                  </div>
                )}
                {analysis.market_data?.last_price_change && (
                  <div className="text-xs text-gray-400 pt-2 border-t">
                    Last change: {new Date(analysis.market_data.last_price_change).toLocaleDateString()}
                  </div>
                )}
                {!analysis.market_data?.buy_box_price && !analysis.market_data?.price_current && (
                  <p className="text-gray-500 text-sm">No price data available yet</p>
                )}
              </div>
            </div>

            {/* Price History (90d) */}
            <div className="card">
              <h3 className="font-semibold mb-4">Price History (90 days)</h3>
              <div className="space-y-3">
                {analysis.market_data?.keepa_price_median_90d != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Median</span>
                    <span className="font-semibold">£{analysis.market_data.keepa_price_median_90d.toFixed(2)}</span>
                  </div>
                )}
                {(analysis.market_data?.keepa_price_min_90d != null || analysis.market_data?.keepa_price_max_90d != null) && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Min / Max</span>
                    <span>
                      £{analysis.market_data?.keepa_price_min_90d?.toFixed(2) ?? '-'} / £{analysis.market_data?.keepa_price_max_90d?.toFixed(2) ?? '-'}
                    </span>
                  </div>
                )}
                {(analysis.market_data?.keepa_price_p25_90d != null || analysis.market_data?.keepa_price_p75_90d != null) && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">25th-75th %ile</span>
                    <span>
                      £{analysis.market_data?.keepa_price_p25_90d?.toFixed(2) ?? '-'} - £{analysis.market_data?.keepa_price_p75_90d?.toFixed(2) ?? '-'}
                    </span>
                  </div>
                )}
                {analysis.market_data?.keepa_volatility_90d != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Volatility</span>
                    <span className={
                      analysis.market_data.keepa_volatility_90d > 0.15 ? 'text-red-600' :
                      analysis.market_data.keepa_volatility_90d > 0.08 ? 'text-yellow-600' :
                      'text-green-600'
                    }>
                      {(analysis.market_data.keepa_volatility_90d * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
                {!analysis.market_data?.keepa_price_median_90d && (
                  <p className="text-gray-500 text-sm">No price history available yet</p>
                )}
              </div>
            </div>

            {/* Sales Rank */}
            <div className="card">
              <h3 className="font-semibold mb-4">Sales Rank</h3>
              <div className="space-y-3">
                {analysis.market_data?.sales_rank_current != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Current Rank</span>
                    <span className="font-semibold">#{analysis.market_data.sales_rank_current.toLocaleString()}</span>
                  </div>
                )}
                {analysis.market_data?.sales_rank_avg_90d != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Rank (90d)</span>
                    <span>#{Math.round(analysis.market_data.sales_rank_avg_90d).toLocaleString()}</span>
                  </div>
                )}
                {analysis.market_data?.keepa_rank_trend_90d != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Rank Trend</span>
                    <span className={
                      analysis.market_data.keepa_rank_trend_90d < 0 ? 'text-green-600' :
                      analysis.market_data.keepa_rank_trend_90d > 0 ? 'text-red-600' :
                      ''
                    }>
                      {analysis.market_data.keepa_rank_trend_90d > 0 ? '+' : ''}
                      {(analysis.market_data.keepa_rank_trend_90d * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
                {analysis.market_data?.out_of_stock_percentage_90d != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Out of Stock %</span>
                    <span className={analysis.market_data.out_of_stock_percentage_90d > 10 ? 'text-yellow-600' : ''}>
                      {analysis.market_data.out_of_stock_percentage_90d.toFixed(0)}%
                    </span>
                  </div>
                )}
                {!analysis.market_data?.sales_rank_current && (
                  <p className="text-gray-500 text-sm">No sales rank data available yet</p>
                )}
              </div>
            </div>

            {/* Competition */}
            <div className="card">
              <h3 className="font-semibold mb-4">Competition</h3>
              <div className="space-y-3">
                {analysis.market_data?.keepa_offers_count_current != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Offers</span>
                    <span className="font-semibold">{analysis.market_data.keepa_offers_count_current}</span>
                  </div>
                )}
                {analysis.market_data?.offers_fba_count != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">FBA Offers</span>
                    <span>{analysis.market_data.offers_fba_count}</span>
                  </div>
                )}
                {analysis.market_data?.offers_fbm_count != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">FBM Offers</span>
                    <span>{analysis.market_data.offers_fbm_count}</span>
                  </div>
                )}
                {!analysis.market_data?.keepa_offers_count_current && (
                  <p className="text-gray-500 text-sm">No offer data available yet</p>
                )}
              </div>
            </div>

            {/* Economics Scenario */}
            <div className="card">
              <h3 className="font-semibold mb-4">Your Economics (Scenario)</h3>
              {analysis.economics_scenario ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Suggested Price</span>
                    <span className="font-semibold">
                      £{analysis.economics_scenario.suggested_price_inc_vat.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">BOM Cost</span>
                    <span>£{analysis.economics_scenario.bom_cost_ex_vat.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Est. Fees</span>
                    <span>£{analysis.economics_scenario.estimated_fees_ex_vat.toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Est. Profit</span>
                      <span className={
                        analysis.economics_scenario.estimated_profit_ex_vat < 0
                          ? 'text-red-600 font-semibold'
                          : 'text-green-600 font-semibold'
                      }>
                        £{analysis.economics_scenario.estimated_profit_ex_vat.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Est. Margin</span>
                      <span className="font-semibold">
                        {(analysis.economics_scenario.estimated_margin * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Create a scenario BOM to see profit estimates</p>
              )}
            </div>

            {/* Opportunity Assessment */}
            <div className="card">
              <h3 className="font-semibold mb-4">Opportunity Assessment</h3>
              {analysis.opportunity_score != null ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Score</span>
                    <span className={`text-2xl font-bold ${
                      analysis.opportunity_score >= 0.7 ? 'text-green-600' :
                      analysis.opportunity_score >= 0.4 ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {(analysis.opportunity_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {analysis.recommendation && (
                    <p className="text-sm text-gray-700">{analysis.recommendation}</p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Score will be calculated after Keepa data sync</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="card">
            <div className="flex flex-wrap gap-3">
              <button onClick={handleTrack} className="btn btn-secondary">
                Track ASIN
              </button>
              <button
                onClick={() => setShowConvertForm(true)}
                className="btn btn-primary"
              >
                Convert to Listing
              </button>
              <a
                href={`https://www.amazon.co.uk/dp/${analysis.asin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                View on Amazon ↗
              </a>
              <a
                href={`https://keepa.com/#!product/2-${analysis.asin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                View on Keepa ↗
              </a>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Analyzed at: {new Date(analysis.analyzed_at).toLocaleString()}
              {analysis.market_data?.last_update && (
                <> • Keepa data: {new Date(analysis.market_data.last_update).toLocaleString()}</>
              )}
            </p>
          </div>

          {/* Convert Form */}
          {showConvertForm && (
            <div className="card lg:col-span-2">
              <h3 className="font-semibold mb-4">Convert to Listing</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Seller SKU *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="YOUR-SKU-001"
                    value={convertSku}
                    onChange={(e) => setConvertSku(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Initial Price (inc VAT) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                    <input
                      type="number"
                      step="0.01"
                      className="input pl-7"
                      value={convertPrice}
                      onChange={(e) => setConvertPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Initial Quantity</label>
                  <input
                    type="number"
                    className="input"
                    value={convertQuantity}
                    onChange={(e) => setConvertQuantity(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleConvert}
                  disabled={isConverting}
                  className="btn btn-primary"
                >
                  {isConverting ? 'Converting...' : 'Create Listing'}
                </button>
                <button
                  onClick={() => setShowConvertForm(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Research Pool - Tracked ASINs */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Research Pool ({trackedAsins.length} tracked)</h3>
        </div>

        {isLoadingTracked ? (
          <p className="text-gray-500 text-center py-8">Loading tracked ASINs...</p>
        ) : trackedAsins.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No ASINs tracked yet. Analyze an ASIN above and click "Track ASIN" to add it to your research pool.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>ASIN</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {trackedAsins.map((asin) => (
                  <tr key={asin.id}>
                    <td className="font-mono">{asin.asin}</td>
                    <td className="max-w-xs truncate">{asin.title || '-'}</td>
                    <td>{asin.category || '-'}</td>
                    <td>
                      <span className={`badge ${
                        asin.status === 'READY' ? 'badge-success' :
                        asin.status === 'CONVERTED' ? 'badge-info' :
                        asin.status === 'ANALYZING' ? 'badge-warning' :
                        'badge-neutral'
                      }`}>
                        {asin.status}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleAnalyzeTracked(asin.asin)}
                        className="btn btn-ghost btn-xs"
                      >
                        Analyze
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
