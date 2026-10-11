import { supabase } from './supabase'
import { db } from './db'

/**
 * Depletes raw material or packaging stock across available lots using FEFO/FIFO.
 * If preferredLotId is passed, that lot is depleted first, and any remainder
 * is depleted from subsequent active lots.
 */
export async function depleteItemStockAcrossLots({
  shopId,
  itemId,
  preferredLotId = null,
  quantityToDeduct,
  unit = 'g',
  referenceId,
  notes = '',
  transactionType = 'production_issue',
  userId = null
}) {
  const needed = Number(quantityToDeduct) || 0
  if (needed <= 0 || !itemId) {
    return { success: true, lotsDeducted: [], totalCost: 0, fulfilledQty: 0 }
  }

  let remaining = needed
  const lotsDeducted = []
  let totalCostAcc = 0

  try {
    // 1. Fetch available lots for this item ordered by FEFO / FIFO
    const { data: itemLots } = await supabase
      .from('inventory_lots')
      .select('*')
      .eq('shop_id', shopId)
      .eq('item_id', itemId)
      .gt('available_quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('received_date', { ascending: true })
      .order('id', { ascending: true })

    const sortedLots = (itemLots || []).slice()

    // If preferredLotId specified, prioritize it first
    if (preferredLotId) {
      const idx = sortedLots.findIndex(l => String(l.id) === String(preferredLotId))
      if (idx > 0) {
        const [pref] = sortedLots.splice(idx, 1)
        sortedLots.unshift(pref)
      }
    }

    // 2. Consume from lots in order
    for (const lot of sortedLots) {
      if (remaining <= 0) break
      const avail = Number(lot.available_quantity) || 0
      if (avail <= 0) continue

      const takeQty = Math.min(avail, remaining)
      const newAvail = Math.max(0, Number((avail - takeQty).toFixed(4)))
      const lotStatus = newAvail <= 0 ? 'exhausted' : 'available'
      const lotCost = Number(lot.unit_cost) || 0
      const lineCost = Number((takeQty * lotCost).toFixed(2))

      // Update lot in Supabase
      await supabase
        .from('inventory_lots')
        .update({ available_quantity: newAvail, status: lotStatus })
        .eq('id', lot.id)

      if (db.inventory_lots) {
        await db.inventory_lots.update(lot.id, { available_quantity: newAvail, status: lotStatus }).catch(() => {})
      }

      // Record immutable ledger entry for this specific lot
      await supabase
        .from('inventory_ledger')
        .insert([{
          shop_id: shopId,
          item_id: itemId,
          lot_id: lot.id,
          location_id: lot.location_id || null,
          transaction_type: transactionType,
          quantity: -Math.abs(takeQty),
          base_unit: unit,
          unit_cost: lotCost,
          total_cost: lineCost,
          reference_id: referenceId,
          notes: notes ? `${notes} (Lot ${lot.lot_number}: ${takeQty} ${unit})` : `Consumed ${takeQty} ${unit} from Lot ${lot.lot_number}`,
          created_by: userId ? String(userId) : 'Admin'
        }])

      totalCostAcc += lineCost
      lotsDeducted.push({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        quantity: takeQty,
        unitCost: lotCost
      })
      remaining = Number((remaining - takeQty).toFixed(4))
    }

    // 3. Deduct catalog items current_stock in items table
    const { data: curItm } = await supabase
      .from('items')
      .select('id, current_stock')
      .eq('id', itemId)
      .maybeSingle()

    if (curItm) {
      const newStock = Math.max(0, Number((Number(curItm.current_stock || 0) - needed).toFixed(4)))
      await supabase
        .from('items')
        .update({ current_stock: newStock })
        .eq('id', itemId)

      if (db.items) {
        await db.items.update(itemId, { current_stock: newStock }).catch(() => {})
      }
    }

    // Call stored procedure decrement_item_stock with fallback
    await supabase.rpc('decrement_item_stock', {
      item_id: itemId,
      qty: needed
    }).catch(() => {
      return supabase.rpc('decrement_item_stock', {
        p_item_id: itemId,
        p_qty: needed
      }).catch(() => {})
    })

    return {
      success: true,
      lotsDeducted,
      totalCost: totalCostAcc,
      fulfilledQty: needed - remaining
    }
  } catch (err) {
    console.error('Error depleting item stock across lots:', err)
    return { success: false, error: err.message, lotsDeducted, totalCost: totalCostAcc }
  }
}

/**
 * Credits finished goods to both POS shelf products and items catalog,
 * creates finished goods lot, and writes output entry to inventory_ledger.
 */
export async function creditFinishedGoodsStock({
  shopId,
  targetProductId = null,
  finishedItemId = null,
  quantity,
  unitCost = 0,
  referenceId,
  notes = 'Finished perfume credited to sellable stock',
  locationId = null,
  userId = null
}) {
  const count = Number(quantity) || 0
  if (count <= 0) return { success: false, message: 'Invalid quantity' }

  try {
    let resolvedItemId = finishedItemId

    // 1. Update POS shelf product if provided
    if (targetProductId) {
      const { data: prod } = await supabase
        .from('products')
        .select('id, name, sku, stock_quantity')
        .eq('id', targetProductId)
        .maybeSingle()

      if (prod) {
        const newStock = (Number(prod.stock_quantity) || 0) + count
        await supabase
          .from('products')
          .update({
            stock_quantity: newStock,
            cost_price: Number(unitCost) || 0
          })
          .eq('id', targetProductId)

        if (db.products) {
          await db.products.update(targetProductId, {
            stock_quantity: newStock,
            cost_price: Number(unitCost) || 0
          }).catch(() => {})
        }

        // If finishedItemId not provided, resolve or create item record
        if (!resolvedItemId) {
          const { data: existItm } = await supabase
            .from('items')
            .select('id, current_stock')
            .eq('shop_id', shopId)
            .eq('name', prod.name)
            .maybeSingle()

          if (existItm) {
            resolvedItemId = existItm.id
          } else {
            const { data: newItm } = await supabase
              .from('items')
              .insert([{
                shop_id: shopId,
                sku: prod.sku || `SKU-FG-${Date.now()}`,
                name: prod.name,
                item_type: 'finished_good',
                base_unit: 'pcs',
                cost_price: Number(unitCost) || 0,
                current_stock: 0,
                is_sellable: true,
                is_active: true
              }])
              .select('id')
              .single()

            if (newItm) resolvedItemId = newItm.id
          }
        }
      }
    }

    // 2. Increment items table current_stock for finished good
    if (resolvedItemId) {
      const { data: itm } = await supabase
        .from('items')
        .select('id, current_stock')
        .eq('id', resolvedItemId)
        .maybeSingle()

      if (itm) {
        const newStock = (Number(itm.current_stock) || 0) + count
        await supabase
          .from('items')
          .update({ current_stock: newStock, cost_price: Number(unitCost) || 0 })
          .eq('id', resolvedItemId)

        if (db.items) {
          await db.items.update(resolvedItemId, { current_stock: newStock, cost_price: Number(unitCost) || 0 }).catch(() => {})
        }
      }
    }

    // 3. Create Finished Goods lot in inventory_lots
    const lotNumber = `LOT-FG-${referenceId.replace(/[^a-zA-Z0-9-]/g, '')}`
    const { data: fgLot } = await supabase
      .from('inventory_lots')
      .insert([{
        shop_id: shopId,
        item_id: resolvedItemId,
        lot_number: lotNumber,
        received_date: new Date().toISOString().split('T')[0],
        initial_quantity: count,
        available_quantity: count,
        unit_cost: Number(unitCost) || 0,
        location_id: locationId || null,
        status: 'available',
        notes: `Produced via ${referenceId}`
      }])
      .select('id')
      .maybeSingle()

    // 4. Log bottling_output in inventory_ledger
    await supabase
      .from('inventory_ledger')
      .insert([{
        shop_id: shopId,
        item_id: resolvedItemId,
        lot_id: fgLot?.id || null,
        location_id: locationId || null,
        transaction_type: 'bottling_output',
        quantity: count,
        base_unit: 'pcs',
        unit_cost: Number(unitCost) || 0,
        total_cost: Number((count * (Number(unitCost) || 0)).toFixed(2)),
        reference_id: referenceId,
        notes,
        created_by: userId ? String(userId) : 'Admin'
      }])

    return { success: true, finishedItemId: resolvedItemId, lotId: fgLot?.id }
  } catch (err) {
    console.error('Error crediting finished goods stock:', err)
    return { success: false, error: err.message }
  }
}
