import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { ITEM_TYPES, normalizeUnit } from '../utils/unitConversion'
import { 
  Plus, Search, Edit2, Trash2, X, AlertTriangle, 
  FlaskConical, Box, Package, ShieldCheck, Scale, Check
} from 'lucide-react'

export default function RawMaterials() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    item_type: 'raw_oil',
    category_id: '',
    brand_id: '',
    base_unit: 'g',
    purchase_unit: 'g',
    density: 1.0000,
    cost_price: 0,
    min_stock_level: 0,
    notes: '',
    is_active: true
  })

  useEffect(() => {
    if (user?.shop_id) {
      fetchData()
    }
  }, [user?.shop_id])

  const fetchData = async () => {
    setLoading(true)
    try {
      // 1. Fetch raw items
      const { data: itemsData, error: itemsError } = await supabase
        .from('items')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('name')

      if (!itemsError && itemsData) {
        setItems(itemsData)
        // Cache to Dexie
        await db.items.bulkPut(JSON.parse(JSON.stringify(itemsData))).catch(() => {})
      } else {
        // Fallback to local Dexie
        const local = await db.items.where('shop_id').equals(user.shop_id).toArray()
        setItems(local || [])
      }

      // 2. Fetch Categories & Brands for dropdowns
      const [catRes, brandRes] = await Promise.all([
        supabase.from('categories').select('id, name').eq('shop_id', user.shop_id),
        supabase.from('brands').select('id, name').eq('shop_id', user.shop_id)
      ])
      if (catRes.data) setCategories(catRes.data)
      if (brandRes.data) setBrands(brandRes.data)

    } catch (err) {
      console.error('Failed to load raw items:', err)
      const local = await db.items.toArray()
      setItems(local.filter(x => String(x.shop_id) === String(user.shop_id)))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (item = null) => {
    setError('')
    if (item) {
      setEditingItem(item)
      setFormData({
        name: item.name || '',
        sku: item.sku || '',
        barcode: item.barcode || '',
        item_type: item.item_type || 'raw_oil',
        category_id: item.category_id || '',
        brand_id: item.brand_id || '',
        base_unit: item.base_unit || 'g',
        purchase_unit: item.purchase_unit || 'g',
        density: item.density !== undefined ? item.density : 1.0000,
        cost_price: item.cost_price || 0,
        min_stock_level: item.min_stock_level || 0,
        notes: item.notes || '',
        is_active: item.is_active !== undefined ? item.is_active : true
      })
    } else {
      setEditingItem(null)
      setFormData({
        name: '',
        sku: '',
        barcode: '',
        item_type: 'raw_oil',
        category_id: '',
        brand_id: '',
        base_unit: 'g',
        purchase_unit: 'g',
        density: 1.0000,
        cost_price: 0,
        min_stock_level: 0,
        notes: '',
        is_active: true
      })
    }
    setShowModal(true)
  }

  const handleTypeChange = (newType) => {
    const typeDef = ITEM_TYPES.find(t => t.id === newType)
    setFormData(prev => ({
      ...prev,
      item_type: newType,
      base_unit: typeDef ? typeDef.baseUnit : 'g',
      purchase_unit: typeDef ? typeDef.baseUnit : 'g'
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setError('Item name is required.')
      return
    }

    setSaving(true)
    setError('')

    const payload = {
      shop_id: user.shop_id,
      name: formData.name.trim(),
      sku: formData.sku.trim() || null,
      barcode: formData.barcode.trim() || null,
      item_type: formData.item_type,
      category_id: formData.category_id ? Number(formData.category_id) : null,
      brand_id: formData.brand_id ? Number(formData.brand_id) : null,
      base_unit: normalizeUnit(formData.base_unit),
      purchase_unit: normalizeUnit(formData.purchase_unit),
      density: Number(formData.density) || 1.0000,
      cost_price: Number(formData.cost_price) || 0,
      min_stock_level: Number(formData.min_stock_level) || 0,
      notes: formData.notes.trim() || null,
      is_active: formData.is_active,
      is_purchasable: true,
      is_sellable: formData.item_type === 'finished_good'
    }

    try {
      if (editingItem) {
        // Update
        const { data, error: upError } = await supabase
          .from('items')
          .update(payload)
          .eq('id', editingItem.id)
          .select()
          .single()

        if (upError) throw upError
        setItems(prev => prev.map(it => it.id === editingItem.id ? data : it))
        await db.items.put(data).catch(() => {})
      } else {
        // Insert
        const { data, error: inError } = await supabase
          .from('items')
          .insert([payload])
          .select()
          .single()

        if (inError) throw inError
        setItems(prev => [data, ...prev])
        await db.items.put(data).catch(() => {})
      }

      setShowModal(false)
    } catch (err) {
      console.error('Error saving item:', err)
      setError(err.message || 'Failed to save item. Make sure database migration has been executed in Supabase.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this raw material item?')) return
    try {
      const { error: delError } = await supabase.from('items').delete().eq('id', id)
      if (delError) throw delError
      setItems(prev => prev.filter(x => x.id !== id))
      await db.items.delete(id).catch(() => {})
    } catch (err) {
      alert('Failed to delete: ' + err.message)
    }
  }

  // Filtered Items
  const filteredItems = items.filter(it => {
    const matchesSearch = 
      (it.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (it.sku || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === 'all' || it.item_type === typeFilter
    return matchesSearch && matchesType
  })

  const getTypeBadge = (type) => {
    const meta = ITEM_TYPES.find(t => t.id === type) || { name: type, icon: '📦', color: 'slate' }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
        <span>{meta.icon}</span>
        <span>{meta.name}</span>
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <FlaskConical className="text-purple-600" size={24} /> Raw Materials & Packaging Catalog
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Master records for perfume oils, aroma chemicals, solvents, bottles, sprayers, and packaging BOM parts.
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2.5 rounded-xl shadow-md transition active:scale-95 cursor-pointer text-sm"
        >
          <Plus size={18} /> Add New Material / Component
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 w-full md:w-80 shadow-xs">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            type="text"
            placeholder="Search oils, chemicals, bottles..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
          />
        </div>

        {/* Type Filter Buttons */}
        <div className="flex flex-wrap gap-1.5 w-full md:w-auto">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              typeFilter === 'all'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            All Items ({items.length})
          </button>
          {ITEM_TYPES.filter(t => t.id !== 'finished_good' && t.id !== 'bulk_liquid').map(t => {
            const count = items.filter(x => x.item_type === t.id).length
            return (
              <button
                key={t.id}
                onClick={() => setTypeFilter(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  typeFilter === t.id
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.name.split(' ')[0]}</span>
                <span className="opacity-75">({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Materials Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 font-bold">Loading master items...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <FlaskConical size={48} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-base font-bold text-gray-700">No Raw Materials Found</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Add your perfume oils, ethanol solvents, bottles, caps, and sprayers to begin lot tracking and formulation.
            </p>
            <button
              onClick={() => handleOpenModal()}
              className="mt-4 inline-flex items-center gap-1.5 bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-lg"
            >
              <Plus size={16} /> Add First Raw Item
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs font-black text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Material / Component</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4">Base Unit</th>
                  <th className="py-3 px-4">Density</th>
                  <th className="py-3 px-4">Current Stock</th>
                  <th className="py-3 px-4">Std Cost</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-purple-50/40 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-gray-900">{item.name}</div>
                      {item.sku && (
                        <span className="text-[11px] font-mono text-gray-400">SKU: {item.sku}</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {getTypeBadge(item.item_type)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-gray-700">
                      {item.base_unit?.toUpperCase()}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-600">
                      {item.item_type === 'raw_oil' || item.item_type === 'raw_chemical' ? (
                        <span>{Number(item.density || 1.0).toFixed(4)} g/mL</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                        Number(item.current_stock || 0) <= Number(item.min_stock_level || 0)
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-800'
                      }`}>
                        {Number(item.current_stock || 0).toLocaleString()} {item.base_unit}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs font-bold text-gray-800">
                      Rs. {Number(item.cost_price || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenModal(item)}
                          className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="font-black text-gray-900 flex items-center gap-2 text-base">
                <FlaskConical className="text-purple-600" size={20} />
                {editingItem ? 'Edit Raw Material / Component' : 'Add New Raw Material / Component'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Material Type Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1.5">
                  Material Classification *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ITEM_TYPES.filter(t => t.id !== 'finished_good' && t.id !== 'bulk_liquid').map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleTypeChange(t.id)}
                      className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2 cursor-pointer ${
                        formData.item_type === t.id
                          ? 'bg-purple-50 border-purple-500 text-purple-900 ring-1 ring-purple-500 font-bold'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 text-xs'
                      }`}
                    >
                      <span className="text-lg">{t.icon}</span>
                      <span className="text-xs leading-tight">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Name & SKU */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Material / Component Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Oud Wood Oil Concentrate or 50ml Amber Glass Bottle"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none font-bold text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Internal SKU / Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. OIL-OUD-01"
                    value={formData.sku}
                    onChange={e => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Barcode (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Barcode string"
                    value={formData.barcode}
                    onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>

              {/* Base Unit & Density */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-purple-50/50 rounded-xl border border-purple-100">
                <div>
                  <label className="block text-xs font-bold text-purple-900 uppercase mb-1 flex items-center gap-1">
                    <Scale size={13} /> Base Stock Unit *
                  </label>
                  <select
                    value={formData.base_unit}
                    onChange={e => setFormData({ ...formData, base_unit: e.target.value, purchase_unit: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm font-bold text-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                  >
                    <option value="g">Gram (g) — Mass</option>
                    <option value="kg">Kilogram (kg) — Mass</option>
                    <option value="ml">Milliliter (mL) — Volume</option>
                    <option value="l">Liter (L) — Volume</option>
                    <option value="pcs">Piece (pcs) — Unit Count</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-purple-900 uppercase mb-1 flex items-center gap-1">
                    Density (g/mL)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.1"
                    max="3.0"
                    placeholder="1.0000"
                    value={formData.density}
                    onChange={e => setFormData({ ...formData, density: parseFloat(e.target.value) || 1.0 })}
                    className="w-full px-3 py-2 bg-white border border-purple-200 rounded-lg text-sm font-mono font-bold text-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                  <span className="text-[10px] text-purple-700 mt-0.5 block leading-tight">
                    For mass-volume conversions (1g is not 1mL). Ethanol ~0.789, Perfume Oils ~0.95.
                  </span>
                </div>
              </div>

              {/* Cost Price & Min Stock Alert */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Standard Cost / Base Unit
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-gray-400 font-bold">Rs.</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.cost_price}
                      onChange={e => setFormData({ ...formData, cost_price: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-xl text-sm font-mono font-bold focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                    Low Stock Threshold
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={formData.min_stock_level}
                    onChange={e => setFormData({ ...formData, min_stock_level: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-mono font-bold focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                  Safety & Storage Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="e.g. Flammable liquid. Store below 25°C away from direct sunlight."
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Form Action Buttons */}
              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition flex items-center gap-2 shadow-md disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingItem ? 'Update Material' : 'Save Material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
