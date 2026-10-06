export type NavigationProfile = 'default' | 'sabono-retail'

export function getNavigationProfile(
  value = import.meta.env.VITE_CRM_NAVIGATION_PROFILE,
): NavigationProfile {
  return value === 'sabono-retail' ? 'sabono-retail' : 'default'
}

export const navigationProfile = getNavigationProfile()
