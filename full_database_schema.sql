-- ==============================================================================
-- EDGEX POS / MAHATIR PERFUMES - FULL DATABASE BASELINE SCHEMA
-- ==============================================================================
-- Run this entire script in the Supabase SQL Editor of your new project:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SUBSCRIPTION PLANS
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

-- Default subscription plans
INSERT INTO public.subscription_plans (name, price, billing_cycle, product_limit, user_limit, features)
VALUES 
    ('TRIAL', 0, 'monthly', 100, 2, '["pos", "inventory"]'::jsonb),
    ('STANDARD', 2500, 'monthly', 1000, 5, '["pos", "inventory", "ledgers", "reports"]'::jsonb),
    ('ENTERPRISE', 5000, 'monthly', 10000, 20, '["pos", "inventory", "ledgers", "reports", "multi_user", "api"]'::jsonb)
ON CONFLICT DO NOTHING;

-- 2. SHOPS (TENANTS)
CREATE TABLE IF NOT EXISTS public.shops (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    logo_url TEXT,
    notes TEXT,
    plan_id INTEGER REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
    subscription_plan TEXT DEFAULT 'ENTERPRISE',
    subscription_fee NUMERIC(15,2) DEFAULT 0,
    next_billing_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    suspension_reason TEXT,
    business_mode TEXT DEFAULT 'retailer',
    business_type TEXT DEFAULT 'general',
    business_preset TEXT DEFAULT 'general',
    pricing_mode TEXT DEFAULT 'hidden',
    custom_price_label TEXT,
    pos_layout TEXT DEFAULT 'two_stage',
    print_size TEXT DEFAULT 'thermal',
    print_mode TEXT DEFAULT 'manual',
    print_template TEXT DEFAULT '2',
    invoice_prefix TEXT DEFAULT 'MP-',
    tax_number TEXT,
    invoice_footer TEXT DEFAULT 'Thank you for shopping! Visit again.',
    quotation_footer TEXT DEFAULT 'Quotation valid for 7 days',
    wa_reminder_template TEXT,
    wa_bill_template TEXT,
    wa_reorder_template TEXT,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. USERS
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

-- 4. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    low_stock_threshold INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. BRANDS
CREATE TABLE IF NOT EXISTS public.brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. UNITS OF MEASURE
CREATE TABLE IF NOT EXISTS public.units (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    abbreviation TEXT,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. BRAND-CATEGORY JUNCTION
CREATE TABLE IF NOT EXISTS public.brand_categories (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER REFERENCES public.brands(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES public.categories(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SUPPLIERS
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

-- 9. CUSTOMERS
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

-- 10. PRODUCTS
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

-- 11. SALES MASTER
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

-- 12. SALE ITEMS
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

-- 13. PURCHASES MASTER
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

-- 14. PURCHASE ITEMS
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

-- 15. EXPENSES
CREATE TABLE IF NOT EXISTS public.expenses (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(15,2) NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. CUSTOMER PAYMENTS (LEDGER)
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

-- 17. SUPPLIER PAYMENTS (LEDGER)
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

-- 18. AUDIT LOGS (SHOP & GLOBAL)
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

-- 19. SUBSCRIPTION PAYMENTS
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

-- 20. SHOP BACKUPS
CREATE TABLE IF NOT EXISTS public.shop_backups (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    backup_rows INTEGER DEFAULT 0,
    backed_up_by UUID,
    backed_up_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. SYSTEM CONFIGS
CREATE TABLE IF NOT EXISTS public.system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS public.announcements (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 23. EMAIL TEMPLATES
CREATE TABLE IF NOT EXISTS public.email_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 24. SUPPORT TICKETS
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 25. SESSIONS
CREATE TABLE IF NOT EXISTS public.sessions (
    token TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- INDEXES
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

-- BASELINE DATA
INSERT INTO public.shops (id, name) VALUES (1, 'EdgeX POS Store') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (username, password, role, shop_id, permissions) 
VALUES ('admin', '1234', 'admin', 1, '[]'::jsonb) 
ON CONFLICT (username) DO NOTHING;
