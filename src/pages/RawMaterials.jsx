import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { ITEM_TYPES, normalizeUnit } from '../utils/unitConversion'
import { 
  Plus, Search, Edit2, Trash2, X, AlertTriangle, 
  FlaskConical, Box, Package, ShieldCheck, Scale, Check,
  History, ArrowDownRight, ArrowUpRight, Calendar, Layers, Clock
} from 'lucide-react'

export default function RawMaterials() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // History / Movement Drawer
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyItem, setHistoryItem] = useState(null)
  const [historyLogs, setHistoryLogs] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

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

      // 2. Fetch Categories, Brands, and Available Lots
      const [catRes, brandRes, lotsRes] = await Promise.all([
        supabase.from('categories').select('id, name').eq('shop_id', user.shop_id),
        supabase.from('brands').select('id, name').eq('shop_id', user.shop_id),
        supabase.from('inventory_lots').select('*').eq('shop_id', user.shop_id).gt('available_quantity', 0)
      ])
      if (catRes.data) setCategories(catRes.data)
      if (brandRes.data) setBrands(brandRes.data)
      if (lotsRes.data) {
        setLots(lotsRes.data)
        await db.inventory_lots?.bulkPut(JSON.parse(JSON.stringify(lotsRes.data))).catch(() => {})
      } else {
        const localLots = await db.inventory_lots?.where('shop_id').equals(user.shop_id).toArray()
        setLots(localLots || [])
      }

    } catch (err) {
      console.error('Failed to load raw items:', err)
      const local = await db.items.toArray()
      setItems(local.filter(x => String(x.shop_id) === String(user.shop_id)))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenHistory = async (item) => {
    setHistoryItem(item)
    setShowHistoryModal(true)
    setHistoryLoading(true)
    try {
      const { data, error } = await supabase
        .from('inventory_ledger')
        .select('*, inventory_lots(lot_number)')
        .eq('shop_id', user.shop_id)
        .eq('item_id', item.id)
        .order('id', { ascending: false })

      if (!error && data) {
        setHistoryLogs(data)
      } else {
        const local = await db.inventory_ledger?.where('item_id').equals(item.id).toArray()
        setHistoryLogs(local || [])
      }
    } catch (err) {
      console.error('Failed to load item movement history:', err)
    } finally {
      setHistoryLoading(false)
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
                      {(() => {
                        const itemLots = lots.filter(l => String(l.item_id) === String(item.id))
                        const lotStock = itemLots.reduce((acc, l) => acc + Number(l.available_quantity || 0), 0)
                        const liveStock = itemLots.length > 0 ? lotStock : Number(item.current_stock || 0)
                        const isLow = liveStock <= Number(item.min_stock_level || 0)
                        return (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                              isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-800'
                            }`}>
                              {liveStock.toLocaleString()} {item.base_unit}
                            </span>
                            {itemLots.length > 0 && (
                              <span className="text-[10px] text-gray-400 font-mono">
                                {itemLots.length} lot{itemLots.length > 1 ? 's' : ''} active
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs font-bold text-gray-800">
                      Rs. {Number(item.cost_price || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenHistory(item)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                          title="Movement History & Consumption Ledger"
                        >
                          <History size={16} />
                        </button>
                        <button
                          onClick={() => handleOpenModal(item)}
                          className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
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

      {/* ── MOVEMENT HISTORY & CONSUMPTION LEDGER MODAL ── */}
      {showHistoryModal && historyItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-5 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <span className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
                  <History size={22} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-gray-900 text-base">
                      {historyItem.name}
                    </h3>
                    {getTypeBadge(historyItem.item_type)}
                  </div>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    SKU: {historyItem.sku || 'N/A'} | Base Unit: {historyItem.base_unit?.toUpperCase()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-white border-b border-gray-100 text-xs shrink-0">
              {(() => {
                const itemLots = lots.filter(l => String(l.item_id) === String(historyItem.id))
                const currentOnHand = itemLots.length > 0 
                  ? itemLots.reduce((acc, l) => acc + Number(l.available_quantity || 0), 0)
                  : Number(historyItem.current_stock || 0)

                const totalConsumed = historyLogs
                  .filter(l => Number(l.quantity) < 0 && l.transaction_type !== 'bottling_damage')
                  .reduce((acc, l) => acc + Math.abs(Number(l.quantity || 0)), 0)

                const totalDamaged = historyLogs
                  .filter(l => l.transaction_type === 'bottling_damage')
                  .reduce((acc, l) => acc + Math.abs(Number(l.quantity || 0)), 0)

                const totalReceived = historyLogs
                  .filter(l => Number(l.quantity) > 0)
                  .reduce((acc, l) => acc + Number(l.quantity || 0), 0)

                return (
                  <>
                    <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                      <span className="text-[10px] text-emerald-700 uppercase font-bold block">Current Stock</span>
                      <strong className="text-base font-black text-emerald-900 font-mono mt-0.5 block">
                        {currentOnHand.toLocaleString()} {historyItem.base_unit}
                      </strong>
                    </div>
                    <div className="bg-purple-50 p-2.5 rounded-xl border border-purple-200">
                      <span className="text-[10px] text-purple-700 uppercase font-bold block">Production Consumed</span>
                      <strong className="text-base font-black text-purple-900 font-mono mt-0.5 block">
                        {totalConsumed.toLocaleString()} {historyItem.base_unit}
                      </strong>
                    </div>
                    <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                      <span className="text-[10px] text-amber-700 uppercase font-bold block">Damaged / Scrap Loss</span>
                      <strong className="text-base font-black text-amber-900 font-mono mt-0.5 block">
                        {totalDamaged.toLocaleString()} {historyItem.base_unit}
                      </strong>
                    </div>
                    <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-200">
                      <span className="text-[10px] text-blue-700 uppercase font-bold block">Total Received</span>
                      <strong className="text-base font-black text-blue-900 font-mono mt-0.5 block">
                        {totalReceived.toLocaleString()} {historyItem.base_unit}
                      </strong>
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Timeline Table */}
            <div className="overflow-y-auto flex-1 p-4">
              {historyLoading ? (
                <div className="py-12 text-center text-xs text-gray-500 font-bold">
                  Loading movement logs...
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-xs">
                  <p className="font-bold text-gray-600">No movement history recorded yet for this material.</p>
                  <p className="mt-1">Deductions and stock receipts will automatically log here.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 font-bold border-b border-gray-200">
                        <th className="p-2.5">Date / Time</th>
                        <th className="p-2.5">Activity</th>
                        <th className="p-2.5">Reference</th>
                        <th className="p-2.5">Lot #</th>
                        <th className="p-2.5 text-right">Quantity Change</th>
                        <th className="p-2.5 text-right">Unit Cost</th>
                        <th className="p-2.5 text-right">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historyLogs.map((log, idx) => {
                        const qtyNum = Number(log.quantity || 0)
                        const isDeduction = qtyNum < 0

                        const typeLabels = {
                          production_issue: { label: '🧪 Batch Blending', bg: 'bg-purple-100 text-purple-800' },
                          bottling_issue: { label: '📦 Bottling Run', bg: 'bg-indigo-100 text-indigo-800' },
                          bottling_damage: { label: '⚠️ Scrap / Damaged', bg: 'bg-red-100 text-red-800' },
                          bottling_bulk_issue: { label: '🍶 Bulk Consumed', bg: 'bg-sky-100 text-sky-800' },
                          purchase_receipt: { label: '📥 PO Received', bg: 'bg-emerald-100 text-emerald-800' },
                          adjustment: { label: '⚖️ Manual Adjustment', bg: 'bg-gray-100 text-gray-800' }
                        }
                        const badgeInfo = typeLabels[log.transaction_type] || {
                          label: log.transaction_type?.replace('_', ' ').toUpperCase(),
                          bg: 'bg-gray-100 text-gray-700'
                        }

                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="p-2.5 text-gray-500 font-mono whitespace-nowrap">
                              {log.created_at ? new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                            </td>
                            <td className="p-2.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeInfo.bg}`}>
                                {badgeInfo.label}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono font-bold text-gray-700">
                              {log.reference_id || '—'}
                            </td>
                            <td className="p-2.5 font-mono text-gray-500">
                              {log.inventory_lots?.lot_number || (log.lot_id ? `LOT-#${log.lot_id}` : 'General')}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold">
                              <span className={isDeduction ? 'text-red-600' : 'text-emerald-600'}>
                                {isDeduction ? '' : '+'}{qtyNum} {log.base_unit || historyItem.base_unit}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-mono text-gray-600">
                              Rs. {Number(log.unit_cost || 0).toLocaleString()}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-gray-900">
                              Rs. {Number(log.total_cost || Math.abs(qtyNum * Number(log.unit_cost || 0))).toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end shrink-0">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-5 py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
