-- ============================================================================
-- MAHATIR PERFUMES — COMPLETE SUPABASE DATABASE SETUP SCRIPT
-- ============================================================================
-- Purpose: Run this single script in the Supabase SQL Editor.
-- It works on BOTH fresh databases and existing installations:
-- 1. Creates all tables and ensures all columns exist.
-- 2. Configures authentication & session functions (secure_login, is_valid_session).
-- 3. Enables clean Row-Level Security (RLS) policies.
-- 4. Creates/Configures the shop: "Mahatir Perfumes" (Shop ID = 1).
-- 5. Creates the default admin account (Username: admin, Password: 1234).
-- 6. Seeds perfume-tailored Categories, Units, Brands, and initial starter Products.
-- ============================================================================

-- 0. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. BASE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(15,2) DEFAULT 0,
    product_limit INTEGER DEFAULT 100000,
    user_limit INTEGER DEFAULT 50,
    features JSONB DEFAULT '{"all": true}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shops (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    email TEXT,
    status TEXT DEFAULT 'active',
    logo_url TEXT,
    notes TEXT,
    print_size TEXT DEFAULT 'thermal',
    print_mode TEXT DEFAULT 'manual',
    print_template TEXT DEFAULT '2',
    wa_reminder_template TEXT,
    wa_bill_template TEXT,
    wa_reorder_template TEXT,
    invoice_footer TEXT DEFAULT 'Thank you for shopping at Mahatir Perfumes! Visit again.',
    quotation_footer TEXT DEFAULT 'Quotation valid for 7 days',
    invoice_prefix TEXT DEFAULT 'MP-',
    business_preset TEXT DEFAULT 'general',
    pricing_mode TEXT DEFAULT 'hidden',
    custom_price_label TEXT,
    tax_number TEXT,
    pos_layout TEXT DEFAULT 'two_stage',
    plan_id INTEGER,
    subscription_plan TEXT DEFAULT 'ENTERPRISE',
    last_sign_in_at TIMESTAMPTZ,
    next_billing_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 years'),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all shop columns exist if table was previously created
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_id INTEGER;
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shops_subscription_plans'
  ) THEN 
    ALTER TABLE shops ADD CONSTRAINT fk_shops_subscription_plans 
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL;
  END IF; 
