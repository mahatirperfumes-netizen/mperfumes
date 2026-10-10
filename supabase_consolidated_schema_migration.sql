-- ==============================================================================
-- EDGEX POS / MAHATIR PERFUMES - CONSOLIDATED SUPABASE SCHEMA & MIGRATION SCRIPT
-- ==============================================================================
-- This script is completely IDEMPOTENT (safe to run multiple times).
-- It creates all missing tables, adds all missing columns, sets up indexes,
-- and aligns all database fields with the actual frontend and backend codebase.
--
-- Instructions: Run this entire script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. SHOPS & TENANTS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.shops (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    logo_url TEXT,
    notes TEXT,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add all shop settings, billing, templates, and layout columns
ALTER TABLE public.shops 
    ADD COLUMN IF NOT EXISTS plan_id INTEGER,
    ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'ENTERPRISE',
    ADD COLUMN IF NOT EXISTS subscription_fee NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
    ADD COLUMN IF NOT EXISTS business_mode TEXT DEFAULT 'retailer',
    ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS business_preset TEXT DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'hidden',
    ADD COLUMN IF NOT EXISTS custom_price_label TEXT,
    ADD COLUMN IF NOT EXISTS pos_layout TEXT DEFAULT 'two_stage',
    ADD COLUMN IF NOT EXISTS print_size TEXT DEFAULT 'thermal',
    ADD COLUMN IF NOT EXISTS print_mode TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS print_template TEXT DEFAULT '2',
    ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT 'MP-',
    ADD COLUMN IF NOT EXISTS tax_number TEXT,
    ADD COLUMN IF NOT EXISTS invoice_footer TEXT DEFAULT 'Thank you for shopping! Visit again.',
    ADD COLUMN IF NOT EXISTS quotation_footer TEXT DEFAULT 'Quotation valid for 7 days',
    ADD COLUMN IF NOT EXISTS wa_reminder_template TEXT,
    ADD COLUMN IF NOT EXISTS wa_bill_template TEXT,
    ADD COLUMN IF NOT EXISTS wa_reorder_template TEXT;

-- ==============================================================================
-- 2. SUBSCRIPTION PLANS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(15,2) NOT NULL DEFAULT 0,
    billing_cycle TEXT DEFAULT 'monthly',
    product_limit INTEGER DEFAULT 1000,
    user_limit INTEGER DEFAULT 5,
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure default baseline plans exist
INSERT INTO public.subscription_plans (name, price, billing_cycle, product_limit, user_limit, features)
VALUES 
    ('TRIAL', 0, 'monthly', 100, 2, '["pos", "inventory"]'::jsonb),
    ('STANDARD', 2500, 'monthly', 1000, 5, '["pos", "inventory", "ledgers", "reports"]'::jsonb),
    ('ENTERPRISE', 5000, 'monthly', 10000, 20, '["pos", "inventory", "ledgers", "reports", "multi_user", "api"]'::jsonb)
ON CONFLICT DO NOTHING;

-- Link shops to subscription_plans foreign key if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_shops_subscription_plans'
    ) THEN
        ALTER TABLE public.shops 
        ADD CONSTRAINT fk_shops_subscription_plans 
        FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==============================================================================
-- 3. USERS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    raw_password TEXT,
    role TEXT NOT NULL DEFAULT 'cashier',
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '[]'::jsonb,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users 
    ADD COLUMN IF NOT EXISTS raw_password TEXT,
    ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ==============================================================================
-- 4. CATEGORIES & BRANDS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    low_stock_threshold INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.categories 
    ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Units of measure (e.g. Tola, ML, Gram, Bottle, Piece)
