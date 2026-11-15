// The Real estate screen in Records: the table rows and the property editor.
import { useTranslation } from 'react-i18next'
import { useAdminRows } from '../../pages/admin/useAdminRows'
import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
import { LoadingScreen } from '../../pages/admin/ui/LoadingScreen'
import { RealEstateView } from './RealEstateView'

export function RealEstateScreen() {
  const { t } = useTranslation()
  const { rows, setRows, loaded, query } = useAdminRows('real_estate')
  return (
    <>
      <AdminReadNotice queries={[query]} />
      {query.data !== undefined ? <RealEstateView rows={rows} setRows={setRows} /> : !loaded ? <LoadingScreen action={t('modules.real_estate.add')} /> : null}
    </>
  )
}