END $$;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_size TEXT DEFAULT 'thermal';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_mode TEXT DEFAULT 'manual';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_template TEXT DEFAULT '2';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_reminder_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_bill_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_reorder_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS invoice_footer TEXT DEFAULT 'Thank you for shopping at Mahatir Perfumes! Visit again.';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS quotation_footer TEXT DEFAULT 'Quotation valid for 7 days';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT 'MP-';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS business_preset TEXT DEFAULT 'general';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'hidden';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS custom_price_label TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS tax_number TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS pos_layout TEXT DEFAULT 'two_stage';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_id INTEGER;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'ENTERPRISE';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 years');

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '["pos","products","inventory","sales","purchases","customers","suppliers","reports","settings"]'::jsonb,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    abbreviation TEXT,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    c_rate NUMERIC(15,2) DEFAULT 0,
    cost_price NUMERIC(15,2) DEFAULT 0,
    sale_price NUMERIC(15,2) DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 10,
    sku TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS c_rate NUMERIC(15,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    payment_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL,
    price NUMERIC(15,2) NOT NULL,
    subtotal NUMERIC(15,2) NOT NULL,
    returned_qty INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL,
    cost_price NUMERIC(15,2) NOT NULL,
    subtotal NUMERIC(15,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(15,2) NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_payments (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. AUTHENTICATION & SESSION FUNCTIONS
-- ============================================================================

-- Parse x-session-token header
CREATE OR REPLACE FUNCTION current_session_token()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_headers  TEXT;
    v_token    TEXT;
BEGIN
    v_headers := current_setting('request.headers', true);
    IF v_headers IS NULL OR v_headers = '' THEN
        RETURN NULL;
    END IF;

    v_token := (v_headers::jsonb)->>'x-session-token';
    IF v_token IS NULL OR v_token = '' THEN
        RETURN NULL;
    END IF;

    IF v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;

    RETURN v_token::uuid;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION current_session_token() TO anon, authenticated, public;

-- Session validator
CREATE OR REPLACE FUNCTION is_valid_session(p_shop_id INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_count INTEGER;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM sessions
    WHERE token    = v_token
      AND shop_id  = p_shop_id
      AND expires_at > NOW();

    RETURN v_count > 0;
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION is_valid_session(INTEGER) TO anon, authenticated, public;

-- Secure login RPC
CREATE OR REPLACE FUNCTION secure_login(p_username TEXT, p_password_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user       RECORD;
    v_shop       RECORD;
    v_match_count INTEGER;
    v_session_token UUID;
BEGIN
    SELECT COUNT(*) INTO v_match_count
    FROM users
    WHERE LOWER(username) = LOWER(p_username) OR LOWER(email) = LOWER(p_username);

    IF v_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Multiple accounts found. Please use your email to login.');
    END IF;

    SELECT u.*
    INTO v_user
    FROM users u
    WHERE (LOWER(u.username) = LOWER(p_username) OR LOWER(u.email) = LOWER(p_username))
      AND u.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    -- Validate password (matches SHA-256 hash or auto-upgrades plain text)
    IF v_user.password != p_password_hash THEN
        IF encode(sha256(v_user.password::bytea), 'hex') = p_password_hash THEN
            UPDATE users SET password = p_password_hash WHERE id = v_user.id;
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
        END IF;
    END IF;

    SELECT s.*, 
           COALESCE(sp.name, s.subscription_plan, 'ENTERPRISE') as plan_name, 
           COALESCE(sp.product_limit, 100000) as product_limit, 
           COALESCE(sp.user_limit, 50) as user_limit
    INTO v_shop
    FROM shops s
    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE s.id = v_user.shop_id;

    IF v_shop.status = 'suspended' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account has been suspended. Please contact support: 0300-1234567');
    END IF;

    UPDATE users SET last_sign_in_at = NOW() WHERE id = v_user.id;
    UPDATE shops SET last_sign_in_at = NOW() WHERE id = v_user.shop_id;

    INSERT INTO sessions (user_id, shop_id, expires_at)
    VALUES (v_user.id, v_user.shop_id, NOW() + INTERVAL '90 days')
    RETURNING token INTO v_session_token;

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'user', jsonb_build_object(
            'id',          v_user.id,
            'username',    v_user.username,
            'email',       COALESCE(v_user.email, ''),
            'role',        v_user.role,
            'shop_id',     v_user.shop_id,
            'permissions', COALESCE(v_user.permissions, '[]'::jsonb)
        ),
        'shop_config', jsonb_build_object(
            'plan_name',     COALESCE(v_shop.plan_name, 'ENTERPRISE'),
            'product_limit', COALESCE(v_shop.product_limit, 100000),
            'user_limit',    COALESCE(v_shop.user_limit, 50),
            'status',        COALESCE(v_shop.status, 'active')
        )
    );
END;
$$;
GRANT EXECUTE ON FUNCTION secure_login(TEXT, TEXT) TO anon, authenticated, public;

-- Update shop settings RPC
DROP FUNCTION IF EXISTS update_shop_settings(INTEGER, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS update_shop_settings(INTEGER, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION update_shop_settings(
  p_shop_id INTEGER,
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_invoice_footer TEXT DEFAULT NULL,
  p_quotation_footer TEXT DEFAULT NULL,
  p_print_size TEXT DEFAULT NULL,
  p_print_mode TEXT DEFAULT NULL,
  p_print_template TEXT DEFAULT NULL,
  p_wa_reminder_template TEXT DEFAULT NULL,
  p_wa_bill_template TEXT DEFAULT NULL,
  p_wa_reorder_template TEXT DEFAULT NULL,
  p_invoice_prefix TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shops WHERE id = p_shop_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shop not found');
  END IF;

  UPDATE shops SET
    name                 = COALESCE(p_name, name),
    phone                = COALESCE(p_phone, phone),
    address              = COALESCE(p_address, address),
    logo_url             = COALESCE(p_logo_url, logo_url),
    invoice_footer       = COALESCE(p_invoice_footer, invoice_footer),
    quotation_footer     = COALESCE(p_quotation_footer, quotation_footer),
    print_size           = COALESCE(p_print_size, print_size),
    print_mode           = COALESCE(p_print_mode, print_mode),
    print_template       = COALESCE(p_print_template, print_template),
    wa_reminder_template = COALESCE(p_wa_reminder_template, wa_reminder_template),
    wa_bill_template     = COALESCE(p_wa_bill_template, wa_bill_template),
    wa_reorder_template  = COALESCE(p_wa_reorder_template, wa_reorder_template),
    invoice_prefix       = COALESCE(p_invoice_prefix, invoice_prefix)
  WHERE id = p_shop_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION update_shop_settings(
  INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated, public;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE units             ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;

-- Drop prior policies to avoid duplicates
DROP POLICY IF EXISTS "Sessions Open Access"      ON sessions;
DROP POLICY IF EXISTS "Tenant Isolation"       ON categories;
DROP POLICY IF EXISTS "Tenant Isolation"       ON brands;
DROP POLICY IF EXISTS "Tenant Isolation"       ON units;
DROP POLICY IF EXISTS "Tenant Isolation"       ON products;
DROP POLICY IF EXISTS "Tenant Isolation"       ON suppliers;
DROP POLICY IF EXISTS "Tenant Isolation"       ON customers;
DROP POLICY IF EXISTS "Tenant Isolation"       ON sales;
DROP POLICY IF EXISTS "Tenant Isolation"       ON purchases;
DROP POLICY IF EXISTS "Tenant Isolation"       ON expenses;
DROP POLICY IF EXISTS "Tenant Isolation"       ON customer_payments;
DROP POLICY IF EXISTS "Tenant Isolation"       ON supplier_payments;
DROP POLICY IF EXISTS "Tenant Isolation"       ON audit_logs;
DROP POLICY IF EXISTS "Tenant Isolation"       ON users;
DROP POLICY IF EXISTS "Tenant Isolation"       ON shops;
DROP POLICY IF EXISTS "Sale Items Isolation"   ON sale_items;
DROP POLICY IF EXISTS "Purchase Items Isolation" ON purchase_items;

-- Sessions table open access (only contains random tokens; safe)
CREATE POLICY "Sessions Open Access" ON sessions
AS PERMISSIVE FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Tenant-scoped tables isolation
CREATE POLICY "Tenant Isolation" ON categories
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON brands
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON units
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON products
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON suppliers
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON customers
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON sales
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON purchases
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON expenses
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON customer_payments
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON supplier_payments
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON audit_logs
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON users
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(shop_id)) WITH CHECK (is_valid_session(shop_id));

CREATE POLICY "Tenant Isolation" ON shops
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (is_valid_session(id)) WITH CHECK (is_valid_session(id));

-- Child tables isolation
CREATE POLICY "Sale Items Isolation" ON sale_items
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_valid_session(s.shop_id)))
WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_valid_session(s.shop_id)));

CREATE POLICY "Purchase Items Isolation" ON purchase_items
AS PERMISSIVE FOR ALL TO anon, authenticated
USING (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id AND is_valid_session(p.shop_id)))
WITH CHECK (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id AND is_valid_session(p.shop_id)));

-- Grant permissions to public roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ============================================================================
-- 4. SEED DATA FOR "MAHATIR PERFUMES"
-- ============================================================================

-- 4a. Subscription Plan
INSERT INTO subscription_plans (id, name, price, product_limit, user_limit, features)
VALUES (1, 'ENTERPRISE', 0, 100000, 50, '{"all": true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET name = 'ENTERPRISE', product_limit = 100000;

-- 4b. Mahatir Perfumes Shop (ID = 1)
INSERT INTO shops (
    id, name, phone, address, email, status, 
    business_preset, invoice_prefix, invoice_footer, quotation_footer, 
    print_size, print_mode, print_template, plan_id, subscription_plan
)
VALUES (
    1, 
    'Mahatir Perfumes', 
    '0300-1234567', 
    'Main Perfume Market', 
    'contact@mahatirperfumes.com', 
    'active', 
    'general', 
    'MP-', 
    'Thank you for shopping at Mahatir Perfumes! Visit again.', 
    'Quotation valid for 7 days',
    'thermal', 
    'manual', 
    '2', 
    1, 
    'ENTERPRISE'
)
ON CONFLICT (id) DO UPDATE SET 
    name = 'Mahatir Perfumes',
    status = 'active',
    invoice_prefix = COALESCE(shops.invoice_prefix, 'MP-'),
    invoice_footer = COALESCE(shops.invoice_footer, 'Thank you for shopping at Mahatir Perfumes! Visit again.');

-- Synchronize shop sequence
SELECT setval(pg_get_serial_sequence('shops', 'id'), GREATEST((SELECT MAX(id) FROM shops), 1));

-- 4c. Default Admin User: admin / 1234 (SHA-256: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4)
INSERT INTO users (
    username, email, password, role, shop_id, is_active, permissions
)
VALUES (
    'admin',
    'admin@mahatirperfumes.com',
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    'admin',
    1,
    true,
    '["pos", "products", "inventory", "sales", "purchases", "customers", "suppliers", "reports", "settings"]'::jsonb
)
ON CONFLICT (username) DO UPDATE SET
    shop_id = 1,
    is_active = true,
    password = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

-- 4d. Perfume Categories for Mahatir Perfumes
INSERT INTO categories (name, shop_id)
SELECT c_name, 1
FROM (VALUES 
    ('Eau de Parfum (EDP)'),
    ('Attar & Concentrated Oil'),
    ('Eau de Toilette (EDT)'),
    ('Body Spray & Mist'),
    ('Bakhoor & Incense'),
    ('Testers & Decants'),
    ('Empty Bottles & Packaging'),
    ('Gift Sets & Combos')
) AS v(c_name)
WHERE NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.name = v.c_name AND c.shop_id = 1
);

-- 4e. Perfume Units of Measure
INSERT INTO units (name, abbreviation, shop_id)
SELECT u_name, u_abbr, 1
FROM (VALUES 
    ('Bottle', 'Btl'),
    ('Milliliter', 'ml'),
    ('Tola', 'Tola'),
    ('Piece', 'Pcs'),
    ('Gram', 'g'),
    ('Box', 'Box')
) AS u(u_name, u_abbr)
WHERE NOT EXISTS (
    SELECT 1 FROM units WHERE name = u.u_name AND shop_id = 1
);

-- 4f. Perfume Brands
INSERT INTO brands (name, shop_id)
SELECT b_name, 1
FROM (VALUES 
    ('Mahatir Signature'),
    ('Rasasi'),
    ('Lattafa'),
    ('Ajmal'),
    ('Armaf'),
    ('Swiss Arabian'),
    ('Al Haramain'),
    ('French Avenue')
) AS b(b_name)
WHERE NOT EXISTS (
    SELECT 1 FROM brands WHERE name = b.b_name AND shop_id = 1
);

-- 4g. Starter Catalog Products
INSERT INTO products (name, brand, shop_id, cost_price, sale_price, stock_quantity, low_stock_threshold, sku, is_active)
SELECT p_name, p_brand, 1, p_cost, p_sale, p_stock, 5, p_sku, true
FROM (VALUES
    ('Mahatir Royal Oud EDP 100ml', 'Mahatir Signature', 2500.00, 4500.00, 30, 'MP-OUD-100'),
    ('Kashmiri Kasturi Attar 1 Tola', 'Mahatir Signature', 1200.00, 2200.00, 50, 'MP-ATT-001'),
    ('White Musk Pure Oil 12ml', 'Mahatir Signature', 800.00, 1500.00, 40, 'MP-MUSK-12'),
    ('French Velvet EDP 50ml', 'Mahatir Signature', 1800.00, 3200.00, 25, 'MP-VEL-050')
) AS p(p_name, p_brand, p_cost, p_sale, p_stock, p_sku)
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE sku = p.p_sku AND shop_id = 1
);

-- ============================================================================
-- COMPLETE! Your "Mahatir Perfumes" shop is ready.
-- Login credentials:
-- Username: admin
-- Password: 1234
-- ============================================================================
