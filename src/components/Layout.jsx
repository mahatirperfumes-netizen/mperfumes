import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { hasFeature, isManufacturer, setBusinessMode } from '../utils/featureGate'
import {
  LayoutDashboard, ShoppingCart, Package, Layers, Boxes,
  Users, BookOpen, MessageSquare, Receipt, Truck,
  ShoppingBag, History, Wallet, BarChart3, UserCog,
  Settings as SettingsIcon, Trash2, LifeBuoy, Lock, Store,
  FlaskConical, Factory, Workflow, Star,
  Sun, Moon, Volume2, VolumeX
} from 'lucide-react'

let lastLayoutFetchTime = 0

function Layout({ children }) {
  const { user, logout, stopImpersonating } = useAuth()
  const { isDark, toggleTheme, soundEnabled, toggleSound } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const [lowStock, setLowStock] = useState([])
  const [shopName, setShopName] = useState(() => {
    const sid = user?.shop_id
    return (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EDGEX POS'
  })
  const [shopLogo, setShopLogo] = useState(() => {
    const sid = user?.shop_id
    return (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || ''
  })
  const [announcements, setAnnouncements] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })
  const [compactMode, setCompactMode] = useState(() => {
    const saved = localStorage.getItem('compact_mode')
    return saved === null ? true : saved === 'true'
  })
  const [planInfo, setPlanInfo] = useState(null)
  const [productCount, setProductCount] = useState(0)
  const dropdownRef = useRef(null)
  const userDropdownRef = useRef(null)

  const [favorites, setFavorites] = useState(() => {
    const sid = user?.shop_id
    if (!sid) return ['/pos', '/products', '/sales']
    try {
      const saved = localStorage.getItem(`shop_favorites_${sid}`)
      return saved ? JSON.parse(saved) : ['/pos', '/products', '/sales']
    } catch {
      return ['/pos', '/products', '/sales']
    }
  })

  const toggleFavorite = (path) => {
    const sid = user?.shop_id
    setFavorites(prev => {
      const next = prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
      if (sid) {
        localStorage.setItem(`shop_favorites_${sid}`, JSON.stringify(next))
      }
      return next
    })
  }

  const toggleSidebar = () => {
    const newVal = !sidebarCollapsed
    setSidebarCollapsed(newVal)
    localStorage.setItem('sidebar_collapsed', String(newVal))
  }

  const toggleCompactMode = () => {
    const newVal = !compactMode
    setCompactMode(newVal)
    localStorage.setItem('compact_mode', String(newVal))
  }

  useEffect(() => {
    const now = Date.now()
    const shouldFetch = (now - lastLayoutFetchTime) > 60 * 1000

    if (shouldFetch) {
      lastLayoutFetchTime = now
      fetchLowStock()
      fetchShopName()
      fetchAnnouncements()
      fetchPlanInfo()
    }

    const interval = setInterval(() => {
      lastLayoutFetchTime = Date.now()
      fetchLowStock()
      fetchShopName()
      fetchAnnouncements()
      fetchPlanInfo()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.shop_id])

  const fetchShopName = async () => {
    if (!user?.shop_id) return
    const sid = user.shop_id
    try {
      const { data } = await supabase.from('shops').select('*').eq('id', sid).maybeSingle()
      if (data?.name) {
        setShopName(data.name)
        localStorage.setItem(`shop_name_${sid}`, data.name)
      }
      if (data?.business_mode) {
        setBusinessMode(data.business_mode, sid)
      }
      // For logo: always prefer the locally-saved version (set immediately on upload)
      // Only fall back to Supabase value if we have nothing locally
      const localLogo = localStorage.getItem(`shop_logo_${sid}`) || ''
      if (localLogo) {
        setShopLogo(localLogo)
      } else if (data?.logo_url) {
        setShopLogo(data.logo_url)
        localStorage.setItem(`shop_logo_${sid}`, data.logo_url)
      }
    } catch (e) {
      const cachedName = localStorage.getItem(`shop_name_${sid}`)
      if (cachedName) setShopName(cachedName)
      const cachedLogo = localStorage.getItem(`shop_logo_${sid}`) || ''
      if (cachedLogo) setShopLogo(cachedLogo)
    }
  }

  useEffect(() => {
    // Re-read logo + shop name whenever Settings saves them to localStorage
    const handleStorage = () => {
      const sid = user?.shop_id
      const freshLogo = sid ? localStorage.getItem(`shop_logo_${sid}`) || '' : ''
      const freshName = sid ? localStorage.getItem(`shop_name_${sid}`) || '' : ''
      if (freshLogo) setShopLogo(freshLogo)
      if (freshName) setShopName(freshName)
    }
    window.addEventListener('storage', handleStorage)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const fetchLowStock = async () => {
    if (!user?.shop_id) return
    const { data } = await supabase
      .from('products')
      .select('name, stock_quantity, low_stock_threshold')
      .eq('shop_id', user.shop_id)

    if (data) {
      const filtered = data.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10))
      setLowStock(filtered)
    }
  }

  const fetchAnnouncements = async () => {
    try {
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .or(`shop_id.is.null,shop_id.eq.${user.shop_id}`)
        .order('created_at', { ascending: false })

      if (data) setAnnouncements(data)
    } catch (e) {
      console.error('Failed to fetch announcements')
    }
  }

  const fetchPlanInfo = async () => {
    if (!user?.shop_id) return
    try {
      const { data, error } = await supabase.rpc('get_shop_config', { p_shop_id: user.shop_id })
      if (!error && data) {
        setPlanInfo(data)
        if (data.business_mode) {
          setBusinessMode(data.business_mode, user.shop_id)
        }
        // Also fetch product count
        const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('shop_id', user.shop_id)
        setProductCount(count || 0)
      }
    } catch (e) {
      console.error('Plan Fetch Error', e)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const hasAccess = (moduleName, allowedRoles) => {
    if (user.role === 'admin' || user.role === 'superadmin') return true
    if (user.permissions && Array.isArray(user.permissions)) {
      return user.permissions.includes(moduleName)
    }
    return allowedRoles.includes(user.role)
  }

  const pageTitle = location.pathname.split('/').pop().replace('-', ' ').toUpperCase() || 'DASHBOARD'

  const allNavItems = [
    { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard', module: 'dashboard', roles: ['admin', 'manager', 'cashier', 'accountant'] },
    { to: '/pos', icon: <ShoppingCart size={18} />, label: 'POS Billing', module: 'pos', roles: ['admin', 'manager', 'cashier'] },
    { to: '/products', icon: <Package size={18} />, label: 'Products', module: 'products', roles: ['admin', 'manager'] },
    { to: '/master-data', icon: <Layers size={18} />, label: 'Master Data', module: 'categories', roles: ['admin', 'manager'] },
    { to: '/inventory', icon: <Boxes size={18} />, label: 'Stock Inventory', module: 'inventory', roles: ['admin', 'manager', 'accountant'] },
    { to: '/customers', icon: <Users size={18} />, label: 'Customers', module: 'customers', roles: ['admin', 'manager', 'cashier'] },
    { to: '/customer-ledger', icon: <BookOpen size={18} />, label: 'Customer Ledger', module: 'customers', roles: ['admin', 'manager', 'cashier'], feature: 'customer_ledger' },
    { to: '/whatsapp', icon: <MessageSquare size={18} />, label: 'WhatsApp Reminders', module: 'customers', roles: ['admin', 'manager', 'cashier'], feature: 'whatsapp' },
    { to: '/sales', icon: <Receipt size={18} />, label: 'Sales History', module: 'sales', roles: ['admin', 'manager', 'accountant'], feature: 'sales_history' },
    { to: '/suppliers', icon: <Truck size={18} />, label: 'Suppliers', module: 'suppliers', roles: ['admin', 'manager'], feature: 'suppliers' },
    { to: '/purchases', icon: <ShoppingBag size={18} />, label: 'Purchases', module: 'purchases', roles: ['admin', 'manager'], feature: 'purchases' },
    { to: '/purchase-history', icon: <History size={18} />, label: 'Purchase History', module: 'purchase-history', roles: ['admin', 'manager', 'accountant'], feature: 'purchases' },
    { to: '/formulas', icon: <FlaskConical size={18} />, label: 'Formulas & BOM', module: 'formulas', roles: ['admin', 'manager'], manufacturerOnly: true },
    { to: '/production', icon: <Workflow size={18} />, label: 'Production Batches', module: 'production', roles: ['admin', 'manager'], manufacturerOnly: true },
    { to: '/bottling', icon: <Factory size={18} />, label: 'Bottling Runs', module: 'bottling', roles: ['admin', 'manager'], manufacturerOnly: true },
    { to: '/expenses', icon: <Wallet size={18} />, label: 'Expenses', module: 'expenses', roles: ['admin'], feature: 'expenses' },
    { to: '/reports', icon: <BarChart3 size={18} />, label: 'Reports', module: 'reports', roles: ['admin', 'manager', 'accountant'], feature: 'reports' },
    { to: '/users', icon: <UserCog size={18} />, label: 'Manage Users', module: 'users', roles: ['admin'] },
    { to: '/settings', icon: <SettingsIcon size={18} />, label: 'Settings', module: 'settings', roles: ['admin'] },
    { to: '/trash', icon: <Trash2 size={18} />, label: 'Trash Bin', module: 'trash', roles: ['admin'], feature: 'trash_bin' },
    { to: '/support', icon: <LifeBuoy size={18} />, label: 'Help & Support', module: 'support', roles: ['admin', 'manager', 'cashier', 'accountant'] },
  ]

  return (
    <div className={`flex h-screen bg-[#f5f5f7] dark:bg-[#000000] overflow-hidden text-[#1d1d1f] dark:text-[#f5f5f7] ${compactMode ? 'compact-mode' : ''}`}>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed md:static inset-y-0 left-0 bg-[#f5f5f7] dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] border-r border-[#e5e5ea] dark:border-[#2c2c2e] flex flex-col shrink-0 z-50 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${sidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}>
        {/* Logo */}
        <div className={`p-4 border-b border-[#e5e5ea] dark:border-[#2c2c2e] flex ${sidebarCollapsed ? 'flex-col items-center gap-3' : 'items-center justify-between gap-2'} transition-all`}>
          <div className="flex items-center gap-3 min-w-0">
            {shopLogo ? (
              <div className="w-8 h-8 rounded-[9px] bg-white dark:bg-[#2c2c2e] border border-[#e5e5ea] dark:border-[#38383a] overflow-hidden flex-shrink-0 flex items-center justify-center p-0.5 shadow-xs">
                <img src={shopLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-8 h-8 bg-[#0071e3] text-white rounded-[9px] flex items-center justify-center font-bold text-sm shadow-[0_2px_6px_rgba(0,113,227,0.35)] flex-shrink-0">
                {shopName.charAt(0).toUpperCase()}
              </div>
            )}
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] truncate w-28">{shopName}</h1>
                <p className="text-[10px] text-[#86868b] dark:text-[#98989d] font-semibold tracking-wider uppercase mt-0.5">Control Center</p>
              </div>
            )}
          </div>
          
          {/* Collapse Toggle Button (Desktop Only) */}
          <button 
            onClick={toggleSidebar} 
            className="hidden md:flex items-center justify-center w-6 h-6 rounded-[7px] bg-[#e5e5ea] dark:bg-[#2c2c2e] hover:bg-[#d1d1d6] dark:hover:bg-[#3a3a3c] text-[#636366] dark:text-[#aeaeb2] hover:text-[#1d1d1f] dark:hover:text-white transition cursor-pointer flex-shrink-0 text-xs"
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {sidebarCollapsed ? "▶" : "◀"}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-3">
          {/* ── 0. Pinned / Favorites Section ── */}
          {favorites.length > 0 && (
            <NavSection
              label="Favorites"
              icon="⭐"
              badgeColor="text-[#b45309]"
              borderColor="border-[#fed7aa]"
              bgColor="bg-[#fffbeb]"
              collapsed={sidebarCollapsed}
            >
              {allNavItems
                .filter(item => {
                  if (!favorites.includes(item.to)) return false
                  if (item.manufacturerOnly && !isManufacturer()) return false
                  return hasAccess(item.module, item.roles)
                })
                .map(item => (
                  <NavItem
                    key={`pinned-${item.to}`}
                    to={item.to}
                    icon={item.icon}
                    label={item.label}
                    active={location.pathname === item.to || (item.to === '/master-data' && (location.pathname.startsWith('/master-data') || location.pathname === '/categories' || location.pathname === '/brands'))}
                    onClick={() => setSidebarOpen(false)}
                    collapsed={sidebarCollapsed}
                    isFavorite={true}
                    onToggleFavorite={toggleFavorite}
                    locked={item.feature && !hasFeature(item.feature)}
                  />
                ))}
            </NavSection>
          )}

          {/* ── 1. Core & Billing ── */}
          <NavSection
            label="Core & Billing"
            icon="⚡"
            badgeColor="text-[#0071e3]"
            borderColor="border-[#bfdbfe]"
            bgColor="bg-[#eff6ff]"
            collapsed={sidebarCollapsed}
          >
            <NavItem
              to="/dashboard"
              icon={<LayoutDashboard size={18} />}
              label="Dashboard"
              active={location.pathname === '/dashboard'}
              onClick={() => setSidebarOpen(false)}
              collapsed={sidebarCollapsed}
              isFavorite={favorites.includes('/dashboard')}
              onToggleFavorite={toggleFavorite}
            />
            {hasAccess('pos', ['admin', 'manager', 'cashier']) && (
              <NavItem
                to="/pos"
                icon={<ShoppingCart size={18} />}
                label="POS Billing"
                active={location.pathname === '/pos'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/pos')}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </NavSection>

          {/* ── 2. Inventory & Catalog ── */}
          <NavSection
            label="Inventory & Catalog"
            icon="📦"
            badgeColor="text-[#ea580c]"
            borderColor="border-[#fed7aa]"
            bgColor="bg-[#fff7ed]"
            collapsed={sidebarCollapsed}
          >
            {hasAccess('products', ['admin', 'manager']) && (
              <NavItem
                to="/products"
                icon={<Package size={18} />}
                label="Products"
                active={location.pathname === '/products'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/products')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('categories', ['admin', 'manager']) && (
              <NavItem
                to="/master-data"
                icon={<Layers size={18} />}
                label="Master Data"
                active={location.pathname.startsWith('/master-data') || location.pathname === '/categories' || location.pathname === '/brands'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/master-data')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('inventory', ['admin', 'manager', 'accountant']) && (
              <NavItem
                to="/inventory"
                icon={<Boxes size={18} />}
                label="Stock Inventory"
                active={location.pathname === '/inventory'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/inventory')}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </NavSection>

          {/* ── 3. Sales & Customers ── */}
          <NavSection
            label="Sales & Customers"
            icon="👥"
            badgeColor="text-[#16a34a]"
            borderColor="border-[#bbf7d0]"
            bgColor="bg-[#f0fdf4]"
            collapsed={sidebarCollapsed}
          >
            {hasAccess('customers', ['admin', 'manager', 'cashier']) && (
              <NavItem
                to="/customers"
                icon={<Users size={18} />}
                label="Customers"
                active={location.pathname === '/customers'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/customers')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('customers', ['admin', 'manager', 'cashier']) && (
              <NavItem
                to="/customer-ledger"
                icon={<BookOpen size={18} />}
                label="Customer Ledger"
                active={location.pathname === '/customer-ledger'}
                locked={!hasFeature('customer_ledger')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/customer-ledger')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('customers', ['admin', 'manager', 'cashier']) && (
              <NavItem
                to="/whatsapp"
                icon={<MessageSquare size={18} />}
                label="WhatsApp Reminders"
                active={location.pathname === '/whatsapp'}
                locked={!hasFeature('whatsapp')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/whatsapp')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('sales', ['admin', 'manager', 'accountant']) && (
              <NavItem
                to="/sales"
                icon={<Receipt size={18} />}
                label="Sales History"
                active={location.pathname === '/sales'}
                locked={!hasFeature('sales_history')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/sales')}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </NavSection>

          {/* ── 4. Procurement ── */}
          <NavSection
            label="Procurement"
            icon="🚚"
            badgeColor="text-[#4f46e5]"
            borderColor="border-[#c7d2fe]"
            bgColor="bg-[#eef2ff]"
            collapsed={sidebarCollapsed}
          >
            {hasAccess('suppliers', ['admin', 'manager']) && (
              <NavItem
                to="/suppliers"
                icon={<Truck size={18} />}
                label="Suppliers"
                active={location.pathname === '/suppliers'}
                locked={!hasFeature('suppliers')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/suppliers')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('purchases', ['admin', 'manager']) && (
              <NavItem
                to="/purchases"
                icon={<ShoppingBag size={18} />}
                label="Purchases"
                active={location.pathname === '/purchases'}
                locked={!hasFeature('purchases')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/purchases')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('purchase-history', ['admin', 'manager', 'accountant']) && (
              <NavItem
                to="/purchase-history"
                icon={<History size={18} />}
                label="Purchase History"
                active={location.pathname === '/purchase-history'}
                locked={!hasFeature('purchases')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/purchase-history')}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </NavSection>

          {/* ── 5. Manufacturing & Blending (Manufacturer Only) ── */}
          {isManufacturer() && (
            <NavSection
              label="Manufacturing & Lab"
              icon="⚗️"
              badgeColor="text-[#9333ea]"
              borderColor="border-[#e9d5ff]"
              bgColor="bg-[#faf5ff]"
              collapsed={sidebarCollapsed}
            >
              {hasAccess('formulas', ['admin', 'manager']) && (
                <NavItem
                  to="/formulas"
                  icon={<FlaskConical size={18} />}
                  label="Formulas & BOM"
                  active={location.pathname === '/formulas'}
                  onClick={() => setSidebarOpen(false)}
                  collapsed={sidebarCollapsed}
                  isFavorite={favorites.includes('/formulas')}
                  onToggleFavorite={toggleFavorite}
                />
              )}
              {hasAccess('production', ['admin', 'manager']) && (
                <NavItem
                  to="/production"
                  icon={<Workflow size={18} />}
                  label="Production Batches"
                  active={location.pathname === '/production'}
                  onClick={() => setSidebarOpen(false)}
                  collapsed={sidebarCollapsed}
                  isFavorite={favorites.includes('/production')}
                  onToggleFavorite={toggleFavorite}
                />
              )}
              {hasAccess('bottling', ['admin', 'manager']) && (
                <NavItem
                  to="/bottling"
                  icon={<Factory size={18} />}
                  label="Bottling Runs"
                  active={location.pathname === '/bottling'}
                  onClick={() => setSidebarOpen(false)}
                  collapsed={sidebarCollapsed}
                  isFavorite={favorites.includes('/bottling')}
                  onToggleFavorite={toggleFavorite}
                />
              )}
            </NavSection>
          )}

          {/* ── 6. Accounts & Admin ── */}
          <NavSection
            label="Accounts & Admin"
            icon="💼"
            badgeColor="text-[#e11d48]"
            borderColor="border-[#fecdd3]"
            bgColor="bg-[#fff1f2]"
            collapsed={sidebarCollapsed}
          >
            {hasAccess('expenses', ['admin']) && (
              <NavItem
                to="/expenses"
                icon={<Wallet size={18} />}
                label="Expenses"
                active={location.pathname === '/expenses'}
                locked={!hasFeature('expenses')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/expenses')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('reports', ['admin', 'manager', 'accountant']) && (
              <NavItem
                to="/reports"
                icon={<BarChart3 size={18} />}
                label="Reports"
                active={location.pathname === '/reports'}
                locked={!hasFeature('reports')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/reports')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('users', ['admin']) && (
              <NavItem
                to="/users"
                icon={<UserCog size={18} />}
                label="Manage Users"
                active={location.pathname === '/users'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/users')}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </NavSection>

          {/* ── 7. Settings & System ── */}
          <NavSection
            label="Settings & System"
            icon="⚙️"
            badgeColor="text-[#64748b]"
            borderColor="border-[#e2e8f0]"
            bgColor="bg-[#f8fafc]"
            collapsed={sidebarCollapsed}
          >
            {hasAccess('settings', ['admin']) && (
              <NavItem
                to="/settings"
                icon={<SettingsIcon size={18} />}
                label="Settings"
                active={location.pathname === '/settings'}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/settings')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {hasAccess('trash', ['admin']) && (
              <NavItem
                to="/trash"
                icon={<Trash2 size={18} />}
                label="Trash Bin"
                active={location.pathname === '/trash'}
                locked={!hasFeature('trash_bin')}
                onClick={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                isFavorite={favorites.includes('/trash')}
                onToggleFavorite={toggleFavorite}
              />
            )}
            <NavItem
              to="/support"
              icon={<LifeBuoy size={18} />}
              label="Help & Support"
              active={location.pathname === '/support'}
              onClick={() => setSidebarOpen(false)}
              collapsed={sidebarCollapsed}
              isFavorite={favorites.includes('/support')}
              onToggleFavorite={toggleFavorite}
            />
          </NavSection>
        </nav>

        {/* Credits */}
        {!sidebarCollapsed && (
          <div className="p-3 border-t border-[#e5e5ea] dark:border-[#2c2c2e] bg-[#f5f5f7] dark:bg-[#1c1c1e] flex flex-col gap-2">
            <div className="text-center px-1">
              <p className="text-[10px] text-[#86868b] dark:text-[#98989d] font-semibold uppercase tracking-wider mb-0.5">Developed with <span className="text-[#ff3b30]">❤︎</span> by</p>
              <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold leading-tight">EdgeX Digital<br />& Babar Joya</p>
              <p className="text-[10px] font-mono text-[#86868b] dark:text-[#98989d] mt-0.5">📞 0301-2616367</p>
            </div>
          </div>
        )}
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">

        {/* Top Header */}
        <header className="h-14 sm:h-16 bg-white dark:bg-[#1c1c1e] border-b border-[#e5e5ea] dark:border-[#2c2c2e] px-3 sm:px-4 md:px-6 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] z-20 transition-all">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden w-8 h-8 flex items-center justify-center text-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-lg transition flex-shrink-0">☰</button>
            <div className="flex flex-col min-w-0">
              <span className="text-gray-900 dark:text-[#f5f5f7] font-black tracking-tight text-sm sm:text-lg leading-none truncate max-w-[140px] sm:max-w-[300px]">{shopName}</span>
              <span className="text-gray-400 dark:text-[#86868b] font-bold tracking-tight text-[10px] uppercase mt-0.5">{pageTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Apple Sound Effects Toggle */}
            <button
              onClick={toggleSound}
              data-sound="toggle"
              className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border text-[10px] sm:text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer select-none ${
                soundEnabled
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-[#0071e3] dark:text-[#2997ff] border-blue-200 dark:border-blue-900/60 shadow-xs'
                  : 'bg-white dark:bg-[#2c2c2e] text-[#86868b] dark:text-[#98989d] border-[#e5e5ea] dark:border-[#38383a]'
              }`}
              title={soundEnabled ? "Sound Effects Enabled (Click to Mute)" : "Sound Effects Muted (Click to Enable)"}
            >
              {soundEnabled ? <Volume2 size={14} className="text-[#0071e3] dark:text-[#2997ff]" /> : <VolumeX size={14} />}
              <span className="hidden lg:inline">{soundEnabled ? "Audio On" : "Audio Muted"}</span>
            </button>

            {/* Apple Theme Switch (Light / Dark) */}
            <button
              onClick={toggleTheme}
              data-sound="toggle"
              className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border border-[#e5e5ea] dark:border-[#38383a] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[10px] sm:text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer select-none shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              title={isDark ? "Switch to Apple Light Mode" : "Switch to Apple Dark Mode"}
            >
              {isDark ? (
                <>
                  <Sun size={14} className="text-[#ff9f0a]" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon size={14} className="text-[#5856d6]" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            {/* Compact Mode Toggle */}
            <button
              onClick={toggleCompactMode}
              className={`px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border text-[10px] sm:text-xs font-bold transition flex items-center gap-1.5 cursor-pointer select-none ${
                compactMode
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900/60 shadow-sm shadow-blue-50 dark:shadow-none'
                  : 'bg-white dark:bg-[#2c2c2e] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-[#38383a] hover:bg-gray-50 dark:hover:bg-[#38383a]'
              }`}
              title={compactMode ? "Switch to Normal View" : "Switch to Compact View"}
            >
              <span>{compactMode ? "🔎" : "🔍"}</span>
              <span className="hidden xl:inline">{compactMode ? "Compact" : "Normal"}</span>
            </button>

            {/* Status Indicator — dot only on mobile, full pill on sm+ */}
            <div className={`flex items-center gap-1.5 rounded-full font-black uppercase tracking-widest ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400 animate-pulse'}`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-orange-500'}`}></span>
              <span className={`hidden md:inline text-[9px] px-2 py-1 rounded-full border ${isOnline ? 'bg-green-50 dark:bg-green-950/40 border-green-100 dark:border-green-900/60' : 'bg-orange-50 dark:bg-orange-950/40 border-orange-100 dark:border-orange-900/60'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Notification Bell */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2 rounded-full transition relative group ${showNotifications ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2c2c2e]'}`}
              >
                <div className={`${lowStock.length > 0 ? 'animate-bounce-slow' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                {lowStock.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white dark:border-[#1c1c1e] ring-1 ring-red-100 dark:ring-red-900">
                    {lowStock.length}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 mt-3 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl border border-gray-100 dark:border-[#2c2c2e] overflow-hidden z-50 origin-top-right">
                  <div className="p-4 bg-gray-50 dark:bg-[#2c2c2e] border-b border-gray-100 dark:border-[#38383a] flex justify-between items-center">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Alerts</h3>
                    <span className="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">{lowStock.length} Now</span>
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {lowStock.length === 0 ? (
                      <div className="p-10 text-center">
                        <span className="text-4xl mb-2 block">✅</span>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Stock levels are perfect!</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50 dark:divide-[#2c2c2e]">
                        <p className="px-4 py-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest bg-red-50/50 dark:bg-red-950/20">Low Stock 🚩</p>
                        {lowStock.map((p, i) => (
                          <div key={i} className="p-4 hover:bg-gray-50 dark:hover:bg-[#2c2c2e] transition flex justify-between items-center">
                            <div className="flex-1 pr-4">
                              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{p.name}</p>
                              <p className="text-xs text-red-500 font-medium">Only {p.stock_quantity} remaining</p>
                            </div>
                            <Link to="/inventory" onClick={() => setShowNotifications(false)} className="px-3 py-1 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded text-[10px] font-black hover:bg-blue-600 hover:text-white transition uppercase">Restock</Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {lowStock.length > 0 && (
                    <div className="p-3 bg-gray-50 dark:bg-[#2c2c2e] border-t border-gray-100 dark:border-[#38383a] text-center">
                      <Link to="/inventory" onClick={() => setShowNotifications(false)} className="text-xs font-bold text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition">Go to Inventory Management →</Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-gray-200 dark:bg-[#2c2c2e] hidden sm:block"></div>

            <div className="flex items-center gap-2 sm:gap-3 relative" ref={userDropdownRef}>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-black text-gray-800 dark:text-gray-100 leading-none">{user?.username}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">{user?.role}</p>
              </div>
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-black shadow-lg shadow-blue-100 dark:shadow-none ring-4 ring-blue-50 dark:ring-blue-950/50 focus:outline-none focus:ring-blue-200 transition hover:scale-105"
              >
                {user?.username?.charAt(0).toUpperCase()}
              </button>

              {/* User Dropdown */}
              {showUserDropdown && (
                <div className="absolute top-[120%] right-0 w-48 bg-white dark:bg-[#1c1c1e] rounded-xl shadow-2xl border border-gray-100 dark:border-[#2c2c2e] overflow-hidden z-50 origin-top-right">
                  <div className="p-4 border-b border-gray-50 dark:border-[#2c2c2e] block sm:hidden">
                    <p className="text-sm font-black text-gray-800 dark:text-gray-100 leading-none">{user?.username}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">{user?.role}</p>
                  </div>
                  <div className="p-2">
                    {user?.isImpersonating && (
                      <button
                        onClick={() => {
                          stopImpersonating()
                          navigate('/admin/shops')
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg font-bold flex items-center gap-2 transition mb-1 cursor-pointer"
                      >
                        <span>🔙</span> Exit Shop
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      data-sound="delete"
                      className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg font-bold flex items-center gap-2 transition cursor-pointer"
                    >
                      <span>🚪</span> Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Impersonation Banner */}
        {user?.isImpersonating && (
          <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between text-sm shadow-inner z-10 shrink-0">
            <div className="flex items-center gap-2 font-bold">
              <span className="animate-pulse">🕵️‍♂️</span>
              <span>SUPERADMIN MODE: You are currently viewing {shopName}'s POS system.</span>
            </div>
            <button
              onClick={() => {
                stopImpersonating()
                navigate('/admin/shops')
              }}
              className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer"
            >
              Exit to Superadmin
            </button>
          </div>
        )}

        {/* Global Announcements Banner */}
        {announcements.length > 0 && (
          <div className="flex flex-col shrink-0">
            {announcements.map(ann => (
              <div
                key={ann.id}
                className={`px-4 py-2 flex items-center justify-between text-sm shadow-sm z-10 ${ann.type === 'error' ? 'bg-red-600 text-white' :
                  ann.type === 'warning' ? 'bg-orange-500 text-white' :
                    ann.type === 'success' ? 'bg-emerald-600 text-white' :
                      'bg-blue-600 text-white'
                  }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="animate-pulse">📢</span>
                  <span>{ann.message}</span>
                </div>
                <button
                  onClick={() => setAnnouncements(announcements.filter(a => a.id !== ann.id))}
                  className="p-1 hover:bg-black/10 rounded-full transition"
                  title="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[#f5f5f7] dark:bg-[#000000] custom-scrollbar relative">
          <div className="mx-auto w-full h-full p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .animate-bounce-slow { animation: bounce-slow 2s infinite; }

        /* Compact Mode Overrides */
        .compact-mode main > div {
          padding: 0.5rem !important;
          max-width: 100% !important;
        }
        .compact-mode header {
          height: 3rem !important;
        }
        .compact-mode h1 {
          font-size: 1.25rem !important;
          line-height: 1.75rem !important;
        }
        .compact-mode h2 {
          font-size: 1rem !important;
          line-height: 1.5rem !important;
        }
        .compact-mode h3 {
          font-size: 0.875rem !important;
          line-height: 1.25rem !important;
        }
        /* Tables general density */
        .compact-mode table th {
          padding: 0.375rem 0.5rem !important;
          font-size: 0.75rem !important;
        }
        .compact-mode table td {
          padding: 0.375rem 0.5rem !important;
          font-size: 0.75rem !important;
        }
        .compact-mode table td input,
        .compact-mode table td select {
          padding: 0.125rem 0.25rem !important;
          font-size: 0.75rem !important;
        }
        /* Forms, inputs and generic buttons */
        .compact-mode input:not([type="checkbox"]):not([type="radio"]),
        .compact-mode select,
        .compact-mode button:not(.md\\:hidden):not(.pos-floating-btn):not(.fixed):not(.flex-shrink-0) {
          padding-top: 0.375rem !important;
          padding-bottom: 0.375rem !important;
          font-size: 0.75rem !important;
          border-radius: 0.5rem !important;
        }
        .compact-mode select {
          padding-right: 2rem !important;
        }
        /* Grid gap density */
        .compact-mode .grid {
          gap: 0.5rem !important;
        }
        .compact-mode .space-y-6 > * + * {
          margin-top: 0.75rem !important;
        }
        .compact-mode .space-y-4 > * + * {
          margin-top: 0.5rem !important;
        }
        .compact-mode .p-6 {
          padding: 0.75rem !important;
        }
        .compact-mode .p-4 {
          padding: 0.5rem !important;
        }
        .compact-mode .p-3 {
          padding: 0.375rem !important;
        }
        .compact-mode .rounded-2xl {
          border-radius: 0.75rem !important;
        }
        .compact-mode .rounded-xl {
          border-radius: 0.5rem !important;
        }
        /* POS Specific overrides */
        .compact-mode .pos-product-card {
          padding: 0.375rem !important;
          border-radius: 0.5rem !important;
        }
        .compact-mode .pos-product-card p {
          font-size: 0.75rem !important;
        }
        .compact-mode .pos-cart-item {
          padding: 0.375rem !important;
          border-radius: 0.5rem !important;
        }
      `}</style>
    </div>
  )
}

function NavSection({ label, icon, badgeColor, borderColor, bgColor, collapsed, children }) {
  if (collapsed) {
    return (
      <div className="my-2 pt-1.5 border-t border-[#e5e5ea] dark:border-[#2c2c2e]">
        <ul className="space-y-1">
          {children}
        </ul>
      </div>
    )
  }

  // Derive matching dot background from badgeColor
  const dotColorClass = badgeColor ? badgeColor.replace('text-', 'bg-') : 'bg-[#0071e3]'

  return (
    <div className={`p-2 rounded-[16px] border transition-all ${borderColor || 'border-[#e5e5ea]'} ${bgColor || 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]'} dark:!bg-[#1f1f23] dark:!border-[#323238] dark:shadow-none`}>
      {/* Prominent Section Header Banner with slightly dark background */}
      <div className="flex items-center justify-between px-2.5 py-1.5 mb-2 rounded-[10px] bg-black/[0.06] dark:bg-black/50 border border-black/[0.06] dark:border-white/[0.08] shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <span className="w-5 h-5 rounded-[6px] bg-white dark:bg-white/[0.12] border border-black/[0.06] dark:border-white/[0.1] shadow-xs flex items-center justify-center text-[11px] shrink-0 select-none">
              {icon}
            </span>
          )}
          <span className={`text-[11px] font-black tracking-wider uppercase truncate ${badgeColor || 'text-gray-900'} dark:!text-white`}>
            {label}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColorClass} opacity-90 dark:opacity-100 shadow-xs ring-2 ring-white/60 dark:ring-black/60`} />
      </div>
      <ul className="space-y-0.5">
        {children}
      </ul>
    </div>
  )
}

function NavItem({ to, icon, label, active, onClick, locked, collapsed, isFavorite, onToggleFavorite }) {
  return (
    <li className="relative group/nav">
      <Link
        to={to}
        onClick={onClick}
        title={collapsed ? label + (locked ? " (Locked)" : "") : undefined}
        className={`flex items-center rounded-[10px] transition-all font-medium text-xs ${
          collapsed ? 'justify-center p-2.5 mx-0.5' : 'gap-2.5 px-3 py-2'
        } ${
          active
            ? 'bg-[#0071e3] text-white shadow-[0_2px_6px_rgba(0,113,227,0.35)] font-semibold'
            : locked
              ? 'text-[#8e8e93] dark:text-[#636366] opacity-60 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
              : 'text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] active:scale-98'
        }`}
      >
        <span className={`flex-shrink-0 flex items-center justify-center ${active ? 'text-white' : 'text-[#636366] dark:text-[#98989d] group-hover/nav:text-[#1d1d1f] dark:group-hover/nav:text-white'}`}>
          {icon}
        </span>
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {!collapsed && locked && <Lock size={12} className="ml-auto text-[#8e8e93] dark:text-[#636366]" />}

        {!locked && onToggleFavorite && !collapsed && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleFavorite(to)
            }}
            title={isFavorite ? "Remove from Favorites" : "Pin to Favorites"}
            className={`transition-opacity p-1 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer opacity-70 md:opacity-0 md:group-hover/nav:opacity-100 ${
              isFavorite ? '!opacity-100 text-[#ff9500]' : 'text-[#8e8e93] dark:text-[#98989d] hover:text-[#ff9500]'
            }`}
          >
            <Star size={13} className={isFavorite ? 'fill-[#ff9500] stroke-[#ff9500]' : 'stroke-current'} />
          </button>
        )}
      </Link>
    </li>
  )
}

export default Layout
