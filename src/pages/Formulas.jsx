import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { isManufacturer } from '../utils/featureGate'
import { convertQuantity, calculateTargetIngredient } from '../utils/unitConversion'
import { 
  FlaskConical, Plus, Search, Edit2, Trash2, X, AlertTriangle, 
  CheckCircle2, Calculator, Layers, Box, Check, Copy, ArrowRight, ShieldCheck
} from 'lucide-react'

export default function Formulas() {
  const { user } = useAuth()
  const [formulas, setFormulas] = useState([])
  const [rawItems, setRawItems] = useState([])
  const [packagingItems, setPackagingItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingFormula, setEditingFormula] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Batch Scaling Calculator State
  const [scalingFormula, setScalingFormula] = useState(null)
  const [scaleTargetVolume, setScaleTargetVolume] = useState(1000)

  // Form State
  const [form, setForm] = useState({
    name: '',
    version: 'v1.0',
    target_volume_ml: 1000,
    calculation_basis: 'weight_percentage', // 'weight_percentage' (% w/w) or 'volume_percentage' (% v/v)
    notes: '',
    is_approved: true,
    ingredients: [],
    packaging_boms: []
  })

  useEffect(() => {
    if (user?.shop_id) {
      fetchData()
    }
  }, [user?.shop_id])

  const fetchData = async () => {
    setLoading(true)
    try {
      // 1. Fetch formulas with ingredients & packaging BOMs
      const { data: fData, error: fError } = await supabase
        .from('formulas')
        .select(`
          *,
          formula_ingredients(*),
          formula_packaging_boms(*)
        `)
        .eq('shop_id', user.shop_id)
        .order('name')

      if (!fError && fData) {
        setFormulas(fData)
        await db.formulas.bulkPut(JSON.parse(JSON.stringify(fData))).catch(() => {})
      } else {
        const local = await db.formulas.where('shop_id').equals(user.shop_id).toArray()
        setFormulas(local || [])
      }

      // 2. Fetch raw materials & packaging
      const { data: itemsData } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', user.shop_id)
        .eq('is_active', true)
        .order('name')

      if (itemsData) {
        setRawItems(itemsData.filter(i => i.item_type === 'raw_oil' || i.item_type === 'raw_chemical'))
        setPackagingItems(itemsData.filter(i => i.item_type === 'packaging'))
      } else {
        const localItems = await db.items.where('shop_id').equals(user.shop_id).toArray()
        setRawItems(localItems.filter(i => i.item_type === 'raw_oil' || i.item_type === 'raw_chemical'))
        setPackagingItems(localItems.filter(i => i.item_type === 'packaging'))
      }
    } catch (err) {
      console.error('Formulas fetch error:', err)
      const local = await db.formulas.toArray()
      setFormulas(local.filter(x => String(x.shop_id) === String(user.shop_id)))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (formula = null) => {
    setError('')
    if (formula) {
      setEditingFormula(formula)
      setForm({
        name: formula.name || '',
        version: formula.version || 'v1.0',
        target_volume_ml: formula.target_volume_ml || 1000,
        calculation_basis: formula.calculation_basis || 'weight_percentage',
        notes: formula.notes || '',
        is_approved: formula.is_approved !== undefined ? formula.is_approved : true,
        ingredients: (formula.formula_ingredients || []).map(i => ({
          ingredient_item_id: i.ingredient_item_id,
          percentage: i.percentage,
          unit: i.unit || 'g',
          tolerance_percent: i.tolerance_percent || 1.0
        })),
        packaging_boms: (formula.formula_packaging_boms || []).map(p => ({
          component_item_id: p.component_item_id,
          quantity_per_unit: p.quantity_per_unit || 1
        }))
      })
    } else {
      setEditingFormula(null)
      setForm({
        name: '',
        version: 'v1.0',
        target_volume_ml: 1000,
        calculation_basis: 'weight_percentage',
        notes: '',
        is_approved: true,
        ingredients: [],
        packaging_boms: []
      })
    }
    setShowModal(true)
  }

  // Ingredient Helpers
  const addIngredientRow = () => {
    if (rawItems.length === 0) return alert('No raw materials found. Add oils/solvents first!')
    setForm(prev => ({
      ...prev,
      ingredients: [
        ...prev.ingredients,
        {
          ingredient_item_id: rawItems[0]?.id || '',
          percentage: 0,
          unit: 'g',
          tolerance_percent: 1.0
        }
      ]
    }))
  }

  const updateIngredient = (index, field, value) => {
    setForm(prev => {
      const copy = [...prev.ingredients]
      copy[index] = { ...copy[index], [field]: value }
      return { ...prev, ingredients: copy }
    })
  }

  const removeIngredient = (index) => {
    setForm(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index)
    }))
  }

  // Packaging BOM Helpers
  const addPackagingRow = () => {
    if (packagingItems.length === 0) return alert('No packaging components found. Add bottles/caps first!')
    setForm(prev => ({
      ...prev,
      packaging_boms: [
        ...prev.packaging_boms,
        {
          component_item_id: packagingItems[0]?.id || '',
          quantity_per_unit: 1
        }
      ]
    }))
  }

  const updatePackaging = (index, field, value) => {
    setForm(prev => {
      const copy = [...prev.packaging_boms]
      copy[index] = { ...copy[index], [field]: value }
      return { ...prev, packaging_boms: copy }
    })
  }

  const removePackaging = (index) => {
    setForm(prev => ({
      ...prev,
      packaging_boms: prev.packaging_boms.filter((_, i) => i !== index)
    }))
  }

  // Percentage Sum Calculation
  const totalPercentage = form.ingredients.reduce((sum, i) => sum + (Number(i.percentage) || 0), 0)

  // Save Formula
  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Formula name is required.')
    if (form.ingredients.length === 0) return setError('Add at least one raw ingredient line item.')

    if (Math.abs(totalPercentage - 100) > 0.05) {
      if (!window.confirm(`Warning: Total ingredient percentage is ${totalPercentage.toFixed(2)}% (not 100%). Do you wish to proceed?`)) {
        return
      }
    }

    setSaving(true)
    setError('')

    const formulaPayload = {
      shop_id: user.shop_id,
      name: form.name.trim(),
      version: form.version.trim() || 'v1.0',
      target_volume_ml: Number(form.target_volume_ml) || 1000,
      calculation_basis: form.calculation_basis,
      notes: form.notes.trim() || null,
      is_approved: form.is_approved,
      created_by: user.username || user.email
    }

    try {
      let savedFormulaId = null

      if (editingFormula) {
        // Update master record
        const { data: upData, error: upError } = await supabase
          .from('formulas')
          .update(formulaPayload)
          .eq('id', editingFormula.id)
          .select()
          .single()

        if (upError) throw upError
        savedFormulaId = editingFormula.id

        // Delete existing lines
        await Promise.all([
          supabase.from('formula_ingredients').delete().eq('formula_id', savedFormulaId),
          supabase.from('formula_packaging_boms').delete().eq('formula_id', savedFormulaId)
        ])
      } else {
        // Insert master record
        const { data: inData, error: inError } = await supabase
          .from('formulas')
          .insert([formulaPayload])
          .select()
          .single()

        if (inError) throw inError
        savedFormulaId = inData.id
      }

      // Insert Ingredients
      const ingInserts = form.ingredients.map(i => ({
        formula_id: savedFormulaId,
        ingredient_item_id: Number(i.ingredient_item_id),
        percentage: Number(i.percentage),
        unit: i.unit || 'g',
        tolerance_percent: Number(i.tolerance_percent) || 1.0,
        target_quantity: calculateTargetIngredient(form.target_volume_ml, i.percentage)
      }))
      const { error: ingError } = await supabase.from('formula_ingredients').insert(ingInserts)
      if (ingError) throw ingError

      // Insert Packaging BOMs
      if (form.packaging_boms.length > 0) {
        const pkgInserts = form.packaging_boms.map(p => ({
          formula_id: savedFormulaId,
          component_item_id: Number(p.component_item_id),
          quantity_per_unit: Number(p.quantity_per_unit) || 1
        }))
        await supabase.from('formula_packaging_boms').insert(pkgInserts)
      }

      setShowModal(false)
      fetchData()
    } catch (err) {
      console.error('Failed to save formula:', err)
      setError(err.message || 'Error saving formula to database.')
    } finally {
      setSaving(false)
    }
  }

  // Delete Formula
  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this formula? Existing batches will remain intact.')) return
    try {
      const { error: delError } = await supabase.from('formulas').delete().eq('id', id)
      if (delError) throw delError
      setFormulas(prev => prev.filter(f => f.id !== id))
      await db.formulas.delete(id).catch(() => {})
    } catch (err) {
      alert('Failed to delete formula: ' + err.message)
    }
  }

  // Filtered Formulas
  const filteredFormulas = formulas.filter(f => 
    (f.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (f.version || '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <FlaskConical className="text-purple-600" size={24} /> Perfume Formulas &amp; Master Recipes
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Formulate concentration ratios (% BOM), define bottle packaging components, and scale batch sizes.
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2.5 rounded-xl shadow-md transition active:scale-95 cursor-pointer text-sm"
        >
          <Plus size={18} /> New Master Formula
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 w-full md:w-80 shadow-xs">
        <Search size={18} className="text-gray-400 shrink-0" />
        <input
          type="text"
          placeholder="Search formulas by name or version..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
        />
      </div>

      {/* Formulas Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-16 text-gray-400 font-bold">Loading formulas...</div>
        ) : filteredFormulas.length === 0 ? (
          <div className="col-span-3 text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
            <FlaskConical size={48} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-base font-bold text-gray-700">No Perfume Formulas Defined</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Create your first master formulation (e.g. 20% oil, 75% ethanol, 5% fixative) to unlock batch production.
            </p>
            <button
              onClick={() => handleOpenModal()}
              className="mt-4 inline-flex items-center gap-1.5 bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-lg"
            >
              <Plus size={16} /> Create First Formula
            </button>
          </div>
        ) : (
          filteredFormulas.map(formula => {
            const ingCount = formula.formula_ingredients?.length || 0
            const pkgCount = formula.formula_packaging_boms?.length || 0

            return (
              <div
                key={formula.id}
                className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-black text-gray-900 text-base leading-tight">
                        {formula.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] font-mono font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                          {formula.version}
                        </span>
                        <span className="text-[11px] font-bold text-gray-400 uppercase">
                          {formula.calculation_basis === 'weight_percentage' ? '% w/w' : '% v/v'}
                        </span>
                      </div>
                    </div>
                    {formula.is_approved ? (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                        <ShieldCheck size={12} /> Approved
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                        Draft
                      </span>
                    )}
                  </div>

                  {/* Summary of composition */}
                  <div className="my-3 space-y-1.5 bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div className="text-[11px] font-bold text-gray-500 uppercase flex justify-between">
                      <span>Ingredients Breakdown</span>
                      <span className="font-mono">{ingCount} raw items</span>
                    </div>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {(formula.formula_ingredients || []).map((ing, idx) => {
                        const item = rawItems.find(r => r.id === ing.ingredient_item_id)
                        return (
                          <div key={idx} className="flex justify-between text-xs text-gray-700">
                            <span className="truncate pr-2">{item?.name || `Item #${ing.ingredient_item_id}`}</span>
                            <span className="font-mono font-bold text-purple-700">{Number(ing.percentage).toFixed(2)}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Packaging BOM info */}
                  {pkgCount > 0 && (
                    <div className="text-[11px] text-gray-500 flex items-center gap-1 font-semibold">
                      <Box size={13} className="text-gray-400" />
                      <span>{pkgCount} packaging parts attached</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="pt-4 border-t border-gray-100 flex items-center justify-between mt-3">
                  <button
                    onClick={() => {
                      setScalingFormula(formula)
                      setScaleTargetVolume(formula.target_volume_ml || 1000)
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition"
                  >
                    <Calculator size={14} /> Batch Calculator
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenModal(formula)}
                      className="p-1.5 text-gray-400 hover:text-purple-600 rounded-lg hover:bg-gray-100 transition"
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(formula.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 transition"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Modal: Create / Edit Formula */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50 shrink-0">
              <h3 className="font-black text-gray-900 flex items-center gap-2 text-base">
                <FlaskConical className="text-purple-600" size={20} />
                {editingFormula ? 'Edit Master Formula' : 'Create Master Perfume Formula'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto p-5 space-y-4 flex-1">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Formula Master Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Formula / Fragrance Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Reshmi Extrait De Parfum"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Version
                  </label>
                  <input
                    type="text"
                    placeholder="v1.0"
                    value={form.version}
                    onChange={e => setForm({ ...form, version: e.target.value })}
                    className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>

              {/* Basis & Reference Target Basis */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-purple-50/50 border border-purple-100 rounded-xl">
                <div>
                  <label className="block text-xs font-bold text-purple-900 uppercase mb-1">
                    Calculation Basis
                  </label>
                  <select
                    value={form.calculation_basis}
                    onChange={e => setForm({ ...form, calculation_basis: e.target.value })}
                    className="w-full px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-bold outline-none"
                  >
                    <option value="weight_percentage">Weight Proportion (% w/w)</option>
                    <option value="volume_percentage">Volume Proportion (% v/v)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-purple-900 uppercase mb-1">
                    Default Batch Basis (mL)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.target_volume_ml}
                    onChange={e => setForm({ ...form, target_volume_ml: parseFloat(e.target.value) || 1000 })}
                    className="w-full px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-bold font-mono outline-none"
                  />
                </div>
              </div>

              {/* Ingredients BOM Table */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-gray-700 uppercase">
                    Raw Ingredient Composition (% BOM)
                  </label>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-mono font-black ${
                      Math.abs(totalPercentage - 100) < 0.05 ? 'text-emerald-600' : 'text-amber-600'
                    }`}>
                      Total: {totalPercentage.toFixed(2)}%
                    </span>
                    <button
                      type="button"
                      onClick={addIngredientRow}
                      className="text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                    >
                      <Plus size={14} /> Add Ingredient
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                  {form.ingredients.length === 0 ? (
                    <p className="text-center py-4 text-xs text-gray-400">
                      Click "+ Add Ingredient" to specify oil concentrates, alcohol, and fixatives.
                    </p>
                  ) : (
                    form.ingredients.map((ing, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                        {/* Item select */}
                        <select
                          value={ing.ingredient_item_id}
                          onChange={e => updateIngredient(idx, 'ingredient_item_id', e.target.value)}
                          className="flex-1 px-2.5 py-1.5 text-xs font-bold text-gray-800 border border-gray-200 rounded-lg outline-none"
                        >
                          {rawItems.map(r => (
                            <option key={r.id} value={r.id}>{r.name} ({r.base_unit})</option>
                          ))}
                        </select>

                        {/* Percentage */}
                        <div className="flex items-center gap-1 w-24">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={ing.percentage}
                            onChange={e => updateIngredient(idx, 'percentage', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-xs font-bold font-mono border border-gray-200 rounded-lg text-right outline-none"
                            placeholder="0.00"
                          />
                          <span className="text-xs font-bold text-gray-400">%</span>
                        </div>

                        {/* Delete row */}
                        <button
                          type="button"
                          onClick={() => removeIngredient(idx)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Packaging Components BOM */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-gray-700 uppercase">
                    Packaging BOM (Per Finished Bottle)
                  </label>
                  <button
                    type="button"
                    onClick={addPackagingRow}
                    className="text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus size={14} /> Add Packaging Part
                  </button>
                </div>

                <div className="space-y-2 border border-gray-200 rounded-xl p-3 bg-gray-50/50">
                  {form.packaging_boms.length === 0 ? (
                    <p className="text-center py-2 text-xs text-gray-400">
                      Optional: Attach glass bottles, crimp sprayers, caps, and unit boxes.
                    </p>
                  ) : (
                    form.packaging_boms.map((pkg, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                        <select
                          value={pkg.component_item_id}
                          onChange={e => updatePackaging(idx, 'component_item_id', e.target.value)}
                          className="flex-1 px-2.5 py-1.5 text-xs font-bold text-gray-800 border border-gray-200 rounded-lg outline-none"
                        >
                          {packagingItems.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>

                        <div className="flex items-center gap-1 w-24">
                          <input
                            type="number"
                            min="1"
                            value={pkg.quantity_per_unit}
                            onChange={e => updatePackaging(idx, 'quantity_per_unit', parseInt(e.target.value) || 1)}
                            className="w-full px-2 py-1.5 text-xs font-bold font-mono border border-gray-200 rounded-lg text-right outline-none"
                          />
                          <span className="text-[11px] text-gray-400">pcs</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => removePackaging(idx)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                  Maceration &amp; Laboratory Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="e.g. Macerate for 21 days at 18-22°C before chill filtration."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Modal Buttons */}
              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingFormula ? 'Update Formula' : 'Save Formula'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Scaling Calculator Drawer / Modal */}
      {scalingFormula && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden p-6">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
              <div>
                <h3 className="font-black text-gray-900 text-base flex items-center gap-2">
                  <Calculator size={18} className="text-purple-600" /> Batch Scaling Calculator
                </h3>
                <p className="text-xs text-gray-500 font-semibold mt-0.5">
                  Formula: {scalingFormula.name} ({scalingFormula.version})
                </p>
              </div>
              <button
                onClick={() => setScalingFormula(null)}
                className="text-gray-400 hover:text-gray-700 p-1"
              >
                <X size={20} />
              </button>
            </div>

            {/* Target Batch Input */}
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-100 mb-4">
              <label className="block text-xs font-bold text-purple-900 uppercase mb-1">
                Target Batch Production Volume (mL)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="50"
                  step="50"
                  value={scaleTargetVolume}
                  onChange={e => setScaleTargetVolume(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm font-black font-mono text-purple-900 outline-none"
                />
                <span className="text-xs font-bold text-purple-700">mL</span>
              </div>
            </div>

            {/* Scaled Ingredients Table */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 mb-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500">
                  <tr>
                    <th className="p-2">Ingredient</th>
                    <th className="p-2 text-right">Ratio</th>
                    <th className="p-2 text-right">Required Qty</th>
                    <th className="p-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(scalingFormula.formula_ingredients || []).map((ing, idx) => {
                    const item = rawItems.find(r => r.id === ing.ingredient_item_id)
                    const requiredQty = calculateTargetIngredient(scaleTargetVolume, ing.percentage)
                    const stock = Number(item?.current_stock) || 0
                    const isSufficient = stock >= requiredQty

                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-2 font-bold text-gray-800">{item?.name || 'Item'}</td>
                        <td className="p-2 text-right font-mono text-purple-700 font-bold">{ing.percentage}%</td>
                        <td className="p-2 text-right font-mono font-bold text-gray-900">
                          {requiredQty.toFixed(2)} {ing.unit}
                        </td>
                        <td className="p-2 text-right">
                          <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                            isSufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {stock.toFixed(1)} {item?.base_unit}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="pt-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setScalingFormula(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold"
              >
                Close Calculator
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
