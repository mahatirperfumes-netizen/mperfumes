# EdgeX Perfumery & POS — AI Agent Guide

> **Audience:** All AI Agents & Developers working on this codebase.  
> **Source of Truth:** `TASK.md` (Implementation phases) and `docs/PROJECT_AUDIT.md` (Operational risks).  
> **Repository:** Mahatir Perfumes / EdgeX Multi-Tenant POS.

---

## 1. Executive Context & Core Principle

This application is a **multi-tenant cloud + offline POS** built with React 18, Vite 5, Tailwind CSS, Supabase (PostgreSQL + RLS), and Dexie (IndexedDB).

### ⚠️ Non-Negotiable Domain Rule
> **Purchasing raw ingredients must NEVER directly increase finished perfume stock; selling finished bottles at POS checkout must NEVER deduct raw materials.**

Perfumery operates on a strict manufacturing hierarchy:
$$\text{Raw Materials / Packaging} \xrightarrow{\text{Formula BOM}} \text{Production Batch (WIP Bulk Liquid)} \xrightarrow{\text{Bottling Run + Packaging}} \text{Finished Goods} \xrightarrow{\text{POS}} \text{Sale}$$

---

## 2. Multi-Tenant Dual Operating Mode

The system supports two distinct operating modes configured by **Superadmin**:

### Mode A: Standard Retail Seller (`business_mode: 'retailer'` — DEFAULT)
- **Target:** Retail perfume sellers, resellers, supermarkets, kiosks.
- **Workflow:** Purchases ready-made, packaged products from suppliers $\to$ directly increases shelf stock $\to$ sells at POS.
- **UI Behavior:** Clean, lightweight sidebar. Formulas, Blending batches, and Bottling runs are **completely hidden**. No unnecessary manufacturing complexity.

### Mode B: Perfumery Manufacturer (`business_mode: 'manufacturer'` — OPTIONAL)
- **Target:** Perfume houses, blending laboratories, and in-house perfume brands (e.g., Mahatir Perfumes).
- **Workflow:** 
  1. Purchases raw oils, chemicals, fixatives, ethanol, and packaging components (bottles, pumps, caps, boxes) into **lot-tracked raw inventory**.
  2. Blends raw materials into **Bulk Perfume Liquid (WIP)** using master formulas (% BOM).
  3. Bottles bulk liquid with packaging components into **Finished Goods** with exact calculated unit costs.
  4. Sells finished goods at POS.
- **UI Behavior:** Unlocks the **"Manufacturing & Blending"** navigation menu:
  - Formulas & Recipes (`/formulas`)
  - Blending Batches (`/production`)
  - Bottling Runs (`/bottling`)
  - Raw Materials & Packaging Procurement

---

## 3. Superadmin Controls & Feature Gating

### Superadmin Configuration
- Configured in `src/components/admin/CreateShopModal.jsx` and `EditShopModal.jsx` (and the standalone `superadmin/` app).
- Column: `shops.business_mode` (`'retailer'` | `'manufacturer'`).
- Feature Flag: `shops.features->>'manufacturing'` (`true` | `false`).

### How to Check in Frontend Code
```javascript
import { isManufacturer, hasFeature, getBusinessMode } from '../utils/featureGate'

// Check if current shop has manufacturing enabled
if (isManufacturer()) {
  // Show formulas, blending, bottling, raw material options
}
```
The shop mode is cached in `localStorage` under `shop_business_mode_${shopId}` to prevent layout flicker on initial render.

---

## 4. Perfumery Domain Specs & Physics

