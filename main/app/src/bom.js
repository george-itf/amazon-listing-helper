// BOM (Bill of Materials) & Cost Management Module
// Phase 4: Pricing & Costs - BOM & cost management

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/opt/alh/data';

// Data file paths
const SUPPLIERS_FILE = `${DATA_DIR}/suppliers.json`;
const COMPONENTS_FILE = `${DATA_DIR}/components.json`;
const BOM_FILE = `${DATA_DIR}/bom.json`;

// Initialize data files if they don't exist
function initDataFiles() {
  if (!existsSync(SUPPLIERS_FILE)) {
    writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers: [] }, null, 2));
  }
  if (!existsSync(COMPONENTS_FILE)) {
    writeFileSync(COMPONENTS_FILE, JSON.stringify({ components: [] }, null, 2));
  }
  if (!existsSync(BOM_FILE)) {
    writeFileSync(BOM_FILE, JSON.stringify({ bom: {} }, null, 2));
  }
}

// ============ SUPPLIERS ============

export function getSuppliers() {
  initDataFiles();
  const data = JSON.parse(readFileSync(SUPPLIERS_FILE, 'utf8'));
  return data.suppliers || [];
}

export function getSupplier(supplierId) {
  const suppliers = getSuppliers();
  return suppliers.find(s => s.id === supplierId);
}

export function createSupplier(supplierData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SUPPLIERS_FILE, 'utf8'));
  const suppliers = data.suppliers || [];

  const newSupplier = {
    id: `SUP-${Date.now()}`,
    name: supplierData.name,
    contactName: supplierData.contactName || '',
    email: supplierData.email || '',
    phone: supplierData.phone || '',
    website: supplierData.website || '',
    address: supplierData.address || '',
    currency: supplierData.currency || 'GBP',
    leadTimeDays: supplierData.leadTimeDays || 7,
    minimumOrder: supplierData.minimumOrder || 0,
    notes: supplierData.notes || '',
    rating: supplierData.rating || 3,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  suppliers.push(newSupplier);
  writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers }, null, 2));
  return newSupplier;
}

export function updateSupplier(supplierId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SUPPLIERS_FILE, 'utf8'));
  const suppliers = data.suppliers || [];

  const index = suppliers.findIndex(s => s.id === supplierId);
  if (index === -1) return null;

  suppliers[index] = {
    ...suppliers[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers }, null, 2));
  return suppliers[index];
}

export function deleteSupplier(supplierId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(SUPPLIERS_FILE, 'utf8'));
  let suppliers = data.suppliers || [];

  const index = suppliers.findIndex(s => s.id === supplierId);
  if (index === -1) return false;

  suppliers.splice(index, 1);
  writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers }, null, 2));
  return true;
}

// ============ COMPONENTS ============

export function getComponents() {
  initDataFiles();
  const data = JSON.parse(readFileSync(COMPONENTS_FILE, 'utf8'));
  return data.components || [];
}

export function getComponent(componentId) {
  const components = getComponents();
  return components.find(c => c.id === componentId);
}

