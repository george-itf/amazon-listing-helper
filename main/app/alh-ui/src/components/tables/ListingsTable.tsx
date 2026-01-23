import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ListingWithFeatures } from '../../types';
import { BuyBoxBadge, RiskBadge } from '../badges';
import { useTableKeyboardNavigation } from '../../hooks';

interface ListingsTableProps {
  listings: ListingWithFeatures[];
  onEditPrice?: (listing: ListingWithFeatures) => void;
  onEditStock?: (listing: ListingWithFeatures) => void;
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return `£${value.toFixed(2)}`;
}

function formatCurrencyWithSign(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}£${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString();
}

// D.2 FIX: Virtualization threshold - only virtualize when we have many rows
const VIRTUALIZATION_THRESHOLD = 50;
const ROW_HEIGHT = 48; // Estimated row height in pixels
const MAX_VISIBLE_HEIGHT = 600; // Max height for virtualized container

export function ListingsTable({ listings, onEditPrice, onEditStock }: ListingsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Keyboard navigation hook
  const { tableProps, getRowProps, containerRef } = useTableKeyboardNavigation({
    items: listings,
    onActivate: (listing) => {
      navigate(`/listings/${listing.id}`);
    },
  });

  // D.2 FIX: Use virtualization for large lists
  const rowVirtualizer = useVirtualizer({
    count: listings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // Render 10 extra items above/below viewport
  });

  if (listings.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No listings found</p>
      </div>
    );
  }

  // For small lists, use simple rendering without virtualization
  if (listings.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div
        ref={containerRef}
        className="overflow-x-auto max-h-[600px] overflow-y-auto"
        {...tableProps}
      >
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="table-header-sticky">
            <tr className="table-header">
              <th className="px-4 py-3" scope="col">SKU</th>
              <th className="px-4 py-3" scope="col">ASIN</th>
              <th className="px-4 py-3" scope="col">Title</th>
              <th className="px-4 py-3 text-right" scope="col">Qty</th>
              <th className="px-4 py-3 text-right" scope="col">Price (inc VAT)</th>
              <th className="px-4 py-3" scope="col">Buy Box</th>
              <th className="px-4 py-3 text-right" scope="col">Profit</th>
              <th className="px-4 py-3 text-right" scope="col">Margin</th>
              <th className="px-4 py-3 text-right" scope="col">Units (7d)</th>
              <th className="px-4 py-3 text-right" scope="col">Days Cover</th>
              <th className="px-4 py-3" scope="col">Risks</th>
              <th className="px-4 py-3" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {listings.map((listing, index) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                index={index}
                rowProps={getRowProps(index)}
                onEditPrice={onEditPrice}
                onEditStock={onEditStock}
              />
            ))}
          </tbody>
        </table>
        <div className="sr-only" aria-live="polite">
          Use arrow keys to navigate rows. Press Enter to view listing details.
        </div>
      </div>
    );
  }

  // D.2 FIX: Virtualized rendering for large lists
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="table-header-sticky">
          <tr className="table-header">
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">ASIN</th>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3 text-right">Price (inc VAT)</th>
            <th className="px-4 py-3">Buy Box</th>
            <th className="px-4 py-3 text-right">Profit</th>
            <th className="px-4 py-3 text-right">Margin</th>
            <th className="px-4 py-3 text-right">Units (7d)</th>
            <th className="px-4 py-3 text-right">Days Cover</th>
            <th className="px-4 py-3">Risks</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
      </table>
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ maxHeight: MAX_VISIBLE_HEIGHT }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          <table className="min-w-full">
            <tbody className="bg-white divide-y divide-gray-200">
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const listing = listings[virtualRow.index];
                return (
                  <tr
                    key={listing.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="hover:bg-gray-50"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <ListingRowContent
                      listing={listing}
                      onEditPrice={onEditPrice}
                      onEditStock={onEditStock}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs text-gray-500 p-2 text-right">
        Showing {listings.length} listings (virtualized)
      </div>
    </div>
  );
}

// Extracted row component for reuse
interface ListingRowProps {
  listing: ListingWithFeatures;
  index?: number;
  rowProps?: {
    id: string;
    role: 'row';
    tabIndex: number;
    'aria-selected': boolean;
    'data-row-index'?: number;
    onClick: () => void;
    onDoubleClick: () => void;
    className: string;
  };
  onEditPrice?: (listing: ListingWithFeatures) => void;
  onEditStock?: (listing: ListingWithFeatures) => void;
}

function ListingRow({ listing, index, rowProps, onEditPrice, onEditStock }: ListingRowProps) {
  const baseClassName = 'hover:bg-gray-50 cursor-pointer';
  const combinedClassName = rowProps?.className
    ? `${baseClassName} ${rowProps.className}`
    : baseClassName;

  return (
    <tr
      {...rowProps}
      className={combinedClassName}
      data-row-index={index}
    >
      <ListingRowContent listing={listing} onEditPrice={onEditPrice} onEditStock={onEditStock} />
    </tr>
  );
}

function ListingRowContent({ listing, onEditPrice, onEditStock }: ListingRowProps) {
  const f = listing.features;
  return (
    <>
      <td className="table-cell font-mono text-xs">
        <Link
          to={`/listings/${listing.id}`}
          className="text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
        >
          {listing.seller_sku}
        </Link>
      </td>
      <td className="table-cell font-mono text-xs">
        {listing.asin || '-'}
      </td>
      <td className="table-cell max-w-xs truncate" title={listing.title}>
        {listing.title}
      </td>
      <td className="table-cell text-right">
        {formatNumber(f?.available_quantity)}
      </td>
      <td className="table-cell text-right font-medium">
        {formatCurrency(f?.price_inc_vat)}
      </td>
      <td className="table-cell">
        {f ? <BuyBoxBadge status={f.buy_box_status} /> : '-'}
      </td>
      <td className="table-cell text-right">
        <span className={f && f.profit_ex_vat != null && f.profit_ex_vat < 0 ? 'text-red-600' : 'text-green-600'}>
          {formatCurrencyWithSign(f?.profit_ex_vat)}
        </span>
      </td>
      <td className="table-cell text-right">
        {formatPercent(f?.margin)}
      </td>
      <td className="table-cell text-right">
        {formatNumber(f?.units_7d)}
      </td>
      <td className="table-cell text-right">
        {f?.days_of_cover != null ? `${f.days_of_cover}d` : '-'}
      </td>
      <td className="table-cell">
        <div className="flex gap-1 flex-wrap">
          {f?.buy_box_risk && f.buy_box_risk !== 'LOW' && (
            <RiskBadge level={f.buy_box_risk} label="BB" />
          )}
          {f?.stockout_risk && f.stockout_risk !== 'LOW' && (
            <RiskBadge level={f.stockout_risk} label="Stock" />
          )}
          {f?.margin != null && f.margin < 0.15 && (
            <RiskBadge level="HIGH" label="Margin" />
          )}
        </div>
      </td>
      <td className="table-cell">
        <div className="flex gap-2">
          {onEditPrice && (
            <button
              onClick={() => onEditPrice(listing)}
              className="text-blue-600 hover:text-blue-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-1"
            >
              Price
            </button>
          )}
          {onEditStock && (
            <button
              onClick={() => onEditStock(listing)}
              className="text-blue-600 hover:text-blue-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-1"
            >
              Stock
            </button>
          )}
          <Link
            to={`/listings/${listing.id}`}
            className="text-gray-600 hover:text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 rounded px-1"
          >
            View
          </Link>
        </div>
      </td>
    </>
  );
}
