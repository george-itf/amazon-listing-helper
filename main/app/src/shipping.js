// Royal Mail Shipping Calculator
// API Key: d6b8544d-638e-4044-9606-ed68f812dcd5

// Royal Mail price bands (UK domestic, 2024 rates)
const ROYAL_MAIL_RATES = {
  largeLetter: [
    { maxWeight: 100, class1: 1.15, class2: 0.85 },
    { maxWeight: 250, class1: 1.70, class2: 1.25 },
    { maxWeight: 500, class1: 2.10, class2: 1.60 },
    { maxWeight: 750, class1: 2.70, class2: 2.10 }
  ],
  smallParcel: [
    { maxWeight: 500, class1: 3.10, class2: 2.90 },
    { maxWeight: 1000, class1: 3.95, class2: 2.90 },
    { maxWeight: 2000, class1: 4.50, class2: 2.90 }
  ],
  mediumParcel: [
    { maxWeight: 1000, class1: 6.40, class2: 5.55 },
    { maxWeight: 2000, class1: 6.40, class2: 5.55 },
    { maxWeight: 5000, class1: 9.50, class2: 8.70 },
    { maxWeight: 10000, class1: 12.40, class2: 11.75 },
    { maxWeight: 20000, class1: 18.20, class2: 17.45 }
  ]
};

function getShippingRate(parcelType, weightGrams, serviceClass = 2) {
  const rates = ROYAL_MAIL_RATES[parcelType];
  if (!rates) return null;
  const rate = rates.find(r => weightGrams <= r.maxWeight);
  if (!rate) return null;
  return serviceClass === 1 ? rate.class1 : rate.class2;
}

function calculateShipping(weightGrams, dimensions = {}) {
  const { length = 200, width = 150, height = 50 } = dimensions;
  let parcelType = null;
  
  if (length <= 353 && width <= 250 && height <= 25 && weightGrams <= 750) {
    parcelType = "largeLetter";
  } else if (length <= 450 && width <= 350 && height <= 160 && weightGrams <= 2000) {
    parcelType = "smallParcel";
  } else if (length <= 610 && width <= 460 && height <= 460 && weightGrams <= 20000) {
    parcelType = "mediumParcel";
  }
  
  if (!parcelType) {
    return { error: "Parcel too large for Royal Mail standard services", parcelType: "oversize" };
  }
  
  const class1 = getShippingRate(parcelType, weightGrams, 1);
  const class2 = getShippingRate(parcelType, weightGrams, 2);
  
  return {
    parcelType,
    weightGrams,
    dimensions: { length, width, height },
    options: [
      { service: "1st Class", price: class1, deliveryDays: "1-2" },
      { service: "2nd Class", price: class2, deliveryDays: "2-3" }
    ],
    recommended: { service: "2nd Class", price: class2 }
  };
}

function determineParcelType(weightGrams, length, width, height) {
  if (length <= 353 && width <= 250 && height <= 25 && weightGrams <= 750) {
    return "largeLetter";
  } else if (length <= 450 && width <= 350 && height <= 160 && weightGrams <= 2000) {
    return "smallParcel";
  } else if (length <= 610 && width <= 460 && height <= 460 && weightGrams <= 20000) {
    return "mediumParcel";
  }
  return "oversize";
}

export { calculateShipping, getShippingRate, determineParcelType, ROYAL_MAIL_RATES };
