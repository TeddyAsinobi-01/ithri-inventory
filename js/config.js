/* ==========================================================================
   Ithri Inventory — Material configuration
   This is the single source of truth for every material's rules
   (bag sizes, thresholds, units). Editing thresholds / bag sizes at
   runtime (via Settings) updates copies of this held in the store,
   not this file — this file only supplies the starting defaults.
   ========================================================================== */

export const ITHRI_CONFIG = {
  freshJuice: [
    { id: "tigernut_juice", name: "Tigernut" },
    { id: "watermelon_juice", name: "Watermelon" },
    { id: "sugarcane_juice", name: "Sugarcane" },
    { id: "pineapple_juice", name: "Pineapple" }
  ],

  // Raw materials tab — order matters, Tigernut/Ginger/Dates/Coconut first,
  // seasonal crops after.
  rawMaterials: [
    {
      id: "tigernut", name: "Tigernut", unit: "custard bucket",
      trackedIn: "buckets", bagSize: 24, bagSizeEditable: true,
      thresholdType: "bags", threshold: 5, seasonal: false, hasHalfBag: false
    },
    {
      id: "ginger", name: "Ginger", unit: "custard bucket",
      trackedIn: "buckets", bagSize: 24, halfBagSize: 12, bagSizeEditable: true,
      thresholdType: "buckets", threshold: 6, seasonal: false, hasHalfBag: true
    },
    {
      id: "dates", name: "Dates", unit: "custard bucket",
      trackedIn: "buckets", bagSize: 23, bagSizeEditable: true,
      thresholdType: "bags", threshold: 1, seasonal: false, hasHalfBag: false
    },
    {
      id: "coconut", name: "Coconut", unit: "piece",
      trackedIn: "pieces", bagSize: 100, bagSizeEditable: true,
      thresholdType: "pieces", threshold: 20, seasonal: false, hasHalfBag: false
    },
    { id: "sugarcane_raw", name: "Sugarcane", unit: "bundle", trackedIn: "units", seasonal: true },
    { id: "lemon", name: "Lemon", unit: "unit", trackedIn: "units", seasonal: true },
    { id: "watermelon_raw", name: "Watermelon", unit: "unit", trackedIn: "units", seasonal: true },
    { id: "pineapple_raw", name: "Pineapple", unit: "unit", trackedIn: "units", seasonal: true }
  ],

  // Other materials tab
  otherMaterials: [
    {
      id: "bottles", name: "Bottles", unit: "piece", trackedIn: "pieces",
      bagSize: 600, bagSizeEditable: true, thresholdType: "bags", threshold: 5,
      dailyMode: "used_spoilt"
    },
    {
      id: "cover", name: "Cover", unit: "piece", trackedIn: "pieces",
      bagSize: 4000, bagSizeEditable: true, thresholdType: "bags", threshold: 1,
      dailyMode: "used_spoilt"
    },
    {
      id: "iceblock", name: "Ice Block", unit: "block", trackedIn: "units",
      dailyMode: "used_only", noThreshold: true
    },
    { id: "sticker_tigernut", name: "Tigernut Sticker", unit: "piece", trackedIn: "pieces", group: "stickers", dailyMode: "used_bad", noThreshold: true },
    { id: "sticker_pineapple", name: "Pineapple Sticker", unit: "piece", trackedIn: "pieces", group: "stickers", dailyMode: "used_bad", noThreshold: true },
    { id: "sticker_watermelon", name: "Watermelon Sticker", unit: "piece", trackedIn: "pieces", group: "stickers", dailyMode: "used_bad", noThreshold: true },
    { id: "sticker_sugarcane", name: "Sugarcane Sticker", unit: "piece", trackedIn: "pieces", group: "stickers", dailyMode: "used_bad", noThreshold: true }
  ],

  // Preform / bottle-factory exchange — tracked separately, see store.js
  preform: {
    preformBagSize: 1200,
    bottleBagsPerPreformBag: 2,
    defaultBottlesPerBottleBag: 600
  },

  // Fixed developer-only password for the second-and-later "clear all
  // entries" action. Deliberately not exposed anywhere in Settings UI.
  CLEAR_ALL_PASSWORD: "ALICE OGECHI OKORO"
};
