import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'
import {
  FlaskConical, Package, Droplets, AlertTriangle, Search,
  Calendar, Printer, Download, Filter, ArrowDownRight, Layers,
  CheckCircle2, Box, Sparkles, TrendingUp
} from 'lucide-react'

export default function MaterialConsumptionReport() {
  const { user } = useAuth()
  const [range, setRange] = useState('month') // 'today' | 'week' | 'month' | 'year' | 'all'
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'raw_oil' | 'raw_chemical' | 'packaging'
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  const [ledgerEntries, setLedgerEntries] = useState([])
  const [items, setItems] = useState([])
  const [lots, setLots] = useState([])

  useEffect(() => {
    if (user?.shop_id) {
      fetchConsumptionData()
    }
  }, [user?.shop_id, range])

  const fetchConsumptionData = async () => {
    setLoading(true)

    let startDate = new Date()
    startDate.setHours(0, 0, 0, 0)

    if (range === 'today') {
      // today only
    } else if (range === 'week') {
      startDate.setDate(startDate.getDate() - 7)
    } else if (range === 'month') {
      startDate.setDate(1) // 1st of month
    } else if (range === 'year') {
      startDate = new Date(new Date().getFullYear(), 0, 1)
    } else if (range === 'all') {
      startDate = new Date(2020, 0, 1)
    }

    const startISO = startDate.toISOString()

    try {
      const [ledgerRes, itemsRes, lotsRes] = await Promise.all([
        supabase
          .from('inventory_ledger')
          .select('*, items(id, name, item_type, base_unit), inventory_lots(lot_number)')
          .eq('shop_id', user.shop_id)
          .gte('created_at', startISO)
          .order('id', { ascending: false }),
        supabase.from('items').select('*').eq('shop_id', user.shop_id),
        supabase.from('inventory_lots').select('*').eq('shop_id', user.shop_id)
      ])

      const ledger = ledgerRes.data || []
      // Filter for consumption transaction types
      const consumptionTypes = ['production_issue', 'bottling_issue', 'bottling_damage', 'bottling_bulk_issue', 'damage_loss']
      const filteredLedger = ledger.filter(l => consumptionTypes.includes(l.transaction_type) || Number(l.quantity) < 0)

      setLedgerEntries(filteredLedger)
      setItems(itemsRes.data || [])
      setLots(lotsRes.data || [])
    } catch (err) {
      console.error('Error fetching material consumption data:', err)
      // Fallback to local Dexie
      const localLedger = await db.inventory_ledger?.where('shop_id').equals(user.shop_id).toArray()
      setLedgerEntries(localLedger || [])
    } finally {
      setLoading(false)
    }
  }

  // Filtered Entries
  const filteredEntries = ledgerEntries.filter(entry => {
    const itemType = entry.items?.item_type
    const matchType = typeFilter === 'all' || itemType === typeFilter
    const q = searchTerm.toLowerCase()
    const itemName = entry.items?.name || ''
    const refId = entry.reference_id || ''
    const notes = entry.notes || ''
    const matchSearch = !searchTerm || 
      itemName.toLowerCase().includes(q) ||
      refId.toLowerCase().includes(q) ||
      notes.toLowerCase().includes(q)

    return matchType && matchSearch
  })

  // ── KEY PERFORMANCE INDICATORS ──
  // 1. Oils Consumed
  const oilEntries = ledgerEntries.filter(e => e.items?.item_type === 'raw_oil')
  const totalOilQty = oilEntries.reduce((sum, e) => sum + Math.abs(Number(e.quantity || 0)), 0)
  const totalOilCost = oilEntries.reduce((sum, e) => sum + Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))), 0)

  // 2. Ethanol & Chemicals
  const chemEntries = ledgerEntries.filter(e => e.items?.item_type === 'raw_chemical')
  const totalChemQty = chemEntries.reduce((sum, e) => sum + Math.abs(Number(e.quantity || 0)), 0)
  const totalChemCost = chemEntries.reduce((sum, e) => sum + Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))), 0)

  // 3. Packaging Used (Bottles, Caps, Sprayers, Boxes)
  const pkgUsedEntries = ledgerEntries.filter(e => e.items?.item_type === 'packaging' && e.transaction_type !== 'bottling_damage')
  const totalPkgQty = pkgUsedEntries.reduce((sum, e) => sum + Math.abs(Number(e.quantity || 0)), 0)
  const totalPkgCost = pkgUsedEntries.reduce((sum, e) => sum + Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))), 0)

  // 4. Packaging Damaged / Scrap
  const pkgDamagedEntries = ledgerEntries.filter(e => e.items?.item_type === 'packaging' && (e.transaction_type === 'bottling_damage' || e.transaction_type === 'damage_loss'))
  const totalScrapQty = pkgDamagedEntries.reduce((sum, e) => sum + Math.abs(Number(e.quantity || 0)), 0)
  const totalScrapCost = pkgDamagedEntries.reduce((sum, e) => sum + Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))), 0)
  const scrapRatePercent = (totalPkgQty + totalScrapQty) > 0 
    ? ((totalScrapQty / (totalPkgQty + totalScrapQty)) * 100).toFixed(1) 
    : 0

  // 5. Total Material Cost
  const grandTotalCost = totalOilCost + totalChemCost + totalPkgCost + totalScrapCost

  // ── CSV EXPORT ──
  const handleExportCSV = () => {
    if (filteredEntries.length === 0) return alert('No consumption data to export.')

    const headers = ['Date', 'Material Name', 'Type', 'Activity', 'Reference', 'Lot Number', 'Quantity', 'Unit', 'Unit Cost (Rs)', 'Total Cost (Rs)', 'Notes']
    const rows = filteredEntries.map(e => [
      e.created_at ? new Date(e.created_at).toLocaleString() : '',
      `"${e.items?.name || 'Unknown'}"`,
      e.items?.item_type || '',
      e.transaction_type || '',
      e.reference_id || '',
      e.inventory_lots?.lot_number || e.lot_id || '',
      Math.abs(Number(e.quantity || 0)),
      e.base_unit || e.items?.base_unit || '',
      Number(e.unit_cost || 0),
      Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))),
      `"${(e.notes || '').replace(/"/g, '""')}"`
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `material_consumption_report_${range}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── A4 PRINT REPORT ──
  const handlePrintReport = () => {
    const branding = getShopBranding(user?.shop_id)
    const header = brandedA4Header(branding, 'RAW MATERIAL & PACKAGING CONSUMPTION REPORT', `Period: ${range.toUpperCase()} | Generated: ${new Date().toLocaleString()}`)

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Material Consumption Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 20px; }
          .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
          .stat-card { border: 1px solid #ddd; border-radius: 8px; padding: 10px; background: #fafafa; }
          .stat-label { font-size: 10px; color: #666; font-weight: bold; text-transform: uppercase; }
          .stat-val { font-size: 16px; font-weight: 900; color: #000; margin-top: 4px; }
          .stat-sub { font-size: 10px; color: #7c3aed; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; font-size: 10px; }
          th { background: #f3f4f6; font-weight: bold; text-transform: uppercase; }
          .text-right { text-align: right; }
          .font-mono { font-family: monospace; }
          .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; }
        </style>
      </head>
      <body>
        ${header}

        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">Essential Oils Used</div>
            <div class="stat-val">${totalOilQty.toLocaleString()} g/mL</div>
            <div class="stat-sub">Rs. ${totalOilCost.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Ethanol & Solvents</div>
            <div class="stat-val">${totalChemQty.toLocaleString()} mL</div>
            <div class="stat-sub">Rs. ${totalChemCost.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Packaging Units Used</div>
            <div class="stat-val">${totalPkgQty.toLocaleString()} pcs</div>
            <div class="stat-sub">Rs. ${totalPkgCost.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Material Cost</div>
            <div class="stat-val">Rs. ${grandTotalCost.toLocaleString()}</div>
            <div class="stat-sub">Scrap Rate: ${scrapRatePercent}%</div>
          </div>
        </div>

        <h3 style="margin-top: 20px; font-size: 12px; text-transform: uppercase;">Itemized Consumption Ledger</h3>
        <table>
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Material Name</th>
              <th>Type</th>
              <th>Activity</th>
              <th>Reference</th>
              <th>Lot #</th>
              <th class="text-right">Quantity</th>
              <th class="text-right">Unit Cost</th>
              <th class="text-right">Total Cost</th>
            </tr>
          </thead>
          <tbody>
            ${filteredEntries.map(e => `
              <tr>
                <td class="font-mono">${e.created_at ? new Date(e.created_at).toLocaleDateString() : '—'}</td>
                <td><strong>${e.items?.name || '—'}</strong></td>
                <td>${e.items?.item_type || '—'}</td>
                <td>${e.transaction_type?.replace('_', ' ').toUpperCase()}</td>
                <td class="font-mono">${e.reference_id || '—'}</td>
                <td class="font-mono">${e.inventory_lots?.lot_number || e.lot_id || '—'}</td>
                <td class="text-right font-mono"><strong>${Math.abs(Number(e.quantity || 0))} ${e.base_unit || e.items?.base_unit || ''}</strong></td>
                <td class="text-right font-mono">Rs. ${Number(e.unit_cost || 0).toLocaleString()}</td>
                <td class="text-right font-mono"><strong>Rs. ${Number(e.total_cost || Math.abs(Number(e.quantity) * Number(e.unit_cost || 0))).toLocaleString()}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `
    printHTML(html)
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Top Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <FlaskConical size={20} />
            </span>
            <div>
              <h2 className="text-base font-black text-gray-900 tracking-tight flex items-center gap-2">
                Raw Material & Packaging Consumption
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold uppercase border border-emerald-200">
                  Lab & Production Audit
                </span>
              </h2>
              <p className="text-xs text-gray-500">
                Live audit of all oils, solvents, bottles, caps, and sprayers consumed across batch runs.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time Filter Buttons */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-bold">
            {['today', 'week', 'month', 'year', 'all'].map(t => (
              <button
                key={t}
                onClick={() => setRange(t)}
                className={`px-3 py-1.5 rounded-lg capitalize transition cursor-pointer ${
                  range === t
                    ? 'bg-white text-emerald-900 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            <Download size={14} /> Export CSV
          </button>

          <button
            onClick={handlePrintReport}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Printer size={14} /> Print A4 Report
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-purple-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-purple-700 font-bold uppercase">
            <span>Essential Oils</span>
            <Droplets size={16} />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-gray-900 font-mono">
              {totalOilQty.toLocaleString()} <span className="text-xs font-normal text-gray-500">g/mL</span>
            </div>
            <div className="text-xs font-bold text-purple-700 mt-0.5 font-mono">
              Rs. {totalOilCost.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-sky-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-sky-700 font-bold uppercase">
            <span>Ethanol & Solvents</span>
            <FlaskConical size={16} />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-gray-900 font-mono">
              {totalChemQty.toLocaleString()} <span className="text-xs font-normal text-gray-500">mL</span>
            </div>
            <div className="text-xs font-bold text-sky-700 mt-0.5 font-mono">
              Rs. {totalChemCost.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-indigo-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-indigo-700 font-bold uppercase">
            <span>Packaging (Bottles/Caps)</span>
            <Package size={16} />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-gray-900 font-mono">
              {totalPkgQty.toLocaleString()} <span className="text-xs font-normal text-gray-500">pcs</span>
            </div>
            <div className="text-xs font-bold text-indigo-700 mt-0.5 font-mono">
              Rs. {totalPkgCost.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-amber-700 font-bold uppercase">
            <span>Scrap & Damaged</span>
            <AlertTriangle size={16} />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black text-gray-900 font-mono">
              {totalScrapQty.toLocaleString()} <span className="text-xs font-normal text-gray-500">pcs</span>
            </div>
            <div className="text-xs font-bold text-amber-700 mt-0.5 font-mono">
              Rs. {totalScrapCost.toLocaleString()} ({scrapRatePercent}% loss)
            </div>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-4 lg:col-span-1 bg-gradient-to-br from-emerald-600 to-teal-700 p-4 rounded-2xl text-white shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-emerald-100 font-bold uppercase">
            <span>Total Material Cost</span>
            <TrendingUp size={16} />
          </div>
          <div className="mt-2">
            <div className="text-xl font-black font-mono">
              Rs. {grandTotalCost.toLocaleString()}
            </div>
            <div className="text-xs text-emerald-100 mt-0.5">
              Across all production runs
            </div>
          </div>
        </div>
      </div>

      {/* Main Consumption Ledger Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {/* Table Filters */}
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50/50">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search material, batch, or run..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 text-xs font-bold">
              {[
                { id: 'all', label: 'All' },
                { id: 'raw_oil', label: '🧴 Oils' },
                { id: 'raw_chemical', label: '💧 Ethanol' },
                { id: 'packaging', label: '📦 Packaging' }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setTypeFilter(f.id)}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer text-xs ${
                    typeFilter === f.id
                      ? 'bg-emerald-50 text-emerald-800 font-bold'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-500 font-mono">
            Showing <strong className="text-gray-800">{filteredEntries.length}</strong> consumption record{filteredEntries.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-16 text-center text-xs text-gray-500 font-bold">
              Loading material consumption ledger...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-400">
              <p className="font-bold text-gray-600">No material consumption recorded for this period.</p>
              <p className="mt-1">Batch completions and bottling runs will automatically record deductions here.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200 uppercase text-[11px]">
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Material / Component</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4">Activity</th>
                  <th className="py-3 px-4">Batch / Run Ref</th>
                  <th className="py-3 px-4">Lot Number</th>
                  <th className="py-3 px-4 text-right">Qty Consumed</th>
                  <th className="py-3 px-4 text-right">Unit Cost</th>
                  <th className="py-3 px-4 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEntries.map((e, idx) => {
                  const qtyNum = Math.abs(Number(e.quantity || 0))
                  const totalCostNum = Number(e.total_cost || (qtyNum * Number(e.unit_cost || 0)))

                  const activityConfig = {
                    production_issue: { label: '🧪 Batch Blending', bg: 'bg-purple-100 text-purple-800 border-purple-200' },
                    bottling_issue: { label: '📦 Bottling Run', bg: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
                    bottling_damage: { label: '⚠️ Scrap / Damaged', bg: 'bg-red-100 text-red-800 border-red-200' },
                    bottling_bulk_issue: { label: '🍶 Bulk Liquid Used', bg: 'bg-sky-100 text-sky-800 border-sky-200' },
                    damage_loss: { label: '⚠️ Loss / Spoilage', bg: 'bg-red-100 text-red-800 border-red-200' }
                  }

                  const activity = activityConfig[e.transaction_type] || {
                    label: e.transaction_type?.replace('_', ' ').toUpperCase(),
                    bg: 'bg-gray-100 text-gray-700 border-gray-200'
                  }

                  return (
                    <tr key={idx} className="hover:bg-emerald-50/30 transition">
                      <td className="py-3 px-4 font-mono text-gray-500 whitespace-nowrap">
                        {e.created_at ? new Date(e.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900">{e.items?.name || 'Unnamed Material'}</div>
                        {e.notes && <span className="text-[10px] text-gray-400 block line-clamp-1">{e.notes}</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[10px] uppercase font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
                          {e.items?.item_type?.replace('_', ' ') || 'General'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${activity.bg}`}>
                          {activity.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-gray-800">
                        {e.reference_id || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-500">
                        {e.inventory_lots?.lot_number || (e.lot_id ? `LOT-#${e.lot_id}` : 'General')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-gray-900">
                        {qtyNum.toLocaleString()} {e.base_unit || e.items?.base_unit || ''}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-600">
                        Rs. {Number(e.unit_cost || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-800">
                        Rs. {totalCostNum.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
