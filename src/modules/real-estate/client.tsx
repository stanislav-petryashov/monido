import { lazy } from 'react'
import { IconHome } from '@tabler/icons-react'
import type { ClientModule } from '../client'
import { RealEstateSubtitle } from './RealEstateSubtitle'

// Pages sit right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const realEstateClient: ClientModule = {
  key: 'real_estate',
  icon: IconHome,
  assetRecords: { kind: 'realEstate', path: '/real-estate' },
  routes: [{
    section: 'data', path: '/real-estate', area: '/assets', menu: false, title: 'modules.real_estate.title', icon: IconHome, order: 40, subtitle: RealEstateSubtitle,
    page: lazy(() => import('./RealEstateScreen').then(m => ({ default: m.RealEstateScreen }))),
  }],
}
