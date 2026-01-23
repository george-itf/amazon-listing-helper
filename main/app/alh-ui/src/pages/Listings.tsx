import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { ListingsTable } from '../components/tables/ListingsTable';
import { PriceEditModal } from '../components/modals/PriceEditModal';
import { getListingsWithFeatures } from '../api/listings';
import { syncListingsFromAmazon, testSpApiConnection, getSyncStatus } from '../api/sync';
import type { ListingWithFeatures } from '../types';

// Search icon component
function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

export function ListingsPage() {
  const [listings, setListings] = useState<ListingWithFeatures[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithFeatures | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [spApiConfigured, setSpApiConfigured] = useState<boolean | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [kpiFilter, setKpiFilter] = useState<'ALL' | 'AT_RISK' | 'BUY_BOX_WON' | null>(null);

  const loadListings = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getListingsWithFeatures();
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setIsLoading(false);
    }
  };

  const checkSyncStatus = async () => {
    try {
      const status = await getSyncStatus();
      setSpApiConfigured(status.spApiConfigured);
    } catch {
      // Ignore errors checking status
    }
  };

  const handleSyncFromAmazon = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncMessage('Testing Amazon SP-API connection...');

    try {
      // First test the connection
      const testResult = await testSpApiConnection();

      if (!testResult.configured) {
        throw new Error('SP-API credentials not configured. Please set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, and SP_API_REFRESH_TOKEN in Railway environment variables.');
      }

      if (!testResult.success) {
        throw new Error(`SP-API connection failed: ${testResult.error}`);
      }

      setSyncMessage('Connection OK. Requesting listings report from Amazon... This may take 2-5 minutes.');

      const result = await syncListingsFromAmazon();

      if (result.listingsProcessed === 0) {
        setSyncMessage('Sync complete but no listings found. Make sure you have active listings in Seller Central.');
      } else {
        setSyncMessage(
          `Sync complete: ${result.listingsCreated} created, ${result.listingsUpdated} updated (${result.listingsProcessed} total)`
        );
      }

      // Reload listings after sync
      await loadListings();
      // Clear success message after 10 seconds
      setTimeout(() => setSyncMessage(null), 10000);
    } catch (err) {
      // Handle both Error instances and ApiError objects from the axios interceptor
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object' && 'message' in err) {
        message = (err as { message: string }).message;
      } else {
        message = 'Failed to sync from Amazon';
      }
      setError(message);
      setSyncMessage(null);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadListings();
    checkSyncStatus();
  }, []);

  const handleEditPrice = (listing: ListingWithFeatures) => {
    setSelectedListing(listing);
    setIsPriceModalOpen(true);
  };

  const handlePriceChangeSuccess = () => {
    // Reload listings to get updated data
    loadListings();
  };

  // D.3 FIX: Memoize stats to avoid recalculation on every render
  const stats = useMemo(() => ({
    total: listings.length,
    active: listings.filter((l) => l.status === 'ACTIVE').length,
    inactive: listings.filter((l) => l.status === 'INACTIVE').length,
    buyBoxWon: listings.filter((l) => l.features?.buy_box_status === 'WON').length,
    atRisk: listings.filter(
      (l) =>
        l.features?.buy_box_risk === 'HIGH' ||
        l.features?.stockout_risk === 'HIGH' ||
        (l.features?.margin != null && l.features.margin < 0.15)
    ).length,
  }), [listings]);

  // D.3 FIX: Memoize filtered listings to avoid recalculation on every render
  const filteredListings = useMemo(() => {
    let result = listings;

    // Apply status filter (tabs)
    if (statusFilter !== 'ALL') {
      result = result.filter((l) => l.status === statusFilter);
    }

    // Apply KPI filter (cards)
    if (kpiFilter === 'AT_RISK') {
      result = result.filter(
        (l) =>
          l.features?.buy_box_risk === 'HIGH' ||
          l.features?.stockout_risk === 'HIGH' ||
          (l.features?.margin != null && l.features.margin < 0.15)
      );
    } else if (kpiFilter === 'BUY_BOX_WON') {
      result = result.filter((l) => l.features?.buy_box_status === 'WON');
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) =>
          l.seller_sku?.toLowerCase().includes(query) ||
          l.asin?.toLowerCase().includes(query) ||
          l.title?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [listings, statusFilter, kpiFilter, searchQuery]);

  // Handle KPI card click
  const handleKpiClick = (filter: 'ALL' | 'AT_RISK' | 'BUY_BOX_WON') => {
    if (kpiFilter === filter || filter === 'ALL') {
      setKpiFilter(null);
    } else {
      setKpiFilter(filter);
    }
    // Reset status filter when using KPI filter
    if (filter !== 'ALL') {
      setStatusFilter('ALL');
    }
  };

  return (
    <div>
      <PageHeader
        title="Listings Command Centre"
        subtitle={`${stats.total} total listings`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleSyncFromAmazon}
              disabled={isSyncing}
              className="btn btn-primary btn-sm"
            >
              {isSyncing ? 'Syncing...' : 'Sync from Amazon'}
            </button>
            <button
              onClick={loadListings}
              disabled={isLoading || isSyncing}
              className="btn btn-secondary btn-sm"
            >
              Refresh
            </button>
          </div>
        }
      />

      {/* SP-API not configured warning */}
      {spApiConfigured === false && !syncMessage && !error && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
          <strong>SP-API not configured.</strong> Set these environment variables in Railway to enable Amazon sync:
          <ul className="mt-2 ml-4 list-disc text-sm">
            <li>SP_API_CLIENT_ID</li>
            <li>SP_API_CLIENT_SECRET</li>
            <li>SP_API_REFRESH_TOKEN</li>
          </ul>
        </div>
      )}

      {/* Sync status message */}
      {syncMessage && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
          {isSyncing && (
            <span className="inline-block animate-spin mr-2">&#8635;</span>
          )}
          {syncMessage}
        </div>
      )}

      {/* Error message */}
      {error && !syncMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards - clickable to filter */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => handleKpiClick('ALL')}
          className={`card card-clickable text-left ${kpiFilter === null ? '' : ''}`}
          aria-pressed={kpiFilter === null}
        >
          <p className="text-sm text-gray-500">Total Listings</p>
          <p className="text-2xl font-semibold">{stats.total}</p>
        </button>
        <button
          onClick={() => {
            setStatusFilter('ACTIVE');
            setKpiFilter(null);
          }}
          className={`card card-clickable text-left ${statusFilter === 'ACTIVE' && !kpiFilter ? 'card-clickable-active' : ''}`}
          aria-pressed={statusFilter === 'ACTIVE' && !kpiFilter}
        >
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-semibold text-green-600">{stats.active}</p>
        </button>
        <button
          onClick={() => handleKpiClick('BUY_BOX_WON')}
          className={`card card-clickable text-left ${kpiFilter === 'BUY_BOX_WON' ? 'card-clickable-active' : ''}`}
          aria-pressed={kpiFilter === 'BUY_BOX_WON'}
        >
          <p className="text-sm text-gray-500">Buy Box Won</p>
          <p className="text-2xl font-semibold text-blue-600">{stats.buyBoxWon}</p>
        </button>
        <button
          onClick={() => handleKpiClick('AT_RISK')}
          className={`card card-clickable text-left ${kpiFilter === 'AT_RISK' ? 'card-clickable-active' : ''}`}
          aria-pressed={kpiFilter === 'AT_RISK'}
        >
          <p className="text-sm text-gray-500">At Risk</p>
          <p className="text-2xl font-semibold text-red-600">{stats.atRisk}</p>
        </button>
      </div>

      {/* Toolbar: tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        {/* Status tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => { setStatusFilter('ALL'); setKpiFilter(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              statusFilter === 'ALL' && !kpiFilter
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            onClick={() => { setStatusFilter('ACTIVE'); setKpiFilter(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 ${
              statusFilter === 'ACTIVE' && !kpiFilter
                ? 'bg-green-100 text-green-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Active ({stats.active})
          </button>
          <button
            onClick={() => { setStatusFilter('INACTIVE'); setKpiFilter(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 ${
              statusFilter === 'INACTIVE' && !kpiFilter
                ? 'bg-gray-200 text-gray-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Inactive ({stats.inactive})
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search by SKU, ASIN, or title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Active filter indicator */}
      {(kpiFilter || searchQuery) && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="text-gray-500">Filtering:</span>
          {kpiFilter === 'AT_RISK' && (
            <span className="badge badge-danger">At Risk</span>
          )}
          {kpiFilter === 'BUY_BOX_WON' && (
            <span className="badge badge-success">Buy Box Won</span>
          )}
          {searchQuery && (
            <span className="badge badge-neutral">"{searchQuery}"</span>
          )}
          <button
            onClick={() => { setKpiFilter(null); setSearchQuery(''); setStatusFilter('ALL'); }}
            className="text-blue-600 hover:text-blue-800 ml-2 focus:outline-none focus:underline"
          >
            Clear all
          </button>
          <span className="text-gray-400 ml-auto">
            {filteredListings.length} result{filteredListings.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Main content */}
      <div className="card">
        {isLoading && !isSyncing && (
          <div className="text-center py-12 text-gray-500">
            <p>Loading listings...</p>
          </div>
        )}

        {isSyncing && (
          <div className="text-center py-12 text-gray-500">
            <div className="inline-block animate-spin text-3xl mb-4">&#8635;</div>
            <p>Syncing listings from Amazon...</p>
            <p className="text-sm mt-2">This may take a few minutes while Amazon generates the report.</p>
          </div>
        )}

        {!isLoading && !isSyncing && !error && listings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No listings found. Sync your listings from Amazon to get started.</p>
            <button
              onClick={handleSyncFromAmazon}
              disabled={isSyncing}
              className="btn btn-primary"
            >
              Sync from Amazon
            </button>
          </div>
        )}

        {!isLoading && !isSyncing && listings.length > 0 && (
          <ListingsTable
            listings={filteredListings}
            onEditPrice={handleEditPrice}
          />
        )}
      </div>

      {/* Price edit modal */}
      {selectedListing && (
        <PriceEditModal
          listing={selectedListing}
          isOpen={isPriceModalOpen}
          onClose={() => {
            setIsPriceModalOpen(false);
            setSelectedListing(null);
          }}
          onSuccess={handlePriceChangeSuccess}
        />
      )}
    </div>
  );
}
