// ============================================================
// Perfumery Unit of Measure & Density Conversion Utility
// Handles metric conversions (g, kg, mL, L, pcs) and
// mass-to-volume density conversions (mass = volume * density).
// ============================================================

export const ITEM_TYPES = [
  {
    id: 'raw_oil',
    name: 'Perfume Oil / Concentrate',
    baseUnit: 'g',
    allowedUnits: ['g', 'kg'],
    color: 'amber',
    icon: '🧪',
    description: 'Aroma oils, inspired concentrates, accords'
  },
  {
    id: 'raw_chemical',
    name: 'Base Chemicals & Solvents',
    baseUnit: 'ml',
    allowedUnits: ['ml', 'l', 'g', 'kg'],
    color: 'cyan',
    icon: '⚗️',
    description: 'Ethanol, DPG, Fixatives (Ambroxan, Iso E Super, Hedione)'
  },
  {
    id: 'packaging',
    name: 'Packaging Component',
    baseUnit: 'pcs',
    allowedUnits: ['pcs'],
    color: 'emerald',
    icon: '📦',
    description: 'Glass bottles, spray pumps, crimp collars, caps, labels, unit boxes'
  },
  {
    id: 'bulk_liquid',
    name: 'Bulk Liquid (WIP)',
    baseUnit: 'ml',
    allowedUnits: ['ml', 'l'],
    color: 'purple',
    icon: '🫙',
    description: 'Macerating or blended perfume batch awaiting bottling'
  },
  {
    id: 'finished_good',
    name: 'Finished Sellable Perfume',
    baseUnit: 'pcs',
    allowedUnits: ['pcs'],
    color: 'blue',
    icon: '✨',
    description: 'Bottled perfume ready for POS checkout'
  },
  {
    id: 'consumable',
    name: 'Laboratory Consumable',
    baseUnit: 'pcs',
    allowedUnits: ['pcs', 'pk', 'box'],
    color: 'slate',
    icon: '🧤',
    description: 'Filter paper, testing strips, gloves, pipette tips'
  }
]

export const STANDARD_UNITS = [
  { id: 'g', name: 'Gram', type: 'mass' },
  { id: 'kg', name: 'Kilogram', type: 'mass' },
  { id: 'ml', name: 'Milliliter', type: 'volume' },
  { id: 'l', name: 'Liter', type: 'volume' },
  { id: 'pcs', name: 'Piece', type: 'count' },
  { id: 'box', name: 'Box', type: 'count' },
  { id: 'pk', name: 'Pack', type: 'count' }
]

/**
 * Normalizes unit string to lowercase canonical format
 */
export function normalizeUnit(unit) {
  if (!unit) return 'g'
  const u = String(unit).trim().toLowerCase()
  if (u === 'gram' || u === 'grams' || u === 'gm') return 'g'
  if (u === 'kilogram' || u === 'kilograms' || u === 'kgs') return 'kg'
  if (u === 'milliliter' || u === 'milliliters' || u === 'millilitre') return 'ml'
  if (u === 'liter' || u === 'liters' || u === 'litre' || u === 'litres' || u === 'ltr') return 'l'
  if (u === 'piece' || u === 'pieces' || u === 'pc') return 'pcs'
  return u
}

/**
 * Converts a quantity from one unit to another, accounting for ingredient density.
 *
 * @param {number} value - The numeric quantity to convert.
 * @param {string} fromUnit - Origin unit (e.g., 'kg', 'g', 'l', 'ml', 'pcs').
 * @param {string} toUnit - Target unit (e.g., 'g', 'ml', etc.).
 * @param {number} density - Density in g/mL (default 1.0000). For alcohol ~0.789, for perfume oils ~0.88 - 1.05.
 * @returns {number} The converted quantity.
 */
export function convertQuantity(value, fromUnit, toUnit, density = 1.0) {
  const val = Number(value)
  if (isNaN(val) || val === 0) return 0

  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  if (from === to) return val

  const d = Number(density) > 0 ? Number(density) : 1.0

  // 1. Convert origin unit to intermediate base:
  //    Mass -> grams (g)
  //    Volume -> milliliters (ml)
  //    Count -> pieces (pcs)
  let baseVal = val
  let baseType = 'mass' // 'mass' (g), 'volume' (ml), 'count' (pcs)

  switch (from) {
    case 'kg':
      baseVal = val * 1000
      baseType = 'mass'
      break
    case 'g':
      baseVal = val
      baseType = 'mass'
      break
    case 'l':
      baseVal = val * 1000
      baseType = 'volume'
      break
    case 'ml':
      baseVal = val
      baseType = 'volume'
      break
    case 'pcs':
    default:
      baseVal = val
      baseType = 'count'
      break
  }

  // 2. Cross-domain conversion using density (mass <-> volume)
  //    mass (g) = volume (ml) * density (g/ml)
  //    volume (ml) = mass (g) / density (g/ml)
  const targetIsVolume = (to === 'ml' || to === 'l')
  const targetIsMass = (to === 'g' || to === 'kg')

  if (baseType === 'mass' && targetIsVolume) {
    // g -> ml: ml = g / density
    baseVal = baseVal / d
    baseType = 'volume'
  } else if (baseType === 'volume' && targetIsMass) {
    // ml -> g: g = ml * density
    baseVal = baseVal * d
    baseType = 'mass'
  }

  // 3. Convert intermediate base to target unit:
  switch (to) {
    case 'kg':
      return baseVal / 1000
    case 'g':
      return baseVal
    case 'l':
      return baseVal / 1000
    case 'ml':
      return baseVal
    case 'pcs':
    default:
      return baseVal
  }
}

/**
 * Calculates formula batch requirement
 * @param {number} batchSize - Target batch volume/weight (e.g., 2000 mL or 1500 g)
 * @param {number} percentage - Percentage in formula (e.g., 20 for 20%)
 * @returns {number} Required quantity
 */
export function calculateTargetIngredient(batchSize, percentage) {
  const b = Number(batchSize) || 0
  const p = Number(percentage) || 0
  return Number(((b * p) / 100).toFixed(4))
}
