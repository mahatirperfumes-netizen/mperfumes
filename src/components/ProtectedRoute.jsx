import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { isManufacturer } from '../utils/featureGate'
import { useEffect, useState, useRef } from 'react'

// In-memory timestamp to prevent spamming get_shop_status RPC on every page transition
let lastStatusCheckTime = 0
let cachedShopStatus = 'active'

function ProtectedRoute({ children, allowedRoles, requiredModule, manufacturerOnly = false }) {
  const { user, logout } = useAuth()
  const [isSuspended, setIsSuspended] = useState(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    async function checkStatus() {
      // Superadmin or user without shop_id does not check shop suspension
      if (!user?.shop_id || (user.role === 'superadmin' && !user.isImpersonating)) {
        return
      }

      // Throttle: Only check RPC if at least 3 minutes have passed since the last check
      const now = Date.now()
      if (now - lastStatusCheckTime < 3 * 60 * 1000) {
        if (cachedShopStatus === 'suspended' && !user.isImpersonating) {
          setIsSuspended(true)
        }
        return
      }

      if (!navigator.onLine) return

      try {
        const { data, error } = await supabase
          .rpc('get_shop_status', { p_shop_id: user.shop_id })

        if (error) throw error

        lastStatusCheckTime = Date.now()
        cachedShopStatus = data

        if (isMountedRef.current) {
          if (!user.isImpersonating && data === 'suspended') {
            setIsSuspended(true)
          }
        }
      } catch (_) {
        // Fail open silently on network glitch so user is never blocked
      }
    }

    checkStatus()

    return () => {
      isMountedRef.current = false
    }
  }, [user])

  if (!user) return <Navigate to="/" replace />

  if (isSuspended) {
    alert('Aap ka account fee na-adaiyegy ki wajah se muattal (suspended) kar diya gaya hai. Baraye meharbani support se rabta karein: 0301-2616367')
    logout()
    return <Navigate to="/" replace />
  }

  // ── 1. Superadmin Route Enforcement ──
  const isSuperadminOnly = allowedRoles && allowedRoles.includes('superadmin') && !allowedRoles.includes('admin')
  if (isSuperadminOnly) {
    if (user.role !== 'superadmin') {
      return <Navigate to="/dashboard" replace />
    }
    return children
  }

  // ── 2. Superadmin accessing Shop Routes ──
  // If user is pure superadmin (not impersonating), redirect them to the Superadmin portal
  if (user.role === 'superadmin' && !user.isImpersonating) {
    return <Navigate to="/admin" replace />
  }

  // ── 2b. Manufacturer-Only Feature Enforcement ──
  if (manufacturerOnly && !isManufacturer() && user.role !== 'superadmin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-xl border border-gray-100 text-center">
          <div className="w-14 h-14 bg-purple-100 text-purple-700 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            🧪
          </div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Manufacturing Mode Required</h2>
          <p className="text-sm text-gray-500 mb-6">
            Formulas, Production Batches, and Bottling Runs are only available for accounts configured with manufacturing enabled.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm rounded-xl transition shadow-sm"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    )
  }

  // ── 3. Shop Admins & Impersonating Superadmins bypass module restrictions ──
  if (user.role === 'admin' || user.isImpersonating) return children

  // ── 4. Module & Role-Based Permissions for Staff (Cashier, Manager, Accountant) ──
  const hasLegacyRole = allowedRoles ? allowedRoles.includes(user.role) : true
  const hasPermission = user.permissions && Array.isArray(user.permissions) && requiredModule
    ? user.permissions.includes(requiredModule)
    : hasLegacyRole

  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-4xl mb-3">🚫</p>
          <h2 className="text-xl font-bold text-gray-700">Access Denied</h2>
          <p className="text-gray-400 mt-1">Aap ka is page tak access nahi hai.</p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute