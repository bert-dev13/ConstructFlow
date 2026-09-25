import { projectIdParams as generateStaticParams } from '../../../../../src/routeParams';
import LegacyRedirect from './LegacyRedirect';

export { generateStaticParams };

export default function Page() {
  return <LegacyRedirect />;
}
