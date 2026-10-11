-- ==============================================================================
-- MAHATIR PERFUMES — PERFUMERY MANUFACTURING & INVENTORY EXTENSION SCHEMA
-- Phase 1 to Phase 6 Consolidated Schema & Migrations
-- Idempotent: Safe to run multiple times in Supabase SQL Editor
-- ==============================================================================

-- 0. Ensure Shops Table Supports Business Modes
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS business_mode TEXT DEFAULT 'retailer';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'hidden';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS custom_price_label TEXT;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS has_manufacturing BOOLEAN DEFAULT FALSE;

-- 1. INVENTORY LOCATIONS (Storage zones per shop: Raw store, Packaging, WIP, Finished)
CREATE TABLE IF NOT EXISTS public.inventory_locations (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_locations_shop ON public.inventory_locations(shop_id);

-- 2. UNIFIED ITEM MASTER (Raw materials, packaging, chemicals, bulk liquid, finished goods)
CREATE TABLE IF NOT EXISTS public.items (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sku TEXT,
    barcode TEXT,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'raw_oil', 
    -- 'raw_oil', 'raw_chemical', 'packaging', 'bulk_liquid', 'finished_good', 'consumable'
    category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    brand_id INTEGER REFERENCES public.brands(id) ON DELETE SET NULL,
    base_unit TEXT NOT NULL DEFAULT 'g', -- 'g', 'ml', 'pcs'
    purchase_unit TEXT DEFAULT 'g',
    density NUMERIC(10,4) DEFAULT 1.0000, -- g/mL density for mass-volume conversion
    cost_price NUMERIC(15,2) DEFAULT 0,
    sale_price NUMERIC(15,2) DEFAULT 0,
    min_stock_level NUMERIC(15,2) DEFAULT 0,
    current_stock NUMERIC(15,4) DEFAULT 0,
    is_purchasable BOOLEAN DEFAULT TRUE,
    is_sellable BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column additions for items
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS density NUMERIC(10,4) DEFAULT 1.0000;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS current_stock NUMERIC(15,4) DEFAULT 0;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS base_unit TEXT DEFAULT 'g';
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS purchase_unit TEXT DEFAULT 'g';

CREATE INDEX IF NOT EXISTS idx_items_shop ON public.items(shop_id);
CREATE INDEX IF NOT EXISTS idx_items_type ON public.items(shop_id, item_type);
CREATE INDEX IF NOT EXISTS idx_items_sku ON public.items(shop_id, sku);

-- 3. UNIT CONVERSIONS (Item-specific or global metric conversions)
CREATE TABLE IF NOT EXISTS public.unit_conversions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES public.items(id) ON DELETE CASCADE,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    multiplier NUMERIC(15,6) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_conv_shop ON public.unit_conversions(shop_id);

-- 4. INVENTORY LOTS (Supplier batches, internal lot codes, and expiry dates)
CREATE TABLE IF NOT EXISTS public.inventory_lots (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    lot_number TEXT NOT NULL,
    supplier_lot_number TEXT,
    supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
    received_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE,
    initial_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
    available_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'available', -- 'available', 'quarantined', 'exhausted', 'expired'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_lots_shop ON public.inventory_lots(shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_lots_item ON public.inventory_lots(item_id, status);

-- 5. INVENTORY LEDGER (Immutable Movement Audit Log)
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
    transaction_type TEXT NOT NULL,
    -- 'purchase_receipt', 'supplier_return', 'production_issue', 'bulk_output', 
    -- 'bottling_issue', 'bottling_output', 'pos_sale', 'customer_return', 'adjustment_loss', 'reversal'
    quantity NUMERIC(15,4) NOT NULL, -- positive for credit/inward, negative for debit/outward
    base_unit TEXT NOT NULL,
    unit_cost NUMERIC(15,4) DEFAULT 0,
    total_cost NUMERIC(15,4) DEFAULT 0,
    reference_id TEXT, -- PO-xxx, BATCH-xxx, RUN-xxx, SALE-xxx
    notes TEXT,
    user_id TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column additions for inventory_ledger
ALTER TABLE public.inventory_ledger ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.inventory_ledger ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_ledger_shop ON public.inventory_ledger(shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_item ON public.inventory_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_type ON public.inventory_ledger(shop_id, transaction_type);

-- 6. FORMULAS / MASTER RECIPES (BOM)
CREATE TABLE IF NOT EXISTS public.formulas (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1.0',
    finished_item_id INTEGER REFERENCES public.items(id) ON DELETE SET NULL,
    target_volume_ml NUMERIC(15,2) DEFAULT 1000,
    calculation_basis TEXT DEFAULT 'weight_percentage', -- 'weight_percentage' (% w/w) or 'volume_percentage' (% v/v)
    notes TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    approved_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_formulas_shop ON public.formulas(shop_id);

-- 7. FORMULA INGREDIENTS
CREATE TABLE IF NOT EXISTS public.formula_ingredients (
    id SERIAL PRIMARY KEY,
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
    ingredient_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    percentage NUMERIC(8,4) NOT NULL, -- e.g. 20.0000 for 20%
    target_quantity NUMERIC(15,4),
    unit TEXT NOT NULL DEFAULT 'g',
    tolerance_percent NUMERIC(5,2) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_formula_ingredients ON public.formula_ingredients(formula_id);

-- 8. FORMULA PACKAGING BOMS
CREATE TABLE IF NOT EXISTS public.formula_packaging_boms (
    id SERIAL PRIMARY KEY,
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
    component_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    quantity_per_unit NUMERIC(10,2) NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_formula_packaging_boms ON public.formula_packaging_boms(formula_id);

-- 9. PRODUCTION BATCHES (Blending & Maceration)
CREATE TABLE IF NOT EXISTS public.production_batches (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL, -- e.g. MP-20261010-001
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE RESTRICT,
    planned_volume_ml NUMERIC(15,2) NOT NULL,
    actual_volume_ml NUMERIC(15,2),
    status TEXT DEFAULT 'draft', -- 'draft', 'in_blending', 'maturing', 'completed', 'cancelled'
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    operator_id TEXT,
    total_material_cost NUMERIC(15,2) DEFAULT 0,
    cost_per_ml NUMERIC(15,4) DEFAULT 0,
    qc_status TEXT DEFAULT 'pending', -- 'pending', 'passed', 'failed'
    qc_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_batches_shop ON public.production_batches(shop_id);
CREATE INDEX IF NOT EXISTS idx_prod_batches_batch_no ON public.production_batches(shop_id, batch_number);

-- 10. BATCH INGREDIENT ISSUES
CREATE TABLE IF NOT EXISTS public.batch_ingredient_issues (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES public.production_batches(id) ON DELETE CASCADE,
    ingredient_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    planned_quantity NUMERIC(15,4) NOT NULL,
    actual_quantity NUMERIC(15,4) NOT NULL,
    unit TEXT NOT NULL,
    unit_cost NUMERIC(15,4) DEFAULT 0,
    total_cost NUMERIC(15,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_ingredient_issues ON public.batch_ingredient_issues(batch_id);

-- 11. BOTTLING RUNS
CREATE TABLE IF NOT EXISTS public.bottling_runs (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    run_number TEXT NOT NULL,
    source_batch_id INTEGER NOT NULL REFERENCES public.production_batches(id) ON DELETE RESTRICT,
    target_finished_item_id INTEGER REFERENCES public.items(id) ON DELETE SET NULL,
    fill_size_ml NUMERIC(10,2) NOT NULL,
    planned_bottles INTEGER NOT NULL,
    actual_good_bottles INTEGER DEFAULT 0,
    rejected_bottles INTEGER DEFAULT 0,
    bulk_consumed_ml NUMERIC(15,2) NOT NULL,
    bulk_cost NUMERIC(15,2) DEFAULT 0,
    packaging_cost NUMERIC(15,2) DEFAULT 0,
    unit_cost NUMERIC(15,4) DEFAULT 0,
    qc_status TEXT DEFAULT 'approved',
    operator_id TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bottling_runs_shop ON public.bottling_runs(shop_id);

-- 12. BOTTLING COMPONENT ISSUES
CREATE TABLE IF NOT EXISTS public.bottling_component_issues (
    id SERIAL PRIMARY KEY,
    bottling_run_id INTEGER NOT NULL REFERENCES public.bottling_runs(id) ON DELETE CASCADE,
    component_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    quantity_used NUMERIC(10,2) NOT NULL,
    quantity_damaged NUMERIC(10,2) DEFAULT 0,
    unit_cost NUMERIC(15,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bottling_comp_issues ON public.bottling_component_issues(bottling_run_id);

-- 13. STORED PROCEDURE: Decrement item stock safely
DROP FUNCTION IF EXISTS public.decrement_item_stock(INTEGER, NUMERIC);
CREATE OR REPLACE FUNCTION public.decrement_item_stock(item_id INTEGER, qty NUMERIC)
RETURNS VOID AS $$
BEGIN
    UPDATE public.items
    SET current_stock = GREATEST(0, COALESCE(current_stock, 0) - qty)
    WHERE id = item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. SEED STANDARD INVENTORY LOCATIONS FOR ALL SHOPS
INSERT INTO public.inventory_locations (shop_id, name, code, is_default)
SELECT s.id, loc.name, loc.code, loc.is_default
FROM public.shops s
CROSS JOIN (
    VALUES 
        ('Raw Material Store', 'RAW', TRUE),
        ('Packaging Store', 'PKG', FALSE),
        ('WIP Blending & Maceration', 'WIP', FALSE),
        ('Finished Goods Shelf', 'FG', FALSE),
        ('Quarantine / QC Hold', 'QC', FALSE)
) AS loc(name, code, is_default)
WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il 
    WHERE il.shop_id = s.id AND il.name = loc.name
);

-- ==============================================================================
-- RLS POLICIES & PERMISSIONS
-- ==============================================================================
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_packaging_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_ingredient_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bottling_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bottling_component_issues ENABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role, anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_item_stock TO postgres, service_role, anon, authenticated;

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'inventory_locations', 'items', 'unit_conversions', 'inventory_lots',
        'inventory_ledger', 'formulas', 'formula_ingredients', 'formula_packaging_boms',
        'production_batches', 'batch_ingredient_issues', 'bottling_runs', 'bottling_component_issues'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY "allow_all_%s" ON public.%I FOR ALL USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
