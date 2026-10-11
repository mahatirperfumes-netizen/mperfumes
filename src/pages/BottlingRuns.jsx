import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { isManufacturer } from '../utils/featureGate'
import { depleteItemStockAcrossLots, creditFinishedGoodsStock } from '../services/inventoryService'
import {
  Factory, Plus, Search, Filter, CheckCircle2, 
  AlertTriangle, Printer, X, Eye, Layers, 
  Box, Package, ShieldCheck, Scale, Sparkles, Droplets
} from 'lucide-react'

export default function BottlingRuns() {
  const { user } = useAuth()
  const [bottlingRuns, setBottlingRuns] = useState([])
  const [completedBatches, setCompletedBatches] = useState([])
  const [packagingItems, setPackagingItems] = useState([])
  const [finishedItems, setFinishedItems] = useState([])
  const [products, setProducts] = useState([])
  const [availableLots, setAvailableLots] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [selectedRun, setSelectedRun] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Create Form State
  const [form, setForm] = useState({
    run_number: '',
    source_batch_id: '',
    target_finished_item_id: '',
    target_product_id: '',
    fill_size_ml: 50,
    planned_bottles: 50,
    actual_good_bottles: 50,
    rejected_bottles: 0,
    operator_id: user?.name || user?.username || 'Bottling Staff',
    notes: '',
    qc_status: 'approved',
    components: [] // [{ component_item_id, item_name, quantity_used, quantity_damaged, lot_id, unit_cost, total_cost, available_stock }]
  })

  useEffect(() => {
    if (user?.shop_id) {
      fetchData()
    }
  }, [user?.shop_id])

  const generateRunNumber = (count = 0) => {
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const seq = String(count + 1).padStart(3, '0')
    return `BOT-${yyyy}${mm}${dd}-${seq}`
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      // 1. Bottling Runs with relations
      const { data: runsData, error: rErr } = await supabase
        .from('bottling_runs')
        .select(`
          *,
          production_batches(id, batch_number, formula_id, cost_per_ml, actual_volume_ml, formulas(name, version)),
          items(id, name, sku, base_unit),
          bottling_component_issues(
            *,
            items(id, name, item_type),
            inventory_lots(id, lot_number)
          )
        `)
        .eq('shop_id', user.shop_id)
        .order('id', { ascending: false })

      if (!rErr && runsData) {
        setBottlingRuns(runsData)
        await db.bottling_runs?.bulkPut(JSON.parse(JSON.stringify(runsData))).catch(() => {})
      } else {
        const local = await db.bottling_runs?.where('shop_id').equals(user.shop_id).toArray()
        setBottlingRuns(local || [])
      }

      // 2. Completed Production Batches with formula packaging BOMs
      const { data: bData } = await supabase
        .from('production_batches')
        .select('*, formulas(id, name, version, formula_packaging_boms(*))')
        .eq('shop_id', user.shop_id)
        .eq('status', 'completed')
        .order('id', { ascending: false })

      if (bData) setCompletedBatches(bData)

      // 3. Packaging & Finished Items
      const { data: itemsData } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', user.shop_id)
        .eq('is_active', true)

      if (itemsData) {
        setPackagingItems(itemsData.filter(i => i.item_type === 'packaging'))
        setFinishedItems(itemsData.filter(i => i.item_type === 'finished_good'))
      }

      // 4. Products (Shelf POS products)
      const { data: prodData } = await supabase
        .from('products')
        .select('*')
        .eq('shop_id', user.shop_id)

      if (prodData) setProducts(prodData)

      // 5. Available Lots for Packaging
      const { data: lotsData } = await supabase
        .from('inventory_lots')
        .select('*')
        .eq('shop_id', user.shop_id)
        .gt('available_quantity', 0)
        .order('received_date', { ascending: true })

      if (lotsData) setAvailableLots(lotsData)

      // 6. Locations
      const { data: locData } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('shop_id', user.shop_id)

      if (locData) setLocations(locData)

    } catch (err) {
      console.error('Bottling runs fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Handle Batch Selection or Planned Bottles change
  const handleBatchOrBottlesChange = (batchId, plannedCount, fillSize) => {
    const batch = completedBatches.find(b => String(b.id) === String(batchId))
    const bottles = Number(plannedCount) || 50
    const size = Number(fillSize) || 50

    // Auto-populate packaging components
    // If formula has packaging BOMs, prioritize those specific components
    const formulaBOMs = batch?.formulas?.formula_packaging_boms || []
    let targetPkgItems = packagingItems
    if (formulaBOMs.length > 0) {
      const bomItemIds = formulaBOMs.map(b => String(b.component_item_id))
      const matched = packagingItems.filter(p => bomItemIds.includes(String(p.id)))
      if (matched.length > 0) targetPkgItems = matched
    }

    const suggestedComponents = targetPkgItems.map(p => {
      const bomEntry = formulaBOMs.find(b => String(b.component_item_id) === String(p.id))
      const perUnitRatio = Number(bomEntry?.quantity_per_unit) || 1
      const totalComponentQty = bottles * perUnitRatio

      const itemLots = availableLots.filter(l => String(l.item_id) === String(p.id))
      const totalStock = itemLots.reduce((acc, l) => acc + Number(l.available_quantity || 0), 0)
      const defaultLot = itemLots[0] || null
      const unitCost = defaultLot ? Number(defaultLot.unit_cost) : (Number(p.cost_price) || 0)

      return {
        component_item_id: p.id,
        item_name: p.name,
        quantity_used: totalComponentQty,
        quantity_damaged: 0,
        lot_id: defaultLot ? defaultLot.id : '',
        lot_number: defaultLot ? defaultLot.lot_number : '',
        unit_cost: unitCost,
        total_cost: Number((totalComponentQty * unitCost).toFixed(2)),
        available_stock: totalStock,
        selected: true
      }
    })

    setForm(prev => ({
      ...prev,
      source_batch_id: batchId,
      planned_bottles: bottles,
      actual_good_bottles: bottles,
      fill_size_ml: size,
      components: prev.components.length > 0 ? prev.components.map(c => {
        const bomEntry = formulaBOMs.find(b => String(b.component_item_id) === String(c.component_item_id))
        const perUnitRatio = Number(bomEntry?.quantity_per_unit) || 1
        const totalQty = bottles * perUnitRatio
        return {
          ...c,
          quantity_used: totalQty,
          total_cost: Number(((totalQty + Number(c.quantity_damaged || 0)) * c.unit_cost).toFixed(2))
        }
      }) : suggestedComponents
    }))
  }

  const handleOpenCreateModal = () => {
    setError('')
    const runNo = generateRunNumber(bottlingRuns.length)
    setForm({
      run_number: runNo,
      source_batch_id: '',
      target_finished_item_id: '',
      target_product_id: '',
      fill_size_ml: 50,
      planned_bottles: 50,
      actual_good_bottles: 50,
      rejected_bottles: 0,
      operator_id: user?.name || user?.username || 'Bottling Staff',
      notes: '',
      qc_status: 'approved',
      components: []
    })
    setShowCreateModal(true)
  }

  // Cost & Remaining Volume Calculations
  const selectedBatchObj = completedBatches.find(b => String(b.id) === String(form.source_batch_id))
  const alreadyConsumedBulk = selectedBatchObj 
    ? bottlingRuns.filter(r => String(r.source_batch_id) === String(selectedBatchObj.id)).reduce((sum, r) => sum + Number(r.bulk_consumed_ml || 0), 0)
    : 0
  const batchTotalBulk = Number(selectedBatchObj?.actual_volume_ml) || Number(selectedBatchObj?.planned_volume_ml) || 0
  const remainingBulkVolume = Math.max(0, batchTotalBulk - alreadyConsumedBulk)

  const bulkPerMlCost = selectedBatchObj ? Number(selectedBatchObj.cost_per_ml || 0) : 0
  const bulkVolumeConsumed = Number(form.actual_good_bottles || form.planned_bottles) * Number(form.fill_size_ml)
  const bulkCostTotal = Number((bulkVolumeConsumed * bulkPerMlCost).toFixed(2))
  
  const packagingCostTotal = form.components
    .filter(c => c.selected !== false)
    .reduce((sum, c) => sum + (Number(c.total_cost) || 0), 0)

  const totalRunCost = bulkCostTotal + packagingCostTotal
  const unitBottleCost = Number(form.actual_good_bottles) > 0 
    ? Number((totalRunCost / Number(form.actual_good_bottles)).toFixed(2))
    : 0

  const handleCreateBottlingRun = async () => {
    if (!form.run_number.trim()) {
      setError('Run number is required')
      return
    }
    if (!form.source_batch_id) {
      setError('Please select a completed bulk batch')
      return
    }
    if (!form.target_finished_item_id && !form.target_product_id) {
      setError('Please select a target finished perfume or product')
      return
    }
    if (Number(form.actual_good_bottles) <= 0) {
      setError('Actual good bottles must be greater than 0')
      return
    }

    // Validate bulk volume sufficiency
    if (bulkVolumeConsumed > remainingBulkVolume && remainingBulkVolume > 0) {
      setError(`Requested bulk volume (${bulkVolumeConsumed} mL) exceeds remaining batch bulk liquid (${remainingBulkVolume} mL)!`)
      return
    }

    // Check packaging stock sufficiency
    for (const comp of form.components.filter(c => c.selected !== false)) {
      const needed = Number(comp.quantity_used) + Number(comp.quantity_damaged || 0)
      if (needed > comp.available_stock) {
        setError(`Insufficient packaging stock for ${comp.item_name}. Needed: ${needed}, In stock: ${comp.available_stock}`)
        return
      }
    }

    setSaving(true)
    setError('')

    try {
      // 1. Resolve Target Item ID
      let targetItemId = form.target_finished_item_id ? Number(form.target_finished_item_id) : null
      let targetProduct = null

      if (form.target_product_id) {
        targetProduct = products.find(p => String(p.id) === String(form.target_product_id))
      }

      // If targetItemId is not set but targetProduct is chosen, find or create finished good in items
      if (!targetItemId && targetProduct) {
        const { data: existItem } = await supabase
          .from('items')
          .select('id')
          .eq('shop_id', user.shop_id)
          .eq('name', targetProduct.name)
          .maybeSingle()

        if (existItem) {
          targetItemId = existItem.id
        } else {
          const { data: newItem } = await supabase
            .from('items')
            .insert([{
              shop_id: user.shop_id,
              sku: targetProduct.sku || `SKU-${Date.now()}`,
              name: targetProduct.name,
              item_type: 'finished_good',
              base_unit: 'pcs',
              cost_price: unitBottleCost,
              sale_price: targetProduct.sale_price || 0,
              is_active: true
            }])
            .select('id')
            .single()

          if (newItem) targetItemId = newItem.id
        }
      }

      // 2. Insert into bottling_runs
      const runPayload = {
        shop_id: user.shop_id,
        run_number: form.run_number.trim(),
        source_batch_id: Number(form.source_batch_id),
        target_finished_item_id: targetItemId,
        fill_size_ml: Number(form.fill_size_ml),
        planned_bottles: Number(form.planned_bottles),
        actual_good_bottles: Number(form.actual_good_bottles),
        rejected_bottles: Number(form.rejected_bottles) || 0,
        bulk_consumed_ml: bulkVolumeConsumed,
        bulk_cost: bulkCostTotal,
        packaging_cost: packagingCostTotal,
        unit_cost: unitBottleCost,
        qc_status: form.qc_status,
        operator_id: form.operator_id,
        completed_at: new Date().toISOString()
      }

      const { data: createdRun, error: rErr } = await supabase
        .from('bottling_runs')
        .insert([runPayload])
        .select()
        .single()

      if (rErr) throw rErr

      // 3. Insert bottling component issues and deplete packaging across lots using FEFO/FIFO
      const selectedComponents = form.components.filter(c => c.selected !== false)
      if (selectedComponents.length > 0) {
        const compIssues = selectedComponents.map(c => ({
          bottling_run_id: createdRun.id,
          component_item_id: c.component_item_id,
          lot_id: c.lot_id ? Number(c.lot_id) : null,
          quantity_used: Number(c.quantity_used),
          quantity_damaged: Number(c.quantity_damaged) || 0,
          unit_cost: c.unit_cost
        }))

        await supabase.from('bottling_component_issues').insert(compIssues)

        for (const c of selectedComponents) {
          const usedQty = Number(c.quantity_used) || 0
          const damagedQty = Number(c.quantity_damaged) || 0
          const totalQty = usedQty + damagedQty
          if (totalQty > 0) {
            await depleteItemStockAcrossLots({
              shopId: user.shop_id,
              itemId: c.component_item_id,
              preferredLotId: c.lot_id,
              quantityToDeduct: totalQty,
              unit: 'pcs',
              referenceId: `RUN-${createdRun.run_number}`,
              notes: `Packaging consumed in bottling run ${createdRun.run_number}`,
              transactionType: 'bottling_issue',
              userId: user.id
            })
          }
        }
      }

      // 3b. Deduct Bulk Liquid from Source Batch Lot & Items stock
      if (selectedBatchObj && bulkVolumeConsumed > 0) {
        const { data: bulkLot } = await supabase
          .from('inventory_lots')
          .select('*')
          .eq('shop_id', user.shop_id)
          .ilike('lot_number', `%${selectedBatchObj.batch_number}%`)
          .gt('available_quantity', 0)
          .order('id', { ascending: false })
          .maybeSingle()

        if (bulkLot) {
          const newBulkAvail = Math.max(0, Number(bulkLot.available_quantity) - bulkVolumeConsumed)
          const bulkStat = newBulkAvail <= 0 ? 'exhausted' : 'available'

          await supabase
            .from('inventory_lots')
            .update({ available_quantity: newBulkAvail, status: bulkStat })
            .eq('id', bulkLot.id)

          if (db.inventory_lots) {
            await db.inventory_lots.update(bulkLot.id, { available_quantity: newBulkAvail, status: bulkStat }).catch(() => {})
          }

          if (bulkLot.item_id) {
            const { data: bItm } = await supabase
              .from('items')
              .select('id, current_stock')
              .eq('id', bulkLot.item_id)
              .maybeSingle()

            if (bItm) {
              const newBStock = Math.max(0, (Number(bItm.current_stock) || 0) - bulkVolumeConsumed)
              await supabase
                .from('items')
                .update({ current_stock: newBStock })
                .eq('id', bulkLot.item_id)

              if (db.items) {
                await db.items.update(bulkLot.item_id, { current_stock: newBStock }).catch(() => {})
              }
            }
          }

          // Immutable ledger for bulk liquid consumption
          await supabase
            .from('inventory_ledger')
            .insert([{
              shop_id: user.shop_id,
              item_id: bulkLot.item_id,
              lot_id: bulkLot.id,
              transaction_type: 'bottling_bulk_issue',
              quantity: -Math.abs(bulkVolumeConsumed),
              base_unit: 'ml',
              unit_cost: bulkPerMlCost,
              total_cost: bulkCostTotal,
              reference_id: `RUN-${createdRun.run_number}`,
              notes: `Bulk liquid consumed in bottling run ${createdRun.run_number}`,
              created_by: user.username || user.email || 'Admin'
            }])
        }
      }

      // 4. Credit Finished Goods to shelf products & items catalog & lots
      const finishedLocation = locations.find(l => l.name?.toLowerCase().includes('finished') || l.name?.toLowerCase().includes('shelf'))

      await creditFinishedGoodsStock({
        shopId: user.shop_id,
        targetProductId: form.target_product_id,
        finishedItemId: targetItemId,
        quantity: Number(form.actual_good_bottles),
        unitCost: unitBottleCost,
        referenceId: `RUN-${createdRun.run_number}`,
        notes: `Finished perfume bottles credited to sellable stock`,
        locationId: finishedLocation?.id || null,
        userId: user.id
      })

      setShowCreateModal(false)
      await fetchData()
    } catch (err) {
      console.error('Bottling run creation error:', err)
      setError(err.message || 'Failed to complete bottling run')
    } finally {
      setSaving(false)
    }
  }

  // Filtered runs
  const filteredRuns = bottlingRuns.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      r.run_number?.toLowerCase().includes(q) ||
      r.production_batches?.batch_number?.toLowerCase().includes(q) ||
      r.items?.name?.toLowerCase().includes(q)
    return matchSearch
  })

  // Summary Metrics
  const totalBottlesProduced = bottlingRuns.reduce((sum, r) => sum + (Number(r.actual_good_bottles) || 0), 0)
  const totalBulkConsumedLiters = bottlingRuns.reduce((sum, r) => sum + (Number(r.bulk_consumed_ml) || 0), 0) / 1000
  const avgUnitCost = bottlingRuns.length > 0
    ? (bottlingRuns.reduce((sum, r) => sum + (Number(r.unit_cost) || 0), 0) / bottlingRuns.length).toFixed(2)
    : '0.00'

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Top Banner */}
      <div className="p-4 sm:p-6 bg-white border-b border-gray-200 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Factory size={22} />
            </span>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                Bottling Runs & Packaging
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-blue-200">
                  Finished Goods
                </span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Consume bulk perfume & packaging components (bottles, caps, sprayers) to credit finished sellable stock for POS.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm shadow-sm transition cursor-pointer"
          >
            <Plus size={16} />
            New Bottling Run
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:px-6 bg-white border-b border-gray-200 shrink-0 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 font-bold uppercase">Total Bottling Runs</p>
          <p className="text-lg font-black text-gray-900 mt-0.5">{bottlingRuns.length}</p>
        </div>
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p className="text-xs text-blue-700 font-bold uppercase flex items-center gap-1">
            <Package size={12} /> Total Good Bottles
          </p>
          <p className="text-lg font-black text-blue-900 mt-0.5">
            {totalBottlesProduced.toLocaleString()} <span className="text-xs font-medium">Units</span>
          </p>
        </div>
        <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
          <p className="text-xs text-purple-700 font-bold uppercase flex items-center gap-1">
            <Droplets size={12} /> Bulk Consumed
          </p>
          <p className="text-lg font-black text-purple-900 mt-0.5">
            {totalBulkConsumedLiters.toFixed(2)} <span className="text-xs font-medium">Litres</span>
          </p>
        </div>
        <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
          <p className="text-xs text-emerald-700 font-bold uppercase flex items-center gap-1">
            <Scale size={12} /> Average Unit Cost
          </p>
          <p className="text-lg font-black text-emerald-900 mt-0.5">
            Rs. {avgUnitCost} <span className="text-xs font-medium">/ bottle</span>
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4 sm:px-6 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3 shrink-0">
        <div className="relative flex-1 sm:w-80">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search run #, source batch, perfume name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Runs Table / Cards */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-xs">Loading bottling runs...</p>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center bg-white rounded-xl border border-gray-200 p-6">
            <Factory size={40} className="text-gray-300 mb-2" />
            <h3 className="text-base font-bold text-gray-700">No Bottling Runs Recorded</h3>
            <p className="text-xs text-gray-400 max-w-sm mt-1">
              Start a bottling run to consume matured bulk liquid with glass bottles, sprayers, and caps to populate shelf inventory.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
            >
              New Bottling Run
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRuns.map(run => (
              <div
                key={run.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-black text-blue-700">
                          {run.run_number}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                          COMPLETED
                        </span>
                      </div>
                      <h4 className="font-black text-gray-900 text-base mt-1">
                        {run.items?.name || 'Finished Perfume'}
                      </h4>
                      <p className="text-[11px] text-gray-400 font-mono">
                        Source Batch: {run.production_batches?.batch_number || `#${run.source_batch_id}`}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedRun(run)
                        setShowPrintModal(true)
                      }}
                      title="Print Bottling Sheet"
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                    >
                      <Printer size={16} />
                    </button>
                  </div>

                  {/* Run Metrics */}
                  <div className="grid grid-cols-2 gap-2 my-3 text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                    <div>
                      <p className="text-gray-400 text-[10px] uppercase font-bold">Good Bottles</p>
                      <p className="font-black text-blue-700 text-sm">
                        {run.actual_good_bottles} <span className="text-[10px] font-normal text-gray-500">× {run.fill_size_ml}mL</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] uppercase font-bold">Bulk Consumed</p>
                      <p className="font-bold text-gray-800">{run.bulk_consumed_ml} mL</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] uppercase font-bold">Unit Cost</p>
                      <p className="font-black text-emerald-700">
                        Rs. {Number(run.unit_cost || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] uppercase font-bold">Total Cost</p>
                      <p className="font-bold text-gray-800">
                        Rs. {(Number(run.bulk_cost || 0) + Number(run.packaging_cost || 0)).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2 px-1">
                    <span>Operator: <strong className="text-gray-700">{run.operator_id || 'Staff'}</strong></span>
                    <span>QC: <strong className="uppercase text-emerald-600">{run.qc_status || 'Passed'}</strong></span>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      setSelectedRun(run)
                      setShowDetailModal(true)
                    }}
                    className="w-full py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                  >
                    <Eye size={14} /> View Component Breakdown
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CREATE BOTTLING RUN MODAL ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:px-6 bg-blue-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-blue-800 rounded-lg text-blue-200">
                  <Factory size={20} />
                </span>
                <div>
                  <h3 className="text-base font-black tracking-tight">New Bottling Run</h3>
                  <p className="text-xs text-blue-200">Fill bulk perfume into bottles, deduct packaging lots, and credit sellable stock.</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-blue-300 hover:text-white p-1 rounded-lg">
                <X size={20} />
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold flex items-center gap-2 border-b border-red-200">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Form Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Run Number *</label>
                  <input
                    type="text"
                    value={form.run_number}
                    onChange={e => setForm({ ...form, run_number: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Source Bulk Batch *</label>
                  <select
                    value={form.source_batch_id}
                    onChange={e => handleBatchOrBottlesChange(e.target.value, form.planned_bottles, form.fill_size_ml)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">-- Choose Bulk Batch --</option>
                    {completedBatches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.batch_number} - {b.formulas?.name} (Rs. {Number(b.cost_per_ml || 0).toFixed(2)}/mL)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Fill Size (mL per bottle) *</label>
                  <select
                    value={form.fill_size_ml}
                    onChange={e => handleBatchOrBottlesChange(form.source_batch_id, form.planned_bottles, e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="15">15 mL</option>
                    <option value="30">30 mL</option>
                    <option value="50">50 mL</option>
                    <option value="60">60 mL</option>
                    <option value="100">100 mL</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-700 mb-1">Target Shelf Product (For POS Selling) *</label>
                  <select
                    value={form.target_product_id}
                    onChange={e => setForm({ ...form, target_product_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">-- Select POS Product --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Current Stock: {p.stock_quantity || 0} pcs)
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-gray-400 mt-0.5 block">
                    Finishing this bottling run will directly increment shelf stock for this product in POS billing.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Operator / Technician</label>
                  <input
                    type="text"
                    value={form.operator_id}
                    onChange={e => setForm({ ...form, operator_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Quantities & Yield */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-blue-50/50 p-3 rounded-xl border border-blue-200">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Planned Bottle Count *</label>
                  <input
                    type="number"
                    min="1"
                    value={form.planned_bottles}
                    onChange={e => handleBatchOrBottlesChange(form.source_batch_id, e.target.value, form.fill_size_ml)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-emerald-800 mb-1">Actual Good Bottles Passed QC *</label>
                  <input
                    type="number"
                    min="1"
                    value={form.actual_good_bottles}
                    onChange={e => setForm({ ...form, actual_good_bottles: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-emerald-400 rounded-lg text-xs font-bold text-emerald-900 focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-red-700 mb-1">Rejected / Broken Bottles</label>
                  <input
                    type="number"
                    min="0"
                    value={form.rejected_bottles}
                    onChange={e => setForm({ ...form, rejected_bottles: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-red-300 rounded-lg text-xs text-red-800 focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Packaging Components Section */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider flex items-center gap-1.5">
                    <Box size={14} className="text-blue-600" />
                    Packaging Components Reconciliation
                  </h4>
                  <span className="text-[11px] text-gray-500">
                    Packaging Total: <strong className="text-blue-700">Rs. {packagingCostTotal.toLocaleString()}</strong>
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                        <th className="p-2.5">Component</th>
                        <th className="p-2.5">Lot # (FEFO)</th>
                        <th className="p-2.5 text-right">In Stock</th>
                        <th className="p-2.5 text-right">Qty Used</th>
                        <th className="p-2.5 text-right">Damaged</th>
                        <th className="p-2.5 text-right">Unit Cost</th>
                        <th className="p-2.5 text-right">Line Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {form.components.map((comp, idx) => {
                        const compLots = availableLots.filter(l => String(l.item_id) === String(comp.component_item_id))
                        const isShort = Number(comp.quantity_used) + Number(comp.quantity_damaged || 0) > comp.available_stock

                        return (
                          <tr key={idx} className={isShort ? 'bg-red-50/50' : 'hover:bg-gray-50'}>
                            <td className="p-2.5 font-bold text-gray-900">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={comp.selected !== false}
                                  onChange={e => {
                                    const copy = [...form.components]
                                    copy[idx].selected = e.target.checked
                                    setForm({ ...form, components: copy })
                                  }}
                                  className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <span>{comp.item_name}</span>
                              </label>
                            </td>
                            <td className="p-2.5">
                              <select
                                value={comp.lot_id || ''}
                                onChange={e => {
                                  const selectedL = compLots.find(l => String(l.id) === String(e.target.value))
                                  const copy = [...form.components]
                                  copy[idx].lot_id = selectedL ? selectedL.id : ''
                                  copy[idx].unit_cost = selectedL ? Number(selectedL.unit_cost) : 0
                                  copy[idx].total_cost = Number(((Number(copy[idx].quantity_used) + Number(copy[idx].quantity_damaged || 0)) * copy[idx].unit_cost).toFixed(2))
                                  setForm({ ...form, components: copy })
                                }}
                                className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-[11px] font-mono focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">-- Choose Lot --</option>
                                {compLots.map(l => (
                                  <option key={l.id} value={l.id}>
                                    {l.lot_number} (Avail: {l.available_quantity})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2.5 text-right font-mono">
                              <span className={isShort ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                {comp.available_stock} pcs
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                value={comp.quantity_used}
                                onChange={e => {
                                  const copy = [...form.components]
                                  copy[idx].quantity_used = Number(e.target.value)
                                  copy[idx].total_cost = Number(((Number(e.target.value) + Number(copy[idx].quantity_damaged || 0)) * copy[idx].unit_cost).toFixed(2))
                                  setForm({ ...form, components: copy })
                                }}
                                className="w-16 px-1.5 py-0.5 text-right bg-white border border-gray-300 rounded font-mono text-xs"
                              />
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                value={comp.quantity_damaged}
                                onChange={e => {
                                  const copy = [...form.components]
                                  copy[idx].quantity_damaged = Number(e.target.value)
                                  copy[idx].total_cost = Number(((Number(copy[idx].quantity_used) + Number(e.target.value)) * copy[idx].unit_cost).toFixed(2))
                                  setForm({ ...form, components: copy })
                                }}
                                className="w-16 px-1.5 py-0.5 text-right bg-white border border-gray-300 rounded font-mono text-xs text-red-700"
                              />
                            </td>
                            <td className="p-2.5 text-right font-mono text-gray-600">
                              Rs. {comp.unit_cost}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-blue-700">
                              Rs. {comp.total_cost}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cost Summary Card */}
              <div className="bg-gray-900 text-white p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs space-y-1">
                  <p className="text-gray-400">Bulk Liquid Cost: <strong className="text-white">Rs. {bulkCostTotal.toLocaleString()}</strong> ({bulkVolumeConsumed} mL @ Rs. {bulkPerMlCost.toFixed(2)}/mL)</p>
                  <p className="text-gray-400">Packaging Materials Cost: <strong className="text-white">Rs. {packagingCostTotal.toLocaleString()}</strong></p>
                  <p className="text-gray-400">Total Run Expenditure: <strong className="text-white">Rs. {totalRunCost.toLocaleString()}</strong></p>
                </div>

                <div className="text-center sm:text-right bg-gray-800/80 p-3 rounded-lg border border-gray-700">
                  <p className="text-[10px] text-gray-400 uppercase font-bold">Calculated Unit Cost per Bottle</p>
                  <p className="text-2xl font-black text-emerald-400">
                    Rs. {unitBottleCost.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:px-6 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-bold transition"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={saving || !form.source_batch_id || (!form.target_finished_item_id && !form.target_product_id)}
                onClick={handleCreateBottlingRun}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 size={14} /> Finalize Bottling & Update Shelf Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RUN DETAILS MODAL ── */}
      {showDetailModal && selectedRun && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 sm:px-6 bg-gray-900 text-white flex items-center justify-between shrink-0">
              <div>
                <span className="font-mono text-xs font-black text-blue-400">{selectedRun.run_number}</span>
                <h3 className="text-base font-black tracking-tight">{selectedRun.items?.name || 'Bottling Run Details'}</h3>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-white p-1 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Good Units</span>
                  <p className="font-bold text-gray-900">{selectedRun.actual_good_bottles} pcs</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Fill Size</span>
                  <p className="font-bold text-gray-900">{selectedRun.fill_size_ml} mL</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Unit Cost</span>
                  <p className="font-bold text-emerald-700">Rs. {Number(selectedRun.unit_cost || 0).toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">QC Status</span>
                  <p className="font-bold text-blue-700 uppercase">{selectedRun.qc_status || 'Approved'}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-2">
                  Packaging Components Issued
                </h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 font-bold border-b border-gray-200 text-gray-600">
                        <th className="p-2">Component</th>
                        <th className="p-2">Lot #</th>
                        <th className="p-2 text-right">Qty Used</th>
                        <th className="p-2 text-right">Damaged</th>
                        <th className="p-2 text-right">Unit Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(selectedRun.bottling_component_issues || []).map((issue, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-bold">{issue.items?.name}</td>
                          <td className="p-2 font-mono text-[11px] text-gray-600">{issue.inventory_lots?.lot_number || 'Default'}</td>
                          <td className="p-2 text-right font-mono font-bold">{issue.quantity_used} pcs</td>
                          <td className="p-2 text-right font-mono text-red-600">{issue.quantity_damaged} pcs</td>
                          <td className="p-2 text-right font-mono text-gray-600">Rs. {issue.unit_cost}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 sm:px-6 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT BOTTLING WORKSHEET MODAL ── */}
      {showPrintModal && selectedRun && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-gray-900 text-white flex items-center justify-between shrink-0 print:hidden">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Printer size={16} /> Bottling Sheet Print Preview
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  Print Sheet
                </button>
                <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-white p-1">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto flex-1 bg-white text-gray-900 space-y-6 text-xs">
              <div className="border-b-2 border-gray-900 pb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-tight">Perfumery Bottling & Packaging Record</h2>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">Finished Goods Reconciliation & Line Release</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-black text-blue-700">{selectedRun.run_number}</p>
                  <p className="text-[11px] text-gray-500">Date: {new Date(selectedRun.created_at || Date.now()).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div>
                  <p className="text-gray-500 uppercase text-[10px] font-bold">Target Perfume</p>
                  <p className="text-sm font-black text-gray-900">{selectedRun.items?.name}</p>
                  <p className="text-[11px] text-gray-500">Fill Size: {selectedRun.fill_size_ml} mL</p>
                </div>
                <div>
                  <p className="text-gray-500 uppercase text-[10px] font-bold">Good Finished Units</p>
                  <p className="text-sm font-black text-gray-900">{selectedRun.actual_good_bottles} bottles</p>
                  <p className="text-[11px] text-gray-500">Source Batch: {selectedRun.production_batches?.batch_number}</p>
                </div>
              </div>

              <div>
                <h4 className="font-black text-xs uppercase tracking-wider mb-2 border-b border-gray-200 pb-1">
                  Quality Control & Line Verification Checklist
                </h4>
                <div className="space-y-1.5 text-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 border border-gray-400 inline-block text-center text-[10px]">✓</span>
                    <span>Fill Volume Check (Target {selectedRun.fill_size_ml} mL ± 1%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 border border-gray-400 inline-block text-center text-[10px]">✓</span>
                    <span>Crimping / Pump Seal Leak Test Passed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 border border-gray-400 inline-block text-center text-[10px]">✓</span>
                    <span>Cap Fit & Alignment Verified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 border border-gray-400 inline-block text-center text-[10px]">✓</span>
                    <span>Label Straightness & Batch Code Imprint Legible</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-300 grid grid-cols-2 gap-8 text-[11px]">
                <div>
                  <p className="font-bold text-gray-700">Packaging Technician Sign:</p>
                  <div className="mt-8 border-b border-gray-400 w-48" />
                  <p className="text-gray-400 text-[10px] mt-1">Signature & Date</p>
                </div>
                <div>
                  <p className="font-bold text-gray-700">QC Manager Release Sign:</p>
                  <div className="mt-8 border-b border-gray-400 w-48" />
                  <p className="text-gray-400 text-[10px] mt-1">Status: {selectedRun.qc_status?.toUpperCase() || 'APPROVED'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
