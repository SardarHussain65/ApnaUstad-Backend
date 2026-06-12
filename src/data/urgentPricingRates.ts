export interface PricingRate {
    baseRatePerHour: number;
    minimumPrice: number;
}

export const URGENT_PRICING_RATES: Record<string, PricingRate> = {
    'Electrician': { baseRatePerHour: 600, minimumPrice: 800 },
    'Plumber': { baseRatePerHour: 550, minimumPrice: 700 },
    'Painter': { baseRatePerHour: 400, minimumPrice: 500 },
    'Carpenter': { baseRatePerHour: 500, minimumPrice: 600 },
    'AC Technician': { baseRatePerHour: 700, minimumPrice: 900 },
    'Cleaner': { baseRatePerHour: 300, minimumPrice: 400 },
    'Mason': { baseRatePerHour: 500, minimumPrice: 700 },
    'Welder': { baseRatePerHour: 550, minimumPrice: 700 },
};

export const DEFAULT_URGENT_RATE: PricingRate = {
    baseRatePerHour: 450,
    minimumPrice: 600,
};

export function getRateForCategory(category: string): PricingRate {
    // case-insensitive match or direct match
    const keys = Object.keys(URGENT_PRICING_RATES);
    const matchedKey = keys.find(k => k.toLowerCase() === category.toLowerCase());
    if (matchedKey) {
        const rate = URGENT_PRICING_RATES[matchedKey];
        if (rate) return rate;
    }
    return DEFAULT_URGENT_RATE;
}
