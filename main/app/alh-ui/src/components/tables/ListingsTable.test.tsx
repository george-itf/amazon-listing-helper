/**
 * ListingsTable Component Tests
 *
 * D.1 FIX: Frontend test coverage for ListingsTable component.
 * Tests rendering, data display, and user interactions.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ListingsTable } from './ListingsTable';
import type { ListingWithFeatures } from '../../types';

// Helper to wrap component with router
function renderWithRouter(ui: React.ReactElement) {
  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
}

// Mock listing data
const createMockListing = (overrides: Partial<ListingWithFeatures> = {}): ListingWithFeatures => ({
  id: 1,
  seller_sku: 'TEST-SKU-001',
  asin: 'B00TEST123',
  title: 'Test Product Title',
  status: 'ACTIVE',
  price_inc_vat: 24.99,
  available_quantity: 100,
  marketplace_id: 1,
  fulfillmentChannel: 'FBM',
  category: 'General',
  features: {
    price_inc_vat: 24.99,
    available_quantity: 100,
    profit_ex_vat: 5.50,
    margin: 0.22,
    units_7d: 25,
    days_of_cover: 45,
    buy_box_status: 'WON',
    buy_box_risk: 'LOW',
    stockout_risk: 'LOW',
    ...overrides.features,
  },
  ...overrides,
});

describe('ListingsTable', () => {
  describe('rendering', () => {
    it('should render empty state when no listings', () => {
      renderWithRouter(<ListingsTable listings={[]} />);

      expect(screen.getByText('No listings found')).toBeInTheDocument();
    });

    it('should render table headers', () => {
      renderWithRouter(<ListingsTable listings={[createMockListing()]} />);

      expect(screen.getByText('SKU')).toBeInTheDocument();
      expect(screen.getByText('ASIN')).toBeInTheDocument();
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Price (inc VAT)')).toBeInTheDocument();
      expect(screen.getByText('Profit')).toBeInTheDocument();
      expect(screen.getByText('Margin')).toBeInTheDocument();
    });

    it('should render listing data correctly', () => {
      const listing = createMockListing();
      renderWithRouter(<ListingsTable listings={[listing]} />);

      expect(screen.getByText('TEST-SKU-001')).toBeInTheDocument();
      expect(screen.getByText('B00TEST123')).toBeInTheDocument();
      expect(screen.getByText('Test Product Title')).toBeInTheDocument();
      expect(screen.getByText('£24.99')).toBeInTheDocument();
      expect(screen.getByText('£5.50')).toBeInTheDocument();
      expect(screen.getByText('22.0%')).toBeInTheDocument();
    });

    it('should render multiple listings', () => {
      const listings = [
        createMockListing({ id: 1, seller_sku: 'SKU-001' }),
        createMockListing({ id: 2, seller_sku: 'SKU-002' }),
        createMockListing({ id: 3, seller_sku: 'SKU-003' }),
      ];

      renderWithRouter(<ListingsTable listings={listings} />);

      expect(screen.getByText('SKU-001')).toBeInTheDocument();
      expect(screen.getByText('SKU-002')).toBeInTheDocument();
      expect(screen.getByText('SKU-003')).toBeInTheDocument();
    });
  });

  describe('Buy Box status', () => {
    it('should show Won badge for Buy Box winner', () => {
      const listing = createMockListing({
        features: { buy_box_status: 'WON' },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      // Badge shows human-readable "Won" label
      expect(screen.getByText('Won')).toBeInTheDocument();
    });

    it('should show Lost badge for Buy Box loser', () => {
      const listing = createMockListing({
        features: { buy_box_status: 'LOST' },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      // Badge shows human-readable "Lost" label
      expect(screen.getByText('Lost')).toBeInTheDocument();
    });
  });

  describe('risk indicators', () => {
    it('should show margin risk for low margin listings', () => {
      const listing = createMockListing({
        features: { margin: 0.10 }, // 10% margin < 15% threshold
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      // "Margin" appears both in header and as risk badge
      // Use getAllByText and verify the badge exists
      const marginElements = screen.getAllByText('Margin');
      expect(marginElements.length).toBeGreaterThanOrEqual(2);
      // Find the one that's a badge
      const marginBadge = marginElements.find((el) => el.classList.contains('badge'));
      expect(marginBadge).toBeDefined();
    });

    it('should show Buy Box risk indicator', () => {
      const listing = createMockListing({
        features: { buy_box_risk: 'HIGH' },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      expect(screen.getByText('BB')).toBeInTheDocument();
    });

    it('should show stockout risk indicator', () => {
      const listing = createMockListing({
        features: { stockout_risk: 'HIGH' },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      expect(screen.getByText('Stock')).toBeInTheDocument();
    });
  });

  describe('user interactions', () => {
    it('should call onEditPrice when Price button is clicked', () => {
      const listing = createMockListing();
      const onEditPrice = vi.fn();

      renderWithRouter(
        <ListingsTable listings={[listing]} onEditPrice={onEditPrice} />
      );

      const priceButton = screen.getByText('Price');
      fireEvent.click(priceButton);

      expect(onEditPrice).toHaveBeenCalledWith(listing);
    });

    it('should not render Price button when onEditPrice not provided', () => {
      const listing = createMockListing();

      renderWithRouter(<ListingsTable listings={[listing]} />);

      expect(screen.queryByRole('button', { name: /price/i })).not.toBeInTheDocument();
    });

    it('should render View link for each listing', () => {
      const listing = createMockListing({ id: 123 });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      const viewLink = screen.getByText('View');
      expect(viewLink).toHaveAttribute('href', '/listings/123');
    });
  });

  describe('data formatting', () => {
    it('should handle null/undefined values gracefully', () => {
      const listing = createMockListing({
        asin: null,
        features: {
          profit_ex_vat: null,
          margin: null,
          days_of_cover: null,
        },
      });

      renderWithRouter(<ListingsTable listings={[listing as ListingWithFeatures]} />);

      // Should render dashes for missing values
      const cells = screen.getAllByText('-');
      expect(cells.length).toBeGreaterThan(0);
    });

    it('should format negative profit in red', () => {
      const listing = createMockListing({
        features: { profit_ex_vat: -2.50 },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      // formatCurrency outputs £-2.50 (currency symbol before negative sign)
      const profitCell = screen.getByText('£-2.50');
      expect(profitCell).toHaveClass('text-red-600');
    });

    it('should format days of cover with "d" suffix', () => {
      const listing = createMockListing({
        features: { days_of_cover: 45 },
      });

      renderWithRouter(<ListingsTable listings={[listing]} />);

      expect(screen.getByText('45d')).toBeInTheDocument();
    });
  });
});
