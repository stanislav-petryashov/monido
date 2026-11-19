// The components of src/components/ui: one entry each, its states as variants. Data only (react-refresh).
import { IconAlertTriangle, IconCheck, IconHome } from '@tabler/icons-react'
import { Avatar } from '../../src/components/ui/Avatar'
import { Card } from '../../src/components/ui/Card'
import { Chip } from '../../src/components/ui/Chip'
import { Disclosure, DisclosureGroup } from '../../src/components/ui/Disclosure'
import { DisclosureChevron } from '../../src/components/ui/DisclosureChevron'
import { Link } from '../../src/components/ui/Link'
import { Loading } from '../../src/components/ui/Loading'
import { Notice } from '../../src/components/ui/Notice'
import { OwnerAvatar } from '../../src/components/ui/OwnerAvatar'
import { ProgressTrack } from '../../src/components/ui/ProgressTrack'
import { Ring } from '../../src/components/ui/Ring'
import { SectionLabel } from '../../src/components/ui/SectionLabel'
import { SegmentedBar } from '../../src/components/ui/SegmentedBar'
import { PageSkeleton, Skeleton } from '../../src/components/ui/Skeleton'
import { Toaster } from '../../src/components/ui/Toaster'
import { ViewOnlyNote } from '../../src/components/ui/ViewOnlyNote'
import type { DesignEntry } from '../registry'
import { ConfirmSample, DialogSample, PasswordSample, PillsSample, RadioMenuSample, SwitchSample, ToastSample } from '../samples'

const MEMBERS = ['Alex', 'Sam']
const ui = (file: string) => `src/components/ui/${file}`

