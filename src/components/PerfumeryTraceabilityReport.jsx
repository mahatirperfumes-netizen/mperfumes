import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import {
  Workflow, Factory, Search, ArrowRight, ShieldCheck,
  Package, Droplets, Layers, Calendar, Printer, CheckCircle2,
  AlertTriangle, Filter
} from 'lucide-react'

export default function PerfumeryTraceabilityReport() {
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [lots, setLots] = useState([])
  const [batches, setBatches] = useState([])
  const [bottlingRuns, setBottlingRuns] = useState([])
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [rawItems, setRawItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTrace, setSelectedTrace] = useState(null)

  useEffect(() => {
    if (user?.shop_id) {
      fetchTraceData()
    }
  }, [user?.shop_id])

  const fetchTraceData = async () => {
    setLoading(true)
    try {
      const [lotsRes, batchesRes, runsRes, ledgerRes, itemsRes] = await Promise.all([
        supabase.from('inventory_lots').select('*, items(name, item_type, base_unit)').eq('shop_id', user.shop_id).order('received_date', { ascending: false }),
        supabase.from('production_batches').select('*, formulas(name, version), batch_ingredient_issues(*, items(name))').eq('shop_id', user.shop_id).order('id', { ascending: false }),
        supabase.from('bottling_runs').select('*, items(name), production_batches(batch_number), bottling_component_issues(*, items(name))').eq('shop_id', user.shop_id).order('id', { ascending: false }),
        supabase.from('inventory_ledger').select('*, items(name)').eq('shop_id', user.shop_id).order('id', { ascending: false }).limit(100),
        supabase.from('items').select('*').eq('shop_id', user.shop_id)
      ])

      setLots(lotsRes.data || [])
      setBatches(batchesRes.data || [])
      setBottlingRuns(runsRes.data || [])
      setLedgerEntries(ledgerRes.data || [])
      setRawItems(itemsRes.data || [])
    } catch (err) {
      console.error('Error fetching traceability data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Summary Metrics
  const rawMaterialValuation = (lots || [])
    .filter(l => l.items?.item_type === 'raw_oil' || l.items?.item_type === 'raw_chemical' || l.items?.item_type === 'packaging')
    .reduce((sum, l) => sum + (Number(l.available_quantity || 0) * Number(l.unit_cost || 0)), 0)

  const bulkwipValuation = (lots || [])
    .filter(l => l.items?.item_type === 'bulk_liquid')
    .reduce((sum, l) => sum + (Number(l.available_quantity || 0) * Number(l.unit_cost || 0)), 0)

  const finishedGoodsValuation = (lots || [])
    .filter(l => l.items?.item_type === 'finished_good')
    .reduce((sum, l) => sum + (Number(l.available_quantity || 0) * Number(l.unit_cost || 0)), 0)

  // Trace Search Logic
  const handleTraceLookup = (query) => {
    const q = query.trim().toLowerCase()
    if (!q) {
      setSelectedTrace(null)
      return
    }

    // 1. Check if lot number matches
    const matchedLot = lots.find(l => l.lot_number?.toLowerCase().includes(q))
    // 2. Check if batch number matches
    const matchedBatch = batches.find(b => b.batch_number?.toLowerCase().includes(q))
    // 3. Check if bottling run matches
    const matchedRun = bottlingRuns.find(r => r.run_number?.toLowerCase().includes(q))

    let traceResult = {
      query: q,
      lot: matchedLot,
      batch: matchedBatch,
      run: matchedRun,
      relatedBatches: [],
      relatedRuns: [],
      ledger: []
    }

    if (matchedLot) {
      // Find batches where this lot was consumed
      traceResult.relatedBatches = batches.filter(b => 
        b.batch_ingredient_issues?.some(i => String(i.lot_id) === String(matchedLot.id))
      )
      // Find bottling runs if this lot was packaging or finished goods
      traceResult.relatedRuns = bottlingRuns.filter(r => 
        r.bottling_component_issues?.some(c => String(c.lot_id) === String(matchedLot.id)) ||
        r.run_number?.toLowerCase().includes(matchedLot.lot_number?.toLowerCase().replace('lot-fg-', ''))
      )
    }

    if (matchedBatch) {
      traceResult.relatedRuns = bottlingRuns.filter(r => String(r.source_batch_id) === String(matchedBatch.id))
    }

    setSelectedTrace(traceResult)
  }

  return (
    <div className="space-y-6">
      {/* Valuation Header Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Raw Materials & Packaging Value</p>
          <p className="text-2xl font-black text-amber-950 mt-1">Rs. {rawMaterialValuation.toLocaleString()}</p>
          <p className="text-[11px] text-amber-600 mt-1">Oils, Aroma Chemicals & Bottles in Stock</p>
        </div>

        <div className="bg-purple-50 p-5 rounded-2xl border border-purple-200">
          <p className="text-xs font-bold uppercase tracking-wider text-purple-700">Macerating Bulk Liquid (WIP)</p>
          <p className="text-2xl font-black text-purple-950 mt-1">Rs. {bulkwipValuation.toLocaleString()}</p>
          <p className="text-[11px] text-purple-600 mt-1">Blended Perfume in Maturation Vats</p>
        </div>

        <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Finished Perfume Stock Value</p>
          <p className="text-2xl font-black text-emerald-950 mt-1">Rs. {finishedGoodsValuation.toLocaleString()}</p>
          <p className="text-[11px] text-emerald-600 mt-1">Bottled Goods Ready for POS Billing</p>
        </div>
      </div>

      {/* Traceability Explorer Search Box */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div className="max-w-2xl">
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck size={20} className="text-purple-600" />
            End-to-End Lot & Batch Traceability
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Trace from raw oil supplier lot → laboratory production batch → bottling run → POS customer sale.
          </p>

          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Enter Lot # (e.g. LOT-261011-001) or Batch # (MP-20261011-001)..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value)
                  handleTraceLookup(e.target.value)
                }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Trace Visual Journey */}
        {selectedTrace && (
          <div className="mt-6 pt-6 border-t border-gray-100 animate-in fade-in">
            <h4 className="text-xs font-black uppercase text-gray-400 tracking-wider mb-4">
              Traceability Journey for "{selectedTrace.query}"
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Node 1: Raw Material Lot */}
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  1. Raw Ingredient Lot
                </span>
                {selectedTrace.lot ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="font-mono font-black text-purple-700">{selectedTrace.lot.lot_number}</p>
                    <p className="font-bold text-gray-800">{selectedTrace.lot.items?.name}</p>
                    <p className="text-gray-500">Initial: {selectedTrace.lot.initial_quantity} {selectedTrace.lot.items?.base_unit}</p>
                    <p className="text-gray-500">Available: {selectedTrace.lot.available_quantity} {selectedTrace.lot.items?.base_unit}</p>
                    <p className="text-emerald-700 font-bold">Unit Cost: Rs. {selectedTrace.lot.unit_cost}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-400 italic">No direct raw lot match</p>
                )}
              </div>

              {/* Node 2: Production Batch */}
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  2. Blending Batch
                </span>
                {selectedTrace.batch ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="font-mono font-black text-purple-700">{selectedTrace.batch.batch_number}</p>
                    <p className="font-bold text-gray-800">{selectedTrace.batch.formulas?.name}</p>
                    <p className="text-gray-500">Planned: {selectedTrace.batch.planned_volume_ml} mL</p>
                    <p className="text-gray-500">Yield: {selectedTrace.batch.actual_volume_ml || selectedTrace.batch.planned_volume_ml} mL</p>
                    <p className="text-purple-700 font-bold">Cost/mL: Rs. {Number(selectedTrace.batch.cost_per_ml || 0).toFixed(2)}</p>
                  </div>
                ) : selectedTrace.relatedBatches.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-[11px] text-gray-500">Consumed in:</p>
                    {selectedTrace.relatedBatches.map(b => (
                      <p key={b.id} className="font-mono font-bold text-purple-700">{b.batch_number} ({b.formulas?.name})</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-400 italic">No production batch linked</p>
                )}
              </div>

              {/* Node 3: Bottling Run & Shelf Stock */}
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  3. Bottling & Finished Goods
                </span>
                {selectedTrace.run ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="font-mono font-black text-blue-700">{selectedTrace.run.run_number}</p>
                    <p className="font-bold text-gray-800">{selectedTrace.run.items?.name}</p>
                    <p className="text-gray-500">Good Bottles: {selectedTrace.run.actual_good_bottles} pcs</p>
                    <p className="text-emerald-700 font-bold">Unit Cost: Rs. {Number(selectedTrace.run.unit_cost || 0).toFixed(2)}</p>
                  </div>
                ) : selectedTrace.relatedRuns.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-[11px] text-gray-500">Bottled in:</p>
                    {selectedTrace.relatedRuns.map(r => (
                      <p key={r.id} className="font-mono font-bold text-blue-700">{r.run_number} ({r.items?.name})</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-400 italic">No bottling run linked</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Lots Ledger Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-black text-gray-900 text-sm flex items-center gap-2">
            <Layers size={16} className="text-purple-600" />
            Active Inventory Lots Overview
          </h3>
          <span className="text-xs text-gray-400">Total lots: {lots.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 font-bold text-gray-600 border-b border-gray-200">
                <th className="p-3">Lot Number</th>
                <th className="p-3">Item Name</th>
                <th className="p-3">Classification</th>
                <th className="p-3 text-right">Available Qty</th>
                <th className="p-3 text-right">Unit Cost</th>
                <th className="p-3 text-right">Total Value</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lots.slice(0, 15).map(lot => {
                const totalVal = Number(lot.available_quantity || 0) * Number(lot.unit_cost || 0)
                return (
                  <tr key={lot.id} className="hover:bg-gray-50 transition">
                    <td className="p-3 font-mono font-bold text-purple-700">{lot.lot_number}</td>
                    <td className="p-3 font-bold text-gray-800">{lot.items?.name}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600">
                        {lot.items?.item_type?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-gray-900">
                      {lot.available_quantity} {lot.items?.base_unit}
                    </td>
                    <td className="p-3 text-right font-mono text-gray-600">
                      Rs. {Number(lot.unit_cost || 0).toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-700">
                      Rs. {totalVal.toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        lot.status === 'available' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {lot.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