export function createComponent(componentData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(COMPONENTS_FILE, 'utf8'));
  const components = data.components || [];

  const newComponent = {
    id: `COMP-${Date.now()}`,
    sku: componentData.sku || '',
    name: componentData.name,
    description: componentData.description || '',
    category: componentData.category || 'General',
    supplierId: componentData.supplierId || null,
    supplierSku: componentData.supplierSku || '',
    unitCost: parseFloat(componentData.unitCost) || 0,
    unitOfMeasure: componentData.unitOfMeasure || 'each',
    packSize: componentData.packSize || 1,
    weight: componentData.weight || 0,
    dimensions: componentData.dimensions || { length: 0, width: 0, height: 0 },
    minStockLevel: componentData.minStockLevel || 0,
    currentStock: componentData.currentStock || 0,
    reorderPoint: componentData.reorderPoint || 0,
    isActive: true,
    priceHistory: [{
      cost: parseFloat(componentData.unitCost) || 0,
      date: new Date().toISOString(),
      supplierId: componentData.supplierId
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  components.push(newComponent);
  writeFileSync(COMPONENTS_FILE, JSON.stringify({ components }, null, 2));
  return newComponent;
}

export function updateComponent(componentId, updates) {
  initDataFiles();
  const data = JSON.parse(readFileSync(COMPONENTS_FILE, 'utf8'));
  const components = data.components || [];

  const index = components.findIndex(c => c.id === componentId);
  if (index === -1) return null;

  // Track price changes
  if (updates.unitCost && updates.unitCost !== components[index].unitCost) {
    components[index].priceHistory = components[index].priceHistory || [];
    components[index].priceHistory.push({
      cost: parseFloat(updates.unitCost),
      date: new Date().toISOString(),
      supplierId: updates.supplierId || components[index].supplierId
    });
  }

  components[index] = {
    ...components[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeFileSync(COMPONENTS_FILE, JSON.stringify({ components }, null, 2));
  return components[index];
}

export function deleteComponent(componentId) {
  initDataFiles();
  const data = JSON.parse(readFileSync(COMPONENTS_FILE, 'utf8'));
  let components = data.components || [];

  const index = components.findIndex(c => c.id === componentId);
  if (index === -1) return false;

  components.splice(index, 1);
  writeFileSync(COMPONENTS_FILE, JSON.stringify({ components }, null, 2));
  return true;
}

// ============ BILL OF MATERIALS ============

export function getBOM(sku) {
  initDataFiles();
  const data = JSON.parse(readFileSync(BOM_FILE, 'utf8'));
  return data.bom?.[sku] || { sku, components: [], laborCost: 0, packagingCost: 0, overheadPercent: 0 };
}

export function getAllBOMs() {
  initDataFiles();
  const data = JSON.parse(readFileSync(BOM_FILE, 'utf8'));
  return data.bom || {};
}

export function saveBOM(sku, bomData) {
  initDataFiles();
  const data = JSON.parse(readFileSync(BOM_FILE, 'utf8'));
  const bom = data.bom || {};

  // Get existing BOM to preserve components if not provided
  const existingBom = bom[sku] || { components: [] };

  bom[sku] = {
    sku,
    // Preserve existing components if not explicitly provided
    components: bomData.components !== undefined ? bomData.components : existingBom.components,
    laborCost: parseFloat(bomData.laborCost) || 0,
    packagingCost: parseFloat(bomData.packagingCost) || 0,
    overheadPercent: parseFloat(bomData.overheadPercent) || 0,
    notes: bomData.notes !== undefined ? bomData.notes : (existingBom.notes || ''),
    updatedAt: new Date().toISOString()
  };

  writeFileSync(BOM_FILE, JSON.stringify({ bom }, null, 2));
  return bom[sku];
}

export function addComponentToBOM(sku, componentId, quantity) {
  const bom = getBOM(sku);
  const existingIndex = bom.components.findIndex(c => c.componentId === componentId);

  if (existingIndex >= 0) {
    bom.components[existingIndex].quantity = quantity;
  } else {
    bom.components.push({ componentId, quantity });
  }

  return saveBOM(sku, bom);
}

export function removeComponentFromBOM(sku, componentId) {
  const bom = getBOM(sku);
  bom.components = bom.components.filter(c => c.componentId !== componentId);
  return saveBOM(sku, bom);
}

// ============ COST CALCULATIONS ============

export function calculateLandedCost(sku) {
  const bom = getBOM(sku);
  const components = getComponents();

  let materialCost = 0;
  const componentDetails = [];

  for (const bomItem of bom.components) {
    const component = components.find(c => c.id === bomItem.componentId);
    if (component) {
      const itemCost = component.unitCost * bomItem.quantity;
      materialCost += itemCost;
      componentDetails.push({
        componentId: component.id,
        name: component.name,
        unitCost: component.unitCost,
        quantity: bomItem.quantity,
        totalCost: itemCost
      });
    }
  }

  const laborCost = bom.laborCost || 0;
  const packagingCost = bom.packagingCost || 0;
  const subtotal = materialCost + laborCost + packagingCost;
  const overheadCost = subtotal * ((bom.overheadPercent || 0) / 100);
  const totalCost = subtotal + overheadCost;

  return {
    sku,
    materialCost: Math.round(materialCost * 100) / 100,
    laborCost: Math.round(laborCost * 100) / 100,
    packagingCost: Math.round(packagingCost * 100) / 100,
    overheadCost: Math.round(overheadCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    componentDetails,
    hasCompleteBOM: bom.components.length > 0
  };
}

export function calculateMargin(sku, sellingPrice, fbaFees = 0, shippingCost = 0) {
  const landedCost = calculateLandedCost(sku);
  const totalCosts = landedCost.totalCost + fbaFees + shippingCost;
  const profit = sellingPrice - totalCosts;
  const marginPercent = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
  const roi = landedCost.totalCost > 0 ? (profit / landedCost.totalCost) * 100 : 0;

  return {
    sku,
    sellingPrice,
    landedCost: landedCost.totalCost,
    fbaFees,
    shippingCost,
    totalCosts: Math.round(totalCosts * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    marginPercent: Math.round(marginPercent * 10) / 10,
    roi: Math.round(roi * 10) / 10,
    isProfitable: profit > 0
  };
}

export function getBulkCostAnalysis() {
  const allBOMs = getAllBOMs();
  const results = [];

  for (const sku of Object.keys(allBOMs)) {
    const landedCost = calculateLandedCost(sku);
    results.push(landedCost);
  }

  return {
    total: results.length,
    items: results,
    summary: {
      avgMaterialCost: results.length > 0 ?
        Math.round(results.reduce((sum, r) => sum + r.materialCost, 0) / results.length * 100) / 100 : 0,
      avgTotalCost: results.length > 0 ?
        Math.round(results.reduce((sum, r) => sum + r.totalCost, 0) / results.length * 100) / 100 : 0
    }
  };
}

// ============ SUPPLIER COMPARISON ============

export function compareSupplierPrices(componentId) {
  const components = getComponents();
  const suppliers = getSuppliers();

  // Find all components with same name/category from different suppliers
  const component = components.find(c => c.id === componentId);
  if (!component) return null;

  const similarComponents = components.filter(c =>
    c.name.toLowerCase() === component.name.toLowerCase() ||
    (c.category === component.category && c.description === component.description)
  );

  const comparison = similarComponents.map(c => {
    const supplier = suppliers.find(s => s.id === c.supplierId);
    return {
      componentId: c.id,
      supplierName: supplier?.name || 'Unknown',
      supplierId: c.supplierId,
      unitCost: c.unitCost,
      packSize: c.packSize,
      costPerUnit: c.unitCost / (c.packSize || 1),
      leadTimeDays: supplier?.leadTimeDays || 0,
      minimumOrder: supplier?.minimumOrder || 0
    };
  }).sort((a, b) => a.costPerUnit - b.costPerUnit);

  return {
    componentName: component.name,
    bestPrice: comparison[0],
    alternatives: comparison.slice(1),
    potentialSavings: comparison.length > 1 ?
      Math.round((comparison[comparison.length - 1].costPerUnit - comparison[0].costPerUnit) * 100) / 100 : 0
  };
}

// ============ BULK IMPORT ============

export function importBOMData(rows) {
  initDataFiles();

  let suppliersCreated = 0;
  let componentsCreated = 0;
  let bomEntriesCreated = 0;

  // Track existing suppliers/components by name for deduplication
  const suppliersByName = {};
  getSuppliers().forEach(s => { suppliersByName[s.name.toLowerCase()] = s; });

  const componentsByName = {};
  getComponents().forEach(c => { componentsByName[c.name.toLowerCase()] = c; });

  // Group rows by SKU
  const rowsBySku = {};
  for (const row of rows) {
    if (!row.sku || !row.component) continue;
    if (!rowsBySku[row.sku]) rowsBySku[row.sku] = [];
    rowsBySku[row.sku].push(row);
  }

  // Process each row
  for (const row of rows) {
    if (!row.sku || !row.component) continue;

    // 1. Create or find supplier
    let supplier = suppliersByName[row.supplier?.toLowerCase()];
    if (!supplier && row.supplier) {
      supplier = createSupplier({
        name: row.supplier,
        currency: 'GBP'
      });
      suppliersByName[supplier.name.toLowerCase()] = supplier;
      suppliersCreated++;
    }

    // 2. Create or find component
    let component = componentsByName[row.component.toLowerCase()];
    if (!component) {
      component = createComponent({
        name: row.component,
        unitCost: row.cost || 0,
        supplierId: supplier?.id || null,
        category: 'Imported'
      });
      componentsByName[component.name.toLowerCase()] = component;
      componentsCreated++;
    }

    // 3. Add to BOM for this SKU
    addComponentToBOM(row.sku, component.id, row.qty || 1);
    bomEntriesCreated++;
  }

  return {
    suppliersCreated,
    componentsCreated,
    bomEntriesCreated,
    skusProcessed: Object.keys(rowsBySku).length
  };
}

export default {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getComponents,
  getComponent,
  createComponent,
  updateComponent,
  deleteComponent,
  getBOM,
  getAllBOMs,
  saveBOM,
  addComponentToBOM,
  removeComponentFromBOM,
  calculateLandedCost,
  calculateMargin,
  getBulkCostAnalysis,
  compareSupplierPrices,
  importBOMData
};
