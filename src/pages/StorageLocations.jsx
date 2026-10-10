import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { Plus, Edit2, Trash2, MapPin, X, Check } from 'lucide-react'

const DEFAULT_LOCATIONS = [
  { name: 'Raw Material Store', code: 'RAW-01', is_default: false },
  { name: 'Packaging Component Store', code: 'PKG-01', is_default: false },
  { name: 'WIP / Blending Laboratory', code: 'WIP-01', is_default: false },
  { name: 'Finished Goods Shelf', code: 'FG-01', is_default: true },
  { name: 'Quarantine / Damaged Stock', code: 'QC-HOLD', is_default: false }
]

export default function StorageLocations() {
  const { user } = useAuth()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingLoc, setEditingLoc] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', is_default: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user?.shop_id) fetchLocations()
  }, [user?.shop_id])

  const fetchLocations = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('id')

      if (!error && data) {
        setLocations(data)
        await db.inventory_locations.bulkPut(JSON.parse(JSON.stringify(data))).catch(() => {})
      } else {
        const local = await db.inventory_locations.where('shop_id').equals(user.shop_id).toArray()
        setLocations(local || [])
      }
    } catch {
      const local = await db.inventory_locations.toArray()
      setLocations(local.filter(x => String(x.shop_id) === String(user.shop_id)))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (loc = null) => {
    setError('')
    if (loc) {
      setEditingLoc(loc)
      setForm({ name: loc.name || '', code: loc.code || '', is_default: !!loc.is_default })
    } else {
      setEditingLoc(null)
      setForm({ name: '', code: '', is_default: false })
    }
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return

    setSaving(true)
    setError('')

    const payload = {
      shop_id: user.shop_id,
      name: form.name.trim(),
      code: form.code.trim() || null,
      is_default: form.is_default
    }

    try {
      if (editingLoc) {
        const { data, error: upError } = await supabase
          .from('inventory_locations')
          .update(payload)
          .eq('id', editingLoc.id)
          .select()
          .single()

        if (upError) throw upError
        setLocations(prev => prev.map(l => l.id === editingLoc.id ? data : l))
        await db.inventory_locations.put(data).catch(() => {})
      } else {
        const { data, error: inError } = await supabase
          .from('inventory_locations')
          .insert([payload])
          .select()
          .single()

        if (inError) throw inError
        setLocations(prev => [...prev, data])
        await db.inventory_locations.put(data).catch(() => {})
      }
      setShowModal(false)
    } catch (err) {
      setError(err.message || 'Failed to save location.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this storage location?')) return
    try {
      const { error: delError } = await supabase.from('inventory_locations').delete().eq('id', id)
      if (delError) throw delError
      setLocations(prev => prev.filter(l => l.id !== id))
      await db.inventory_locations.delete(id).catch(() => {})
    } catch (err) {
      alert('Failed to delete: ' + err.message)
    }
  }

  const handleSeedDefaults = async () => {
    setSaving(true)
    try {
      const inserts = DEFAULT_LOCATIONS.map(d => ({ ...d, shop_id: user.shop_id }))
      const { data, error } = await supabase.from('inventory_locations').insert(inserts).select()
      if (error) throw error
      setLocations(prev => [...prev, ...(data || [])])
      if (data) await db.inventory_locations.bulkPut(JSON.parse(JSON.stringify(data))).catch(() => {})
    } catch (err) {
      alert('Failed to seed defaults: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200">
        <div>
          <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
            <MapPin size={18} className="text-purple-600" /> Storage & Warehouse Locations
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Segregate Raw Materials, Packaging, WIP Blending, and Finished Goods across your facility.
          </p>
        </div>
        <div className="flex gap-2">
          {locations.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              disabled={saving}
              className="text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-2 rounded-lg border border-purple-200 transition cursor-pointer"
            >
              Seed Standard Zones
            </button>
          )}
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-3 py-2 rounded-lg transition cursor-pointer"
          >
            <Plus size={16} /> Add Location
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-gray-400 font-bold">Loading storage zones...</div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center">
            <MapPin size={36} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm font-bold text-gray-600">No Storage Locations Configured</p>
            <p className="text-xs text-gray-400 mt-1">Click "Seed Standard Zones" to populate default perfumery stores.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase">
              <tr>
                <th className="py-3 px-4">Zone / Location Name</th>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Default</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {locations.map(loc => (
                <tr key={loc.id} className="hover:bg-gray-50/50">
                  <td className="py-3 px-4 font-bold text-gray-800 flex items-center gap-2">
                    <MapPin size={15} className="text-gray-400" />
                    {loc.name}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-500">
                    {loc.code || '—'}
                  </td>
                  <td className="py-3 px-4">
                    {loc.is_default && (
                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleOpenModal(loc)}
                        className="p-1.5 text-gray-400 hover:text-purple-600 rounded transition"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(loc.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded transition"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl overflow-hidden p-5">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
              <h4 className="font-bold text-gray-900 text-sm">
                {editingLoc ? 'Edit Storage Location' : 'New Storage Location'}
              </h4>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-3 p-2.5 bg-red-50 text-red-700 text-xs rounded-lg font-bold">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                  Location Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Raw Material Store"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                  Zone Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. RAW-01"
                  value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={e => setForm({ ...form, is_default: e.target.checked })}
                  className="rounded text-purple-600 focus:ring-purple-500"
                />
                Default Storage Location
              </label>

              <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