export const UI_ENTRIES: DesignEntry[] = [
  { name: 'Card', use: 'The one surface of a block on the ground; not for menus or dialogs (they float on --raised).', kind: 'component', from: ui('Card.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'default', render: () => <Card><p>A block of content.</p></Card> },
    { label: 'plain', render: () => <Card plain><p>Without its padding.</p></Card> },
  ] },
  { name: 'Chip', use: 'A status only (on track, overdue); not a tag, a filter or a count.', kind: 'component', from: ui('Chip.tsx'), owner: 'src/styles/tokens.css', variants:
    (['secondary', 'success', 'warning', 'error', 'info', 'primary'] as const).map(color => ({ label: color, render: () => <Chip color={color}>{color}</Chip> })) },
  { name: 'Avatar', use: 'An icon in a tinted circle; for a person use OwnerAvatar.', kind: 'component', from: ui('Avatar.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'sm', render: () => <Avatar icon={IconHome} color="info" size="sm" /> },
    { label: 'lg, success', render: () => <Avatar icon={IconCheck} color="success" size="lg" /> },
    { label: 'sm, warning', render: () => <Avatar icon={IconAlertTriangle} color="warning" size="sm" /> },
  ] },
  { name: 'OwnerAvatar', use: 'A family member: the initial on the member tint; not for icons (Avatar).', kind: 'component', from: ui('OwnerAvatar.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'first member', render: () => <OwnerAvatar member="Alex" members={MEMBERS} /> },
    { label: 'second member', render: () => <OwnerAvatar member="Sam" members={MEMBERS} /> },
    { label: 'no member', render: () => <OwnerAvatar member="" members={MEMBERS} name="Shared" /> },
  ] },
  { name: 'Link', use: 'Every in-app link (client routing); give it .link-accent in text; not for an action (a button).', kind: 'component', from: ui('Link.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'accent', render: () => <Link to="/design/" className="link-accent">What changed our net worth</Link> },
  ] },
  { name: 'SectionLabel', use: 'The title of a section inside a page; not a card title (.card-hd).', kind: 'component', from: ui('SectionLabel.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <SectionLabel>Assets</SectionLabel> },
  ] },
  { name: 'Notice', use: 'A short message in the flow of a page: neutral, warning or subtle; not a toast.', kind: 'component', from: ui('Notice.tsx'), owner: 'src/styles/tokens.css', variants:
    (['neutral', 'warning', 'subtle'] as const).map(tone => ({ label: tone, render: () => <Notice tone={tone} title="Tracking is off">Income and expenses are not recorded.</Notice> })) },
  { name: 'ViewOnlyNote', use: 'The line that says a person may only view a screen; not a general notice.', kind: 'component', from: ui('ViewOnlyNote.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'edit', render: () => <ViewOnlyNote right="edit" /> },
  ] },
  { name: 'ProgressTrack', use: 'Progress towards a target as a filled track (violet fill); not a share of a whole (SegmentedBar).', kind: 'component', from: ui('ProgressTrack.tsx'), owner: 'src/styles/progress-track.css', variants: [
    { label: 'compact', render: () => <ProgressTrack pct={42} label="Emergency fund" valueText="42%" /> },
    { label: 'tall, full', render: () => <ProgressTrack pct={100} label="Car" valueText="100%" size="tall" /> },
  ] },
  { name: 'SegmentedBar', use: 'A share shown in segments (health, a member); not progress to a target (ProgressTrack).', kind: 'component', from: ui('SegmentedBar.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: '60%', render: () => <SegmentedBar pct={60} label="Savings rate" /> },
  ] },
  { name: 'Ring', use: 'One score in a ring (financial health); not a chart of several values.', kind: 'component', from: ui('Ring.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'large', render: () => <Ring pct={72} label="Health" center="72" /> },
    { label: 'small, amber', render: () => <Ring pct={45} size={44} label="Health" amberAt={[5]} /> },
  ] },
  { name: 'SegmentedPills', use: 'A choice of one view among a few (a period); not navigation between pages.', kind: 'component', from: ui('SegmentedPills.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <PillsSample /> },
    { label: 'with a disabled pill', render: () => <PillsSample withDisabled /> },
  ] },
  { name: 'Switch', use: 'An on/off setting that applies at once; not a choice that needs Save.', kind: 'component', from: ui('Switch.tsx'), owner: 'src/styles/controls.css', variants: [
    { label: 'on', render: () => <SwitchSample /> },
    { label: 'disabled', render: () => <SwitchSample disabled /> },
  ] },
  { name: 'RadioMenu', use: 'A small menu of exclusive options behind a trigger; not a form select (Select).', kind: 'component', from: ui('RadioMenu.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'default', render: () => <RadioMenuSample /> },
  ] },
  { name: 'PasswordInput', use: 'Every password field (show/hide); not a plain input.', kind: 'component', from: ui('PasswordInput.tsx'), owner: 'src/styles/controls.css', variants: [
    { label: 'empty', render: () => <PasswordSample /> },
    { label: 'invalid', render: () => <PasswordSample invalid /> },
  ] },
  { name: 'Disclosure', use: 'A section that opens on demand (row) or a quiet note (inline); not an accordion of cards.', kind: 'component', from: ui('Disclosure.tsx'), owner: 'src/styles/disclosure.css', variants: [
    { label: 'row in a group', render: () => <DisclosureGroup><Disclosure title="History" hint="12 months"><p>Rows appear here.</p></Disclosure></DisclosureGroup> },
    { label: 'inline', render: () => <Disclosure variant="inline" title="2 earlier milestones"><p>Folded content.</p></Disclosure> },
  ] },
  { name: 'DisclosureGroup', use: 'The frame of several row Disclosures in one card; shown under Disclosure.', kind: 'component', from: ui('Disclosure.tsx'), owner: 'src/styles/disclosure.css', variants: [] },
  { name: 'DisclosureChevron', use: 'The chevron of a disclosure or an expandable row; not a navigation arrow.', kind: 'component', from: ui('DisclosureChevron.tsx'), owner: 'src/styles/disclosure.css', variants: [
    { label: '18 and 16', render: () => <span><DisclosureChevron /> <DisclosureChevron size={16} /></span> },
  ] },
  { name: 'Loading', use: 'A loading line while a query is pending; for a whole page use PageSkeleton.', kind: 'component', from: ui('Loading.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <Loading /> },
    { label: 'quiet', render: () => <Loading quiet /> },
  ] },
  { name: 'Skeleton', use: 'A placeholder block of a known size while data loads.', kind: 'component', from: ui('Skeleton.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'line', render: () => <Skeleton width={240} /> },
  ] },
  { name: 'PageSkeleton', use: 'A dashboard page while its snapshot loads; not inside a card (Skeleton).', kind: 'component', from: ui('Skeleton.tsx'), owner: 'src/styles/tokens.css', variants: [
    { label: 'default', render: () => <PageSkeleton /> },
  ] },
  { name: 'Dialog', use: 'Every modal window (with useModalDialog); not a popover or a menu.', kind: 'component', from: ui('Dialog.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'opens on demand', render: () => <DialogSample /> },
  ] },
  { name: 'ConfirmDialog', use: 'A yes/no question before an irreversible step, through useConfirm; never built by hand.', kind: 'component', from: ui('ConfirmDialog.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'danger', render: () => <ConfirmSample tone="danger" /> },
    { label: 'warning', render: () => <ConfirmSample tone="warning" /> },
  ] },
  { name: 'Toaster', use: 'Toasts after an action, through useToast; not a notice in the page.', kind: 'component', from: ui('Toaster.tsx'), owner: 'src/styles/ui-surfaces.css', variants: [
    { label: 'success', render: () => <ToastSample tone="success" /> },
    { label: 'error', render: () => <ToastSample tone="error" /> },
    { label: 'empty host', render: () => <Toaster toasts={[]} onDismiss={() => {}} /> },
  ] },
]
