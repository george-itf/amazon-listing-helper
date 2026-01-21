/**
 * Validation Schemas Module
 *
 * JSON Schema definitions for request validation using Fastify's built-in validation.
 * Use these in route definitions: { schema: { body: schema, querystring: schema } }
 *
 * @module ValidationSchemas
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

/**
 * Positive integer schema
 */
export const positiveInteger = {
  type: 'integer',
  minimum: 1,
};

/**
 * Non-negative integer schema
 */
export const nonNegativeInteger = {
  type: 'integer',
  minimum: 0,
};

/**
 * Positive number (decimal) schema
 */
export const positiveNumber = {
  type: 'number',
  minimum: 0.01,
};

/**
 * Non-negative number schema
 */
export const nonNegativeNumber = {
  type: 'number',
  minimum: 0,
};

/**
 * ASIN format (10 alphanumeric characters)
 */
export const asinFormat = {
  type: 'string',
  pattern: '^[A-Z0-9]{10}$',
  maxLength: 10,
};

/**
 * SKU format (max 40 characters, alphanumeric with some special chars)
 */
export const skuFormat = {
  type: 'string',
  maxLength: 40,
  minLength: 1,
};

/**
 * Marketplace ID format
 */
export const marketplaceIdFormat = {
  type: 'string',
  pattern: '^[A-Z0-9]+$',
  maxLength: 20,
};

// ============================================================================
// PRICE ENDPOINTS
// ============================================================================

export const pricePreviewSchema = {
  body: {
    type: 'object',
    required: ['price_inc_vat'],
    properties: {
      price_inc_vat: {
        type: 'number',
        minimum: 0.01,
        maximum: 100000, // Reasonable max price
      },
    },
    additionalProperties: false,
  },
};

export const pricePublishSchema = {
  body: {
    type: 'object',
    required: ['price_inc_vat', 'reason'],
    properties: {
      price_inc_vat: {
        type: 'number',
        minimum: 0.01,
        maximum: 100000,
      },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
      },
      correlation_id: {
        type: 'string',
        maxLength: 100,
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// STOCK ENDPOINTS
// ============================================================================

export const stockPreviewSchema = {
  body: {
    type: 'object',
    required: ['available_quantity'],
    properties: {
      available_quantity: {
        type: 'integer',
        minimum: 0,
        maximum: 1000000, // Reasonable max stock
      },
    },
    additionalProperties: false,
  },
};

export const stockPublishSchema = {
  body: {
    type: 'object',
    required: ['available_quantity', 'reason'],
    properties: {
      available_quantity: {
        type: 'integer',
        minimum: 0,
        maximum: 1000000,
      },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// SUPPLIER ENDPOINTS
// ============================================================================

export const createSupplierSchema = {
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
      contact_email: {
        type: 'string',
        format: 'email',
        maxLength: 255,
      },
      contact_phone: {
        type: 'string',
        maxLength: 50,
      },
      website: {
        type: 'string',
        format: 'uri',
        maxLength: 500,
      },
      notes: {
        type: 'string',
        maxLength: 2000,
      },
      is_active: {
        type: 'boolean',
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// COMPONENT ENDPOINTS
// ============================================================================

export const createComponentSchema = {
  body: {
    type: 'object',
    required: ['component_sku', 'name'],
    properties: {
      component_sku: skuFormat,
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
      description: {
        type: 'string',
        maxLength: 2000,
      },
      category: {
        type: 'string',
        maxLength: 100,
      },
      unit_cost_ex_vat: nonNegativeNumber,
      supplier_id: positiveInteger,
      is_active: {
        type: 'boolean',
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// BOM ENDPOINTS
// ============================================================================

export const createBomSchema = {
  body: {
    type: 'object',
    required: ['lines'],
    properties: {
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          required: ['component_id', 'quantity'],
          properties: {
            component_id: positiveInteger,
            quantity: {
              type: 'number',
              minimum: 0.001,
              maximum: 10000,
            },
            wastage_rate: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            notes: {
              type: 'string',
              maxLength: 500,
            },
          },
          additionalProperties: false,
        },
      },
      notes: {
        type: 'string',
        maxLength: 2000,
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// ASIN ENDPOINTS
// ============================================================================

export const analyzeAsinSchema = {
  body: {
    type: 'object',
    required: ['asin'],
    properties: {
      asin: {
        type: 'string',
        minLength: 10,
        maxLength: 10,
        pattern: '^[A-Z0-9]{10}$',
      },
      marketplace_id: {
        type: 'string',
        maxLength: 20,
      },
    },
    additionalProperties: false,
  },
};

export const trackAsinSchema = {
  body: {
    type: 'object',
    required: ['asin'],
    properties: {
      asin: {
        type: 'string',
        minLength: 10,
        maxLength: 10,
        pattern: '^[A-Z0-9]{10}$',
      },
      marketplace_id: {
        type: 'string',
        maxLength: 20,
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// RECOMMENDATION ENDPOINTS
// ============================================================================

export const snoozeRecommendationSchema = {
  body: {
    type: 'object',
    properties: {
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
      },
      snooze_until: {
        type: 'string',
        format: 'date-time',
      },
      reason: {
        type: 'string',
        maxLength: 500,
      },
      notes: {
        type: 'string',
        maxLength: 2000,
      },
    },
    additionalProperties: false,
  },
};

// ============================================================================
// COMMON QUERY STRING SCHEMAS
// ============================================================================

export const paginationQuerySchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
    offset: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
  },
};

export const listingIdParamsSchema = {
  type: 'object',
  required: ['listingId'],
  properties: {
    listingId: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
  },
};

export default {
  pricePreviewSchema,
  pricePublishSchema,
  stockPreviewSchema,
  stockPublishSchema,
  createSupplierSchema,
  createComponentSchema,
  createBomSchema,
  analyzeAsinSchema,
  trackAsinSchema,
  snoozeRecommendationSchema,
  paginationQuerySchema,
  listingIdParamsSchema,
};
