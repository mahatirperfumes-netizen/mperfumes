import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { isManufacturer } from '../utils/featureGate'
import { calculateTargetIngredient } from '../utils/unitConversion'
import {
  Workflow, Plus, Search, Filter, Play, CheckCircle2, 
  Clock, AlertTriangle, Printer, X, Eye, FileText, Check,
  Layers, FlaskConical, Sparkles, ChevronRight, Scale
} from 'lucide-react'

export default function ProductionBatches() {
  const { user } = useAuth()
  const [batches, setBatches] = useState([])
  const [formulas, setFormulas] = useState([])
  const [rawItems, setRawItems] = useState([])
  const [availableLots, setAvailableLots] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Create Batch Form
  const [form, setForm] = useState({
    batch_number: '',
    formula_id: '',
    planned_volume_ml: 1000,
    operator_id: user?.name || user?.username || 'Admin',
    notes: '',
    status: 'draft',
    ingredients: [] // [{ ingredient_item_id, item_name, unit, target_quantity, lot_id, actual_quantity, unit_cost, total_cost, available_stock }]
  })

  useEffect(() => {
    if (user?.shop_id) {
      fetchData()
    }
  }, [user?.shop_id])

  const generateBatchNumber = (existingCount = 0) => {
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const seq = String(existingCount + 1).padStart(3, '0')
    return `MP-${yyyy}${mm}${dd}-${seq}`
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      // 1. Production Batches
      const { data: bData, error: bError } = await supabase
        .from('production_batches')
        .select(`
          *,
          formulas(id, name, version, calculation_basis),
          batch_ingredient_issues(
            *,
            items(id, name, item_type, base_unit),
            inventory_lots(id, lot_number, expiry_date)
          )
        `)
        .eq('shop_id', user.shop_id)
        .order('id', { ascending: false })

      if (!bError && bData) {
        setBatches(bData)
        await db.production_batches?.bulkPut(JSON.parse(JSON.stringify(bData))).catch(() => {})
      } else {
        const local = await db.production_batches?.where('shop_id').equals(user.shop_id).toArray()
        setBatches(local || [])
      }

      // 2. Formulas
      const { data: fData } = await supabase
        .from('formulas')
        .select(`*, formula_ingredients(*)`)
        .eq('shop_id', user.shop_id)
        .order('name')

      if (fData) setFormulas(fData)

      // 3. Raw Items
      const { data: itemsData } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', user.shop_id)
        .eq('is_active', true)

      if (itemsData) setRawItems(itemsData)

      // 4. Inventory Lots (Available stock)
      const { data: lotsData } = await supabase
        .from('inventory_lots')
        .select('*')
        .eq('shop_id', user.shop_id)
        .gt('available_quantity', 0)
        .order('received_date', { ascending: true }) // FEFO/FIFO

      if (lotsData) setAvailableLots(lotsData)

      // 5. Locations
      const { data: locData } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('shop_id', user.shop_id)

      if (locData) setLocations(locData)

    } catch (err) {
      console.error('Production batches fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  // When Formula or Planned Volume changes in Create Form
  const handleFormulaChange = (formulaId, volume = form.planned_volume_ml) => {
    const formula = formulas.find(f => String(f.id) === String(formulaId))
    if (!formula) {
      setForm(prev => ({ ...prev, formula_id: '', ingredients: [] }))
      return
    }

    const plannedVol = Number(volume) || 1000
    const calculatedIngredients = (formula.formula_ingredients || []).map(fi => {
      const item = rawItems.find(i => String(i.id) === String(fi.ingredient_item_id))
      const density = item?.density || (item?.item_type === 'raw_chemical' ? 0.789 : 0.95)
      
      const targetQty = calculateTargetIngredient(
        fi.percentage,
        plannedVol,
        formula.calculation_basis || 'weight_percentage',
        density
      )

      // Find lots for this item ordered by FEFO / FIFO
      const itemLots = availableLots.filter(l => String(l.item_id) === String(fi.ingredient_item_id))
      const totalStock = itemLots.reduce((acc, l) => acc + Number(l.available_quantity || 0), 0)
      
      // Auto-assign earliest available lot if possible
      const defaultLot = itemLots[0] || null
      const unitCost = defaultLot ? Number(defaultLot.unit_cost) : (Number(item?.cost_price) || 0)

      return {
        ingredient_item_id: fi.ingredient_item_id,
        item_name: item?.name || `Item #${fi.ingredient_item_id}`,
        percentage: fi.percentage,
        unit: fi.unit || 'g',
        target_quantity: Number(targetQty.toFixed(2)),
        actual_quantity: Number(targetQty.toFixed(2)), // default actual to target
        lot_id: defaultLot ? defaultLot.id : '',
        lot_number: defaultLot ? defaultLot.lot_number : '',
        available_stock: totalStock,
        unit_cost: unitCost,
        total_cost: Number((targetQty * unitCost).toFixed(2))
      }
    })

    setForm(prev => ({
      ...prev,
      formula_id: formulaId,
      planned_volume_ml: plannedVol,
      ingredients: calculatedIngredients
    }))
  }

  const handleOpenCreateModal = () => {
    setError('')
    const batchNo = generateBatchNumber(batches.length)
    setForm({
      batch_number: batchNo,
      formula_id: '',
      planned_volume_ml: 1000,
      operator_id: user?.name || user?.username || 'Production Staff',
      notes: '',
      status: 'draft',
      ingredients: []
    })
    setShowCreateModal(true)
  }

  const handleCreateBatch = async (startDirectly = false) => {
    if (!form.batch_number.trim()) {
      setError('Batch Number is required')
      return
    }
    if (!form.formula_id) {
      setError('Please select a master formula')
      return
    }
    if (form.ingredients.length === 0) {
      setError('Formula has no ingredients')
      return
    }

    // Validate stock if starting directly
    if (startDirectly) {
      for (const ing of form.ingredients) {
        if (!ing.lot_id) {
          setError(`Please select an inventory lot for ${ing.item_name}`)
          return
        }
        if (ing.actual_quantity > ing.available_stock) {
          setError(`Insufficient stock for ${ing.item_name}. Required: ${ing.actual_quantity}, Available: ${ing.available_stock}`)
          return
        }
      }
    }

    setSaving(true)
    setError('')

    try {
      const initialStatus = startDirectly ? 'in_blending' : 'draft'
      const startedAt = startDirectly ? new Date().toISOString() : null
      const totalMatCost = form.ingredients.reduce((sum, i) => sum + (Number(i.total_cost) || 0), 0)

      const batchPayload = {
        shop_id: user.shop_id,
        batch_number: form.batch_number.trim(),
        formula_id: Number(form.formula_id),
        planned_volume_ml: Number(form.planned_volume_ml),
        actual_volume_ml: startDirectly ? Number(form.planned_volume_ml) : null,
        status: initialStatus,
        started_at: startedAt,
        operator_id: form.operator_id,
        total_material_cost: totalMatCost,
        cost_per_ml: form.planned_volume_ml > 0 ? totalMatCost / Number(form.planned_volume_ml) : 0,
        qc_status: 'pending',
        qc_notes: form.notes || null
      }

      const { data: createdBatch, error: bErr } = await supabase
        .from('production_batches')
        .insert([batchPayload])
        .select()
        .single()

      if (bErr) throw bErr

      // Insert ingredient issues
      const issueRecords = form.ingredients.map(ing => ({
        batch_id: createdBatch.id,
        ingredient_item_id: ing.ingredient_item_id,
        lot_id: ing.lot_id || null,
        planned_quantity: ing.target_quantity,
        actual_quantity: ing.actual_quantity,
        unit: ing.unit,
        unit_cost: ing.unit_cost,
        total_cost: ing.total_cost
      }))

      const { error: issueErr } = await supabase
        .from('batch_ingredient_issues')
        .insert(issueRecords)

      if (issueErr) throw issueErr

      setShowCreateModal(false)
      await fetchData()
    } catch (err) {
      console.error('Batch creation error:', err)
      setError(err.message || 'Failed to create production batch')
    } finally {
      setSaving(false)
    }
  }

  // Update Status: Draft -> In Blending -> Maturing -> Completed
  const handleUpdateStatus = async (batch, newStatus, extraData = {}) => {
    setSaving(true)
    setError('')
    try {
      const updatePayload = {
        status: newStatus,
        ...extraData
      }

      if (newStatus === 'in_blending' && !batch.started_at) {
        updatePayload.started_at = new Date().toISOString()
      }

      // ── COMPLETION LOGIC ──
      // If moving to 'completed', deduct exact inventory lots and credit bulk output
      if (newStatus === 'completed') {
        const completedAt = new Date().toISOString()
        updatePayload.completed_at = completedAt
        updatePayload.qc_status = extraData.qc_status || 'passed'
        
        const actualYieldMl = Number(extraData.actual_volume_ml) || Number(batch.planned_volume_ml)
        updatePayload.actual_volume_ml = actualYieldMl

        // Recalculate cost per mL
        const totalMatCost = Number(batch.total_material_cost) || 0
        updatePayload.cost_per_ml = actualYieldMl > 0 ? Number((totalMatCost / actualYieldMl).toFixed(4)) : 0

        // 1. Deduct ingredient lots & add ledger entries
        const issues = batch.batch_ingredient_issues || []
        for (const issue of issues) {
          if (issue.lot_id && issue.actual_quantity > 0) {
            // Fetch lot
            const { data: lot } = await supabase
              .from('inventory_lots')
              .select('*')
              .eq('id', issue.lot_id)
              .single()

            if (lot) {
              const newAvailable = Math.max(0, Number(lot.available_quantity) - Number(issue.actual_quantity))
              const lotStatus = newAvailable <= 0 ? 'exhausted' : 'available'

              await supabase
                .from('inventory_lots')
                .update({ available_quantity: newAvailable, status: lotStatus })
                .eq('id', lot.id)

              // Record in immutable ledger
              await supabase
                .from('inventory_ledger')
                .insert([{
                  shop_id: user.shop_id,
                  item_id: issue.ingredient_item_id,
                  lot_id: lot.id,
                  location_id: lot.location_id || null,
                  transaction_type: 'production_issue',
                  quantity: -Math.abs(Number(issue.actual_quantity)),
                  base_unit: issue.unit,
                  unit_cost: issue.unit_cost,
                  total_cost: issue.total_cost,
                  reference_id: `BATCH-${batch.batch_number}`,
                  notes: `Consumed in batch ${batch.batch_number}`,
                  user_id: user.id
                }])

              // Deduct from items current_stock if column exists
              await supabase.rpc('decrement_item_stock', {
                p_item_id: issue.ingredient_item_id,
                p_qty: Number(issue.actual_quantity)
              }).catch(() => {})
            }
          }
        }

        // 2. Find or create Bulk Liquid item and Lot for WIP aging / bottling
        const wipLocation = locations.find(l => l.name?.toLowerCase().includes('wip') || l.name?.toLowerCase().includes('blending'))
        const formulaName = batch.formulas?.name || 'Bulk Perfume'
        
        // Check if a bulk liquid item exists for this formula
        let bulkItemId = null
        const { data: existingBulk } = await supabase
          .from('items')
          .select('id')
          .eq('shop_id', user.shop_id)
          .eq('item_type', 'bulk_liquid')
          .ilike('name', `%${formulaName}%`)
          .maybeSingle()

        if (existingBulk) {
          bulkItemId = existingBulk.id
        } else {
          // Create bulk item
          const { data: newBulk } = await supabase
            .from('items')
            .insert([{
              shop_id: user.shop_id,
              sku: `BLK-${batch.batch_number}`,
              name: `Bulk ${formulaName} Liquid (WIP)`,
              item_type: 'bulk_liquid',
              base_unit: 'ml',
              cost_price: updatePayload.cost_per_ml,
              is_active: true
            }])
            .select('id')
            .single()

          if (newBulk) bulkItemId = newBulk.id
        }

        if (bulkItemId) {
          // Create bulk liquid lot
          const { data: newLot } = await supabase
            .from('inventory_lots')
            .insert([{
              shop_id: user.shop_id,
              item_id: bulkItemId,
              lot_number: `LOT-${batch.batch_number}`,
              received_date: new Date().toISOString().split('T')[0],
              initial_quantity: actualYieldMl,
              available_quantity: actualYieldMl,
              unit_cost: updatePayload.cost_per_ml,
              location_id: wipLocation?.id || null,
              status: 'available'
            }])
            .select('id')
            .single()

          // Log bulk output in inventory ledger
          if (newLot) {
            await supabase
              .from('inventory_ledger')
              .insert([{
                shop_id: user.shop_id,
                item_id: bulkItemId,
                lot_id: newLot.id,
                location_id: wipLocation?.id || null,
                transaction_type: 'bulk_output',
                quantity: actualYieldMl,
                base_unit: 'ml',
                unit_cost: updatePayload.cost_per_ml,
                total_cost: totalMatCost,
                reference_id: `BATCH-${batch.batch_number}`,
                notes: `Yield from production batch ${batch.batch_number}`,
                user_id: user.id
              }])
          }
        }
      }

      // Update production batch record
      const { error: updErr } = await supabase
        .from('production_batches')
        .update(updatePayload)
        .eq('id', batch.id)

      if (updErr) throw updErr

      setShowDetailModal(false)
      await fetchData()
    } catch (err) {
      console.error('Batch status update error:', err)
      alert(err.message || 'Failed to update batch status')
    } finally {
      setSaving(false)
    }
  }

  // Filtered list
  const filteredBatches = batches.filter(b => {
    const matchStatus = filterStatus === 'all' || b.status === filterStatus
    const q = search.toLowerCase()
    const matchSearch = !search || 
      b.batch_number?.toLowerCase().includes(q) ||
      b.formulas?.name?.toLowerCase().includes(q) ||
      b.operator_id?.toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  // Summary Metrics
  const totalBatches = batches.length
  const inBlendingCount = batches.filter(b => b.status === 'in_blending').length
  const maturingCount = batches.filter(b => b.status === 'maturing').length
  const completedCount = batches.filter(b => b.status === 'completed').length
  const totalBulkWipMl = batches
    .filter(b => b.status === 'completed')
    .reduce((sum, b) => sum + Number(b.actual_volume_ml || b.planned_volume_ml || 0), 0)

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Top Banner */}
      <div className="p-4 sm:p-6 bg-white border-b border-gray-200 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-purple-100 text-purple-700 rounded-lg">
              <Workflow size={22} />
            </span>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                Production Batches & Blending
                <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-purple-200">
                  Lab & Maceration
                </span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Scale approved formulas, weigh raw ingredients, deduct FEFO lots, and track bulk perfume maturation.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-sm shadow-sm transition cursor-pointer"
          >
            <Plus size={16} />
            Start New Batch
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 sm:px-6 bg-white border-b border-gray-200 shrink-0 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 font-bold uppercase">Total Batches</p>
          <p className="text-lg font-black text-gray-900 mt-0.5">{totalBatches}</p>
        </div>
        <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
          <p className="text-xs text-amber-700 font-bold uppercase flex items-center gap-1">
            <Clock size={12} /> In Blending
          </p>
          <p className="text-lg font-black text-amber-900 mt-0.5">{inBlendingCount}</p>
        </div>
        <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
          <p className="text-xs text-indigo-700 font-bold uppercase flex items-center gap-1">
            <FlaskConical size={12} /> Maturing / Rest
          </p>
          <p className="text-lg font-black text-indigo-900 mt-0.5">{maturingCount}</p>
        </div>
        <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
          <p className="text-xs text-emerald-700 font-bold uppercase flex items-center gap-1">
            <CheckCircle2 size={12} /> Completed
          </p>
          <p className="text-lg font-black text-emerald-900 mt-0.5">{completedCount}</p>
        </div>
        <div className="bg-purple-50 p-3 rounded-lg border border-purple-200 col-span-2 sm:col-span-1">
          <p className="text-xs text-purple-700 font-bold uppercase">Total Yield</p>
          <p className="text-lg font-black text-purple-900 mt-0.5">
            {(totalBulkWipMl / 1000).toFixed(2)} <span className="text-xs font-medium">Litres</span>
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 sm:px-6 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search batch #, formula..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All' },
            { id: 'draft', label: 'Draft' },
            { id: 'in_blending', label: 'In Blending' },
            { id: 'maturing', label: 'Maturing' },
            { id: 'completed', label: 'Completed' },
            { id: 'cancelled', label: 'Cancelled' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table / Card List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400">
            <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-xs">Loading production batches...</p>
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center bg-white rounded-xl border border-gray-200 p-6">
            <Workflow size={40} className="text-gray-300 mb-2" />
            <h3 className="text-base font-bold text-gray-700">No Production Batches Found</h3>
            <p className="text-xs text-gray-400 max-w-sm mt-1">
              Start your first production batch from an approved formula to weigh ingredients and track bulk perfume yield.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
            >
              Start New Batch
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBatches.map(batch => {
              const statusColors = {
                draft: 'bg-gray-100 text-gray-700 border-gray-300',
                in_blending: 'bg-amber-100 text-amber-800 border-amber-300',
                maturing: 'bg-indigo-100 text-indigo-800 border-indigo-300',
                completed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                cancelled: 'bg-red-100 text-red-800 border-red-300'
              }

              return (
                <div
                  key={batch.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-4 flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-black text-purple-700">
                            {batch.batch_number}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColors[batch.status] || 'bg-gray-100 text-gray-700'}`}>
                            {batch.status?.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <h4 className="font-black text-gray-900 text-base mt-1">
                          {batch.formulas?.name || 'Unnamed Formula'}
                        </h4>
                        <span className="text-[11px] text-gray-400">
                          Version: {batch.formulas?.version || 'v1.0'}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedBatch(batch)
                          setShowPrintModal(true)
                        }}
                        title="Print Batch Sheet"
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                      >
                        <Printer size={16} />
                      </button>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-2 my-3 text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                      <div>
                        <p className="text-gray-400 text-[10px] uppercase font-bold">Planned Vol</p>
                        <p className="font-bold text-gray-800">{batch.planned_volume_ml} mL</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[10px] uppercase font-bold">Actual Yield</p>
                        <p className="font-bold text-gray-800">
                          {batch.actual_volume_ml ? `${batch.actual_volume_ml} mL` : 'Pending'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[10px] uppercase font-bold">Material Cost</p>
                        <p className="font-bold text-purple-700">
                          Rs. {Number(batch.total_material_cost || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[10px] uppercase font-bold">Cost / mL</p>
                        <p className="font-bold text-gray-800">
                          Rs. {Number(batch.cost_per_ml || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-500 mb-3 px-1">
                      <span>Operator: <strong className="text-gray-700">{batch.operator_id || 'Staff'}</strong></span>
                      <span>QC: <strong className="uppercase text-emerald-600">{batch.qc_status || 'Pending'}</strong></span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        setSelectedBatch(batch)
                        setShowDetailModal(true)
                      }}
                      className="flex-1 py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Eye size={14} /> View Details
                    </button>

                    {batch.status === 'draft' && (
                      <button
                        onClick={() => handleUpdateStatus(batch, 'in_blending')}
                        className="py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                      >
                        <Play size={14} /> Start
                      </button>
                    )}

                    {batch.status === 'in_blending' && (
                      <button
                        onClick={() => {
                          setSelectedBatch(batch)
                          setShowDetailModal(true)
                        }}
                        className="py-1.5 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                      >
                        <Scale size={14} /> Weigh & Complete
                      </button>
                    )}

                    {batch.status === 'maturing' && (
                      <button
                        onClick={() => {
                          setSelectedBatch(batch)
                          setShowDetailModal(true)
                        }}
                        className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                      >
                        <CheckCircle2 size={14} /> Finalize
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── CREATE BATCH MODAL ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:px-6 bg-purple-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-purple-800 rounded-lg text-purple-200">
                  <Workflow size={20} />
                </span>
                <div>
                  <h3 className="text-base font-black tracking-tight">Create Production Batch</h3>
                  <p className="text-xs text-purple-200">Select formula, calculate raw ingredients, and allocate lots.</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-purple-300 hover:text-white p-1 rounded-lg">
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
                  <label className="block text-xs font-bold text-gray-700 mb-1">Batch Number *</label>
                  <input
                    type="text"
                    value={form.batch_number}
                    onChange={e => setForm({ ...form, batch_number: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Select Formula *</label>
                  <select
                    value={form.formula_id}
                    onChange={e => handleFormulaChange(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    <option value="">-- Choose Formula --</option>
                    {formulas.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.version || 'v1.0'})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Planned Bulk Volume (mL) *</label>
                  <input
                    type="number"
                    min="1"
                    value={form.planned_volume_ml}
                    onChange={e => handleFormulaChange(form.formula_id, e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Operator / Lab Chemist</label>
                  <input
                    type="text"
                    value={form.operator_id}
                    onChange={e => setForm({ ...form, operator_id: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Batch Notes</label>
                  <input
                    type="text"
                    placeholder="Maceration notes, temperature, etc."
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Calculated Ingredients Breakdown */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider flex items-center gap-1.5">
                    <FlaskConical size={14} className="text-purple-600" />
                    Required Ingredients & Lot Allocation
                  </h4>
                  <span className="text-[11px] text-gray-500">
                    Total Estimated Cost: <strong className="text-purple-700">Rs. {form.ingredients.reduce((s, i) => s + (i.total_cost || 0), 0).toLocaleString()}</strong>
                  </span>
                </div>

                {form.ingredients.length === 0 ? (
                  <div className="p-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 text-xs">
                    Please select a formula to calculate ingredient quantities and inspect available inventory lots.
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                          <th className="p-2.5">Ingredient</th>
                          <th className="p-2.5 text-center">Ratio</th>
                          <th className="p-2.5 text-right">Target Qty</th>
                          <th className="p-2.5">Allocate Lot (FEFO)</th>
                          <th className="p-2.5 text-right">In Stock</th>
                          <th className="p-2.5 text-right">Unit Cost</th>
                          <th className="p-2.5 text-right">Line Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {form.ingredients.map((ing, idx) => {
                          const itemLots = availableLots.filter(l => String(l.item_id) === String(ing.ingredient_item_id))
                          const isLowStock = ing.target_quantity > ing.available_stock

                          return (
                            <tr key={idx} className={isLowStock ? 'bg-red-50/50' : 'hover:bg-gray-50'}>
                              <td className="p-2.5 font-bold text-gray-900">
                                {ing.item_name}
                                {isLowStock && (
                                  <span className="block text-[10px] text-red-600 font-bold">
                                    ⚠️ Insufficient stock!
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-mono text-gray-600">
                                {ing.percentage}%
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-gray-900">
                                {ing.target_quantity} {ing.unit}
                              </td>
                              <td className="p-2.5">
                                <select
                                  value={ing.lot_id || ''}
                                  onChange={e => {
                                    const selectedL = itemLots.find(l => String(l.id) === String(e.target.value))
                                    const updated = [...form.ingredients]
                                    updated[idx].lot_id = selectedL ? selectedL.id : ''
                                    updated[idx].lot_number = selectedL ? selectedL.lot_number : ''
                                    updated[idx].unit_cost = selectedL ? Number(selectedL.unit_cost) : 0
                                    updated[idx].total_cost = Number((updated[idx].actual_quantity * (selectedL ? Number(selectedL.unit_cost) : 0)).toFixed(2))
                                    setForm({ ...form, ingredients: updated })
                                  }}
                                  className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-[11px] font-mono focus:ring-1 focus:ring-purple-500"
                                >
                                  <option value="">-- Pick Lot --</option>
                                  {itemLots.map(l => (
                                    <option key={l.id} value={l.id}>
                                      {l.lot_number} (Avail: {l.available_quantity} {ing.unit})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-2.5 text-right font-mono">
                                <span className={isLowStock ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                  {ing.available_stock} {ing.unit}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-mono text-gray-600">
                                Rs. {ing.unit_cost}
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-purple-700">
                                Rs. {ing.total_cost}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 sm:px-6 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-bold transition"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || form.ingredients.length === 0}
                  onClick={() => handleCreateBatch(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={saving || form.ingredients.length === 0}
                  onClick={() => handleCreateBatch(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <Play size={14} /> Start Blending Directly
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BATCH DETAILS & COMPLETION MODAL ── */}
      {showDetailModal && selectedBatch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-4 sm:px-6 bg-gray-900 text-white flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-purple-400">
                    {selectedBatch.batch_number}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-200 border border-purple-700">
                    {selectedBatch.status}
                  </span>
                </div>
                <h3 className="text-base font-black tracking-tight mt-0.5">
                  {selectedBatch.formulas?.name}
                </h3>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-white p-1 rounded-lg">
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs">
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Planned Volume</span>
                  <p className="font-bold text-gray-900 mt-0.5">{selectedBatch.planned_volume_ml} mL</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Total Material Cost</span>
                  <p className="font-bold text-purple-700 mt-0.5">Rs. {Number(selectedBatch.total_material_cost || 0).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Cost / mL</span>
                  <p className="font-bold text-gray-900 mt-0.5">Rs. {Number(selectedBatch.cost_per_ml || 0).toFixed(4)}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] uppercase font-bold">Operator</span>
                  <p className="font-bold text-gray-900 mt-0.5">{selectedBatch.operator_id || 'Staff'}</p>
                </div>
              </div>

              {/* Ingredients Issued Table */}
              <div>
                <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider mb-2 flex items-center gap-1.5">
                  <Layers size={14} className="text-purple-600" />
                  Weighed & Issued Ingredients
                </h4>

                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                        <th className="p-2.5">Ingredient</th>
                        <th className="p-2.5">Assigned Lot</th>
                        <th className="p-2.5 text-right">Planned Qty</th>
                        <th className="p-2.5 text-right">Actual Qty</th>
                        <th className="p-2.5 text-right">Unit Cost</th>
                        <th className="p-2.5 text-right">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(selectedBatch.batch_ingredient_issues || []).map((issue, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="p-2.5 font-bold text-gray-900">
                            {issue.items?.name || `Item #${issue.ingredient_item_id}`}
                          </td>
                          <td className="p-2.5 font-mono text-gray-600">
                            {issue.inventory_lots?.lot_number || 'Default Stock'}
                          </td>
                          <td className="p-2.5 text-right font-mono text-gray-600">
                            {issue.planned_quantity} {issue.unit}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-gray-900">
                            {issue.actual_quantity} {issue.unit}
                          </td>
                          <td className="p-2.5 text-right font-mono text-gray-600">
                            Rs. {issue.unit_cost}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-purple-700">
                            Rs. {issue.total_cost}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status Transition Forms */}
              {selectedBatch.status !== 'completed' && selectedBatch.status !== 'cancelled' && (
                <div className="mt-4 p-4 bg-purple-50 rounded-xl border border-purple-200">
                  <h4 className="text-xs font-black uppercase text-purple-900 tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-purple-600" />
                    Advance Batch Workflow
                  </h4>

                  <div className="space-y-3">
                    {selectedBatch.status === 'in_blending' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          disabled={saving}
                          onClick={() => handleUpdateStatus(selectedBatch, 'maturing')}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                        >
                          <Clock size={14} /> Send to Maturation / Maceration
                        </button>
                      </div>
                    )}

                    <div className="pt-2 border-t border-purple-200">
                      <p className="text-xs text-purple-800 font-bold mb-2">Finalize & Complete Bulk Liquid Yield:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-700 mb-1">Actual Usable Yield (mL) *</label>
                          <input
                            type="number"
                            id="actualYieldInput"
                            defaultValue={selectedBatch.actual_volume_ml || selectedBatch.planned_volume_ml}
                            className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-gray-700 mb-1">QC Sign-off *</label>
                          <select
                            id="qcStatusSelect"
                            defaultValue="passed"
                            className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold"
                          >
                            <option value="passed">Passed QC</option>
                            <option value="pending">Pending QC</option>
                            <option value="failed">Failed QC</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button
                            disabled={saving}
                            onClick={() => {
                              const yieldInput = document.getElementById('actualYieldInput')
                              const qcSelect = document.getElementById('qcStatusSelect')
                              const vol = yieldInput ? Number(yieldInput.value) : selectedBatch.planned_volume_ml
                              const qc = qcSelect ? qcSelect.value : 'passed'
                              handleUpdateStatus(selectedBatch, 'completed', {
                                actual_volume_ml: vol,
                                qc_status: qc
                              })
                            }}
                            className="w-full px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
                          >
                            <CheckCircle2 size={14} /> Complete & Deduct Lots
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 sm:px-6 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-bold transition"
              >
                Close
              </button>

              <button
                onClick={() => {
                  setShowDetailModal(false)
                  setShowPrintModal(true)
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
              >
                <Printer size={14} /> Print Batch Worksheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT BATCH WORKSHEET MODAL ── */}
      {showPrintModal && selectedBatch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-gray-900 text-white flex items-center justify-between shrink-0 print:hidden">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Printer size={16} /> Batch Sheet Print Preview
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  Print Sheet
                </button>
                <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-white p-1">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Printable Document */}
            <div className="p-8 overflow-y-auto flex-1 bg-white text-gray-900 space-y-6 text-xs">
              <div className="border-b-2 border-gray-900 pb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-tight">Perfumery Blending Sheet</h2>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">Standard Operating Procedure / Master Batch Record</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-black text-purple-700">{selectedBatch.batch_number}</p>
                  <p className="text-[11px] text-gray-500">Date: {new Date(selectedBatch.created_at || Date.now()).toLocaleDateString()}</p>
                </div>
              </div>

              {/* General Info */}
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div>
                  <p className="text-gray-500 uppercase text-[10px] font-bold">Formula Name</p>
                  <p className="text-sm font-black text-gray-900">{selectedBatch.formulas?.name}</p>
                  <p className="text-[11px] text-gray-500">Version: {selectedBatch.formulas?.version || 'v1.0'}</p>
                </div>
                <div>
                  <p className="text-gray-500 uppercase text-[10px] font-bold">Planned Volume</p>
                  <p className="text-sm font-black text-gray-900">{selectedBatch.planned_volume_ml} mL</p>
                  <p className="text-[11px] text-gray-500">Operator: {selectedBatch.operator_id || 'Staff'}</p>
                </div>
              </div>

              {/* Ingredients Table */}
              <div>
                <h4 className="font-black text-xs uppercase tracking-wider mb-2 border-b border-gray-200 pb-1">
                  Ingredient Weighed Log
                </h4>
                <table className="w-full text-left text-xs border border-gray-300 border-collapse">
                  <thead>
                    <tr className="bg-gray-100 font-bold border-b border-gray-300">
                      <th className="p-2 border-r border-gray-300">Ingredient</th>
                      <th className="p-2 border-r border-gray-300">Lot #</th>
                      <th className="p-2 border-r border-gray-300 text-right">Target</th>
                      <th className="p-2 border-r border-gray-300 text-right">Actual Weighed</th>
                      <th className="p-2 text-center">Initial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedBatch.batch_ingredient_issues || []).map((issue, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="p-2 border-r border-gray-300 font-bold">{issue.items?.name}</td>
                        <td className="p-2 border-r border-gray-300 font-mono text-[11px]">{issue.inventory_lots?.lot_number || '---'}</td>
                        <td className="p-2 border-r border-gray-300 text-right font-mono">{issue.planned_quantity} {issue.unit}</td>
                        <td className="p-2 border-r border-gray-300 text-right font-mono font-bold">{issue.actual_quantity} {issue.unit}</td>
                        <td className="p-2 text-center text-gray-400">______</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Sign-off & Yield Verification */}
              <div className="pt-6 border-t border-gray-300 grid grid-cols-2 gap-8 text-[11px]">
                <div>
                  <p className="font-bold text-gray-700">Lab Chemist / Operator Sign:</p>
                  <div className="mt-8 border-b border-gray-400 w-48" />
                  <p className="text-gray-400 text-[10px] mt-1">Signature & Date</p>
                </div>
                <div>
                  <p className="font-bold text-gray-700">Quality Control (QC) Approval:</p>
                  <div className="mt-8 border-b border-gray-400 w-48" />
                  <p className="text-gray-400 text-[10px] mt-1">Status: {selectedBatch.qc_status?.toUpperCase() || 'APPROVED'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
