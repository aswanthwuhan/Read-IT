import { usePwaUpdates } from './registration';
import PwaUpdateBannerView from './PwaUpdateBannerView';

export default function PwaUpdateBanner() {
  const { state, reload, later } = usePwaUpdates();
  return <PwaUpdateBannerView state={state} onReload={reload} onLater={later} />;
}
