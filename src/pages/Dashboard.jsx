import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { printHTML, getShopBranding } from '../utils/printUtils'
import { isManufacturer } from '../utils/featureGate'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import {
  TrendingUp, ShoppingCart, Package, Users, AlertTriangle,
  ArrowUpRight, Clock, Printer, MessageSquare, RefreshCw,
  Wallet, ChevronRight, FlaskConical, Factory,
  Sparkles, CheckCircle2, DollarSign, Layers, Workflow
} from 'lucide-react'

const PIE_COLORS = ['#34c759', '#ff9500', '#0071e3', '#af52de', '#ff2d55']

export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('today') // 'today', 'week', 'month', 'year'

  // Financial & Operational Metrics
  const [stats, setStats] = useState({
    periodSales: 0,
    periodDiscount: 0,
    periodNetSales: 0,
    periodProfit: 0,
    profitMargin: 0,
    cashSales: 0,
    creditSales: 0,
    bankSales: 0,
    periodExpenses: 0,
    periodPurchases: 0,
    totalReceivables: 0,
    lowStockCount: 0,
    productCount: 0,
    planInfo: null,
    // Manufacturer metrics
    activeBatchesCount: 0,
    maturingVolumeMl: 0,
    bottledUnitsCount: 0
  })

  // List Data
  const [salesTrend, setSalesTrend] = useState([])
  const [paymentBreakdown, setPaymentBreakdown] = useState([])
  const [recentSales, setRecentSales] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [lowStockProducts, setLowStockProducts] = useState([])
  const [topDebtors, setTopDebtors] = useState([])

  // End of Day (EOD) Modal
  const [showEOD, setShowEOD] = useState(false)
  const [eodData, setEodData] = useState(null)
  const [eodLoading, setEodLoading] = useState(false)

  useEffect(() => {
    if (user?.shop_id) {
      fetchDashboardData(timeRange)
    }
  }, [user?.shop_id, timeRange])

  const getDateBoundary = (range) => {
    const now = new Date()
    const d = new Date(now)
    if (range === 'today') {
      d.setHours(0, 0, 0, 0)
    } else if (range === 'week') {
      d.setDate(d.getDate() - 7)
      d.setHours(0, 0, 0, 0)
    } else if (range === 'month') {
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
    } else if (range === 'year') {
      d.setMonth(0, 1)
      d.setHours(0, 0, 0, 0)
    }
    return d
  }

  const fetchDashboardData = async (range = 'today') => {
    setLoading(true)
    const startDate = getDateBoundary(range)
    const startISO = startDate.toISOString()

    try {
      if (!navigator.onLine) throw new Error('Offline')

      // 1. Parallel queries
      const queries = [
        // Period Sales
        supabase
          .from('sales')
          .select('id, invoice_number, total_amount, discount, payment_type, created_at, customer_name, cashier_name, sale_items(cost_price, quantity, returned_qty, product_name)')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .gte('created_at', startISO)
          .order('created_at', { ascending: false }),

        // Recent Sales (for live feed)
        supabase
          .from('sales')
          .select('id, invoice_number, total_amount, discount, payment_type, created_at, customer_name, customer_id')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .order('created_at', { ascending: false })
          .limit(6),

        // Customers (Receivables & Debtors)
        supabase
          .from('customers')
          .select('id, name, phone, outstanding_balance')
          .eq('shop_id', user.shop_id),

        // Products (Stock inventory)
        supabase
          .from('products')
          .select('id, name, stock_quantity, low_stock_threshold, cost_price, sale_price')
          .eq('shop_id', user.shop_id),

        // Expenses in period
        supabase
          .from('expenses')
          .select('amount')
          .eq('shop_id', user.shop_id)
          .gte('created_at', startISO),

        // Purchases in period
        supabase
          .from('purchases')
          .select('total_amount, payment_type')
          .eq('shop_id', user.shop_id)
          .gte('created_at', startISO),

        // Shop Config
        supabase.rpc('get_shop_config', { p_shop_id: user.shop_id })
      ]

      // Add Manufacturing queries if manufacturer
      if (isManufacturer()) {
        queries.push(
          supabase
            .from('production_batches')
            .select('id, planned_volume_ml, actual_volume_ml, status, cost_per_ml')
            .eq('shop_id', user.shop_id)
        )
        queries.push(
          supabase
            .from('bottling_runs')
            .select('id, actual_good_bottles')
            .eq('shop_id', user.shop_id)
        )
      }

      const results = await Promise.all(queries)

      const salesRes = results[0]
      const recentRes = results[1]
      const custRes = results[2]
      const prodRes = results[3]
      const expRes = results[4]
      const purRes = results[5]
      const shopConfigRes = results[6]
      const mfgBatchesRes = isManufacturer() ? results[7] : null
      const mfgBottlingRes = isManufacturer() ? results[8] : null

      const config = shopConfigRes.data || {}
      if (config.status === 'suspended' && !user.isImpersonating) {
        alert('Aap ka account fee na-adaiyegy ki wajah se muattal (suspended) kar diya gaya hai.')
        logout()
        navigate('/')
        return
      }

      // Calculations
      const salesList = salesRes.data || []
      const grossSales = salesList.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
      const totalDiscount = salesList.reduce((sum, s) => sum + Number(s.discount || 0), 0)
      const netSales = grossSales - totalDiscount

      const totalCOGS = salesList.reduce((sum, s) => {
        return sum + (s.sale_items || []).reduce((iSum, i) => {
          const qty = Math.max(0, Number(i.quantity || 0) - Number(i.returned_qty || 0))
          return iSum + (Number(i.cost_price || 0) * qty)
        }, 0)
      }, 0)

      const grossProfit = netSales - totalCOGS
      const profitMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0

      // Payment Breakdown
      const cashSales = salesList.filter(s => s.payment_type === 'cash').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const creditSales = salesList.filter(s => s.payment_type === 'credit').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const bankSales = salesList.filter(s => s.payment_type !== 'cash' && s.payment_type !== 'credit').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)

      setPaymentBreakdown([
        { name: 'Cash', value: cashSales },
        { name: 'Credit / Udhaar', value: creditSales },
        { name: 'Bank / Digital', value: bankSales }
      ].filter(p => p.value > 0))

      // Expenses & Purchases
      const totalExpenses = (expRes.data || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)
      const totalPurchases = (purRes.data || []).reduce((sum, p) => sum + Number(p.total_amount || 0), 0)

      // Customers & Receivables
      const custList = custRes.data || []
      const totalReceivables = custList.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
      const debtors = custList
        .filter(c => Number(c.outstanding_balance) > 0)
        .sort((a, b) => Number(b.outstanding_balance) - Number(a.outstanding_balance))
        .slice(0, 5)

      // Products & Stock Alerts
      const prodList = prodRes.data || []
      const lowStockList = prodList.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10))

      // Top Selling Products in Period
      const productMap = {}
      salesList.forEach(s => {
        (s.sale_items || []).forEach(item => {
          const name = item.product_name || 'Product'
          const qty = Number(item.quantity || 0)
          const rev = qty * Number(item.cost_price || 0) // approximate
          if (!productMap[name]) productMap[name] = { name, qty: 0, revenue: 0 }
          productMap[name].qty += qty
          productMap[name].revenue += rev
        })
      })
      const sortedTopProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 5)

      // Sales Trend Timeline
      const trendMap = {}
      salesList.forEach(s => {
        const dateKey = range === 'today'
          ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : new Date(s.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })

        const amt = Number(s.total_amount || 0) - Number(s.discount || 0)
        if (!trendMap[dateKey]) trendMap[dateKey] = { time: dateKey, amount: 0, orders: 0 }
        trendMap[dateKey].amount += amt
        trendMap[dateKey].orders += 1
      })
      const trendArray = Object.values(trendMap).slice(-12)

      // Manufacturing metrics
      let activeBatches = 0
      let maturingBulkMl = 0
      let totalBottled = 0
      if (mfgBatchesRes && mfgBatchesRes.data) {
        activeBatches = mfgBatchesRes.data.filter(b => b.status === 'in_blending' || b.status === 'maturing').length
        maturingBulkMl = mfgBatchesRes.data
          .filter(b => b.status === 'maturing' || b.status === 'completed')
          .reduce((sum, b) => sum + Number(b.actual_volume_ml || b.planned_volume_ml || 0), 0)
      }
      if (mfgBottlingRes && mfgBottlingRes.data) {
        totalBottled = mfgBottlingRes.data.reduce((sum, r) => sum + Number(r.actual_good_bottles || 0), 0)
      }

      setStats({
        periodSales: grossSales,
        periodDiscount: totalDiscount,
        periodNetSales: netSales,
        periodProfit: grossProfit,
        profitMargin,
        cashSales,
        creditSales,
        bankSales,
        periodExpenses: totalExpenses,
        periodPurchases: totalPurchases,
        totalReceivables,
        lowStockCount: lowStockList.length,
        productCount: prodList.length,
        planInfo: config,
        activeBatchesCount: activeBatches,
        maturingVolumeMl: maturingBulkMl,
        bottledUnitsCount: totalBottled
      })

      setRecentSales(recentRes.data || [])
      setTopProducts(sortedTopProducts)
      setLowStockProducts(lowStockList.slice(0, 5))
      setTopDebtors(debtors)
      setSalesTrend(trendArray)

    } catch (err) {
      console.warn('Dashboard: Using offline local storage', err)
      // Offline fallback from Dexie
      try {
        const sid = String(user.shop_id)
        const [lSales, lCustomers, lProducts] = await Promise.all([
          db.sales.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.sales.toArray()),
          db.customers.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.customers.toArray()),
          db.products.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.products.toArray())
        ])

        const mySales = (lSales || []).filter(s => String(s.shop_id) === sid && s.sale_type === 'sale')
        const myCustomers = (lCustomers || []).filter(c => String(c.shop_id) === sid)
        const myProducts = (lProducts || []).filter(p => String(p.shop_id) === sid)

        const gross = mySales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
        const totalReceiv = myCustomers.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
        const lowStock = myProducts.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10))

        setStats(prev => ({
          ...prev,
          periodSales: gross,
          periodNetSales: gross,
          periodProfit: gross * 0.3, // estimate
          profitMargin: 30,
          cashSales: gross,
          totalReceivables: totalReceiv,
          lowStockCount: lowStock.length,
          productCount: myProducts.length
        }))

        setTopDebtors(myCustomers.filter(c => Number(c.outstanding_balance) > 0).slice(0, 5))
        setLowStockProducts(lowStock.slice(0, 5))
      } catch (localErr) {
        console.error('Offline fallback error:', localErr)
      }
    } finally {
      setLoading(false)
    }
  }

  // End of Day (EOD) modal opener
  const openEOD = async () => {
    setEodLoading(true)
    setShowEOD(true)
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const [expRes, purRes] = await Promise.all([
        supabase.from('expenses').select('amount').eq('shop_id', user.shop_id).gte('created_at', today.toISOString()),
        supabase.from('purchases').select('total_amount, payment_type').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())
      ])

      const todayExpenses = (expRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
      const todayCashPurchases = (purRes.data || []).filter(p => p.payment_type === 'cash').reduce((s, p) => s + Number(p.total_amount || 0), 0)
      const todayCreditPurchases = (purRes.data || []).filter(p => p.payment_type !== 'cash').reduce((s, p) => s + Number(p.total_amount || 0), 0)

      setEodData({
        cashSales: stats.cashSales,
        creditSales: stats.creditSales,
        totalSales: stats.periodNetSales,
        profit: stats.periodProfit,
        expenses: todayExpenses,
        cashPurchases: todayCashPurchases,
        creditPurchases: todayCreditPurchases,
        netCash: stats.cashSales - todayExpenses - todayCashPurchases
      })
    } catch (e) {
      console.error('EOD fetch error:', e)
    } finally {
      setEodLoading(false)
    }
  }

  const shareEODWhatsApp = () => {
    const d = eodData
    if (!d) return
    const dateStr = new Date().toLocaleDateString('en-PK')
    const sid = user?.shop_id
    const shopName = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'My Shop'
    const msg =
      `🌙 *End of Day Reconciliation — ${dateStr}*\n*${shopName}*\n\n` +
      `💵 Cash Sales: Rs. ${d.cashSales.toLocaleString()}\n` +
      `📒 Credit / Udhaar: Rs. ${d.creditSales.toLocaleString()}\n` +
      `📊 Total Net Sales: Rs. ${d.totalSales.toLocaleString()}\n\n` +
      `💸 Expenses: Rs. ${d.expenses.toLocaleString()}\n` +
      `📦 Cash Purchases: Rs. ${d.cashPurchases.toLocaleString()}\n\n` +
      `📈 Gross Profit: Rs. ${d.profit.toLocaleString()}\n` +
      `💰 *Net Cash in Hand: Rs. ${d.netCash.toLocaleString()}*`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const printEOD = () => {
    const d = eodData
    if (!d) return
    const branding = getShopBranding(user?.shop_id)
    const dateStr = new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    printHTML(`<html><head><title>End of Day Report</title>
      <style>
        @page{size:80mm auto;margin:2mm}
        *{box-sizing:border-box}
        body{font-family:monospace;width:302px;margin:0 auto;padding:12px 8px;font-size:13px;}
        h2,p.center{text-align:center;margin:2px 0;}
        hr{border-top:1px dashed #000;margin:8px 0;}
        .row{display:flex;justify-content:space-between;padding:4px 0;}
        .bold{font-weight:bold;} .green{color:green;} .red{color:red;}
      </style></head><body>
      <h2>${branding.name}</h2>
      ${branding.phone ? `<p class="center" style="font-size:11px;">${branding.phone}</p>` : ''}
      <p class="center bold" style="font-size:13px;margin-top:4px;">🌙 END OF DAY CLOSING</p>
      <p class="center">${dateStr}</p>
      <hr/>
      <div class="row"><span>💵 Cash Sales</span><span class="green bold">Rs. ${d.cashSales.toLocaleString()}</span></div>
      <div class="row"><span>📒 Credit (Udhaar)</span><span class="bold">Rs. ${d.creditSales.toLocaleString()}</span></div>
      <div class="row bold"><span>Total Net Sales</span><span>Rs. ${d.totalSales.toLocaleString()}</span></div>
      <hr/>
      <div class="row"><span>💸 Expenses</span><span class="red">Rs. ${d.expenses.toLocaleString()}</span></div>
      <div class="row"><span>📦 Purchases</span><span class="red">Rs. ${d.cashPurchases.toLocaleString()}</span></div>
      <hr/>
      <div class="row bold"><span>📈 Gross Profit</span><span class="${d.profit >= 0 ? 'green' : 'red'}">Rs. ${d.profit.toLocaleString()}</span></div>
      <div class="row bold" style="font-size:15px;"><span>💰 Net Cash</span><span class="${d.netCash >= 0 ? 'green' : 'red'}">Rs. ${d.netCash.toLocaleString()}</span></div>
      <hr/>
      <p class="center" style="font-size:11px;color:#888;">Generated: ${new Date().toLocaleTimeString('en-PK')}</p>
      </body></html>`)
  }

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* ── TOP EXECUTIVE HEADER & TIME SELECTOR (APPLE HIG) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#1c1c1e] p-4 sm:p-5 rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_2px_8px_rgba(0,0,0,0.03)] dark:shadow-none">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-[12px] bg-[#0071e3] text-white flex items-center justify-center font-bold text-sm shadow-[0_2px_6px_rgba(0,113,227,0.3)] select-none">
            POS
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                Executive Dashboard
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#1b7331] dark:text-[#30d158]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs text-[#86868b] dark:text-[#98989d] mt-0.5 flex items-center gap-2">
              <span>Welcome back, <strong className="text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold">{user?.name || user?.username}</strong></span>
              <span className="text-[#d1d1d6] dark:text-[#38383a]">•</span>
              <span>{new Date().toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Apple Segmented Control */}
          <div className="inline-flex p-1 bg-[#efeff4] dark:bg-[#2c2c2e] rounded-[12px] border border-[#e5e5ea] dark:border-[#38383a] text-xs font-medium">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: '7 Days' },
              { id: 'month', label: 'This Month' },
              { id: 'year', label: 'YTD' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTimeRange(t.id)}
                className={`px-3.5 py-1.5 rounded-[9px] transition-all duration-150 cursor-pointer ${
                  timeRange === t.id
                    ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-[0_1px_3px_rgba(0,0,0,0.12)] font-semibold'
                    : 'text-[#636366] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={openEOD}
            className="px-4 py-2 bg-[#1d1d1f] dark:bg-[#2c2c2e] hover:bg-[#323236] dark:hover:bg-[#38383a] text-white rounded-[10px] text-xs font-medium transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-98 border border-transparent dark:border-[#38383a]"
          >
            <span>🌙</span>
            <span>Day Close (EOD)</span>
          </button>

          <button
            onClick={() => fetchDashboardData(timeRange)}
            className="p-2 bg-[#efeff4] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-[10px] transition-all duration-150 cursor-pointer"
            title="Refresh Dashboard Data"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin text-[#0071e3]' : ''} />
          </button>
        </div>
      </div>

      {/* ── KPI METRICS GRID (APPLE DISTINCT SYSTEM COLORS) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Net Sales / Revenue (Apple System Blue) */}
        <div className="bg-[#f8faff] dark:bg-[#0c1829] border border-[#d0e4ff] dark:border-[#1e3a8a]/60 rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,113,227,0.05)] dark:shadow-none hover:border-[#0071e3]/40 hover:shadow-[0_4px_16px_rgba(0,113,227,0.1)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0071e3] dark:text-[#2997ff]">
                Net Sales (Revenue)
              </span>
              <span className="w-9 h-9 rounded-[10px] bg-[#0071e3] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(0,113,227,0.35)]">
                <DollarSign size={18} />
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-semibold text-[#86868b] dark:text-[#98989d]">Rs.</span>
              <span className="text-2xl sm:text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] font-sans tracking-tight">
                {Number(stats.periodNetSales || 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#d0e4ff]/70 dark:border-[#1e3a8a]/40 flex items-center justify-between text-[11px] text-[#86868b] dark:text-[#98989d]">
            <span>Gross: Rs. {Number(stats.periodSales || 0).toLocaleString()}</span>
            <span className="font-medium">Disc: Rs. {Number(stats.periodDiscount || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* 2. Gross Profit (Apple System Green) */}
        <div className="bg-[#f8fcf9] dark:bg-[#0b1f13] border border-[#cbeed4] dark:border-[#14532d]/60 rounded-[20px] p-5 shadow-[0_2px_8px_rgba(52,199,89,0.05)] dark:shadow-none hover:border-[#34c759]/40 hover:shadow-[0_4px_16px_rgba(52,199,89,0.1)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#248a3d] dark:text-[#30d158]">
                Gross Profit
              </span>
              <span className="w-9 h-9 rounded-[10px] bg-[#34c759] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(52,199,89,0.35)]">
                <TrendingUp size={18} />
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-semibold text-[#34c759] dark:text-[#30d158]">Rs.</span>
              <span className="text-2xl sm:text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] font-sans tracking-tight">
                {Number(stats.periodProfit || 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#cbeed4]/70 dark:border-[#14532d]/40 flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold bg-[#34c759]/15 dark:bg-[#34c759]/20 text-[#1b7331] dark:text-[#30d158]">
              {stats.profitMargin.toFixed(1)}% Margin
            </span>
            <span className="text-[#86868b] dark:text-[#98989d] text-[10px]">Net of product COGS</span>
          </div>
        </div>

        {/* 3. Total Receivables / Udhaar (Apple System Orange) */}
        <div className="bg-[#fffdf9] dark:bg-[#1f1305] border border-[#fed7aa] dark:border-[#7c2d12]/60 rounded-[20px] p-5 shadow-[0_2px_8px_rgba(255,149,0,0.05)] dark:shadow-none hover:border-[#ff9500]/40 hover:shadow-[0_4px_16px_rgba(255,149,0,0.1)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#c26200] dark:text-[#ff9f0a]">
                Customer Receivables
              </span>
              <span className="w-9 h-9 rounded-[10px] bg-[#ff9500] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(255,149,0,0.35)]">
                <Wallet size={18} />
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-semibold text-[#ff9500] dark:text-[#ff9f0a]">Rs.</span>
              <span className="text-2xl sm:text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] font-sans tracking-tight">
                {Number(stats.totalReceivables || 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#fed7aa]/70 dark:border-[#7c2d12]/40 flex items-center justify-between text-[11px]">
            <span className="text-[#86868b] dark:text-[#98989d]">{topDebtors.length} Pending Accounts</span>
            <Link to="/customer-ledger" className="font-semibold text-[#c26200] dark:text-[#ff9f0a] hover:underline">
              View Ledgers →
            </Link>
          </div>
        </div>

        {/* 4. Low Stock Warning (Apple System Red) */}
        <div className="bg-[#fffafa] dark:bg-[#200b0e] border border-[#fecaca] dark:border-[#7f1d1d]/60 rounded-[20px] p-5 shadow-[0_2px_8px_rgba(255,59,48,0.05)] dark:shadow-none hover:border-[#ff3b30]/40 hover:shadow-[0_4px_16px_rgba(255,59,48,0.1)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#d70015] dark:text-[#ff453a]">
                Low Stock Alert
              </span>
              <span className="w-9 h-9 rounded-[10px] bg-[#ff3b30] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(255,59,48,0.35)]">
                <AlertTriangle size={18} />
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-bold text-[#d70015] dark:text-[#ff453a] font-sans tracking-tight">
                {stats.lowStockCount}
              </span>
              <span className="text-xs font-semibold text-[#86868b] dark:text-[#98989d] ml-1">Products Low</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#fecaca]/70 dark:border-[#7f1d1d]/40 flex items-center justify-between text-[11px]">
            <span className="text-[#86868b] dark:text-[#98989d] text-[10px]">Below safety threshold</span>
            <Link to="/inventory" className="font-semibold text-[#d70015] dark:text-[#ff453a] hover:underline">
              Inspect Stock →
            </Link>
          </div>
        </div>
      </div>

      {/* ── PERFUMERY MANUFACTURING METRICS (APPLE PURPLE THEME) ── */}
      {isManufacturer() && (
        <div className="bg-[#faf8ff] dark:bg-[#190c29] border border-[#ebdcfc] dark:border-[#581c87]/60 rounded-[20px] p-5 shadow-[0_2px_8px_rgba(175,82,222,0.05)] dark:shadow-none">
          <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-[#ebdcfc]/70 dark:border-[#581c87]/40">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#af52de]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#581c87] dark:text-[#d8b4fe]">
                Perfumery Manufacturing & Lab Pipeline
              </span>
            </div>
            <span className="text-[11px] font-semibold bg-[#af52de]/15 dark:bg-[#af52de]/25 text-[#6b21a8] dark:text-[#d8b4fe] px-2.5 py-0.5 rounded-full">
              Manufacturer Mode Active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Active Blending Batches */}
            <Link
              to="/production"
              className="flex items-center gap-3.5 p-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] hover:bg-white/95 dark:hover:bg-[#252528] border border-[#ebdcfc] dark:border-[#38383a] hover:border-[#af52de]/40 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.02)] group"
            >
              <span className="w-9 h-9 rounded-[10px] bg-[#af52de] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(175,82,222,0.35)] group-hover:scale-105 transition-transform flex-shrink-0">
                <Workflow size={18} />
              </span>
              <div>
                <p className="text-[10px] uppercase font-bold text-[#86868b] dark:text-[#98989d]">Active Blending Batches</p>
                <p className="text-base sm:text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                  {stats.activeBatchesCount} <span className="text-xs font-semibold text-[#86868b] dark:text-[#98989d]">Batches WIP</span>
                </p>
              </div>
            </Link>

            {/* Bulk Liquid Maceration */}
            <Link
              to="/production"
              className="flex items-center gap-3.5 p-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] hover:bg-white/95 dark:hover:bg-[#252528] border border-[#ebdcfc] dark:border-[#38383a] hover:border-[#5856d6]/40 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.02)] group"
            >
              <span className="w-9 h-9 rounded-[10px] bg-[#5856d6] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(88,86,214,0.35)] group-hover:scale-105 transition-transform flex-shrink-0">
                <FlaskConical size={18} />
              </span>
              <div>
                <p className="text-[10px] uppercase font-bold text-[#86868b] dark:text-[#98989d]">Bulk Liquid in Maceration</p>
                <p className="text-base sm:text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                  {(stats.maturingVolumeMl / 1000).toFixed(2)} <span className="text-xs font-semibold text-[#86868b] dark:text-[#98989d]">Litres WIP</span>
                </p>
              </div>
            </Link>

            {/* Total Bottled Finished Goods */}
            <Link
              to="/bottling"
              className="flex items-center gap-3.5 p-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] hover:bg-white/95 dark:hover:bg-[#252528] border border-[#ebdcfc] dark:border-[#38383a] hover:border-[#7e22ce]/40 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.02)] group"
            >
              <span className="w-9 h-9 rounded-[10px] bg-[#7e22ce] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(126,34,206,0.35)] group-hover:scale-105 transition-transform flex-shrink-0">
                <Factory size={18} />
              </span>
              <div>
                <p className="text-[10px] uppercase font-bold text-[#86868b] dark:text-[#98989d]">Finished Goods Bottled</p>
                <p className="text-base sm:text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                  {stats.bottledUnitsCount.toLocaleString()} <span className="text-xs font-semibold text-[#86868b] dark:text-[#98989d]">Bottles Released</span>
                </p>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* ── CHARTS SECTION: TIMELINE & PAYMENT MODES (APPLE STYLE) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Sales Trend Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2">
                <span className="w-2 h-4 bg-[#0071e3] rounded-full inline-block" />
                Sales & Revenue Timeline
              </h3>
              <p className="text-xs text-[#86868b] dark:text-[#98989d] mt-0.5">
                Hourly and periodic transaction volume across the active window
              </p>
            </div>
            {salesTrend.length > 0 && (
              <span className="text-xs font-mono font-semibold text-[#636366] dark:text-[#98989d] bg-[#efeff4] dark:bg-[#2c2c2e] px-2.5 py-0.5 rounded-full">
                {salesTrend.length} Data Points
              </span>
            )}
          </div>

          <div className="h-64 w-full">
            {salesTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesTrend}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0071e3" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0071e3" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f2f2f7" />
                  <XAxis dataKey="time" stroke="#8e8e93" fontSize={10} tickLine={false} />
                  <YAxis stroke="#8e8e93" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', backgroundColor: '#1d1d1f', color: '#fff', boxShadow: '0 8px 20px rgba(0,0,0,0.15)' }}
                    formatter={(val) => [`Rs. ${Number(val).toLocaleString()}`, 'Revenue']}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#0071e3"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorSales)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#d1d1d6] dark:border-[#38383a] rounded-[16px] bg-[#f5f5f7]/60 dark:bg-[#2c2c2e]/40">
                <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1c1c1e] flex items-center justify-center text-[#86868b] dark:text-[#98989d] shadow-xs mb-2.5">
                  <TrendingUp size={20} />
                </div>
                <p className="text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">No Sales Recorded In This Window</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#98989d] max-w-xs mt-0.5 mb-3">
                  {timeRange === 'today'
                    ? "Open the POS register to record checkout transactions and populate live chart data."
                    : `No completed transactions found for ${timeRange}.`}
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    to="/pos"
                    className="px-3.5 py-1.5 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-[9px] text-xs font-semibold shadow-xs transition"
                  >
                    ⚡ Open POS Register
                  </Link>
                  {timeRange === 'today' && (
                    <button
                      onClick={() => setTimeRange('week')}
                      className="px-3.5 py-1.5 bg-white dark:bg-[#2c2c2e] hover:bg-[#efeff4] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[9px] text-xs font-medium transition cursor-pointer"
                    >
                      View 7 Days
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment Tender Distribution */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none p-5 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2 mb-1">
              <span className="w-2 h-4 bg-[#34c759] rounded-full inline-block" />
              Payment Methods
            </h3>
            <p className="text-xs text-[#86868b] dark:text-[#98989d]">Cash in drawer vs. Credit vs. Bank</p>
          </div>

          <div className="h-44 w-full my-auto flex items-center justify-center">
            {paymentBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentBreakdown}
                    innerRadius={45}
                    outerRadius={68}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {paymentBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val) => [`Rs. ${Number(val).toLocaleString()}`, 'Amount']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center p-4">
                <span className="inline-block p-2 rounded-full bg-[#efeff4] dark:bg-[#2c2c2e] text-[#86868b] dark:text-[#98989d] mb-1.5">
                  <Wallet size={18} />
                </span>
                <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">No payment records yet</p>
                <p className="text-[10px] text-[#86868b] dark:text-[#98989d]">Breakdown will appear as tenders are received.</p>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-3 border-t border-[#e5e5ea] dark:border-[#2c2c2e] text-xs">
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[#34c759] inline-block" /> Cash in Drawer
              </span>
              <strong className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">Rs. {stats.cashSales.toLocaleString()}</strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff9500] inline-block" /> Credit / Udhaar
              </span>
              <strong className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">Rs. {stats.creditSales.toLocaleString()}</strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0071e3] inline-block" /> Bank / Digital
              </span>
              <strong className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">Rs. {stats.bankSales.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── ACTIONABLE OPERATIONAL PANELS: RECENT SALES, DEBTORS, LOW STOCK ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Recent Transactions Feed */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none p-5">
          <div className="flex items-center justify-between mb-3 border-b border-[#e5e5ea] dark:border-[#2c2c2e] pb-2.5">
            <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={14} className="text-[#0071e3]" />
              Live Sales Feed
            </h3>
            <Link to="/sales" className="text-xs font-semibold text-[#0071e3] hover:underline">
              All Sales →
            </Link>
          </div>

          <div className="space-y-2">
            {recentSales.map(sale => (
              <div key={sale.id} className="p-2.5 hover:bg-[#f5f5f7] dark:hover:bg-[#252528] rounded-[12px] transition border border-[#f2f2f7] dark:border-[#2c2c2e] flex items-center justify-between text-xs">
                <div>
                  <p className="font-mono font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">{sale.invoice_number}</p>
                  <p className="text-[11px] text-[#86868b] dark:text-[#98989d] truncate max-w-[130px]">{sale.customer_name || 'Walk-in Customer'}</p>
                </div>
                <div className="text-right">
                  <p className="font-black font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                    Rs. {(Number(sale.total_amount || 0) - Number(sale.discount || 0)).toLocaleString()}
                  </p>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    sale.payment_type === 'cash' ? 'bg-[#34c759]/15 dark:bg-[#34c759]/25 text-[#1b7331] dark:text-[#30d158]' : 'bg-[#ff9500]/15 dark:bg-[#ff9500]/25 text-[#c26200] dark:text-[#ff9f0a]'
                  }`}>
                    {sale.payment_type}
                  </span>
                </div>
              </div>
            ))}
            {recentSales.length === 0 && (
              <div className="py-8 text-center text-[#86868b] dark:text-[#98989d] text-xs">
                <p>No recent transactions recorded</p>
                <Link to="/pos" className="text-[#0071e3] font-bold text-[11px] hover:underline mt-1 inline-block">
                  Record First Sale →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Top Debtors / Receivables */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none p-5">
          <div className="flex items-center justify-between mb-3 border-b border-[#e5e5ea] dark:border-[#2c2c2e] pb-2.5">
            <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="text-[#ff9500]" />
              Top Customer Receivables
            </h3>
            <Link to="/customer-ledger" className="text-xs font-semibold text-[#ff9500] hover:underline">
              Ledger →
            </Link>
          </div>

          <div className="space-y-2">
            {topDebtors.map(debtor => (
              <div key={debtor.id} className="p-2.5 hover:bg-[#f5f5f7] dark:hover:bg-[#252528] rounded-[12px] transition border border-[#f2f2f7] dark:border-[#2c2c2e] flex items-center justify-between text-xs">
                <div>
                  <Link to={`/customers/${debtor.id}`} className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0071e3]">
                    {debtor.name}
                  </Link>
                  <p className="text-[10px] text-[#86868b] dark:text-[#98989d] font-mono">{debtor.phone || 'No Phone'}</p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <span className="font-black font-mono text-[#ff3b30] dark:text-[#ff453a]">
                    Rs. {Number(debtor.outstanding_balance).toLocaleString()}
                  </span>
                  {debtor.phone && (
                    <button
                      onClick={() => {
                        const msg = `Assalam-o-Alaikum ${debtor.name}, your outstanding balance of Rs. ${Number(debtor.outstanding_balance).toLocaleString()} is pending. Kindly arrange payment. Thank you!`
                        window.open(`https://wa.me/${debtor.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
                      }}
                      title="Send WhatsApp Reminder"
                      className="p-1 text-[#34c759] dark:text-[#30d158] hover:bg-[#34c759]/10 rounded cursor-pointer"
                    >
                      <MessageSquare size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {topDebtors.length === 0 && (
              <div className="py-8 text-center text-[#86868b] dark:text-[#98989d] text-xs">
                <p>No outstanding customer debts 🎉</p>
                <p className="text-[10px] text-[#34c759] dark:text-[#30d158] font-semibold mt-0.5">All accounts clear</p>
              </div>
            )}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none p-5">
          <div className="flex items-center justify-between mb-3 border-b border-[#e5e5ea] dark:border-[#2c2c2e] pb-2.5">
            <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-[#ff3b30]" />
              Stock Restock Alerts
            </h3>
            <Link to="/inventory" className="text-xs font-semibold text-[#ff3b30] hover:underline">
              Inventory →
            </Link>
          </div>

          <div className="space-y-2">
            {lowStockProducts.slice(0, 5).map(prod => (
              <div key={prod.id} className="p-2.5 hover:bg-[#f5f5f7] dark:hover:bg-[#252528] rounded-[12px] transition border border-[#f2f2f7] dark:border-[#2c2c2e] flex items-center justify-between text-xs">
                <div>
                  <p className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate max-w-[140px]">{prod.name}</p>
                  <p className="text-[10px] text-[#86868b] dark:text-[#98989d]">Min Alert: {prod.low_stock_threshold || 10} pcs</p>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded-[6px] font-black font-mono bg-[#ff3b30]/15 dark:bg-[#ff3b30]/25 text-[#d70015] dark:text-[#ff453a] text-xs">
                    {prod.stock_quantity || 0} pcs
                  </span>
                </div>
              </div>
            ))}
            {lowStockProducts.length === 0 && (
              <div className="py-8 text-center text-[#86868b] dark:text-[#98989d] text-xs">
                <p>All inventory levels healthy ✅</p>
                <p className="text-[10px] text-[#34c759] dark:text-[#30d158] font-semibold mt-0.5">No immediate restocks required</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── QUICK ACTION LAUNCHPAD (APPLE SQUIRCLE TILES) ── */}
      <div className="bg-white dark:bg-[#1c1c1e] p-5 rounded-[20px] border border-[#e5e5ea] dark:border-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none">
        <h3 className="text-xs font-semibold uppercase text-[#86868b] dark:text-[#98989d] tracking-wider mb-3">
          Quick Operations Launchpad
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          <Link
            to="/pos"
            className="flex flex-col items-center p-3.5 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-[14px] font-semibold text-xs transition shadow-[0_2px_6px_rgba(0,113,227,0.3)] text-center active:scale-98"
          >
            <ShoppingCart size={20} className="mb-1" />
            <span>New Sale (POS)</span>
          </Link>

          <Link
            to="/products"
            className="flex flex-col items-center p-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[14px] font-semibold text-xs transition text-center active:scale-98"
          >
            <Package size={20} className="mb-1 text-[#ff9500]" />
            <span>Products</span>
          </Link>

          <Link
            to="/purchases"
            className="flex flex-col items-center p-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[14px] font-semibold text-xs transition text-center active:scale-98"
          >
            <Layers size={20} className="mb-1 text-[#5856d6]" />
            <span>New Purchase</span>
          </Link>

          <Link
            to="/customers"
            className="flex flex-col items-center p-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[14px] font-semibold text-xs transition text-center active:scale-98"
          >
            <Users size={20} className="mb-1 text-[#34c759]" />
            <span>Customers</span>
          </Link>

          {isManufacturer() ? (
            <Link
              to="/production"
              className="flex flex-col items-center p-3.5 bg-[#faf8ff] dark:bg-[#251738] hover:bg-[#f3e8ff] dark:hover:bg-[#321e4d] text-[#6b21a8] dark:text-[#d8b4fe] border border-[#ebdcfc] dark:border-[#581c87]/60 rounded-[14px] font-semibold text-xs transition text-center active:scale-98"
            >
              <Workflow size={20} className="mb-1 text-[#af52de]" />
              <span>Blending Batch</span>
            </Link>
          ) : (
            <Link
              to="/reports"
              className="flex flex-col items-center p-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[14px] font-semibold text-xs transition text-center active:scale-98"
            >
              <TrendingUp size={20} className="mb-1 text-[#ff2d55]" />
              <span>Analytics</span>
            </Link>
          )}

          <button
            onClick={openEOD}
            className="flex flex-col items-center p-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5ea] dark:border-[#38383a] rounded-[14px] font-semibold text-xs transition text-center cursor-pointer active:scale-98"
          >
            <Clock size={20} className="mb-1 text-[#0071e3]" />
            <span>Day Close</span>
          </button>
        </div>
      </div>

      {/* ── END OF DAY (EOD) MODAL ── */}
      {showEOD && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl border border-gray-100 dark:border-[#2c2c2e] w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 dark:border-[#2c2c2e] bg-gray-900 dark:bg-[#121214] text-white flex justify-between items-center">
              <div>
                <h2 className="text-base font-black flex items-center gap-2">
                  🌙 End of Day Reconciliation
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setShowEOD(false)} className="text-gray-400 hover:text-white text-xl">
                ✕
              </button>
            </div>

            {eodLoading ? (
              <div className="p-8 text-center text-gray-400 text-xs">
                Calculating day register closing...
              </div>
            ) : eodData ? (
              <div className="p-5 space-y-4 text-xs">
                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-2">Inflows</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-[#98989d]">💵 Cash Sales:</span>
                      <strong className="text-emerald-600 dark:text-emerald-400 font-mono">Rs. {eodData.cashSales.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-[#98989d]">📒 Credit / Udhaar:</span>
                      <strong className="text-amber-600 dark:text-amber-400 font-mono">Rs. {eodData.creditSales.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between border-t border-gray-100 dark:border-[#2c2c2e] pt-1">
                      <span className="font-bold text-gray-800 dark:text-[#f5f5f7]">Total Net Sales:</span>
                      <strong className="font-mono text-gray-900 dark:text-white">Rs. {eodData.totalSales.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-2">Outflows</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-[#98989d]">💸 Expenses:</span>
                      <strong className="text-red-600 dark:text-red-400 font-mono">Rs. {eodData.expenses.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-[#98989d]">📦 Cash Purchases:</span>
                      <strong className="text-red-600 dark:text-red-400 font-mono">Rs. {eodData.cashPurchases.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-[#2c2c2e] rounded-xl p-3.5 space-y-2 border border-gray-200 dark:border-[#38383a]">
                  <div className="flex justify-between">
                    <span className="font-bold text-gray-700 dark:text-[#e5e5ea]">📈 Gross Profit:</span>
                    <strong className={`font-mono ${eodData.profit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                      Rs. {eodData.profit.toLocaleString()}
                    </strong>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 dark:border-[#38383a] pt-2 text-sm">
                    <span className="font-black text-gray-900 dark:text-white">💰 Net Cash in Hand:</span>
                    <strong className={`font-mono font-black ${eodData.netCash >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                      Rs. {eodData.netCash.toLocaleString()}
                    </strong>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="p-4 bg-gray-50 dark:bg-[#1c1c1e] border-t border-gray-100 dark:border-[#2c2c2e] flex gap-2">
              {eodData && (
                <button
                  onClick={printEOD}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  🖨️ Thermal Print
                </button>
              )}
              {eodData && (
                <button
                  onClick={shareEODWhatsApp}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  📱 WhatsApp
                </button>
              )}
              <button
                onClick={() => setShowEOD(false)}
                className="py-2 px-4 bg-gray-200 dark:bg-[#2c2c2e] hover:bg-gray-300 dark:hover:bg-[#38383a] text-gray-700 dark:text-[#f5f5f7] font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}