CREATE TABLE IF NOT EXISTS public.units (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    abbreviation TEXT,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand-Category Linking Junction Table
CREATE TABLE IF NOT EXISTS public.brand_categories (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER REFERENCES public.brands(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES public.categories(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. SUPPLIERS & CUSTOMERS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    outstanding_balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.suppliers 
    ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;

-- Sync outstanding_balance with balance if empty
UPDATE public.suppliers SET outstanding_balance = balance WHERE (outstanding_balance IS NULL OR outstanding_balance = 0) AND balance <> 0;

CREATE TABLE IF NOT EXISTS public.customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    outstanding_balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.customers 
    ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;

-- Sync outstanding_balance with balance if empty
UPDATE public.customers SET outstanding_balance = balance WHERE (outstanding_balance IS NULL OR outstanding_balance = 0) AND balance <> 0;

-- ==============================================================================
-- 6. PRODUCTS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
    unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    cost_price NUMERIC(15,2) DEFAULT 0,
    sale_price NUMERIC(15,2) DEFAULT 0,
    c_rate NUMERIC(15,2) DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 10,
    sku TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.products 
    ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS c_rate NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ==============================================================================
-- 7. SALES & SALE ITEMS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sales (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    payment_type TEXT DEFAULT 'cash',
    online_provider TEXT,
    transaction_ref TEXT,
    payment_details JSONB,
    sale_type TEXT DEFAULT 'pos',
    status TEXT DEFAULT 'completed',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.sales 
    ADD COLUMN IF NOT EXISTS customer_name TEXT,
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS online_provider TEXT,
    ADD COLUMN IF NOT EXISTS transaction_ref TEXT,
    ADD COLUMN IF NOT EXISTS payment_details JSONB,
    ADD COLUMN IF NOT EXISTS sale_type TEXT DEFAULT 'pos',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE TABLE IF NOT EXISTS public.sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES public.sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT,
    quantity INTEGER NOT NULL,
    price NUMERIC(15,2) NOT NULL,
    unit_price NUMERIC(15,2),
    cost_price NUMERIC(15,2) DEFAULT 0,
    subtotal NUMERIC(15,2) NOT NULL,
    line_total NUMERIC(15,2),
    returned_qty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.sale_items 
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS returned_qty INTEGER DEFAULT 0;

-- Backfill unit_price and line_total if null
UPDATE public.sale_items SET unit_price = price WHERE unit_price IS NULL;
UPDATE public.sale_items SET line_total = subtotal WHERE line_total IS NULL;

-- ==============================================================================
-- 8. PURCHASES & PURCHASE ITEMS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    payment_type TEXT DEFAULT 'cash',
    status TEXT DEFAULT 'completed',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.purchases 
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

CREATE TABLE IF NOT EXISTS public.purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER REFERENCES public.purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT,
    quantity INTEGER NOT NULL,
    cost_price NUMERIC(15,2) NOT NULL,
    unit_price NUMERIC(15,2),
    subtotal NUMERIC(15,2) NOT NULL,
    total_price NUMERIC(15,2),
    returned_qty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.purchase_items 
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS total_price NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS returned_qty INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill unit_price and total_price if null
UPDATE public.purchase_items SET unit_price = cost_price WHERE unit_price IS NULL;
UPDATE public.purchase_items SET total_price = subtotal WHERE total_price IS NULL;

-- ==============================================================================
-- 9. EXPENSES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(15,2) NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    note TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS note TEXT;

-- ==============================================================================
-- 10. CUSTOMER PAYMENTS & LEDGER
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.customer_payments (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    payment_type TEXT DEFAULT 'payment',
    payment_mode TEXT DEFAULT 'cash',
    bill_number TEXT,
    note TEXT,
    description TEXT,
    details TEXT,
    transaction_ref TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.customer_payments 
    ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment',
    ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS bill_number TEXT,
    ADD COLUMN IF NOT EXISTS note TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS details TEXT,
    ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

-- ==============================================================================
-- 11. SUPPLIER PAYMENTS & LEDGER
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    payment_type TEXT DEFAULT 'payment',
    payment_mode TEXT DEFAULT 'cash',
    bill_number TEXT,
    note TEXT,
    description TEXT,
    details TEXT,
    transaction_ref TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.supplier_payments 
    ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment',
    ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS bill_number TEXT,
    ADD COLUMN IF NOT EXISTS note TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS details TEXT,
    ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

-- ==============================================================================
-- 12. AUDIT LOGS (UNIFIED SHOP + SUPERADMIN)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action TEXT,
    action_type TEXT,
    actor_id UUID,
    actor_email TEXT,
    target_type TEXT,
    target_id TEXT,
    ip_address TEXT,
    entity TEXT,
    entity_id TEXT,
    details JSONB,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_logs 
    ADD COLUMN IF NOT EXISTS action_type TEXT,
    ADD COLUMN IF NOT EXISTS actor_id UUID,
    ADD COLUMN IF NOT EXISTS actor_email TEXT,
    ADD COLUMN IF NOT EXISTS target_type TEXT,
    ADD COLUMN IF NOT EXISTS target_id TEXT,
    ADD COLUMN IF NOT EXISTS ip_address TEXT,
    ADD COLUMN IF NOT EXISTS entity TEXT,
    ADD COLUMN IF NOT EXISTS entity_id TEXT,
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================================
-- 13. SUPERADMIN & PLATFORM TABLES
-- ==============================================================================

-- Subscription Payment Tracking
CREATE TABLE IF NOT EXISTS public.shop_payments (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    payment_type TEXT DEFAULT 'renewal',
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    recorded_by UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backups Registry
CREATE TABLE IF NOT EXISTS public.shop_backups (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    backup_rows INTEGER DEFAULT 0,
    backed_up_by UUID,
    backed_up_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Configuration (version flags, maintenance mode)
CREATE TABLE IF NOT EXISTS public.system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Broadcast Announcements
CREATE TABLE IF NOT EXISTS public.announcements (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Templates for Admin Broadcasts
CREATE TABLE IF NOT EXISTS public.email_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Masquerade / Admin Impersonation Sessions
CREATE TABLE IF NOT EXISTS public.sessions (
    token TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- ==============================================================================
-- 14. PERFORMANCE INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON public.products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_unit_id ON public.products(unit_id);
CREATE INDEX IF NOT EXISTS idx_sales_shop_id ON public.sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON public.sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_transaction_ref ON public.sales(transaction_ref);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_shop_id ON public.purchases(shop_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON public.customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON public.supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_shop_id ON public.audit_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);

-- ==============================================================================
-- 15. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Grant permissions for service_role and anon/authenticated
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role, anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, anon, authenticated;

-- Public / Authenticated read policies (adjust according to your multi-tenant isolation model)
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'shops', 'subscription_plans', 'users', 'categories', 'brands', 'units',
        'brand_categories', 'suppliers', 'customers', 'products', 'sales',
        'sale_items', 'purchases', 'purchase_items', 'expenses', 'customer_payments',
        'supplier_payments', 'audit_logs', 'shop_payments', 'shop_backups',
        'system_configs', 'announcements', 'email_templates', 'support_tickets', 'sessions'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY "allow_all_%s" ON public.%I FOR ALL USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;

-- Update get_shop_config to return business_mode & manufacturing flag
CREATE OR REPLACE FUNCTION public.get_shop_config(p_shop_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'status',            s.status,
    'business_mode',     COALESCE(s.business_mode, 'retailer'),
    'business_type',     COALESCE(s.business_type, 'general'),
    'plan_name',         COALESCE(p.name, 'Trial'),
    'product_limit',     COALESCE(p.product_limit, 50),
    'user_limit',        COALESCE(p.user_limit, 2),
    'next_billing_date', s.next_billing_date,
    'subscription_fee',  COALESCE(s.subscription_fee, p.price, 0),
    'features',          COALESCE(p.features, '{}'::jsonb)
  ) INTO v_result
  FROM public.shops s
  LEFT JOIN public.subscription_plans p ON s.plan_id = p.id
  WHERE s.id = p_shop_id;
  RETURN COALESCE(v_result, '{"error":"Shop not found"}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shop_config(INTEGER) TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 26. PERFUMERY MANUFACTURING & INVENTORY EXTENSION TABLES
-- ==============================================================================

-- Storage zones per shop
CREATE TABLE IF NOT EXISTS public.inventory_locations (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_locations_shop ON public.inventory_locations(shop_id);

-- Unified Item Master (raw oils, chemicals, packaging, bulk WIP, finished goods)
CREATE TABLE IF NOT EXISTS public.items (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sku TEXT,
    barcode TEXT,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'raw_oil', 
    category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    brand_id INTEGER REFERENCES public.brands(id) ON DELETE SET NULL,
    base_unit TEXT NOT NULL DEFAULT 'g',
    purchase_unit TEXT DEFAULT 'g',
    density NUMERIC(10,4) DEFAULT 1.0000,
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

CREATE INDEX IF NOT EXISTS idx_items_shop ON public.items(shop_id);
CREATE INDEX IF NOT EXISTS idx_items_type ON public.items(shop_id, item_type);
CREATE INDEX IF NOT EXISTS idx_items_sku ON public.items(shop_id, sku);

-- Unit conversions
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

-- Inventory Lots
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
    status TEXT DEFAULT 'available',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_lots_shop ON public.inventory_lots(shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_lots_item ON public.inventory_lots(item_id, status);

-- Inventory Ledger
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    location_id REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
    transaction_type TEXT NOT NULL,
    quantity NUMERIC(15,4) NOT NULL,
    base_unit TEXT NOT NULL,
    unit_cost NUMERIC(15,4) DEFAULT 0,
    total_cost NUMERIC(15,4) DEFAULT 0,
    reference_id TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_ledger_shop ON public.inventory_ledger(shop_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_item ON public.inventory_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_type ON public.inventory_ledger(shop_id, transaction_type);

-- Formulas (BOM)
CREATE TABLE IF NOT EXISTS public.formulas (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1.0',
    finished_item_id INTEGER REFERENCES public.items(id) ON DELETE SET NULL,
    target_volume_ml NUMERIC(15,2) DEFAULT 1000,
    calculation_basis TEXT DEFAULT 'weight_percentage',
    notes TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    approved_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_formulas_shop ON public.formulas(shop_id);

CREATE TABLE IF NOT EXISTS public.formula_ingredients (
    id SERIAL PRIMARY KEY,
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
    ingredient_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    percentage NUMERIC(8,4) NOT NULL,
    target_quantity NUMERIC(15,4),
    unit TEXT NOT NULL DEFAULT 'g',
    tolerance_percent NUMERIC(5,2) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.formula_packaging_boms (
    id SERIAL PRIMARY KEY,
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
    component_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    quantity_per_unit NUMERIC(10,2) NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Production Batches
CREATE TABLE IF NOT EXISTS public.production_batches (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    formula_id INTEGER NOT NULL REFERENCES public.formulas(id) ON DELETE RESTRICT,
    planned_volume_ml NUMERIC(15,2) NOT NULL,
    actual_volume_ml NUMERIC(15,2),
    status TEXT DEFAULT 'draft',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    operator_id TEXT,
    total_material_cost NUMERIC(15,2) DEFAULT 0,
    cost_per_ml NUMERIC(15,4) DEFAULT 0,
    qc_status TEXT DEFAULT 'pending',
    qc_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_batches_shop ON public.production_batches(shop_id);

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

-- Bottling Runs
CREATE TABLE IF NOT EXISTS public.bottling_runs (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    run_number TEXT NOT NULL,
    source_batch_id INTEGER NOT NULL REFERENCES public.production_batches(id) ON DELETE RESTRICT,
    target_finished_item_id INTEGER NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
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

-- Enable RLS & policies on all manufacturing tables
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

-- STORED PROCEDURE: Decrement item stock safely
CREATE OR REPLACE FUNCTION public.decrement_item_stock(p_item_id INTEGER, p_qty NUMERIC)
RETURNS VOID AS $$
BEGIN
    UPDATE public.items
    SET current_stock = GREATEST(0, COALESCE(current_stock, 0) - p_qty)
    WHERE id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.decrement_item_stock TO postgres, service_role, anon, authenticated;

-- SEED STANDARD INVENTORY LOCATIONS FOR ALL SHOPS
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

DO $$
DECLARE
    tbl text;
    mfg_tables text[] := ARRAY[
        'inventory_locations', 'items', 'unit_conversions', 'inventory_lots',
        'inventory_ledger', 'formulas', 'formula_ingredients', 'formula_packaging_boms',
        'production_batches', 'batch_ingredient_issues', 'bottling_runs', 'bottling_component_issues'
    ];
BEGIN
    FOREACH tbl IN ARRAY mfg_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY "allow_all_%s" ON public.%I FOR ALL USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';


