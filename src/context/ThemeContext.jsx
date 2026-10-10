import { createContext, useContext, useState, useEffect } from 'react'
import {
  initGlobalSoundEffects,
  isSoundEnabled,
  toggleSound as soundToggleHelper,
  setSoundEnabled as soundSetHelper
} from '../utils/soundEffects'

const ThemeContext = createContext({
  theme: 'light',
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
  soundEnabled: true,
  toggleSound: () => {},
  setSoundEnabled: () => {}
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = localStorage.getItem('app_theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  const [soundOn, setSoundOn] = useState(() => isSoundEnabled())

  useEffect(() => {
    initGlobalSoundEffects()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.setAttribute('data-theme', 'dark')
      localStorage.setItem('app_theme', 'dark')
    } else {
      root.classList.remove('dark')
      root.setAttribute('data-theme', 'light')
      localStorage.setItem('app_theme', 'light')
    }
  }, [theme])

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setTheme = (newTheme) => {
    if (newTheme === 'dark' || newTheme === 'light') {
      setThemeState(newTheme)
    }
  }

  const toggleSound = () => {
    const updated = soundToggleHelper()
    setSoundOn(updated)
    return updated
  }

  const setSoundEnabled = (enabled) => {
    soundSetHelper(enabled)
    setSoundOn(enabled)
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
        soundEnabled: soundOn,
        toggleSound,
        setSoundEnabled
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
