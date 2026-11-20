import { Loading } from '../../../components/ui/Loading'
import { PageAction } from './PageAction'

/** While the screen loads, its button already stands in the header, disabled, so the header does not jump after loading. */
export function LoadingScreen({ action }: { action: string }) {
  return (
    <>
      <PageAction><button className="btn btn--primary" disabled>{action}</button></PageAction>
      <Loading className="empty" />
    </>
  )
}
