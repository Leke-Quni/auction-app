import { FormCardSkeleton } from "../skeleton";

export default function Loading() {
  return <FormCardSkeleton title="lg" fields={[0, 0]} labels={false} forgot fullButton footer wrapped />;
}