### Item Classifications (`item_type`)
| `item_type` | Description | Typical Unit | Purchasable? | Sellable at POS? |
| :--- | :--- | :---: | :---: | :---: |
| `raw_oil` | Inspired perfume oil / concentrate | `g`, `kg` | ✅ Yes | ❌ No |
| `raw_chemical` | Ethanol (alcohol), Fixatives (Ambroxan, Iso E Super), DPG | `g`, `mL`, `L` | ✅ Yes | ❌ No |
| `packaging` | Bottles, spray pumps, crimp collars, caps, labels, unit boxes | `pcs` | ✅ Yes | ❌ No |
| `bulk_liquid` | Blended, macerating perfume liquid (WIP) | `mL`, `L` | ❌ No (Yielded) | ❌ No |
| `finished_good`| Bottled perfume ready for customer purchase | `pcs` | ⚠️ Ready-made only | ✅ Yes |
| `consumable` | Filter paper, testing strips, pipette tips, lab gloves | `pcs` | ✅ Yes | ❌ No |

### Density & Mass-to-Volume Conversion
Aroma oils and solvents have distinct densities (typically $0.85$ to $1.08 \text{ g/mL}$):
$$\text{Mass (g)} = \text{Volume (mL)} \times \text{Density (g/mL)}$$
- Always store stock balances in the item's **`base_unit`** (`g`, `ml`, or `pcs`).
- Never assume $1\text{ g} = 1\text{ mL}$ for essential oils or aromatic compounds.

### Cost Accounting Engine
- **Moving Weighted Average Cost (MAC):** Landed cost per base unit incorporates item purchase price + allocated shipping/freight.
- **Bulk Liquid Cost:** Sum of exact lot costs of oils + solvents issued to the batch divided by total yielded volume ($\text{Cost/mL}$).
- **Bottling Unit Cost:**
  $$\text{Unit Cost} = \frac{(\text{Fill Volume (mL)} \times \text{Bulk Cost/mL}) + \text{Packaging Components Cost}}{\text{Good Finished Units}}$$

---

## 5. Schema Conventions & Safe Migrations

### Core Manufacturing Tables
1. `items`: Master catalog with `item_type`, `base_unit`, `density`, `min_stock_level`.
2. `inventory_lots`: Lot numbers, supplier lot numbers, expiry dates, received dates, remaining quantity, unit cost, quarantine status.
3. `inventory_ledger`: Immutable append-only audit trail for all stock events (`purchase_receipt`, `production_issue`, `bulk_output`, `bottling_issue`, `bottling_output`, `pos_sale`, `customer_return`, `adjustment_loss`, `reversal`).
4. `formulas` & `formula_ingredients`: Master BOM recipes with percentages (% w/w or % v/v).
5. `production_batches` & `batch_ingredient_issues`: Blending workbench tracking inputs by lot and bulk outputs.
6. `bottling_runs` & `bottling_component_issues`: Bottling workbench consuming bulk + packaging and minting finished lots.

### Schema Cache Reload & Zero-Downtime Rule
When applying database migrations in Supabase:
1. Always end scripts with: `NOTIFY pgrst, 'reload schema';`
2. Frontend mutations must include fallback column-stripping if PostgREST cache errors (`PGRST204`) occur. See `src/pages/POS.jsx` and `src/components/admin/CreateShopModal.jsx` for the standard pattern.

---

## 6. Critical Do's and Don'ts

| Do | Don't |
| :--- | :--- |
| ✅ Keep POS shell full-screen (`h-screen flex overflow-hidden`). | ❌ Don't add nested scrollbars or page-local `100vh` subtraction. |
| ✅ Guard all manufacturing menus behind `isManufacturer()`. | ❌ Don't show formulas or blending to default retail shops. |
| ✅ Use immutable ledger lines for stock adjustments. | ❌ Don't mutate historic lot transaction records directly. |
| ✅ Filter POS products strictly to `item_type === 'finished_good'`. | ❌ Don't display raw oils or spray pumps on the POS selling grid. |
| ✅ Preserve multi-tenant isolation via `shop_id`. | ❌ Never remove `shop_id` filter or bypass RLS policies. |
| ✅ Run `npm run lint` before committing changes. | ❌ Don't leave unresolved syntax errors or broken imports. |
