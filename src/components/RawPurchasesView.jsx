import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { convertQuantity, ITEM_TYPES } from '../utils/unitConversion'
import { 
  FlaskConical, Search, Plus, Trash2, Calendar, MapPin, 
  Truck, DollarSign, Scale, CheckCircle2, AlertTriangle, Hash, Clock
} from 'lucide-react'

export default function RawPurchasesView({ suppliers, onPurchaseCompleted }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  // Cart state
  const [cart, setCart] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [paymentType, setPaymentType] = useState('cash')
  const [freightCost, setFreightCost] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user?.shop_id) {
      fetchRawData()
    }
  }, [user?.shop_id])

  const fetchRawData = async () => {
    setLoading(true)
    try {
      const [itRes, locRes] = await Promise.all([
        supabase.from('items').select('*').eq('shop_id', user.shop_id).eq('is_purchasable', true).order('name'),
        supabase.from('inventory_locations').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      if (itRes.data) {
        setItems(itRes.data)
        await db.items.bulkPut(JSON.parse(JSON.stringify(itRes.data))).catch(() => {})
      } else {
        const local = await db.items.where('shop_id').equals(user.shop_id).toArray()
        setItems(local || [])
      }

      if (locRes.data) {
        setLocations(locRes.data)
        await db.inventory_locations.bulkPut(JSON.parse(JSON.stringify(locRes.data))).catch(() => {})
      } else {
        const localLocs = await db.inventory_locations.where('shop_id').equals(user.shop_id).toArray()
        setLocations(localLocs || [])
      }
    } catch (err) {
      console.warn('Offline fallback for raw items:', err)
      const [localItems, localLocs] = await Promise.all([
        db.items.toArray(),
        db.inventory_locations.toArray()
      ])
      setItems(localItems.filter(x => String(x.shop_id) === String(user.shop_id)))
      setLocations(localLocs.filter(x => String(x.shop_id) === String(user.shop_id)))
    } finally {
      setLoading(false)
    }
  }

  const generateLotNumber = () => {
    const d = new Date()
    const yr = String(d.getFullYear()).slice(-2)
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const rand = Math.floor(100 + Math.random() * 900)
    return `LOT-${yr}${mo}${day}-${rand}`
  }

  const addToCart = (item) => {
    const existing = cart.find(c => c.item_id === item.id)
    if (existing) {
      setCart(cart.map(c => c.item_id === item.id ? { ...c, qty: c.qty + 1 } : c))
      return
    }

    const defaultUnit = item.purchase_unit || item.base_unit || 'g'
    const defaultLoc = locations[0]?.id || null

    setCart([
      ...cart,
      {
        item_id: item.id,
        name: item.name,
        sku: item.sku,
        item_type: item.item_type,
        base_unit: item.base_unit || 'g',
        unit: defaultUnit,
        density: item.density || 1.0,
        qty: 1,
        purchase_price: item.cost_price || 0,
        lot_number: generateLotNumber(),
        supplier_lot_number: '',
        expiry_date: '',
        location_id: defaultLoc
      }
    ])
  }

  const updateCartItem = (itemId, updates) => {
    setCart(cart.map(i => i.item_id === itemId ? { ...i, ...updates } : i))
  }

  const removeFromCart = (itemId) => {
    setCart(cart.filter(i => i.item_id !== itemId))
  }

  const clearCart = () => {
    setCart([])
    setSupplierId('')
    setFreightCost(0)
    setDiscount(0)
    setError('')
  }

  // Calculations
  const subtotal = cart.reduce((sum, i) => sum + (Number(i.purchase_price) || 0) * (Number(i.qty) || 0), 0)
  const freight = Number(freightCost) || 0
  const totalDiscount = Number(discount) || 0
  const netTotal = Math.max(0, subtotal + freight - totalDiscount)

  // Filter items
  const filteredItems = items.filter(it => {
    const matchesSearch = 
      (it.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (it.sku || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === 'all' || it.item_type === typeFilter
    return matchesSearch && matchesType
  })

  // Complete Raw Purchase
  const handleCompletePurchase = async () => {
    if (cart.length === 0) return alert('Raw material cart is empty!')
    if (!supplierId) return alert('Please select a supplier!')

    setSaving(true)
    setError('')

    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }
    const purchaseData = {
      shop_id: user.shop_id,
      supplier_id: toIntOrNull(supplierId),
      total_amount: netTotal,
      paid_amount: paymentType === 'cash' ? netTotal : 0,
      payment_type: paymentType,
      status: 'completed',
      notes: `Raw Materials & Packaging Receipt (Freight: Rs. ${freight})`
    }

    try {
      // 1. Insert Purchase Record
      const { data: purchase, error: pError } = await supabase
        .from('purchases')
        .insert([purchaseData])
        .select()
        .single()

      if (pError) throw pError

      // 2. Insert Lots & Ledger & Update Items
      const createdLotNumbers = []

      for (const item of cart) {
        const itemLineTotal = (Number(item.purchase_price) || 0) * (Number(item.qty) || 0)
        const itemFreightShare = subtotal > 0 ? (freight * (itemLineTotal / subtotal)) : 0
        const baseQty = convertQuantity(item.qty, item.unit, item.base_unit, item.density)
        const landedUnitCost = baseQty > 0 ? ((itemLineTotal + itemFreightShare) / baseQty) : 0

        // Create Inventory Lot
        const lotPayload = {
          shop_id: user.shop_id,
          item_id: item.item_id,
          lot_number: item.lot_number || generateLotNumber(),
          supplier_lot_number: item.supplier_lot_number || null,
          supplier_id: toIntOrNull(supplierId),
          location_id: item.location_id ? toIntOrNull(item.location_id) : null,
          received_date: new Date().toISOString().split('T')[0],
          expiry_date: item.expiry_date || null,
          initial_quantity: baseQty,
          available_quantity: baseQty,
          unit_cost: landedUnitCost,
          status: 'available',
          notes: `Received via PO #${purchase.id}`
        }

        const { data: lotData, error: lotError } = await supabase
          .from('inventory_lots')
          .insert([lotPayload])
          .select()
          .single()

        if (lotError) throw lotError
        createdLotNumbers.push(lotPayload.lot_number)

        // Insert Immutable Inventory Movement Ledger
        const ledgerPayload = {
          shop_id: user.shop_id,
          item_id: item.item_id,
          lot_id: lotData.id,
          location_id: item.location_id ? toIntOrNull(item.location_id) : null,
          transaction_type: 'purchase_receipt',
          quantity: baseQty,
          base_unit: item.base_unit,
          unit_cost: landedUnitCost,
          total_cost: itemLineTotal + itemFreightShare,
          reference_id: `PO-${purchase.id}`,
          notes: `Received ${item.qty} ${item.unit} @ Rs.${item.purchase_price}/${item.unit} (Landed: Rs.${landedUnitCost.toFixed(2)}/${item.base_unit})`,
          created_by: user.username || user.email
        }
        await supabase.from('inventory_ledger').insert([ledgerPayload])

        // Update Item Stock and Moving Average Cost
        const originalItem = items.find(x => x.id === item.item_id)
        const currStock = Number(originalItem?.current_stock) || 0
        const newStock = currStock + baseQty
        await supabase.from('items').update({
          current_stock: newStock,
          cost_price: landedUnitCost,
          updated_at: new Date().toISOString()
        }).eq('id', item.item_id)

        await db.items.update(item.item_id, { current_stock: newStock, cost_price: landedUnitCost }).catch(() => {})
      }

      // 3. Insert Purchase Items for general reporting
      const pItems = cart.map(i => ({
        purchase_id: purchase.id,
        product_id: null,
        product_name: `[RAW] ${i.name} (${i.qty} ${i.unit})`,
        quantity: i.qty,
        unit_price: i.purchase_price,
        total_price: i.purchase_price * i.qty
      }))
      await supabase.from('purchase_items').insert(pItems)

      // 4. Update Supplier ledger if credit
      if (paymentType === 'credit') {
        const supplier = suppliers.find(s => String(s.id) === String(supplierId))
        const newBalance = (Number(supplier?.outstanding_balance) || 0) + netTotal
        await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', supplierId)
        await db.suppliers.update(supplierId, { outstanding_balance: newBalance }).catch(() => {})
      }

      alert(`✅ Raw materials received successfully!\nPO #${purchase.id} logged.\nLots Created:\n• ${createdLotNumbers.join('\n• ')}`)
      clearCart()
      fetchRawData()
      if (onPurchaseCompleted) onPurchaseCompleted()
    } catch (err) {
      console.error('Raw purchase error:', err)
      setError(err.message || 'Failed to complete raw purchase.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
      {/* LEFT: Raw Material & Packaging Catalog */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        {/* Header & Sub-Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-purple-900 tracking-tight flex items-center gap-2">
              <FlaskConical className="text-purple-600" size={20} /> Raw Ingredients & Packaging
            </h2>
            <p className="text-xs text-gray-500">
              Select perfume oils, ethanol solvents, bottles, caps, and packaging components to receive into inventory lots.
            </p>
          </div>
          <span className="text-xs font-bold bg-purple-100 text-purple-800 px-3 py-1 rounded-full border border-purple-200">
            {cart.length} items in receipt
          </span>
        </div>

        {/* Search & Category Filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-xs">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search raw oils, chemicals, bottles..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-sm outline-none text-gray-800"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                typeFilter === 'all'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {ITEM_TYPES.filter(t => t.id !== 'finished_good' && t.id !== 'bulk_liquid').map(t => (
              <button
                key={t.id}
                onClick={() => setTypeFilter(t.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  typeFilter === t.id
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Grid of Raw Materials */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto flex-1 content-start pr-1 custom-scrollbar">
          {loading ? (
            <div className="col-span-3 text-center py-12 text-gray-400 font-bold">Loading catalog...</div>
          ) : filteredItems.length === 0 ? (
            <div className="col-span-3 text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
              <FlaskConical size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-bold text-gray-600">No Raw Items Found</p>
              <p className="text-xs text-gray-400 mt-1">Configure your oils and bottles under Master Data &gt; Raw Materials.</p>
            </div>
          ) : (
            filteredItems.map(item => (
              <div
                key={item.id}
                onClick={() => addToCart(item)}
                className="bg-white rounded-xl p-3 border border-gray-200 hover:border-purple-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="text-xs font-black text-gray-900 group-hover:text-purple-700 leading-tight">
                      {item.name}
                    </span>
                    <span className="text-sm shrink-0">
                      {ITEM_TYPES.find(t => t.id === item.item_type)?.icon || '🧪'}
                    </span>
                  </div>
                  {item.sku && (
                    <span className="text-[10px] font-mono text-gray-400 block">SKU: {item.sku}</span>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase block font-bold">Stock</span>
                    <span className="font-mono font-bold text-gray-700">
                      {Number(item.current_stock || 0).toLocaleString()} {item.base_unit}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 uppercase block font-bold">Base Unit</span>
                    <span className="font-mono font-bold text-purple-700 uppercase">
                      {item.base_unit}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT: Raw Materials Receiving Cart */}
      <div className="w-full md:w-96 flex flex-col bg-white rounded-2xl border border-gray-200 shadow-md p-4 overflow-hidden shrink-0">
        <div className="border-b border-gray-100 pb-3 mb-3 flex justify-between items-center shrink-0">
          <h3 className="font-black text-gray-900 text-sm flex items-center gap-2">
            <Scale className="text-purple-600" size={18} /> Receiving Cart &amp; Lots
          </h3>
          <button
            onClick={clearCart}
            disabled={cart.length === 0}
            className="text-xs font-bold text-gray-400 hover:text-red-600 transition disabled:opacity-30"
          >
            Clear
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-bold mb-3 flex items-center gap-1.5 shrink-0">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Supplier & Payment Selector */}
        <div className="space-y-2 mb-3 shrink-0">
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">
              Supplier (Vendor) *
            </label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">Select Supplier</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.outstanding_balance > 0 ? `(Bal: Rs.${Number(s.outstanding_balance).toLocaleString()})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentType('cash')}
              className={`py-1.5 rounded-lg text-xs font-bold transition ${
                paymentType === 'cash'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              💵 Cash Paid
            </button>
            <button
              type="button"
              onClick={() => setPaymentType('credit')}
              className={`py-1.5 rounded-lg text-xs font-bold transition ${
                paymentType === 'credit'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              📒 Credit (Payable)
            </button>
          </div>
        </div>

        {/* Cart Line Items (Scrollable) */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              <FlaskConical size={32} className="mx-auto mb-2 opacity-40 text-purple-600" />
              Select raw materials from the left to create lots and receive inventory.
            </div>
          ) : (
            cart.map(item => {
              const itemTotal = (Number(item.purchase_price) || 0) * (Number(item.qty) || 0)
              const itemFreightShare = subtotal > 0 ? (freight * (itemTotal / subtotal)) : 0
              const baseQty = convertQuantity(item.qty, item.unit, item.base_unit, item.density)
              const landedCost = baseQty > 0 ? ((itemTotal + itemFreightShare) / baseQty) : 0

              return (
                <div key={item.item_id} className="p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                  <div className="flex justify-between items-start gap-1">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 leading-tight">{item.name}</h4>
                      <span className="text-[10px] text-purple-700 font-mono">
                        Base: {baseQty.toFixed(2)} {item.base_unit}
                      </span>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.item_id)}
                      className="text-gray-400 hover:text-red-600 p-0.5"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Quantity & Unit & Rate */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-gray-400 block">Qty</label>
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={item.qty}
                        onChange={e => updateCartItem(item.item_id, { qty: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2 py-1 bg-white border border-gray-200 rounded text-xs font-bold font-mono outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-gray-400 block">Unit</label>
                      <select
                        value={item.unit}
                        onChange={e => updateCartItem(item.item_id, { unit: e.target.value })}
                        className="w-full px-1 py-1 bg-white border border-gray-200 rounded text-xs font-bold outline-none"
                      >
                        <option value="g">Gram (g)</option>
                        <option value="kg">Kg</option>
                        <option value="ml">mL</option>
                        <option value="l">Liter (L)</option>
                        <option value="pcs">Pieces</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-gray-400 block">Rate (Rs)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={item.purchase_price}
                        onChange={e => updateCartItem(item.item_id, { purchase_price: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2 py-1 bg-white border border-gray-200 rounded text-xs font-bold font-mono outline-none text-right"
                      />
                    </div>
                  </div>

                  {/* Lot Details Accordion */}
                  <div className="pt-1.5 border-t border-gray-200/60 grid grid-cols-2 gap-1.5 text-[10px]">
                    <div>
                      <label className="font-bold text-gray-400 block">Internal Lot #</label>
                      <input
                        type="text"
                        value={item.lot_number}
                        onChange={e => updateCartItem(item.item_id, { lot_number: e.target.value })}
                        className="w-full px-1.5 py-0.5 bg-white border border-gray-200 rounded font-mono text-[10px]"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-gray-400 block">Supplier Lot</label>
                      <input
                        type="text"
                        placeholder="Supplier batch"
                        value={item.supplier_lot_number}
                        onChange={e => updateCartItem(item.item_id, { supplier_lot_number: e.target.value })}
                        className="w-full px-1.5 py-0.5 bg-white border border-gray-200 rounded font-mono text-[10px]"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-gray-400 block">Storage Zone</label>
                      <select
                        value={item.location_id || ''}
                        onChange={e => updateCartItem(item.item_id, { location_id: e.target.value })}
                        className="w-full px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]"
                      >
                        <option value="">Default Zone</option>
                        {locations.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-gray-400 block">Expiry / Retest</label>
                      <input
                        type="date"
                        value={item.expiry_date}
                        onChange={e => updateCartItem(item.item_id, { expiry_date: e.target.value })}
                        className="w-full px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]"
                      />
                    </div>
                  </div>

                  {/* Real-Time Landed Cost Calculation Badge */}
                  <div className="pt-1 flex items-center justify-between text-[11px] font-bold">
                    <span className="text-gray-500">Landed Cost:</span>
                    <span className="text-purple-700 font-mono">
                      Rs. {landedCost.toFixed(2)} / {item.base_unit}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Totals & Landed Freight Input */}
        <div className="pt-3 border-t border-gray-100 space-y-2 shrink-0">
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal:</span>
              <span className="font-mono font-bold">Rs. {subtotal.toLocaleString()}</span>
            </div>

            {/* Freight / Landed Cost Allocation */}
            <div className="flex items-center justify-between">
              <span className="text-purple-800 font-bold flex items-center gap-1">
                <Truck size={13} /> Freight / Shipping:
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 font-mono">Rs.</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={freightCost}
                  onChange={e => setFreightCost(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-0.5 border border-purple-200 rounded text-right font-mono font-bold text-xs outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600">Discount:</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 font-mono">Rs.</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={discount}
                  onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-0.5 border border-gray-200 rounded text-right font-mono text-xs outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-gray-200 flex justify-between items-baseline font-black">
              <span className="text-sm text-gray-900">Net Payable:</span>
              <span className="text-base font-mono text-purple-900">Rs. {netTotal.toLocaleString()}</span>
            </div>
          </div>

          {/* Complete Button */}
          <button
            onClick={handleCompletePurchase}
            disabled={saving || cart.length === 0}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold shadow-md transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {saving ? 'Receiving & Minting Lots...' : '✅ Complete Receipt & Generate Lots'}
          </button>
        </div>
      </div>
    </div>
  )
}
